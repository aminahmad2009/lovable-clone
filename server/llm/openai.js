import { streamSse, assertOk } from './sse.js'

const DEFAULT_MAX_TOKENS = 8000

/**
 * OpenAI-compatible Chat Completions adapter (OpenAI, Groq, OpenRouter,
 * Together, Ollama, LM Studio — anything speaking /chat/completions).
 *
 * Translates the app's Anthropic-shaped internal messages to OpenAI's tool
 * calling format and back again, so agent.js stays provider-agnostic.
 */
export async function streamOpenAi({
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
  const apiKey = settings.openai?.apiKey
  if (!apiKey) {
    throw new Error('No OpenAI-compatible API key configured. Add one in Settings or set OPENAI_API_KEY.')
  }

  const baseUrl = (settings.openai?.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')

  const body = {
    model: model || settings.openai?.model || 'gpt-4o',
    stream: true,
    stream_options: { include_usage: true },
    messages: toOpenAiMessages(system, messages),
  }
  if (tools.length) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }))
    body.tool_choice = 'auto'
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  })
  await assertOk(response, 'OpenAI-compatible')

  const textParts = []
  /** Tool calls keyed by the streaming index OpenAI assigns. */
  const pending = new Map()
  let stopReason = null
  let usage = { inputTokens: 0, outputTokens: 0 }

  for await (const evt of streamSse(response)) {
    if (evt.done) break
    if (signal?.aborted) break
    const data = evt.data
    if (!data) continue

    if (data.error) throw new Error(data.error.message || 'OpenAI stream error')

    if (data.usage) {
      usage.inputTokens = data.usage.prompt_tokens ?? usage.inputTokens
      usage.outputTokens = data.usage.completion_tokens ?? usage.outputTokens
    }

    const choice = data.choices?.[0]
    if (!choice) continue
    const delta = choice.delta || {}

    if (typeof delta.content === 'string' && delta.content) {
      textParts.push(delta.content)
      onText?.(delta.content)
    }

    for (const part of delta.tool_calls || []) {
      const key = part.index ?? 0
      if (!pending.has(key)) {
        const call = { id: part.id || `call_${key}_${Date.now()}`, name: '', json: '' }
        pending.set(key, call)
      }
      const call = pending.get(key)
      if (part.id) call.id = part.id
      if (part.function?.name) {
        call.name += part.function.name
        if (!call.announced && call.name) {
          call.announced = true
          onToolStart?.({ id: call.id, name: call.name })
        }
      }
      if (part.function?.arguments) call.json += part.function.arguments
    }

    if (choice.finish_reason) stopReason = choice.finish_reason
  }

  const toolCalls = [...pending.values()].map((call) => ({
    id: call.id,
    name: call.name,
    args: safeParse(call.json),
  }))

  return {
    provider: 'openai',
    model: body.model,
    text: textParts.join(''),
    toolCalls,
    stopReason: stopReason || (toolCalls.length ? 'tool_calls' : 'stop'),
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
 * Flatten internal blocks into OpenAI turns. A single internal user message can
 * hold several tool_result blocks; those become separate `tool` turns.
 */
function toOpenAiMessages(system, messages) {
  const out = []
  if (system) {
    out.push({ role: 'system', content: typeof system === 'string' ? system : stringify(system) })
  }

  for (const message of messages || []) {
    const blocks = Array.isArray(message.content)
      ? message.content
      : [{ type: 'text', text: String(message.content ?? '') }]

    if (message.role === 'assistant') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('')
      const calls = blocks.filter((b) => b.type === 'tool_use')
      const turn = { role: 'assistant', content: text || null }
      if (calls.length) {
        turn.tool_calls = calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
        }))
      }
      out.push(turn)
      continue
    }

    const toolResults = blocks.filter((b) => b.type === 'tool_result')
    for (const result of toolResults) {
      out.push({
        role: 'tool',
        tool_call_id: result.tool_use_id,
        content: typeof result.content === 'string' ? result.content : stringify(result.content),
      })
    }

    const textParts = blocks
      .filter((b) => b.type === 'text' && b.text)
      .map((b) => b.text)
    if (textParts.length) {
      out.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content: textParts.join('\n') })
    }
  }

  return out
}

function stringify(value) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}
