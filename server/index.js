import http from 'node:http'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import {
  ROOT_DIR, WEB_DIR, DATA_DIR, CONTROL_PORT, CONTROL_HOST,
  APP_VERSION, PRODUCT_ID, PRODUCT_NAME, COMPANY, REPOSITORY,
  PROJECT_PORT_START, PROJECT_PORT_END, MAX_RUNNING_SERVERS,
  ensureDataDirs, loadSettings, saveSettings, keySource,
  OPENAI_COMPATIBLE_PRESETS, IMAGE_SIZE_PRESETS,
} from './config.js'
import {
  listProjects, getProject, createProject, renameProject, deleteProject,
  loadHistory, clearHistory, projectGitSummary, projectDiff, toPublic, findOrphanDirs,
  setProjectDesign, setProjectSkills, addProjectUsage, importProject,
} from './registry.js'
import { manager, bus, emit } from './devserver.js'
import { runAgentTurn } from './agent.js'
import { providerReady, testConnection } from './llm/index.js'
import { imageCapability, testImageConnection } from './llm/image.js'
import { MOCK_WARNING } from './llm/mock.js'
import { getFileTree, readProjectFile, writeProjectFile, searchProjectFiles } from './files.js'
import { gitShowDiff, gitRestore, gitDiscardWorking, gitCommitAll, gitStatusShort } from './git.js'
import { executeTool } from './tools.js'
import { zipDirectory } from './zip.js'
import { designCatalog, getDesign } from './designs.js'
import { skillCatalog, getSkill, createSkill, updateSkill, deleteSkill } from './skills.js'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

const MAX_BODY = 12 * 1024 * 1024

/** In-flight agent turns, so a project can be aborted and cannot run twice. */
const activeTurns = new Map()

/* ------------------------------- helpers -------------------------------- */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function sendError(res, status, message, extra = {}) {
  sendJson(res, status, { error: message, ...extra })
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw Object.assign(new Error('Request body too large'), { status: 413 })
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  const raw = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(raw)
  } catch {
    throw Object.assign(new Error('Request body is not valid JSON'), { status: 400 })
  }
}

async function serveStatic(req, res, urlPath) {
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
  const target = path.resolve(WEB_DIR, relative)
  if (!target.startsWith(WEB_DIR)) return sendError(res, 403, 'Forbidden')
  if (!existsSync(target)) {
    // SPA fallback so client-side routes work.
    const fallback = path.join(WEB_DIR, 'index.html')
    if (!existsSync(fallback)) return sendError(res, 404, 'Not found')
    const html = await readFile(fallback)
    res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' })
    return res.end(html)
  }
  const content = await readFile(target)
  res.writeHead(200, {
    'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'cache-control': 'no-store',
  })
  res.end(content)
}

function openSse(req, res, filter) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  res.write('retry: 2000\n\n')

  const send = (payload) => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    } catch {
      /* client gone */
    }
  }

  send({ type: 'hello', at: Date.now() })

  const listener = (event) => {
    if (filter && event.projectId && event.projectId !== filter) return
    send(event)
  }
  bus.on('event', listener)

  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n') } catch { /* ignore */ }
  }, 25_000)

  req.on('close', () => {
    clearInterval(heartbeat)
    bus.off('event', listener)
  })
}

function publicSettings(settings) {
  return {
    provider: settings.provider,
    anthropic: {
      ...settings.anthropic,
      apiKey: settings.anthropic.apiKey ? '•'.repeat(8) : '',
      hasKey: Boolean(settings.anthropic.apiKey),
      keySource: keySource(settings, 'anthropic'),
    },
    openai: {
      ...settings.openai,
      apiKey: settings.openai.apiKey ? '•'.repeat(8) : '',
      hasKey: Boolean(settings.openai.apiKey),
      keySource: keySource(settings, 'openai'),
    },
    image: {
      ...settings.image,
      apiKey: settings.image.apiKey ? '•'.repeat(8) : '',
      hasKey: Boolean(settings.image.apiKey),
      keySource: keySource(settings, 'image'),
    },
    agent: settings.agent,
  }
}

/** Merge live dev-server state onto a registry record. */
function withRuntime(project) {
  const server = manager.peek(project.id)
  return toPublic(project, server
    ? { status: server.status, previewUrl: server.previewUrl, lastError: server.lastError }
    : { status: 'stopped', lastError: null })
}

