import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import {
  PROJECTS_DIR, META_DIR, REGISTRY_FILE, PROJECT_PORT_START, PROJECT_PORT_END,
  ensureDataDirs, readJson, writeJsonAtomic,
} from './config.js'
import { scaffoldProject, slugify } from './scaffold.js'
import { gitInit, gitCommitAll, gitLog, gitStatusShort, gitDiff } from './git.js'

const EMPTY_REGISTRY = { projects: [], version: 1 }

async function readRegistry() {
  await ensureDataDirs()
  const data = await readJson(REGISTRY_FILE, EMPTY_REGISTRY)
  if (!data || !Array.isArray(data.projects)) return { ...EMPTY_REGISTRY }
  return data
}

async function writeRegistry(registry) {
  await writeJsonAtomic(REGISTRY_FILE, registry)
}

/** Find the lowest port in range that is both unassigned and not listening. */
async function allocatePort(registry) {
  const taken = new Set(registry.projects.map((p) => p.port).filter(Boolean))
  for (let port = PROJECT_PORT_START; port <= PROJECT_PORT_END; port++) {
    if (taken.has(port)) continue
    const free = await new Promise((resolve) => {
      const tester = createServer()
      tester.once('error', () => resolve(false))
      tester.once('listening', () => tester.close(() => resolve(true)))
      tester.listen(port, '127.0.0.1')
    })
    if (free) return port
  }
  throw new Error(`No free port available in range ${PROJECT_PORT_START}-${PROJECT_PORT_END}`)
}

export function projectPath(slug) {
  return path.join(PROJECTS_DIR, slug)
}

export function metaPath(id) {
  return path.join(META_DIR, id)
}

/** Serialize a project for the API. Runtime status is injected by the caller. */
function toPublic(project, runtime = {}) {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    path: project.path,
    port: project.port,
    template: project.template,
    designId: project.designId || null,
    usage: project.usage || { inputTokens: 0, outputTokens: 0, turns: 0 },
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    previewUrl: project.port ? `http://127.0.0.1:${project.port}` : null,
    ...runtime,
  }
}

export async function listProjects() {
  const registry = await readRegistry()
  return [...registry.projects].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
}

export async function getProject(idOrSlug) {
  const registry = await readRegistry()
  const key = String(idOrSlug || '').toLowerCase()
  return registry.projects.find(
    (p) => p.id === idOrSlug || p.slug.toLowerCase() === key || p.name.toLowerCase() === key,
  ) || null
}

export async function touchProject(id) {
  const registry = await readRegistry()
  const project = registry.projects.find((p) => p.id === id)
  if (!project) return null
  project.updatedAt = Date.now()
  await writeRegistry(registry)
  return project
}

