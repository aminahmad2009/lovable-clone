/* Lovable Local — control panel frontend. Zero dependencies, no build step. */

const $ = (sel, root = document) => root.querySelector(sel)
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)]

const state = {
  projects: [],
  activeId: null,
  settings: null,
  providers: null,
  designs: [],
  designFilter: '',
  templates: [],
  pendingImages: [],
  searchTimer: null,
  view: 'preview',
  mode: 'agent',
  events: null,
  agentRunning: false,
  selectedFile: null,
  editorDirty: false,
  consoleLines: [],
  logs: [],
  commits: [],
  selectedCommit: null,
  /** tool call id -> DOM element */
  toolNodes: new Map(),
  currentAssistantEl: null,
  currentAssistantText: '',
  reconnectTimer: null,
}

/* -------------------------------- helpers ------------------------------- */

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`)
    err.status = res.status
    err.payload = data
    throw err
  }
  return data
}

function toast(message, kind = '') {
  const root = $('#toast-root')
  const node = document.createElement('div')
  node.className = `toast ${kind}`
  node.textContent = message
  root.appendChild(node)
  setTimeout(() => {
    node.style.opacity = '0'
    node.style.transition = 'opacity 0.3s'
    setTimeout(() => node.remove(), 320)
  }, 3200)
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue
    if (key === 'class') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key === 'html') node.innerHTML = value
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value)
    else node.setAttribute(key, value)
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    node.append(child.nodeType ? child : document.createTextNode(String(child)))
  }
  return node
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function activeProject() {
  return state.projects.find((p) => p.id === state.activeId) || null
}

function formatTokens(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function timeAgo(ts) {
  if (!ts) return ''
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

/* --------------------------------- theme -------------------------------- */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  try { localStorage.setItem('lovable-theme', theme) } catch { /* private mode */ }
  const btn = $('#theme-toggle')
  if (btn) {
    btn.textContent = theme === 'light' ? '☀' : '☾'
    btn.title = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'
  }
}

function initTheme() {
  let theme = null
  try { theme = localStorage.getItem('lovable-theme') } catch { /* ignore */ }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  applyTheme(theme)
}

function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light')
}

/* ------------------------------- bootstrap ------------------------------ */

async function boot() {
  try {
    const [health, settings, providers, designs, templates] = await Promise.all([
      api('/api/health'),
      api('/api/settings'),
      api('/api/providers'),
      api('/api/designs').catch(() => ({ designs: [] })),
      api('/api/templates').catch(() => ({ templates: [] })),
    ])
    state.settings = settings
    state.providers = providers
    state.designs = designs.designs || []
    state.templates = templates.templates || []
    renderTemplateChoices()
    renderProviderPill(health)
    await refreshProjects()
    renderSettingsProviderChoices()
    $('#mock-banner').hidden = settings.provider !== 'mock'
  } catch (err) {
    toast(`Could not reach the server: ${err.message}`, 'error')
  }
  wireGlobalEvents()
}

async function refreshProjects() {
  const data = await api('/api/projects')
  // Preserve live status for the active project if the server has it.
  const previous = new Map(state.projects.map((p) => [p.id, p]))
  state.projects = data.projects.map((p) => ({ ...previous.get(p.id), ...p }))
  renderSidebar()
  renderHome()
  if (state.activeId) {
    const still = state.projects.find((p) => p.id === state.activeId)
    if (!still) closeWorkspace()
    else renderTopbar()
  }
}

/* -------------------------------- sidebar ------------------------------- */

/** project id -> element, so status updates patch in place instead of
 *  rebuilding the list (which would detach nodes mid-click). */
const sidebarNodes = new Map()

function renderSidebar() {
  const list = $('#project-list')
  $('#project-count').textContent = state.projects.length

  const seen = new Set()

  for (const project of state.projects) {
    seen.add(project.id)
    const status = project.status || 'stopped'
    let node = sidebarNodes.get(project.id)

    if (!node || !node.isConnected) {
      node = el('button', { class: 'project-item', onclick: () => selectProject(project.id) },
        el('span', { class: 'dot' }),
        el('span', { class: 'pi-text' },
          el('span', { class: 'pi-name' }),
          el('span', { class: 'pi-sub' }),
        ),
      )
      sidebarNodes.set(project.id, node)
    }

    node.classList.toggle('active', project.id === state.activeId)
    node.title = `${project.name}\n${project.path}`
    node.querySelector('.dot').className = `dot ${status}`
    node.querySelector('.pi-name').textContent = project.name
    node.querySelector('.pi-sub').textContent = `:${project.port} · ${status}`
  }

  // Remove nodes for deleted projects, then append in registry order.
  for (const [id, node] of sidebarNodes) {
    if (!seen.has(id)) {
      node.remove()
      sidebarNodes.delete(id)
    }
  }
  list.replaceChildren(...state.projects.map((p) => sidebarNodes.get(p.id)).filter(Boolean))

  if (!state.projects.length && !list.querySelector('.empty-note')) {
    list.append(el('div', { class: 'empty-note' }, 'No projects yet'))
  }
}

let homeSignature = ''
const homeCards = new Map()

function renderHome() {
  const grid = $('#home-grid')
  const signature = state.projects.map((p) => `${p.id}:${p.name}:${p.slug}:${p.port}`).join('|')

  if (signature !== homeSignature) {
    homeSignature = signature
    homeCards.clear()
    grid.replaceChildren()

    for (const project of state.projects) {
      const card = el('div', { class: 'project-card', onclick: () => selectProject(project.id) },
        el('div', { class: 'pc-name', text: project.name }),
        el('div', { class: 'pc-meta' },
          el('span', { class: 'dot' }),
          el('span', { class: 'pc-slug' }),
        ),
        el('div', { class: 'muted small pc-updated' }),
        el('div', { class: 'pc-actions' },
          el('button', {
            class: 'btn btn-ghost btn-xs',
            onclick: (event) => { event.stopPropagation(); selectProject(project.id) },
          }, 'Open'),
          el('button', {
            class: 'btn btn-danger btn-xs',
            onclick: (event) => { event.stopPropagation(); confirmDelete(project) },
          }, 'Delete'),
        ),
      )
      homeCards.set(project.id, card)
      grid.append(card)
    }

    if (!state.projects.length) {
      grid.append(el('div', { class: 'empty-note' }, 'Your projects will appear here.'))
    }
  }

  // Patch volatile fields in place so the 12s poll never detaches cards.
  for (const project of state.projects) {
    const card = homeCards.get(project.id)
    if (!card) continue
    card.querySelector('.dot').className = `dot ${project.status || 'stopped'}`
    card.querySelector('.pc-slug').textContent = `${project.slug} · :${project.port}`
    card.querySelector('.pc-updated').textContent = `updated ${timeAgo(project.updatedAt)}`
  }
}

function renderProviderPill(health) {
  const ready = health?.providerReady
  const pill = $('#provider-pill')
  pill.innerHTML = ''
  pill.append(
    el('span', { class: `dot ${ready ? 'ok' : 'bad'}` }),
    el('span', { id: 'provider-pill-text', text: `${health?.provider || 'none'} · ${ready ? 'ready' : 'no key'}` }),
  )
}

/* ------------------------------- workspace ------------------------------ */

async function selectProject(id) {
  state.activeId = id
  state.consoleLines = []
  state.logs = []
  state.commits = []
  state.selectedFile = null
  state.toolNodes.clear()

  $('#home').hidden = true
  $('#workspace').hidden = false
  $('#chat-messages').replaceChildren()
  $('#console-body').replaceChildren()
  $('#console-count').textContent = '0'
  $('#console-strip').hidden = true
  $('#log-view').textContent = ''
  $('#editor').value = ''
  $('#editor').disabled = true
  $('#editor-path').textContent = 'no file selected'
  $('#btn-save').disabled = true
  $('#chat-input').disabled = false
  $('#chat-send').disabled = false
  $('#chat-hint').textContent = 'Enter to send · Shift+Enter for a new line'
  const attach = $('#btn-attach')
  if (attach) attach.disabled = false
  clearImages()
  hideReviewBar()
  clearSearchResults()

  renderSidebar()
  renderTopbar()
  switchView(state.view)

  const project = activeProject()
  if (!project) return

  connectEvents(project)
  await loadChatHistory(project)
  await refreshWorkspace(project)

  if (project.status !== 'running') {
    setPreviewOverlay(`Starting ${project.slug} on port ${project.port}…\nFirst run installs dependencies, which takes about 20 seconds.`)
    try {
      await api(`/api/projects/${project.id}/start`, { method: 'POST' })
    } catch (err) {
      setPreviewOverlay(`Dev server failed to start:\n${err.message}`, true)
    }
  }
}

function closeWorkspace() {
  state.activeId = null
  disconnectEvents()
  $('#workspace').hidden = true
  $('#home').hidden = false
  $('#chat-input').disabled = true
  $('#chat-send').disabled = true
  $('#chat-hint').textContent = 'Select a project to start'
  const attach = $('#btn-attach')
  if (attach) attach.disabled = true
  clearImages()
  hideReviewBar()
  renderSidebar()
}

function renderTopbar() {
  const project = activeProject()
  if (!project) return
  const status = project.status || 'stopped'
  $('#ws-name').textContent = project.name
  $('#ws-path').textContent = project.path
  $('#ws-port').textContent = `:${project.port}`

  const pill = $('#ws-status')
  pill.innerHTML = ''
  pill.append(el('i', { class: `dot ${status}` }), document.createTextNode(status))

  const usage = project.usage || {}
  const total = (usage.inputTokens || 0) + (usage.outputTokens || 0)
  $('#ws-usage').textContent = total
    ? `${formatTokens(usage.inputTokens || 0)}↑ ${formatTokens(usage.outputTokens || 0)}↓ · ${usage.turns || 0} turns`
    : ''

  const openBtn = $('#btn-open')
  openBtn.href = project.previewUrl || '#'
  if (!project.previewUrl) openBtn.removeAttribute('href')
  $('#preview-url').textContent = project.previewUrl || ''

  updateDesignTrigger()
}

/* -------------------------------- design -------------------------------- */

function currentDesign() {
  const project = activeProject()
  return state.designs.find((d) => d.id === project?.designId) || null
}

function updateDesignTrigger() {
  const btn = $('#btn-design')
  if (!btn) return
  const design = currentDesign()
  btn.querySelector('.dt-name').textContent = design ? design.name : 'Design'
  btn.classList.toggle('has-design', Boolean(design))
  btn.title = design ? `Design style: ${design.name} — click to change` : 'Pick a design style'
}

function renderDesignGrid() {
  const grid = $('#design-grid')
  if (!grid) return
  const q = state.designFilter.trim().toLowerCase()
  const project = activeProject()
  const matches = state.designs.filter((d) => !q
    || [d.name, d.description, ...(d.tags || [])].join(' ').toLowerCase().includes(q))

  grid.replaceChildren()
  if (!matches.length) {
    grid.append(el('div', { class: 'design-empty' }, 'No styles match that search.'))
    return
  }

  for (const design of matches) {
    const selected = project?.designId === design.id
    grid.append(el('button', {
      class: `design-card ${selected ? 'selected' : ''}`,
      onclick: () => selectDesign(design.id),
    },
      el('div', { class: 'dc-name' },
        el('span', { class: 'swatch-row' },
          ...(design.colors || []).map((c) => el('span', { class: 'swatch', style: `background:${c}` })),
        ),
        design.name,
      ),
      el('div', { class: 'dc-desc', text: design.description }),
      el('div', { class: 'dc-tags' },
        ...(design.tags || []).map((t) => el('span', { class: 'dc-tag', text: t })),
      ),
    ))
  }
}

function openDesign() {
  if (!activeProject()) { toast('Select a project first'); return }
  state.designFilter = ''
  const search = $('#design-search')
  search.value = ''
  renderDesignGrid()
  openModal('modal-design')
  setTimeout(() => search.focus(), 40)
}

async function selectDesign(designId) {
  const project = activeProject()
  if (!project) return
  try {
    const updated = await api(`/api/projects/${project.id}/design`, {
      method: 'PUT',
      body: { designId },
    })
    project.designId = updated.designId
    const design = state.designs.find((d) => d.id === designId)
    updateDesignTrigger()
    renderDesignGrid()
    toast(design ? `Design style set to ${design.name}` : 'Design style cleared', 'ok')
    closeModal()
  } catch (err) {
    toast(err.message, 'error')
  }
}

/* ------------------------------- templates ------------------------------ */

function renderTemplateChoices() {
  const select = $('#modal-new-template')
  if (!select) return
  select.replaceChildren()
  const list = state.templates.length
    ? state.templates
    : [{ id: 'react-vite', label: 'React + Vite + Tailwind' }]
  for (const t of list) select.append(el('option', { value: t.id, text: t.label, title: t.hint }))
}

/* ----------------------------- image attach ----------------------------- */

function addImageFiles(fileList) {
  for (const file of fileList) {
    if (!file.type.startsWith('image/')) continue
    if (state.pendingImages.length >= 8) break
    const reader = new FileReader()
    reader.onload = () => {
      state.pendingImages.push({ name: file.name, dataUrl: reader.result })
      renderImageThumbs()
    }
    reader.readAsDataURL(file)
  }
}

function renderImageThumbs() {
  const box = $('#chat-images')
  box.hidden = state.pendingImages.length === 0
  box.replaceChildren()
  state.pendingImages.forEach((img, index) => {
    box.append(el('div', { class: 'chat-thumb', title: img.name },
      el('img', { src: img.dataUrl, alt: img.name }),
      el('button', {
        type: 'button',
        title: 'Remove image',
        onclick: () => { state.pendingImages.splice(index, 1); renderImageThumbs() },
      }, '×'),
    ))
  })
}

function clearImages() {
  state.pendingImages = []
  const input = $('#chat-file')
  if (input) input.value = ''
  renderImageThumbs()
}

/* --------------------------- review before commit ------------------------ */

function showReviewBar(files) {
  const bar = $('#review-bar')
  bar.hidden = false
  $('#review-files').textContent = (files || []).slice(0, 6).join(', ')
    + ((files || []).length > 6 ? ` +${files.length - 6} more` : '')
}

function hideReviewBar() {
  $('#review-bar').hidden = true
}

async function approveReview() {
  const project = activeProject()
  if (!project) return
  try {
    const result = await api(`/api/projects/${project.id}/commit`, {
      method: 'POST',
      body: { message: 'Approved changes' },
    })
    hideReviewBar()
    toast(result.committed ? `Committed ${result.hash}` : 'Nothing to commit', 'ok')
    refreshWorkspace(project)
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function revertReview() {
  const project = activeProject()
  if (!project) return
  openConfirm(
    'Discard these changes?',
    'This reverts the working tree to the last commit, deleting the changes from this turn. This cannot be undone.',
    async () => {
      try {
        await api(`/api/projects/${project.id}/revert`, { method: 'POST' })
        hideReviewBar()
        toast('Changes reverted', 'ok')
        await refreshWorkspace(project)
        reloadPreview()
      } catch (err) {
        toast(err.message, 'error')
      }
    },
  )
}

/* -------------------------------- typecheck ------------------------------ */

async function runTypecheck() {
  const project = activeProject()
  if (!project) return
  switchView('logs')
  toast('Running typecheck…')
  try {
    const result = await api(`/api/projects/${project.id}/typecheck`, { method: 'POST' })
    toast(result.ok ? 'Typecheck passed' : 'Typecheck reported errors', result.ok ? 'ok' : 'error')
  } catch (err) {
    toast(err.message, 'error')
  }
}

/* --------------------------------- export -------------------------------- */

function exportProject() {
  const project = activeProject()
  if (!project) return
  const link = el('a', { href: `/api/projects/${project.id}/export`, download: `${project.slug}.zip` })
  document.body.append(link)
  link.click()
  link.remove()
  toast(`Downloading ${project.slug}.zip`)
}

/* ------------------------------ code search ------------------------------ */

function clearSearchResults() {
  const box = $('#search-results')
  box.hidden = true
  box.replaceChildren()
}

function renderSearchResults(hits) {
  const box = $('#search-results')
  box.replaceChildren()
  if (!hits.length) {
    box.hidden = false
    box.append(el('div', { class: 'empty-note' }, 'No matches'))
    return
  }
  box.hidden = false
  for (const hit of hits) {
    box.append(el('button', {
      class: 'search-hit',
      onclick: () => openFileAt(hit.path, hit.line),
    },
      el('span', { class: 'sh-loc', text: `${hit.path}:${hit.line}` }),
      el('span', { class: 'sh-text', text: hit.text }),
    ))
  }
}

async function runCodeSearch(pattern) {
  const project = activeProject()
  if (!project) return
  if (!pattern.trim()) { clearSearchResults(); return }
  try {
    const data = await api(`/api/projects/${project.id}/search?pattern=${encodeURIComponent(pattern)}`)
    renderSearchResults(data.hits || [])
  } catch (err) {
    renderSearchResults([])
    toast(err.message, 'error')
  }
}

async function openFileAt(filePath, line) {
  await openFile(filePath)
  if (!line) return
  const editor = $('#editor')
  if (editor.disabled) return
  const lines = editor.value.split('\n')
  const start = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0)
  const end = start + (lines[line - 1]?.length || 0)
  editor.focus()
  editor.setSelectionRange(start, end)
  editor.scrollTop = Math.max(0, (line - 5) * 20)
}

/* --------------------------------- restore ------------------------------- */

function restoreCommit() {
  const project = activeProject()
  const ref = state.selectedCommit
  if (!project || !ref) return
  openConfirm(
    `Restore working tree to ${ref}?`,
    'Files in the working tree are replaced with their content at this commit. Uncommitted changes are lost. The commit history is not rewritten.',
    async () => {
      try {
        await api(`/api/projects/${project.id}/restore`, { method: 'POST', body: { ref } })
        toast(`Restored to ${ref}`, 'ok')
        await refreshWorkspace(project)
        reloadPreview()
      } catch (err) {
        toast(err.message, 'error')
      }
    },
  )
}

/* --------------------------------- import -------------------------------- */

function openImport() {
  $('#modal-import-dir').value = ''
  $('#modal-import-name').value = ''
  openModal('modal-import')
  setTimeout(() => $('#modal-import-dir').focus(), 40)
}

async function doImport() {
  const dir = $('#modal-import-dir').value.trim()
  if (!dir) { toast('Enter a folder path', 'error'); return }
  try {
    const project = await api('/api/projects/import', {
      method: 'POST',
      body: { dir, name: $('#modal-import-name').value.trim() },
    })
    closeModal()
    await refreshProjects()
    await selectProject(project.id)
    toast(`Imported ${project.slug}`, 'ok')
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function refreshWorkspace(project) {
  const target = project || activeProject()
  if (!target) return
  const [status, tree, git] = await Promise.all([
    api(`/api/projects/${target.id}/status`).catch(() => null),
    api(`/api/projects/${target.id}/tree`).catch(() => null),
    api(`/api/projects/${target.id}/git`).catch(() => null),
  ])

  if (status) {
    target.status = status.status
    target.lastError = status.lastError
    state.agentRunning = Boolean(status.agentRunning)
    $('#btn-abort').hidden = !state.agentRunning
    if (status.server?.logs?.length) {
      state.logs = status.server.logs
      renderLogs()
    }
    renderSidebar()
    renderTopbar()
    updatePreviewState()
  }
  if (tree) renderFileTree(tree.tree)
  if (git) {
    state.commits = git.log || []
    renderCommits()
    if (git.status?.length) loadDiff(null)
  }
}

function switchView(view) {
  state.view = view
  for (const tab of $$('#tabs .tab')) tab.classList.toggle('active', tab.dataset.view === view)
  for (const pane of $$('.view')) pane.hidden = pane.id !== `view-${view}`
  if (view === 'preview') updatePreviewState()
  if (view === 'code') {
    const project = activeProject()
    if (project) api(`/api/projects/${project.id}/tree`).then((d) => renderFileTree(d.tree)).catch(() => {})
  }
  if (view === 'history') {
    const project = activeProject()
    if (project) api(`/api/projects/${project.id}/git`).then((g) => {
      state.commits = g.log || []
      renderCommits()
      loadDiff(state.selectedCommit)
    }).catch(() => {})
  }
  if (view === 'logs') renderLogs()
}

/* -------------------------------- preview ------------------------------- */

function updatePreviewState() {
  const project = activeProject()
  if (!project) return
  const frame = $('#preview-frame')
  const url = project.previewUrl

  if (project.status === 'running' && url) {
    if (frame.dataset.src !== url) {
      frame.dataset.src = url
      frame.src = url
    }
    hidePreviewOverlay()
  } else if (project.status === 'error') {
    setPreviewOverlay(`Build error:\n${project.lastError || 'The dev server reported a problem.'}\n\nCheck the Logs tab for detail.`, true)
  } else {
    setPreviewOverlay(`Dev server ${project.status || 'stopped'}.\nUse Restart to bring it back up.`)
  }
}

function setPreviewOverlay(text, isError = false) {
  const overlay = $('#preview-overlay')
  overlay.hidden = false
  overlay.innerHTML = ''
  overlay.append(el('div', { class: 'preview-overlay-inner' },
    isError
      ? el('div', { class: 'dot error', style: 'width:12px;height:12px' })
      : el('div', { class: 'spinner' }),
    el('p', { id: 'preview-overlay-text', text }),
  ))
}

function hidePreviewOverlay() {
  $('#preview-overlay').hidden = true
}

function reloadPreview() {
  const frame = $('#preview-frame')
  if (frame.src) frame.src = frame.src
}

/* Messages posted by src/preview-bridge.ts inside the generated app. */
window.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.source !== 'lovable-preview') return

  if (data.type === 'console') {
    pushConsole(data.level, data.text)
  } else if (data.type === 'runtime-error') {
    pushConsole('error', `${data.error?.message || 'Runtime error'}${data.error?.stack ? `\n${data.error.stack}` : ''}`)
  } else if (data.type === 'build-error') {
    pushConsole('error', `Build error: ${data.message}${data.file ? ` (${data.file})` : ''}`)
    const project = activeProject()
    if (project) {
      project.status = 'error'
      project.lastError = `${data.message}${data.file ? `\n${data.file}` : ''}`
      renderTopbar()
      updatePreviewState()
    }
  } else if (data.type === 'ready') {
    // The app booted cleanly inside the iframe; re-sync status in case the
    // server was still reporting a stale build error.
    const project = activeProject()
    if (project && project.status === 'error') refreshWorkspace(project)
  }
})

function pushConsole(level, text) {
  state.consoleLines.push({ level, text, at: Date.now() })
  if (state.consoleLines.length > 300) state.consoleLines.shift()

  const strip = $('#console-strip')
  strip.hidden = false
  const errors = state.consoleLines.filter((l) => l.level === 'error').length
  $('#console-count').textContent = String(errors || state.consoleLines.length)
  $('#console-body').append(el('div', { class: `console-line ${level}`, text: `[${level}] ${text}` }))
  $('#console-body').scrollTop = $('#console-body').scrollHeight
}

/* ---------------------------------- code -------------------------------- */

function renderFileTree(tree) {
  const root = $('#file-tree')
  root.replaceChildren()
  if (!tree?.length) {
    root.append(el('div', { class: 'empty-note' }, 'empty'))
    return
  }
  const renderNodes = (nodes, depth, parent) => {
    for (const node of nodes) {
      if (node.type === 'dir') {
        const childrenBox = el('div', { class: 'tree-children' })
        const toggle = el('button', {
          class: 'tree-node dir',
          style: `padding-left:${10 + depth * 12}px`,
          onclick: () => {
            const open = childrenBox.style.display !== 'none'
            childrenBox.style.display = open ? 'none' : 'block'
            toggle.querySelector('.tw').textContent = open ? '▸' : '▾'
          },
        }, el('span', { class: 'tw', text: '▾' }, ), node.name)
        parent.append(toggle, childrenBox)
        renderNodes(node.children || [], depth + 1, childrenBox)
      } else {
        parent.append(el('button', {
          class: `tree-node ${state.selectedFile === node.path ? 'active' : ''}`,
          style: `padding-left:${10 + depth * 12 + 17}px`,
          'data-path': node.path,
          onclick: () => openFile(node.path),
        }, el('span', { class: 'tw' }), node.name))
      }
    }
  }
  renderNodes(tree, 0, root)
}

async function openFile(filePath) {
  const project = activeProject()
  if (!project) return
  if (state.editorDirty && !window.confirm('Discard unsaved changes?')) return

  try {
    const data = await api(`/api/projects/${project.id}/file?path=${encodeURIComponent(filePath)}`)
    state.selectedFile = filePath
    state.editorDirty = false
    $('#editor-path').textContent = filePath
    $('#editor-dirty').hidden = true
    $('#btn-save').disabled = true

    const editor = $('#editor')
    if (data.binary) {
      editor.value = `(binary file, ${data.size} bytes)`
      editor.disabled = true
    } else if (data.truncated) {
      editor.value = `(file too large to edit here: ${data.size} bytes)`
      editor.disabled = true
    } else {
      editor.value = data.content
      editor.disabled = false
    }

    $$('#file-tree .tree-node').forEach((n) => n.classList.toggle('active', n.dataset.path === filePath))
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function saveFile() {
  const project = activeProject()
  if (!project || !state.selectedFile) return
  try {
    await api(`/api/projects/${project.id}/file`, {
      method: 'PUT',
      body: { path: state.selectedFile, content: $('#editor').value },
    })
    state.editorDirty = false
    $('#editor-dirty').hidden = true
    $('#btn-save').disabled = true
    toast(`Saved ${state.selectedFile}`, 'ok')
  } catch (err) {
    toast(err.message, 'error')
  }
}

/* -------------------------------- history ------------------------------- */

function renderCommits() {
  const list = $('#commit-list')
  list.replaceChildren()
  const restoreBtn = $('#btn-restore')
  if (restoreBtn) restoreBtn.disabled = !state.selectedCommit
  if (!state.commits.length) {
    list.append(el('div', { class: 'empty-note' }, 'No commits yet'))
    return
  }
  for (const commit of state.commits) {
    list.append(el('button', {
      class: `commit-item ${state.selectedCommit === commit.hash ? 'active' : ''}`,
      onclick: () => {
        state.selectedCommit = commit.hash
        renderCommits()
        loadDiff(commit.hash)
      },
    },
      el('span', { class: 'ci-subject', text: commit.subject }),
      el('span', { class: 'ci-meta', text: `${commit.hash} · ${timeAgo(commit.timestamp)}` }),
    ))
  }
}

async function loadDiff(ref) {
  const project = activeProject()
  if (!project) return
  $('#diff-label').textContent = ref ? `Commit ${ref}` : 'Working tree changes'
  try {
    const data = await api(`/api/projects/${project.id}/diff${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`)
    renderDiff(data.diff || '')
  } catch (err) {
    $('#diff-view').textContent = err.message
  }
}

function renderDiff(diff) {
  const view = $('#diff-view')
  view.replaceChildren()
  if (!diff.trim()) {
    view.append(el('div', { class: 'empty-note' }, 'No changes'))
    return
  }
  for (const line of diff.split('\n')) {
    let cls = ''
    if (line.startsWith('+++') || line.startsWith('---')) cls = 'file'
    else if (line.startsWith('@@')) cls = 'hunk'
    else if (line.startsWith('+')) cls = 'add'
    else if (line.startsWith('-')) cls = 'del'
    view.append(el('span', { class: cls, text: `${line}\n` }))
  }
}

/* ---------------------------------- logs -------------------------------- */

function renderLogs() {
  const view = $('#log-view')
  view.replaceChildren()
  if (!state.logs.length) {
    view.append(el('div', { class: 'empty-note' }, 'No output yet. Start the dev server to see logs.'))
    return
  }
  for (const entry of state.logs) {
    view.append(el('span', { class: entry.stream === 'stdout' ? '' : entry.stream, text: `${entry.line}\n` }))
  }
  view.scrollTop = view.scrollHeight

  const errors = state.logs.filter((l) => l.stream === 'stderr').length
  const badge = $('#log-badge')
  badge.hidden = errors === 0
  badge.textContent = String(errors)
}

/* ---------------------------------- SSE --------------------------------- */

function connectEvents(project) {
  disconnectEvents()
  const source = new EventSource(`/api/projects/${project.id}/events`)
  state.events = source

  source.onmessage = (event) => {
    let data
    try { data = JSON.parse(event.data) } catch { return }
    handleEvent(data)
  }

  source.onerror = () => {
    // EventSource retries on its own; only rebuild if it gave up entirely.
    if (source.readyState === EventSource.CLOSED) {
      clearTimeout(state.reconnectTimer)
      state.reconnectTimer = setTimeout(() => {
        if (state.activeId === project.id) connectEvents(project)
      }, 2500)
    }
  }
}

function disconnectEvents() {
  clearTimeout(state.reconnectTimer)
  if (state.events) {
    state.events.close()
    state.events = null
  }
}

function handleEvent(data) {
  const project = activeProject()
  if (project && data.projectId && data.projectId !== project.id) {
    // Still update the sidebar so background projects show live status.
    if (data.type === 'status') {
      const other = state.projects.find((p) => p.id === data.projectId)
      if (other) { other.status = data.status; renderSidebar(); renderHome() }
    }
    return
  }

  switch (data.type) {
    case 'status':
      if (project) {
        project.status = data.status
        renderSidebar()
        renderHome()
        renderTopbar()
        updatePreviewState()
        if (data.status === 'running') hidePreviewOverlay()
        if (data.status === 'starting' || data.status === 'installing') {
          setPreviewOverlay(data.status === 'installing'
            ? 'Installing dependencies…\nThis happens once per project.'
            : 'Starting dev server…')
        }
      }
      break

    case 'log':
      state.logs.push({ stream: data.stream, line: data.line, at: data.at })
      if (state.logs.length > 400) state.logs.shift()
      if (state.view === 'logs') renderLogs()
      else {
        const badge = $('#log-badge')
        if (data.stream === 'stderr') {
          badge.hidden = false
          badge.textContent = String(Number(badge.textContent || 0) + 1)
        }
      }
      break

    case 'turn:queued':
      setAgentRunning(true)
      break

    case 'turn:start':
      setAgentRunning(true)
      state.currentAssistantEl = null
      state.currentAssistantText = ''
      break

    case 'assistant:delta':
      appendAssistantDelta(data.delta)
      break

    case 'assistant:text':
      finalizeAssistant()
      break

    case 'tool:start':
      addToolEvent(data.id, data.name, 'running')
      break

    case 'tool:args':
      updateToolArgs(data.id, data.args)
      break

    case 'tool:log':
      appendToolLog(data.id, data.text)
      break

    case 'tool:end':
      addToolEvent(data.id, data.name, data.ok ? 'ok' : 'error', data.result)
      break

    case 'agent:selfheal':
      addChatMessage('system', `Build error detected — the agent is fixing it:\n${data.error.slice(0, 300)}`)
      break

    case 'agent:retry':
      addChatMessage('system', `Provider said "${data.message}" — retrying in ${Math.round(data.delayMs / 1000)}s (attempt ${data.attempt + 1}).`)
      break

    case 'git:commit':
      hideReviewBar()
      if (data.committed) toast(`Committed ${data.hash}`, 'ok')
      api(`/api/projects/${data.projectId}/git`).then((g) => {
        state.commits = g.log || []
        renderCommits()
      }).catch(() => {})
      break

    case 'review:pending':
      showReviewBar(data.files)
      break

    case 'typecheck:done':
      toast(data.ok ? 'Typecheck passed' : 'Typecheck reported errors', data.ok ? 'ok' : 'error')
      break

    case 'file:written':
      if (state.view === 'code') {
        api(`/api/projects/${data.projectId}/tree`).then((d) => renderFileTree(d.tree)).catch(() => {})
      }
      break

    case 'deps:changed':
      setTimeout(reloadPreview, 1500)
      break

    case 'turn:end':
      setAgentRunning(false)
      finalizeAssistant()
      if (data.usage?.inputTokens || data.usage?.outputTokens) {
        $('#usage-label').textContent = `${data.steps} steps · ${data.usage.inputTokens}↑ ${data.usage.outputTokens}↓`
      }
      refreshWorkspace()
      break

    case 'turn:error':
      setAgentRunning(false)
      finalizeAssistant()
      addChatMessage('error', `${data.message}${data.hint ? `\n\n${data.hint}` : ''}`)
      break

    case 'turn:aborted':
      setAgentRunning(false)
      addChatMessage('system', 'Turn stopped.')
      break

    case 'turn:maxsteps':
      addChatMessage('system', `Reached the ${data.maxSteps}-step limit. Send another message to continue.`)
      break

    case 'history:cleared':
      $('#chat-messages').replaceChildren()
      break

    default:
      break
  }
}

function setAgentRunning(running) {
  state.agentRunning = running
  $('#btn-abort').hidden = !running
  $('#chat-send').disabled = running
  $('#chat-input').disabled = running
  $('#chat-hint').textContent = running ? 'Agent is working…' : 'Enter to send · Shift+Enter for a new line'
}

/* ---------------------------------- chat -------------------------------- */

function addChatMessage(role, text) {
  const wrap = el('div', { class: `msg ${role}` },
    el('div', { class: 'msg-role', text: role }),
    el('div', { class: 'msg-bubble', text }),
  )
  $('#chat-messages').append(wrap)
  scrollChat()
  return wrap
}

function appendAssistantDelta(delta) {
  if (!state.currentAssistantEl) {
    state.currentAssistantEl = el('div', { class: 'msg assistant' },
      el('div', { class: 'msg-role', text: 'assistant' }),
      el('div', { class: 'msg-bubble' }),
    )
    $('#chat-messages').append(state.currentAssistantEl)
    state.currentAssistantText = ''
  }
  state.currentAssistantText += delta
  state.currentAssistantEl.querySelector('.msg-bubble').textContent = state.currentAssistantText
  scrollChat()
}

function finalizeAssistant() {
  if (state.currentAssistantEl && !state.currentAssistantText.trim()) {
    state.currentAssistantEl.remove()
  }
  state.currentAssistantEl = null
  state.currentAssistantText = ''
}

function addToolEvent(id, name, status, result) {
  let node = state.toolNodes.get(id)

  if (!node) {
    const body = el('div', { class: 'tool-body' })
    const head = el('button', {
      class: 'tool-head',
      onclick: () => node.event.classList.toggle('open'),
    },
      el('span', { class: `dot ${status === 'error' ? 'error' : status === 'ok' ? 'running' : 'busy'}` }),
      el('span', { class: 'tname', text: name }),
      el('span', { class: `tstatus ${status === 'ok' ? 'ok' : status === 'error' ? 'err' : 'run'}`, text: status }),
    )
    const container = el('div', { class: 'tool-event' }, head, body)
    node = { event: container, head, body, args: null }
    state.toolNodes.set(id, node)

    // Group consecutive tool calls under one heading to reduce noise.
    let group = $('#chat-messages').lastElementChild
    if (!group || !group.classList.contains('tool-group')) {
      group = el('div', { class: 'msg' },
        el('div', { class: 'msg-role', text: 'tools' }),
        el('div', { class: 'tool-group' }),
      )
      $('#chat-messages').append(group)
      group = group.lastElementChild
    } else {
      group = group.querySelector('.tool-group')
    }
    group.append(container)
  }

  const statusEl = node.head.querySelector('.tstatus')
  statusEl.textContent = status
  statusEl.className = `tstatus ${status === 'ok' ? 'ok' : status === 'error' ? 'err' : 'run'}`
  node.head.querySelector('.dot').className = `dot ${status === 'error' ? 'error' : status === 'ok' ? 'running' : 'busy'}`

  if (result !== undefined) {
    const argsText = node.args ? `arguments: ${JSON.stringify(node.args, null, 2)}\n\n` : ''
    node.body.textContent = `${argsText}${result}`
    if (status === 'error') node.event.classList.add('open')
  }
  scrollChat()
}

function updateToolArgs(id, args) {
  const node = state.toolNodes.get(id)
  if (!node) return
  node.args = args
  node.body.textContent = `arguments: ${JSON.stringify(args, null, 2)}`
}

function appendToolLog(id, text) {
  const node = state.toolNodes.get(id)
  if (!node) return
  node.body.textContent += text
}

function scrollChat() {
  const box = $('#chat-messages')
  box.scrollTop = box.scrollHeight
}

async function loadChatHistory(project) {
  try {
    const data = await api(`/api/projects/${project.id}/history`)
    const box = $('#chat-messages')
    box.replaceChildren()
    for (const message of data.messages || []) {
      const text = Array.isArray(message.content)
        ? message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
        : String(message.content || '')
      if (text.trim()) addChatMessage(message.role === 'user' ? 'user' : 'assistant', text)
    }
    if (!data.messages?.length) {
      addChatMessage('system', `New project. Describe the app you want — the agent edits the real files in ${project.slug}/ and the preview updates live.`)
    }
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function sendMessage() {
  const project = activeProject()
  const input = $('#chat-input')
  const message = input.value.trim()
  if (!project || !message || state.agentRunning) return

  input.value = ''
  addChatMessage('user', message)
  state.toolNodes.clear()
  setAgentRunning(true)

  const images = state.pendingImages.map((img) => img.dataUrl)
  clearImages()
  hideReviewBar()

  try {
    await api(`/api/projects/${project.id}/chat`, {
      method: 'POST',
      body: { message, mode: state.mode, images },
    })
  } catch (err) {
    setAgentRunning(false)
    if (err.payload?.needsKey) {
      addChatMessage('error', `${err.message}`)
      openSettings()
    } else {
      addChatMessage('error', err.message)
    }
  }
}

/* --------------------------------- modals ------------------------------- */

function openModal(id) {
  $('#modal-root').hidden = false
  $$('.modal').forEach((m) => { m.hidden = m.id !== id })
}

function closeModal() {
  $('#modal-root').hidden = true
}

/** Generic confirm dialog. Rebinds #confirm-ok to run `onOk` once, then close. */
function openConfirm(title, body, onOk) {
  $('#confirm-title').textContent = title
  $('#confirm-body').textContent = body
  openModal('modal-confirm')

  const ok = $('#confirm-ok')
  const replacement = ok.cloneNode(true)
  ok.replaceWith(replacement)
  replacement.addEventListener('click', async () => {
    try {
      await onOk()
    } finally {
      closeModal()
    }
  })
}

function confirmDelete(project) {
  openConfirm(
    `Delete "${project.name}"?`,
    `This removes ${project.path} and its git history permanently. The dev server will be stopped.`,
    async () => {
      try {
        await api(`/api/projects/${project.id}`, { method: 'DELETE' })
        toast(`Deleted ${project.slug}`, 'ok')
        if (state.activeId === project.id) closeWorkspace()
        await refreshProjects()
      } catch (err) {
        toast(err.message, 'error')
      }
    },
  )
}

async function createProject(name) {
  if (!name.trim()) return
  const template = $('#modal-new-template')?.value || undefined
  try {
    const project = await api('/api/projects', { method: 'POST', body: { name: name.trim(), template } })
    closeModal()
    await refreshProjects()
    await selectProject(project.id)
    toast(`Created ${project.slug} on port ${project.port}`, 'ok')
  } catch (err) {
    toast(err.message, 'error')
  }
}

function renderSettingsProviderChoices() {
  const row = $('#settings-provider')
  row.replaceChildren()
  for (const provider of state.providers?.providers || ['openai', 'anthropic', 'mock']) {
    const label = provider === 'mock' ? 'mock (scripted, no API)' : provider
    row.append(el('label', {},
      el('input', {
        type: 'radio', name: 'provider', value: provider,
        ...(state.settings.provider === provider ? { checked: true } : {}),
      }),
      label,
    ))
  }

  const presetSelect = $('#settings-preset')
  presetSelect.replaceChildren()
  for (const preset of state.providers?.presets || []) {
    presetSelect.append(el('option', { value: preset.id, text: preset.label }))
  }
}

function openSettings() {
  const s = state.settings
  $('#settings-openai-key').value = ''
  $('#settings-openai-key').placeholder = s.openai.hasKey ? 'configured — leave blank to keep' : 'sk-…'
  $('#settings-openai-base').value = s.openai.baseUrl
  $('#settings-openai-model').value = s.openai.model

  $('#settings-anthropic-key').value = ''
  $('#settings-anthropic-key').placeholder = s.anthropic.hasKey ? 'configured — leave blank to keep' : 'sk-ant-…'
  $('#settings-anthropic-base').value = s.anthropic.baseUrl
  $('#settings-anthropic-model').value = s.anthropic.model

  $('#settings-autoinstall').checked = s.agent.autoInstall !== false
  $('#settings-autocommit').checked = s.agent.autoCommit !== false
  $('#settings-reviewcommit').checked = s.agent.reviewCommit === true
  $('#settings-maxsteps').value = s.agent.maxSteps || 24
  $('#settings-maxsteps-val').textContent = String(s.agent.maxSteps || 24)
  $('#settings-test-result').hidden = true

  $$('#settings-provider input').forEach((input) => {
    input.checked = input.value === s.provider
  })
  syncProviderVisibility()
  openModal('modal-settings')
}

function syncProviderVisibility() {
  const chosen = $$('#settings-provider input').find((i) => i.checked)?.value || 'openai'
  $('#settings-openai').hidden = chosen !== 'openai'
  $('#settings-anthropic').hidden = chosen !== 'anthropic'
  return chosen
}

async function saveSettings() {
  const chosen = syncProviderVisibility()
  const patch = {
    provider: chosen,
    agent: {
      autoInstall: $('#settings-autoinstall').checked,
      autoCommit: $('#settings-autocommit').checked,
      reviewCommit: $('#settings-reviewcommit').checked,
      maxSteps: Number($('#settings-maxsteps').value),
    },
  }

  const openaiKey = $('#settings-openai-key').value.trim()
  const anthropicKey = $('#settings-anthropic-key').value.trim()

  patch.openai = {
    baseUrl: $('#settings-openai-base').value.trim() || 'https://api.openai.com/v1',
    model: $('#settings-openai-model').value.trim() || 'gpt-4o',
  }
  if (openaiKey) patch.openai.apiKey = openaiKey

  patch.anthropic = {
    baseUrl: $('#settings-anthropic-base').value.trim() || 'https://api.anthropic.com',
    model: $('#settings-anthropic-model').value.trim() || 'claude-sonnet-4-5',
  }
  if (anthropicKey) patch.anthropic.apiKey = anthropicKey

  try {
    state.settings = await api('/api/settings', { method: 'PUT', body: patch })
    $('#mock-banner').hidden = chosen !== 'mock'
    const health = await api('/api/health')
    renderProviderPill(health)
    toast('Settings saved', 'ok')
    closeModal()
  } catch (err) {
    toast(err.message, 'error')
  }
}

async function testConnection() {
  const box = $('#settings-test-result')
  const chosen = syncProviderVisibility()
  box.hidden = false
  box.className = 'test-result'
  box.textContent = 'Testing…'

  // Save first so the test uses whatever is currently in the form.
  try {
    await saveSettingsSilently(chosen)
  } catch { /* test anyway with stored values */ }

  try {
    const result = await api('/api/settings/test', { method: 'POST', body: { provider: chosen } })
    if (result.ok) {
      box.className = 'test-result ok'
      box.textContent = `Connected to ${result.provider} in ${result.latencyMs}ms\nmodel: ${result.model}\nreply: ${result.reply || '(empty)'}`
    } else {
      box.className = 'test-result bad'
      box.textContent = `Failed (${result.status || 'no status'})\n${result.error}${result.hint ? `\n\n${result.hint}` : ''}`
    }
  } catch (err) {
    box.className = 'test-result bad'
    box.textContent = err.message
  }
}

/** Persist the form without closing the modal or toasting. */
async function saveSettingsSilently(chosen) {
  const patch = { provider: chosen }
  const openaiKey = $('#settings-openai-key').value.trim()
  const anthropicKey = $('#settings-anthropic-key').value.trim()
  patch.openai = {
    baseUrl: $('#settings-openai-base').value.trim(),
    model: $('#settings-openai-model').value.trim(),
  }
  if (openaiKey) patch.openai.apiKey = openaiKey
  patch.anthropic = {
    baseUrl: $('#settings-anthropic-base').value.trim(),
    model: $('#settings-anthropic-model').value.trim(),
  }
  if (anthropicKey) patch.anthropic.apiKey = anthropicKey
  state.settings = await api('/api/settings', { method: 'PUT', body: patch })
}

/* ------------------------------ global wiring --------------------------- */

function wireGlobalEvents() {
  $('#new-project').addEventListener('click', () => {
    $('#modal-new-name').value = ''
    openModal('modal-new')
    setTimeout(() => $('#modal-new-name').focus(), 40)
  })

  $('#modal-new-form').addEventListener('submit', (event) => {
    event.preventDefault()
    createProject($('#modal-new-name').value)
  })

  $('#home-create').addEventListener('submit', (event) => {
    event.preventDefault()
    const input = $('#home-name')
    createProject(input.value)
    input.value = ''
  })

  $('#home-name').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      createProject(event.target.value)
      event.target.value = ''
    }
  })

  $$('#modal-root [data-close]').forEach((node) => node.addEventListener('click', closeModal))
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#modal-root').hidden) closeModal()
  })

  $('#open-settings').addEventListener('click', openSettings)
  $('#provider-pill').addEventListener('click', openSettings)
  $('#theme-toggle').addEventListener('click', toggleTheme)

  $('#btn-design').addEventListener('click', openDesign)
  $('#design-search').addEventListener('input', (event) => {
    state.designFilter = event.target.value
    renderDesignGrid()
  })
  $('#design-clear').addEventListener('click', () => selectDesign(null))

  $('#settings-save').addEventListener('click', saveSettings)
  $('#settings-test').addEventListener('click', testConnection)
  $('#settings-maxsteps').addEventListener('input', (e) => {
    $('#settings-maxsteps-val').textContent = e.target.value
  })
  $('#settings-preset').addEventListener('change', (event) => {
    const preset = (state.providers?.presets || []).find((p) => p.id === event.target.value)
    if (!preset) return
    if (preset.baseUrl) $('#settings-openai-base').value = preset.baseUrl
    if (preset.model) $('#settings-openai-model').value = preset.model
  })
  $$('#settings-provider input').forEach((input) => {
    input.addEventListener('change', syncProviderVisibility)
  })

  $('#tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('.tab')
    if (tab) switchView(tab.dataset.view)
  })

  $('#btn-reload').addEventListener('click', reloadPreview)
  $('#btn-restart').addEventListener('click', async () => {
    const project = activeProject()
    if (!project) return
    setPreviewOverlay('Restarting dev server…')
    try {
      await api(`/api/projects/${project.id}/restart`, { method: 'POST' })
      await refreshWorkspace(project)
      reloadPreview()
    } catch (err) {
      toast(err.message, 'error')
    }
  })
  $('#btn-stop').addEventListener('click', async () => {
    const project = activeProject()
    if (!project) return
    try {
      await api(`/api/projects/${project.id}/stop`, { method: 'POST' })
      await refreshWorkspace(project)
    } catch (err) {
      toast(err.message, 'error')
    }
  })

  $$('.device-widths .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $$('.device-widths .chip').forEach((c) => c.classList.remove('active'))
      chip.classList.add('active')
      const width = Number(chip.dataset.width)
      $('#preview-frame').style.width = width ? `${width}px` : '100%'
    })
  })

  $('#console-toggle').addEventListener('click', () => $('#console-strip').classList.toggle('open'))
  $('#btn-clear-logs').addEventListener('click', () => {
    state.logs = []
    $('#log-badge').hidden = true
    renderLogs()
  })
  $('#btn-refresh-tree').addEventListener('click', async () => {
    const project = activeProject()
    if (!project) return
    const data = await api(`/api/projects/${project.id}/tree`)
    renderFileTree(data.tree)
  })
  $('#btn-diff-worktree').addEventListener('click', () => {
    state.selectedCommit = null
    renderCommits()
    loadDiff(null)
  })

  $('#btn-save').addEventListener('click', saveFile)
  $('#editor').addEventListener('input', () => {
    state.editorDirty = true
    $('#editor-dirty').hidden = false
    $('#btn-save').disabled = false
  })
  $('#editor').addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault()
      saveFile()
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const box = event.target
      const start = box.selectionStart
      box.value = `${box.value.slice(0, start)}  ${box.value.slice(box.selectionEnd)}`
      box.selectionStart = box.selectionEnd = start + 2
      box.dispatchEvent(new Event('input'))
    }
  })

  $$('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode
      $$('.mode-btn').forEach((b) => b.classList.toggle('active', b === btn))
      $('#chat-input').placeholder = state.mode === 'plan'
        ? 'Discuss the approach — no files are changed in Plan mode…'
        : 'Describe what to build or change…'
    })
  })

  $('#chat-form').addEventListener('submit', (event) => {
    event.preventDefault()
    sendMessage()
  })

  $('#chat-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  })

  $('#btn-abort').addEventListener('click', async () => {
    const project = activeProject()
    if (!project) return
    try {
      await api(`/api/projects/${project.id}/abort`, { method: 'POST' })
      toast('Stopping…')
    } catch (err) {
      toast(err.message, 'error')
    }
  })

  $('#btn-clear-chat').addEventListener('click', async () => {
    const project = activeProject()
    if (!project) return
    try {
      await api(`/api/projects/${project.id}/history`, { method: 'DELETE' })
      $('#chat-messages').replaceChildren()
      addChatMessage('system', 'Conversation cleared. The code and git history are untouched.')
    } catch (err) {
      toast(err.message, 'error')
    }
  })

  // --- images / review / search / typecheck / export / import / restore ---

  const attachBtn = $('#btn-attach')
  const chatFile = $('#chat-file')
  if (attachBtn && chatFile) {
    attachBtn.addEventListener('click', () => chatFile.click())
    chatFile.addEventListener('change', (event) => {
      addImageFiles(event.target.files)
      event.target.value = ''
    })
  }

  const chatPane = $('#chat')
  if (chatPane) {
    chatPane.addEventListener('dragover', (event) => {
      event.preventDefault()
      chatPane.classList.add('dragging')
    })
    chatPane.addEventListener('dragleave', () => chatPane.classList.remove('dragging'))
    chatPane.addEventListener('drop', (event) => {
      event.preventDefault()
      chatPane.classList.remove('dragging')
      if (event.dataTransfer?.files?.length) addImageFiles(event.dataTransfer.files)
    })
  }

  $('#review-approve')?.addEventListener('click', approveReview)
  $('#review-revert')?.addEventListener('click', revertReview)
  $('#review-diff')?.addEventListener('click', () => {
    state.selectedCommit = null
    switchView('history')
    renderCommits()
    loadDiff(null)
  })

  $('#btn-typecheck')?.addEventListener('click', runTypecheck)
  $('#btn-export')?.addEventListener('click', exportProject)
  $('#btn-restore')?.addEventListener('click', restoreCommit)
  $('#import-project')?.addEventListener('click', openImport)
  $('#modal-import-ok')?.addEventListener('click', doImport)

  const codeSearch = $('#code-search')
  if (codeSearch) {
    codeSearch.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        clearTimeout(state.searchTimer)
        runCodeSearch(codeSearch.value)
      }
      if (event.key === 'Escape') {
        codeSearch.value = ''
        clearSearchResults()
      }
    })
    codeSearch.addEventListener('input', () => {
      clearTimeout(state.searchTimer)
      const value = codeSearch.value
      if (!value.trim()) { clearSearchResults(); return }
      state.searchTimer = setTimeout(() => runCodeSearch(value), 350)
    })
  }

  // Poll so status stays honest even if an SSE reconnect is missed.
  setInterval(() => {
    if (document.hidden) return
    api('/api/projects').then((data) => {
      const previous = new Map(state.projects.map((p) => [p.id, p]))
      state.projects = data.projects.map((p) => ({ ...p, status: previous.get(p.id)?.status || p.status }))
      renderSidebar()
      renderHome()
      if (state.activeId) renderTopbar()
    }).catch(() => {})
  }, 12_000)
}

initTheme()
boot()