async function requireProject(res, idOrSlug) {
  const project = await getProject(idOrSlug)
  if (!project) {
    sendError(res, 404, `No project matching "${idOrSlug}"`)
    return null
  }
  return project
}

/* -------------------------------- routing -------------------------------- */

const routes = []
function route(method, pattern, handler) {
  const keys = []
  const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => {
    keys.push(k)
    return '([^/]+)'
  })}$`)
  routes.push({ method, regex, keys, handler })
}

/* health + settings */

route('GET', '/api/health', async (_req, res) => {
  const settings = await loadSettings()
  const projects = await listProjects()
  const image = imageCapability(settings, settings.provider)
  sendJson(res, 200, {
    ok: true,
    version: APP_VERSION,
    productId: PRODUCT_ID,
    product: PRODUCT_NAME,
    company: COMPANY,
    repository: REPOSITORY || null,
    root: ROOT_DIR,
    dataDir: DATA_DIR,
    projects: projects.length,
    running: manager.all().filter((s) => s.status === 'running').length,
    provider: settings.provider,
    providerReady: Boolean(settings[settings.provider]?.apiKey),
    imageReady: image.available,
    imageModel: image.model || null,
  })
})

route('GET', '/api/settings', async (_req, res) => {
  sendJson(res, 200, publicSettings(await loadSettings()))
})

route('PUT', '/api/settings', async (req, res) => {
  const patch = await readBody(req)
  // Never let a redacted placeholder overwrite a real key.
  for (const provider of ['anthropic', 'openai', 'image']) {
    if (patch[provider]?.apiKey?.includes('•')) delete patch[provider].apiKey
  }
  const next = await saveSettings(patch)
  sendJson(res, 200, publicSettings(next))
})

route('GET', '/api/providers', async (_req, res) => {
  const settings = await loadSettings()
  const image = imageCapability(settings, settings.provider)
  sendJson(res, 200, {
    presets: OPENAI_COMPATIBLE_PRESETS,
    imageSizes: IMAGE_SIZE_PRESETS,
    providers: ['openai', 'anthropic', 'mock'],
    active: settings.provider,
    ready: {
      openai: providerReady(settings, 'openai'),
      anthropic: providerReady(settings, 'anthropic'),
      mock: true,
    },
    image: {
      available: image.available,
      model: image.model || null,
      host: image.host || null,
      source: image.source || null,
      fallbacks: image.fallbacks || [],
    },
    mockWarning: MOCK_WARNING,
  })
})

route('POST', '/api/settings/test', async (req, res) => {
  const { provider } = await readBody(req).catch(() => ({}))
  const settings = await loadSettings()
  const target = provider || settings.provider
  if (!providerReady(settings, target)) {
    return sendJson(res, 200, { ok: false, provider: target, error: 'No API key configured for this provider.' })
  }
  sendJson(res, 200, await testConnection(settings, target))
})

/** Generates a tiny 256×256 image so a bad endpoint is caught in Settings. */
route('POST', '/api/settings/test-image', async (req, res) => {
  const settings = await loadSettings()
  sendJson(res, 200, await testImageConnection(settings, settings.provider))
})

route('GET', '/api/designs', async (_req, res) => {
  sendJson(res, 200, { designs: designCatalog() })
})

/* skills */

route('GET', '/api/skills', async (_req, res) => {
  sendJson(res, 200, { skills: await skillCatalog() })
})

route('POST', '/api/skills', async (req, res) => {
  const body = await readBody(req)
  try {
    const skill = await createSkill(body)
    sendJson(res, 201, skill)
  } catch (err) {
    sendError(res, err.status || 500, err.message)
  }
})

route('PUT', '/api/skills/:skillId', async (req, res, params) => {
  const body = await readBody(req)
  try {
    const skill = await updateSkill(params.skillId, body)
    sendJson(res, 200, skill)
  } catch (err) {
    sendError(res, err.status || 500, err.message)
  }
})

route('DELETE', '/api/skills/:skillId', async (req, res, params) => {
  try {
    const deleted = await deleteSkill(params.skillId)
    if (!deleted) return sendError(res, 404, 'No such user skill')
    sendJson(res, 200, { deleted: params.skillId })
  } catch (err) {
    sendError(res, err.status || 500, err.message)
  }
})

route('GET', '/api/templates', async (_req, res) => {
  sendJson(res, 200, {
    templates: [
      { id: 'react-vite', label: 'React + Vite + Tailwind', hint: 'TypeScript, react-router, the full agent stack' },
      { id: 'vue-vite', label: 'Vue + Vite + Tailwind', hint: 'Vue 3 SFCs, TypeScript, same preview bridge' },
    ],
  })
})

/* projects */

route('GET', '/api/projects', async (_req, res) => {
  const projects = await listProjects()
  sendJson(res, 200, {
    projects: projects.map(withRuntime),
    servers: manager.all(),
    orphans: await findOrphanDirs(),
  })
})

route('POST', '/api/projects', async (req, res) => {
  const { name, template } = await readBody(req)
  if (!name || !String(name).trim()) return sendError(res, 400, 'name is required')
  try {
    const project = await createProject({ name: String(name).trim(), template })
    emit(project.id, 'project:created', { name: project.name, slug: project.slug, port: project.port })
    sendJson(res, 201, withRuntime(project))
  } catch (err) {
    sendError(res, 500, err.message)
  }
})

route('POST', '/api/projects/import', async (req, res) => {
  const { name, dir } = await readBody(req)
  if (!dir || !String(dir).trim()) return sendError(res, 400, 'dir is required')
  try {
    const project = await importProject({ name: String(name || '').trim(), dir: String(dir).trim() })
    emit(project.id, 'project:created', { name: project.name, slug: project.slug, port: project.port })
    sendJson(res, 201, withRuntime(project))
  } catch (err) {
    sendError(res, 500, err.message)
  }
})

route('GET', '/api/projects/:id', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  sendJson(res, 200, withRuntime(project))
})

route('PATCH', '/api/projects/:id', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  const { name } = await readBody(req)
  if (!name) return sendError(res, 400, 'name is required')
  const updated = await renameProject(project.id, String(name).trim())
  sendJson(res, 200, withRuntime(updated))
})

route('PUT', '/api/projects/:id/design', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  const { designId } = await readBody(req)
  if (designId && !getDesign(designId)) {
    return sendError(res, 400, `Unknown design "${designId}"`)
  }
  const updated = await setProjectDesign(project.id, designId || null)
  emit(project.id, 'design:changed', { designId: updated.designId || null })
  sendJson(res, 200, withRuntime(updated))
})

route('PUT', '/api/projects/:id/skills', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  const { skillIds } = await readBody(req)
  if (!Array.isArray(skillIds)) return sendError(res, 400, 'skillIds must be an array')
  const updated = await setProjectSkills(project.id, skillIds)
  emit(project.id, 'skills:changed', { skillIds: updated.skillIds || [] })
  sendJson(res, 200, withRuntime(updated))
})

route('DELETE', '/api/projects/:id', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  await manager.peek(project.id)?.stop()
  activeTurns.get(project.id)?.controller.abort()
  activeTurns.delete(project.id)
  const deleted = await deleteProject(project.id)
  sendJson(res, 200, { deleted: deleted.slug })
})

/* dev server control */

route('POST', '/api/projects/:id/start', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  try {
    const snapshot = await manager.get(project).start()
    sendJson(res, 200, snapshot)
  } catch (err) {
    sendError(res, 500, err.message)
  }
})

route('POST', '/api/projects/:id/stop', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  await manager.peek(project.id)?.stop()
  sendJson(res, 200, manager.peek(project.id)?.snapshot() ?? { status: 'stopped' })
})

route('POST', '/api/projects/:id/restart', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  try {
    sendJson(res, 200, await manager.get(project).restart())
  } catch (err) {
    sendError(res, 500, err.message)  }
})

route('GET', '/api/projects/:id/logs', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  sendJson(res, 200, manager.peek(project.id)?.snapshot() ?? { logs: [], status: 'stopped' })
})

/* files + git */

route('GET', '/api/projects/:id/tree', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  sendJson(res, 200, { tree: await getFileTree(project.path) })
})

route('GET', '/api/projects/:id/file', async (req, res, params, query) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  const filePath = query.get('path')
  if (!filePath) return sendError(res, 400, 'path query parameter is required')
  try {
    sendJson(res, 200, await readProjectFile(project.path, filePath))
  } catch (err) {
    sendError(res, err.status || 500, err.message)
  }
})

route('PUT', '/api/projects/:id/file', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  const { path: filePath, content } = await readBody(req)
  if (!filePath || typeof content !== 'string') {
    return sendError(res, 400, 'path and content are required')
  }
  try {
    const result = await writeProjectFile(project.path, filePath, content)
    emit(project.id, 'file:written', { path: filePath, by: 'user' })
    sendJson(res, 200, result)
  } catch (err) {
    sendError(res, 500, err.message)
  }
})

route('GET', '/api/projects/:id/git', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  sendJson(res, 200, await projectGitSummary(project))
})

route('GET', '/api/projects/:id/diff', async (req, res, params, query) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  const ref = query.get('ref')
  const diff = ref ? await gitShowDiff(project.path, ref) : await projectDiff(project)
  sendJson(res, 200, { ref: ref || 'working-tree', diff })
})

route('GET', '/api/projects/:id/search', async (req, res, params, query) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  const pattern = query.get('pattern')
  if (!pattern) return sendError(res, 400, 'pattern query parameter is required')
  try {
    const hits = await searchProjectFiles(project.path, pattern, {
      filePattern: query.get('file') || undefined,
    })
    sendJson(res, 200, { pattern, hits })
  } catch (err) {
    sendError(res, err.status || 500, err.message)
  }
})

route('POST', '/api/projects/:id/typecheck', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  emit(project.id, 'log', { stream: 'system', line: 'Running typecheck: npm run typecheck' })
  const output = await executeTool('run_command', { command: 'npm run typecheck' }, {
    root: project.path,
    onLog: (text) => {
      for (const line of text.split('\n')) {
        if (line.trim()) emit(project.id, 'log', { stream: 'stdout', line })
      }
    },
  })
  const failed = !/^exit code 0/m.test(output)
  emit(project.id, 'log', { stream: 'system', line: failed ? 'Typecheck reported errors.' : 'Typecheck passed.' })
  emit(project.id, 'typecheck:done', { ok: !failed })
  sendJson(res, 200, { ok: !failed, output })
})

route('POST', '/api/projects/:id/restore', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  const { ref } = await readBody(req)
  if (!ref) return sendError(res, 400, 'ref is required')
  try {
    await gitRestore(project.path, ref)
    emit(project.id, 'file:written', { path: '.', by: 'restore' })
    sendJson(res, 200, { restored: ref })
  } catch (err) {
    sendError(res, 500, err.message)
  }
})

route('POST', '/api/projects/:id/commit', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  const { message } = await readBody(req)
  try {
    const pending = await gitStatusShort(project.path)
    if (!pending.length) return sendJson(res, 200, { committed: false, reason: 'no-changes' })
    const commit = await gitCommitAll(project.path, String(message || 'Manual commit'))
    emit(project.id, 'git:commit', { ...commit, files: pending.length })
    sendJson(res, 200, commit)
  } catch (err) {
    sendError(res, 500, err.message)
  }
})

route('POST', '/api/projects/:id/revert', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  try {
    await gitDiscardWorking(project.path)
    emit(project.id, 'file:written', { path: '.', by: 'revert' })
    sendJson(res, 200, { reverted: true })
  } catch (err) {
    sendError(res, 500, err.message)
  }
})

route('GET', '/api/projects/:id/export', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  const buffer = await zipDirectory(project.path)
  res.writeHead(200, {
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="${project.slug}.zip"`,
    'content-length': buffer.length,
    'cache-control': 'no-store',
  })
  res.end(buffer)
})

