/**
 * Minimal SSE client for streaming LLM responses. Handles the event/data
 * framing both Anthropic and OpenAI use, including multi-line data fields and
 * CRLF line endings.
 */
export async function* streamSse(response) {
  const decoder = new TextDecoder()
  let buffer = ''

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
