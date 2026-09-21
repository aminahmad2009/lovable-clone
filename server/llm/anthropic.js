import { streamSse, assertOk } from './sse.js'

const DEFAULT_MAX_TOKENS = 8000

/**
 * Anthropic Messages API adapter.
 *
 * The app's internal message format is Anthropic-shaped, so this adapter is
 * close to pass-through; openai.js does the translation work instead.
 * Internal blocks: {type:'text'}, {type:'tool_use',id,name,input},
 * {type:'tool_result',tool_use_id,content,is_error}.
 */
export async function streamAnthropic({
  settings,
  system,
  messages,
  tools = [],
  model,
  maxTokens = DEFAULT_MAX_TOKENS,
  signal,
  onText,
  onToolStart,
}) {
  const apiKey = settings.anthropic?.apiKey
  if (!apiKey) {
    throw new Error('No Anthropic API key configured. Add one in Settings or set ANTHROPIC_API_KEY.')
  }

  const baseUrl = (settings.anthropic?.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')

  // Gateway tokens (rather than first-party API keys) authenticate with a
  // bearer header instead of x-api-key.
  const isBearer = !!process.env.ANTHROPIC_AUTH_TOKEN && process.env.ANTHROPIC_AUTH_TOKEN === apiKey
  const headers = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    ...(isBearer ? { authorization: `Bearer ${apiKey}` } : { 'x-api-key': apiKey }),
  }

  const body = {
    model: model || settings.anthropic?.model || 'claude-sonnet-4-5',
    max_tokens: maxTokens,
    stream: true,
    messages: normalizeMessages(messages),
  }
  if (system) body.system = typeof system === 'string' ? system : system
  if (tools.length) {
    body.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }))
  }

  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  })
  await assertOk(response, 'Anthropic')

  const textParts = []
  const toolCalls = []
  /** Partial tool calls keyed by content block index. */
  const pending = new Map()
  let stopReason = null
  let usage = { inputTokens: 0, outputTokens: 0 }

  for await (const evt of streamSse(response)) {
    if (evt.done) break
    if (signal?.aborted) break
    const data = evt.data
    if (!data) continue

    if (data.type === 'error') {
      throw new Error(data.error?.message || 'Anthropic stream error')
    }

    if (data.type === 'message_start') {
      usage.inputTokens = data.message?.usage?.input_tokens ?? 0
    }

    if (data.type === 'content_block_start') {
      const block = data.content_block
      if (block?.type === 'tool_use') {
        const call = { id: block.id, name: block.name, json: '' }
        pending.set(data.index, call)
        toolCalls.push(call)
        onToolStart?.({ id: call.id, name: call.name })
      }
    }

    if (data.type === 'content_block_delta') {
      const delta = data.delta
      if (delta?.type === 'text_delta' && delta.text) {
        textParts.push(delta.text)
        onText?.(delta.text)
      } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
        const call = pending.get(data.index)
        if (call) call.json += delta.partial_json
      }
    }

    if (data.type === 'message_delta') {
      if (data.delta?.stop_reason) stopReason = data.delta.stop_reason
      if (data.usage?.output_tokens) usage.outputTokens = data.usage.output_tokens
    }
  }

  const finalized = toolCalls.map((call) => ({
    id: call.id,
    name: call.name,
    args: safeParse(call.json),
  }))

  return {
    provider: 'anthropic',
    model: body.model,
    text: textParts.join(''),
    toolCalls: finalized,
    stopReason: stopReason || (finalized.length ? 'tool_use' : 'end_turn'),
    usage,
  }
}

function safeParse(json) {
  if (!json || !json.trim()) return {}
  try {
    return JSON.parse(json)
  } catch {
    return { __parseError: true, raw: json.slice(0, 2000) }
  }
}

/**
 * Anthropic rejects empty content blocks and requires consecutive same-role
 * turns to be merged. Clean both up before sending.
 */
function normalizeMessages(messages) {
  const out = []

  for (const message of messages || []) {
    const content = toBlocks(message.content)
    if (!content.length) continue

    const last = out[out.length - 1]
    if (last && last.role === message.role) {
      last.content.push(...content)
    } else {
      out.push({ role: message.role, content })
    }
  }

  return out
}

function toBlocks(content) {
  if (typeof content === 'string') {
    return content.trim() ? [{ type: 'text', text: content }] : []
  }
  if (!Array.isArray(content)) return []

  return content
    .map((block) => {
      if (!block) return null
      if (typeof block === 'string') return { type: 'text', text: block }
      if (block.type === 'text') return block.text ? { type: 'text', text: block.text } : null
      if (block.type === 'tool_use') {
        return { type: 'tool_use', id: block.id, name: block.name, input: block.input ?? {} }
      }
      if (block.type === 'tool_result') {
        return {
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          content: typeof block.content === 'string'
            ? block.content
            : JSON.stringify(block.content ?? ''),
          is_error: !!block.is_error,
        }
      }
      return null
    })
    .filter(Boolean)
}