/* chat */

route('GET', '/api/projects/:id/history', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  sendJson(res, 200, { messages: await loadHistory(project.id) })
})

route('DELETE', '/api/projects/:id/history', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  await clearHistory(project.id)
  emit(project.id, 'history:cleared', {})
  sendJson(res, 200, { cleared: true })
})

route('POST', '/api/projects/:id/chat', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return

  if (activeTurns.has(project.id)) {
    return sendError(res, 409, 'An agent turn is already running for this project. Stop it first.')
  }

  const { message, mode = 'agent', provider, images = [] } = await readBody(req)
  if (!message || !String(message).trim()) return sendError(res, 400, 'message is required')

  // Accept data URLs ("data:image/png;base64,....") or raw base64 payloads.
  const parsedImages = (Array.isArray(images) ? images : [])
    .map((img) => {
      if (typeof img === 'string') {
        const match = img.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i)
        return match ? { mediaType: match[1], data: match[2] } : { mediaType: 'image/png', data: img }
      }
      if (img && typeof img.data === 'string') return { mediaType: img.mediaType || 'image/png', data: img.data }
      return null
    })
    .filter(Boolean)
    .slice(0, 8)

  const settings = await loadSettings()
  const chosen = provider || settings.provider
  if (!providerReady(settings, chosen)) {
    return sendError(res, 400, `No API key for "${chosen}". Add one in Settings.`, { needsKey: true })
  }

  const controller = new AbortController()
  activeTurns.set(project.id, { controller, startedAt: Date.now() })
  emit(project.id, 'turn:queued', { mode })

  // Respond immediately; progress arrives over SSE.
  sendJson(res, 202, { accepted: true, mode })

  // Make sure the preview is live so build errors feed back into the agent.
  if (mode === 'agent') {
    manager.get(project).start().catch((err) => {
      emit(project.id, 'log', { stream: 'system', line: `Could not start dev server: ${err.message}` })
      emit(project.id, 'system:notice', { message: `Dev server did not start: ${err.message}` })
    })
  }

  try {
    await runAgentTurn({
      project,
      userMessage: String(message),
      settings,
      mode,
      provider: chosen,
      signal: controller.signal,
      images: parsedImages,
    })
  } catch (err) {
    console.error(`[agent] turn failed for ${project.slug}:`, err.message)
    // runAgentTurn normally emits turn:error itself; this is the safety net so
    // no failure path can ever leave the chat panel without an explanation.
    if (!err.emitted) {
      emit(project.id, 'turn:error', { message: err.message || 'The agent stopped unexpectedly.', hint: err.hint })
    }
  } finally {
    activeTurns.delete(project.id)
  }
})