export async function createProject({ name, template = 'react-vite' }) {
  await ensureDataDirs()
  const registry = await readRegistry()

  const baseSlug = slugify(name)
  let slug = baseSlug
  let n = 2
  const taken = new Set(registry.projects.map((p) => p.slug))
  while (taken.has(slug)) slug = `${baseSlug}-${n++}`

  const dir = projectPath(slug)
  if (existsSync(dir)) {
    throw new Error(`Directory already exists at ${dir}`)
  }

  const port = await allocatePort(registry)
  const id = randomUUID()

  await mkdir(dir, { recursive: true })
  try {
    await scaffoldProject(dir, { name, slug, template })
    await mkdir(metaPath(id), { recursive: true })
  } catch (err) {
    // Never leave a half-built folder behind: it would show up as an orphan
    // and permanently block that slug.
    await rm(dir, { recursive: true, force: true }).catch(() => {})
    await rm(metaPath(id), { recursive: true, force: true }).catch(() => {})
    throw err
  }

  const project = {
    id,
    name,
    slug,
    path: dir,
    port,
    template,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  registry.projects.push(project)
  await writeRegistry(registry)

  // Best-effort version control; a missing git binary must not block creation.
  try {
    await gitInit(dir)
    await gitCommitAll(dir, 'Initial scaffold')
  } catch (err) {
    console.warn(`[registry] git init failed for ${slug}: ${err.message}`)
  }

  return project
}

export async function renameProject(id, name) {
  const registry = await readRegistry()
  const project = registry.projects.find((p) => p.id === id)
  if (!project) throw new Error('Project not found')
  project.name = name
  project.updatedAt = Date.now()
  await writeRegistry(registry)
  return project
}

/** Set (or clear, when designId is null) the design preset for a project. */
export async function setProjectDesign(id, designId) {
  const registry = await readRegistry()
  const project = registry.projects.find((p) => p.id === id)
  if (!project) throw new Error('Project not found')
  if (designId) project.designId = designId
  else delete project.designId
  await writeRegistry(registry)
  return project
}

/** Accumulate token usage for a project across turns. */
export async function addProjectUsage(id, usage) {
  const registry = await readRegistry()
  const project = registry.projects.find((p) => p.id === id)
  if (!project) return null
  const current = project.usage || { inputTokens: 0, outputTokens: 0, turns: 0 }
  project.usage = {
    inputTokens: current.inputTokens + (usage?.inputTokens || 0),
    outputTokens: current.outputTokens + (usage?.outputTokens || 0),
    turns: current.turns + 1,
  }
  await writeRegistry(registry)
  return project.usage
}

/** Adopt an existing folder on disk as a project (no scaffold, no copy). */
export async function importProject({ name, dir }) {
  await ensureDataDirs()
  const registry = await readRegistry()

  const abs = path.resolve(dir)
  const info = await stat(abs).catch(() => null)
  if (!info || !info.isDirectory()) throw new Error(`Not a directory: ${dir}`)
  if (registry.projects.some((p) => path.resolve(p.path) === abs)) {
    throw new Error('That folder is already registered as a project')
  }

  const baseSlug = slugify(name || path.basename(abs))
  let slug = baseSlug
  let n = 2
  const taken = new Set(registry.projects.map((p) => p.slug))
  while (taken.has(slug)) slug = `${baseSlug}-${n++}`

  const port = await allocatePort(registry)
  const id = randomUUID()
  await mkdir(metaPath(id), { recursive: true })

  const project = {
    id,
    name: name || path.basename(abs),
    slug,
    path: abs,
    port,
    template: 'imported',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  registry.projects.push(project)
  await writeRegistry(registry)

  try {
    await gitInit(abs)
    await gitCommitAll(abs, 'Imported into Lovable Local')
  } catch (err) {
    console.warn(`[registry] git init failed for imported ${slug}: ${err.message}`)
  }
  return project
}

export async function deleteProject(id) {
  const registry = await readRegistry()
  const index = registry.projects.findIndex((p) => p.id === id)
  if (index === -1) throw new Error('Project not found')
  const [project] = registry.projects.splice(index, 1)
  await writeRegistry(registry)

  await rm(project.path, { recursive: true, force: true })
  await rm(metaPath(project.id), { recursive: true, force: true })
  return project
}

/* ------------------------------- chat history ------------------------------ */

export async function loadHistory(id) {
  const file = path.join(metaPath(id), 'history.json')
  const data = await readJson(file, { messages: [] })
  return Array.isArray(data.messages) ? data.messages : []
}

export async function appendHistory(id, messages) {
  const file = path.join(metaPath(id), 'history.json')
  await mkdir(metaPath(id), { recursive: true })
  const current = await readJson(file, { messages: [] })
  const list = Array.isArray(current.messages) ? current.messages : []
  list.push(...messages)
  // Keep the on-disk transcript bounded so long-lived projects stay loadable.
  const trimmed = list.slice(-400)
  await writeJsonAtomic(file, { messages: trimmed, updatedAt: Date.now() })
  return trimmed
}

export async function clearHistory(id) {
  const file = path.join(metaPath(id), 'history.json')
  await mkdir(metaPath(id), { recursive: true })
  await writeJsonAtomic(file, { messages: [], updatedAt: Date.now() })
}

/* ------------------------------ git shortcuts ----------------------------- */

export async function projectGitSummary(project) {
  try {
    const [status, log] = await Promise.all([
      gitStatusShort(project.path),
      gitLog(project.path, 20),
    ])
    return { available: true, status, log }
  } catch (err) {
    return { available: false, error: err.message }
  }
}

export async function projectDiff(project, ref) {
  return gitDiff(project.path, ref)
}

/** List project folders present on disk but missing from the registry (orphans). */
export async function findOrphanDirs() {
  await ensureDataDirs()
  const registry = await readRegistry()
  const known = new Set(registry.projects.map((p) => p.slug))
  let entries = []
  try {
    entries = await readdir(PROJECTS_DIR, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.filter((e) => e.isDirectory() && !known.has(e.name)).map((e) => e.name)
}

export { toPublic }
