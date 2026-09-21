import { cp, mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const TEMPLATES_DIR = path.join(__dirname, 'templates')
export const REACT_VITE_TEMPLATE = path.join(TEMPLATES_DIR, 'react-vite')

const TEXT_EXTENSIONS = new Set([
  '.json', '.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.md', '.txt',
  '.yml', '.yaml', '.svg', '.env', '.example', '.gitignore', '.d.ts',
])

/** Files whose basename has no extension but are still text. */
const TEXT_BASENAMES = new Set(['.gitignore', '.npmrc', '.env', 'Dockerfile', 'LICENSE'])

export function slugify(input) {
  const base = String(input || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return base || 'app'
}

function isTextFile(filePath) {
  const base = path.basename(filePath)
  if (TEXT_BASENAMES.has(base)) return true
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      yield* walk(full)
    } else if (entry.isFile()) {
      yield full
    }
  }
}

function substitute(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
  )
}

/** Accept either a template name ("react-vite") or an absolute path. */
function resolveTemplate(template) {
  if (!template) return REACT_VITE_TEMPLATE
  if (path.isAbsolute(template)) return template
  return path.join(TEMPLATES_DIR, template)
}

/**
 * Copy a starter template into `destDir`, expanding {{PLACEHOLDER}} tokens in
 * every text file. Creates the destination if missing.
 */
export async function scaffoldProject(destDir, { name, slug, template, extraVars = {} } = {}) {
  const templateDir = resolveTemplate(template)
  if (!(await pathExists(templateDir))) {
    throw new Error(`Unknown template "${template}" (looked in ${templateDir})`)
  }

  await mkdir(destDir, { recursive: true })
  await cp(templateDir, destDir, { recursive: true, force: true })

  const vars = {
    PROJECT_NAME: name ?? slug ?? 'App',
    PROJECT_SLUG: slug ?? slugify(name),
    ...extraVars,
  }

  let touched = 0
  for await (const file of walk(destDir)) {
    if (!isTextFile(file)) continue
    const original = await readFile(file, 'utf8')
    const replaced = substitute(original, vars)
    if (replaced !== original) {
      await writeFile(file, replaced, 'utf8')
      touched++
    }
  }

  return { destDir, vars, filesSubstituted: touched }
}

export async function pathExists(target) {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}
