/**
 * Minimal SSE client for streaming LLM responses. Handles the event/data
 * framing both Anthropic and OpenAI use, including multi-line data fields and
 * CRLF line endings.
 */
export async function* streamSse(response, context = {}) {
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true })

      let boundary
      // eslint-disable-next-line no-cond-assign
      while ((boundary = findBoundary(buffer)) !== -1) {
        const rawEvent = buffer.slice(0, boundary.start)
        buffer = buffer.slice(boundary.end)

        const parsed = parseEvent(rawEvent)
        if (parsed) yield parsed
      }
    }
  } catch (err) {
    // A stream that dies halfway surfaces as a bare "terminated"/"fetch failed"
    // from undici. Translate it so the chat panel says something actionable.
    throw describeNetworkError(err, context.url, context.provider)
  }

  const tail = parseEvent(buffer)
  if (tail) yield tail
}

function findBoundary(buffer) {
  const dblLf = buffer.indexOf('\n\n')
  const dblCrLf = buffer.indexOf('\r\n\r\n')

  if (dblLf === -1 && dblCrLf === -1) return -1
  if (dblLf === -1) return { start: dblCrLf, end: dblCrLf + 4 }
  if (dblCrLf === -1) return { start: dblLf, end: dblLf + 2 }
  return dblLf < dblCrLf
    ? { start: dblLf, end: dblLf + 2 }
    : { start: dblCrLf, end: dblCrLf + 4 }
}

function parseEvent(raw) {
  const lines = raw.split(/\r?\n/)
  const dataLines = []
  let eventName = null

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''))
    }
  }

  if (!dataLines.length) return null
  const data = dataLines.join('\n')
  if (data === '[DONE]') return { event: eventName, done: true }

  try {
    return { event: eventName, data: JSON.parse(data) }
  } catch {
    return null
  }
}

/** Throw a useful error for non-2xx responses, including the provider's body. */
export async function assertOk(response, provider) {
  if (response.ok) return response
  let detail = ''
  try {
    detail = await response.text()
  } catch { /* ignore */ }

  let message = `${provider} API error ${response.status}`
  try {
    const parsed = JSON.parse(detail)
    message = parsed?.error?.message || parsed?.message || message
  } catch {
    if (detail) message = `${message}: ${detail.slice(0, 600)}`
  }

  const err = new Error(message)
  err.status = response.status
  err.provider = provider
  if (response.status === 401 || response.status === 403) {
    err.hint = 'Check the API key in Settings.'
  } else if (response.status === 429) {
    err.hint = 'Rate limited — wait a moment and retry.'
  }
  throw err
}

/* --------------------------- network failures --------------------------- */

/** Error codes worth retrying rather than reporting as a dead end. */
export const TRANSIENT_CODES = new Set([
  'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
])

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return url || 'the configured endpoint'
  }
}

/** The real reason lives on err.cause; Node's fetch only says "fetch failed". */
function codeOf(err) {
  return err?.cause?.code || err?.code || ''
}

/**
 * Turn a transport-level failure into a sentence a person can act on. Returns
 * the original error untouched when it is a user abort or already carries a
 * status/hint (i.e. it came from assertOk, not from the network stack).
 */
export function describeNetworkError(err, url, provider) {
  if (!err) return err
  if (err.name === 'AbortError' || codeOf(err) === 'ABORT_ERR') return err
  if (err.status || err.hint) return err

  const code = codeOf(err)
  const host = hostOf(url)
  const what = provider ? `${provider} endpoint` : 'model endpoint'
  const causeText = String(err?.cause?.message || '')

  // AbortSignal.timeout() rejects with TimeoutError, not AbortError, so a
  // deadline is distinguishable from the user pressing Stop.
  if (err.name === 'TimeoutError') {
    const timedOut = new Error(`The ${what} at ${host} did not respond within the time limit.`)
    timedOut.hint = 'The endpoint may be overloaded or unreachable. Retry; if it persists, check the base URL in Settings.'
    timedOut.code = 'ETIMEDOUT'
    timedOut.network = true
    timedOut.cause = err
    return timedOut
  }

  let message = ''
  let hint = ''

  if (/cert|ssl|tls|signature/i.test(code + causeText)) {
    message = `TLS handshake with ${host} failed (${code || 'certificate error'}).`
    hint = 'The endpoint presents a certificate this machine does not trust — a corporate proxy or an expired cert. Fix the certificate chain; do not disable verification.'
  } else {
    switch (code) {
      case 'ECONNREFUSED':
        message = `Could not reach the ${what} at ${host} — the connection was refused.`
        hint = 'Nothing is listening there. Check the base URL and port in Settings and confirm the service is running.'
        break
      case 'ENOTFOUND':
        message = `DNS lookup failed for ${host}.`
        hint = 'Check the base URL in Settings for a typo, or your network/DNS if the host is correct.'
        break
      case 'EAI_AGAIN':
        message = `Temporary DNS failure resolving ${host}.`
        hint = 'Transient — retry. If it persists, your DNS resolver is unreachable.'
        break
      case 'ETIMEDOUT':
      case 'UND_ERR_CONNECT_TIMEOUT':
        message = `The ${what} at ${host} did not accept the connection in time.`
        hint = 'A firewall or proxy may be blocking it, or the host is down. Retry, then check the base URL in Settings.'
        break
      case 'UND_ERR_HEADERS_TIMEOUT':
      case 'UND_ERR_BODY_TIMEOUT':
        message = `The ${what} at ${host} stalled before finishing the response.`
        hint = 'The gateway took too long to answer. Retry; if the model is heavily loaded, try a smaller max-tokens or a different model.'
        break
      case 'ECONNRESET':
      case 'EPIPE':
      case 'UND_ERR_SOCKET':
        message = `The connection to ${host} dropped mid-request.`
        hint = 'Transient network failure — retry. If it repeats, a proxy may be cutting long-lived streaming connections.'
        break
      default:
        break
    }
  }

  if (!message) {
    message = err.message && err.message !== 'fetch failed' && err.message !== 'terminated'
      ? err.message
      : `The request to ${host} failed${code ? ` (${code})` : ''}.`
    hint = causeText || 'Check the base URL in Settings and your network connection.'
  }

  const translated = new Error(message)
  translated.hint = hint
  translated.code = code
  translated.network = true
  translated.cause = err
  return translated
}
