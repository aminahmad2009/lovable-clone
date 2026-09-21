import path from 'node:path'
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolveInside } from './tools.js'

const IGNORED = new Set(['node_modules', '.git', 'dist', '.vite', '.cache', 'coverage', '.DS_Store'])
const MAX_DEPTH = 9

async function* walk(root, dir = root, depth = 0) {
  if (depth > MAX_DEPTH) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    const relPath = path.relative(root, full).split(path.sep).join('/')
    if (entry.isDirectory()) {
      yield { type: 'dir', path: relPath, name: entry.name }
      yield* walk(root, full, depth + 1)
    } else if (entry.isFile()) {
      let size = 0
      try { size = (await stat(full)).size } catch { /* ignore */ }
      yield { type: 'file', path: relPath, name: entry.name, size }
    }
  }
}

/** Compact indented tree for the model's system prompt. */
export async function listProjectTree(root) {
  const lines = []
  const dirs = new Set()

  for await (const entry of walk(root)) {
    if (lines.length > 300) {
      lines.push('… (tree truncated)')
      break
    }
    if (entry.type === 'dir') {
      dirs.add(entry.path)
      continue
    }
    const dir = path.posix.dirname(entry.path)
    if (dir !== '.' && !dirs.has(dir)) {
      dirs.add(dir)
      lines.push(`${dir}/`)
    }
    lines.push(`  ${entry.path}${entry.size > 20_000 ? ` (${Math.round(entry.size / 1024)}kb)` : ''}`)
  }

  return lines.length ? lines.join('\n') : '(empty project)'
}

/** Nested tree for the UI file browser. */
export async function getFileTree(root) {
  const tree = { name: '', path: '', type: 'dir', children: [] }

  /** Return the directory node for a slash-separated path, creating it. */
  const ensureDir = (segments) => {
    let node = tree
    for (let i = 0; i < segments.length; i++) {
      const name = segments[i]
      let child = node.children.find((c) => c.type === 'dir' && c.name === name)
      if (!child) {
        child = { name, path: segments.slice(0, i + 1).join('/'), type: 'dir', children: [] }
        node.children.push(child)
      }
      node = child
    }
    return node
  }

  for await (const entry of walk(root)) {
    const parts = entry.path.split('/')
    if (entry.type === 'dir') {
      // Directories are materialised by ensureDir; recording them here too
      // keeps empty folders visible in the browser.
      ensureDir(parts)
      continue
    }
    const parent = ensureDir(parts.slice(0, -1))
    if (!parent.children.some((c) => c.type === 'file' && c.name === entry.name)) {
      parent.children.push({ name: entry.name, path: entry.path, type: 'file', size: entry.size })
    }
  }

  sortTree(tree)
  return tree.children
}

function sortTree(node) {
  node.children?.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const child of node.children || []) if (child.type === 'dir') sortTree(child)
}

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.eot',
  '.mp3', '.mp4', '.webm', '.pdf', '.zip', '.wasm',
])

export function isBinary(filePath) {
  return BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

export async function readProjectFile(root, relPath) {
  const target = resolveInside(root, relPath)
  if (!existsSync(target)) throw Object.assign(new Error(`Not found: ${relPath}`), { status: 404 })
  const info = await stat(target)
  if (info.isDirectory()) throw Object.assign(new Error(`${relPath} is a directory`), { status: 400 })
  if (isBinary(relPath)) {
    return { path: relPath, binary: true, size: info.size }
  }
  if (info.size > 2_000_000) {
    return { path: relPath, truncated: true, size: info.size, content: '' }
  }
  return { path: relPath, content: await readFile(target, 'utf8'), size: info.size }
}

export async function writeProjectFile(root, relPath, content) {
  const target = resolveInside(root, relPath)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
  return { path: relPath, size: content.length }
}

export async function fileExists(root, relPath) {
  try {
    await stat(resolveInside(root, relPath))
    return true
  } catch {
    return false
  }
}

/** Structured content search for the UI. Returns [{path,line,text}]. */
export async function searchProjectFiles(root, pattern, { filePattern, ignoreCase = true, limit = 200 } = {}) {
  let regex
  try {
    regex = new RegExp(pattern, ignoreCase ? 'gi' : 'g')
  } catch (err) {
    throw Object.assign(new Error(`Invalid regex: ${err.message}`), { status: 400 })
  }

  const hits = []
  for await (const entry of walk(root)) {
    if (entry.type !== 'file' || entry.size > 2_000_000) continue
    if (filePattern && !new RegExp(filePattern, 'i').test(entry.path)) continue
    let content
    try { content = await readFile(path.join(root, entry.path), 'utf8') } catch { continue }
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      regex.lastIndex = 0
      if (regex.test(lines[i])) {
        hits.push({ path: entry.path, line: i + 1, text: lines[i].trim().slice(0, 200) })
        if (hits.length >= limit) return hits
      }
    }
  }
  return hits
}