route('POST', '/api/projects/:id/abort', async (req, res, params) => {
  const turn = activeTurns.get(params.id)
  if (!turn) return sendError(res, 404, 'No active turn for this project')
  turn.controller.abort()
  activeTurns.delete(params.id)
  sendJson(res, 200, { aborted: true })
})

route('GET', '/api/projects/:id/status', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  sendJson(res, 200, {
    ...withRuntime(project),
    agentRunning: activeTurns.has(project.id),
    server: manager.peek(project.id)?.snapshot() ?? null,
  })
})

/* events */

route('GET', '/api/events', async (req, res) => openSse(req, res, null))
route('GET', '/api/projects/:id/events', async (req, res, params) => {
  const project = await requireProject(res, params.id)
  if (!project) return
  // Events carry the project UUID, but the route accepts a slug — filter on
  // the resolved id so both forms of the URL work.
  openSse(req, res, project.id)
})

/* --------------------------------- server -------------------------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const pathname = decodeURIComponent(url.pathname)

  if (pathname.startsWith('/api/')) {
    for (const candidate of routes) {
      if (candidate.method !== req.method) continue
      const match = pathname.match(candidate.regex)
      if (!match) continue
      const params = {}
      candidate.keys.forEach((key, i) => { params[key] = match[i + 1] })
      try {
        return await candidate.handler(req, res, params, url.searchParams)
      } catch (err) {
        console.error(`[api] ${req.method} ${pathname} failed:`, err)
        if (!res.headersSent) sendError(res, err.status || 500, err.message)
        return
      }
    }
    return sendError(res, 404, `No route for ${req.method} ${pathname}`)
  }

  try {
    return await serveStatic(req, res, pathname)
  } catch (err) {
    console.error('[static]', err)
    if (!res.headersSent) sendError(res, 500, err.message)
  }
})

server.on('clientError', (_err, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'))

async function main() {
  await ensureDataDirs()
  server.listen(CONTROL_PORT, CONTROL_HOST, async () => {
    const settings = await loadSettings()
    const image = imageCapability(settings, settings.provider)
    console.log('')
    console.log(`  ${PRODUCT_NAME} v${APP_VERSION} — built by ${COMPANY}`)
    console.log(`  product id      ${PRODUCT_ID}`)
    console.log(`  control panel   http://${CONTROL_HOST}:${CONTROL_PORT}`)
    console.log(`  data directory  ${DATA_DIR}`)
    console.log(`  provider        ${settings.provider} (${settings[settings.provider]?.apiKey ? 'key configured' : 'NO KEY — open Settings'})`)
    console.log(`  image model     ${image.available ? `${image.model} @ ${image.host}` : 'not configured (image_generation falls back to the text endpoint)'}`)
    console.log(`  dev servers     ports ${PROJECT_PORT_START}-${PROJECT_PORT_END}, max ${MAX_RUNNING_SERVERS} concurrent, ${manager.all().length} tracked`)
    console.log('')
  })
}

async function shutdown() {
  console.log('\n[shutdown] stopping dev servers…')
  await manager.stopAll()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 4000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err))

main().catch((err) => {
  console.error('Failed to start:', err)
  process.exit(1)
})
