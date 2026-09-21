/**
 * Preview bridge. Reports console errors, unhandled rejections and runtime
 * exceptions to the parent frame so the platform can show them and hand them
 * to the agent. Inert when the app is opened outside an iframe.
 */
const inFrame = typeof window !== 'undefined' && window.parent !== window

function post(type, payload) {
  if (!inFrame) return
  try {
    window.parent.postMessage({ source: 'lovable-preview', type, ...payload }, '*')
  } catch {
    /* parent gone */
  }
}

function serializeError(error) {
  if (!error) return { message: 'Unknown error' }
  if (typeof error === 'string') return { message: error }
  return {
    message: error.message || String(error),
    stack: typeof error.stack === 'string' ? error.stack.slice(0, 3000) : undefined,
    name: error.name,
  }
}

if (inFrame && typeof window !== 'undefined') {
  const originalError = console.error
  const originalWarn = console.warn
  const originalLog = console.log

  console.error = (...args) => {
    originalError.apply(console, args)
    post('console', { level: 'error', text: args.map(format).join(' ').slice(0, 2000) })
  }
  console.warn = (...args) => {
    originalWarn.apply(console, args)
    post('console', { level: 'warn', text: args.map(format).join(' ').slice(0, 2000) })
  }
  console.log = (...args) => {
    originalLog.apply(console, args)
    post('console', { level: 'log', text: args.map(format).join(' ').slice(0, 2000) })
  }

  window.addEventListener('error', (event) => {
    post('runtime-error', {
      error: serializeError(event.error || event.message),
      file: event.filename,
      line: event.lineno,
      column: event.colno,
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    post('runtime-error', { error: serializeError(event.reason), unhandledRejection: true })
  })

  // Vite's own error overlay signals a compile failure; surface it as text too.
  const observer = new MutationObserver(() => {
    const overlay = document.querySelector('vite-error-overlay')
    if (!overlay) return
    const message = overlay.shadowRoot?.querySelector('.message')?.textContent
    const file = overlay.shadowRoot?.querySelector('.file')?.textContent
    if (message) post('build-error', { message: message.trim(), file: file?.trim() })
  })

  const start = () => observer.observe(document.documentElement, { childList: true, subtree: true })
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', start, { once: true })
  } else {
    start()
  }

  window.addEventListener('message', (event) => {
    if (event.data?.source === 'lovable-host' && event.data.type === 'ping') {
      post('pong', { href: window.location.href, title: document.title })
    }
  })

  post('ready', { href: window.location.href, title: document.title })
}

function format(value) {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack || value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export {}
