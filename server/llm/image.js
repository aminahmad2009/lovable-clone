import { assertOk, describeNetworkError } from './sse.js'

/**
 * OpenAI-compatible image generation (`POST {baseUrl}/images/generations`).
 *
 * Resolution order, matching what the agent is told in its system prompt:
 *   1. the dedicated image model from Settings, if one is configured;
 *   2. the active OpenAI-compatible text endpoint (many gateways serve both);
 *   3. nothing — throw a clear, actionable error.
 *
 * Every attempt that fails is reported in the final error so the user can see
 * which credential or model name was wrong instead of a silent no-op.
 */

const DEFAULT_SIZE = '1024x1024'
const IMAGE_TIMEOUT_MS = 180_000

function normalizeBase(base) {
  return String(base || '').trim().replace(/\/+$/, '')
}

/**
 * Build the ordered list of endpoints to try. Pure and exported so the
 * Settings UI can explain what will happen before anything is called.
 */
export function imageTargets(settings, activeProvider) {
  const image = settings?.image || {}
  const openai = settings?.openai || {}
  const size = image.size || DEFAULT_SIZE
  const targets = []

  if (image.model) {
    targets.push({
      label: 'image model',
      baseUrl: normalizeBase(image.baseUrl) || normalizeBase(openai.baseUrl) || 'https://api.openai.com/v1',
      apiKey: image.apiKey || openai.apiKey || '',
      model: image.model,
      size,
    })
  }

  // Fall back to the OpenAI-compatible text endpoint. Anthropic has no image
  // API, so an Anthropic-only setup simply has no fallback.
  const fallback = {
    label: 'text model endpoint',
    baseUrl: normalizeBase(openai.baseUrl) || 'https://api.openai.com/v1',
    apiKey: openai.apiKey || '',
    model: openai.model || '',
    size,
  }
  const distinct = !targets.length
    || targets[0].model !== fallback.model
    || targets[0].baseUrl !== fallback.baseUrl
  const usable = activeProvider === 'anthropic'
    ? Boolean(openai.apiKey && openai.model)
    : true
  if (fallback.model && distinct && usable) targets.push(fallback)

  return targets.filter((t) => t.apiKey && t.baseUrl)
}

/** True when at least one endpoint could be attempted. */
export function imageCapable(settings, activeProvider) {
  return imageTargets(settings, activeProvider).length > 0
}

/** Describe the configured capability for the system prompt / Settings UI. */
export function imageCapability(settings, activeProvider) {
  const targets = imageTargets(settings, activeProvider)
  if (!targets.length) return { available: false, model: null, host: null, targets: [] }
  const primary = targets[0]
  return {
    available: true,
    model: primary.model,
    host: safeHost(primary.baseUrl),
    source: primary.label,
    fallbacks: targets.slice(1).map((t) => `${t.model} (${t.label})`),
    targets,
  }
}

function safeHost(baseUrl) {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

function combinedSignal(signal) {
  const timeout = AbortSignal.timeout(IMAGE_TIMEOUT_MS)
  if (!signal) return timeout
  try {
    return AbortSignal.any([signal, timeout])
  } catch {
    return signal
  }
}

async function post(baseUrl, apiKey, body, signal) {
  const endpoint = `${baseUrl}/images/generations`
  try {
    return await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    throw describeNetworkError(err, endpoint, 'image')
  }
}

async function requestImage(target, { prompt, size, signal }) {
  const body = {
    model: target.model,
    prompt,
    n: 1,
    size: size || target.size || DEFAULT_SIZE,
    response_format: 'b64_json',
  }

  let response = await post(target.baseUrl, target.apiKey, body, signal)

  if (!response.ok) {
    // gpt-image-1 and several gateways reject `response_format` (or `size`)
    // outright. Retry once with the offending parameter dropped rather than
    // failing the whole turn on a schema technicality.
    const detail = await response.text().catch(() => '')
    const droppable = ['response_format', 'size'].filter((key) =>
      new RegExp(`\\b${key}\\b`).test(detail) && /unsupported|unknown|invalid|not (?:allowed|supported)|remove/i.test(detail))
    if (response.status === 400 && droppable.length) {
      for (const key of droppable) delete body[key]
      response = await post(target.baseUrl, target.apiKey, body, signal)
    } else {
      const err = await errorFrom(response, detail)
      throw err
    }
  }

  await assertOk(response, 'Image API')

  const json = await response.json().catch(() => null)
  const item = json?.data?.[0]
  if (!item) {
    throw new Error(`The image endpoint returned no image data${json?.error?.message ? `: ${json.error.message}` : '.'}`)
  }

  if (typeof item.b64_json === 'string' && item.b64_json) {
    return { buffer: Buffer.from(item.b64_json, 'base64'), ext: 'png', model: target.model, source: target.label }
  }
  if (typeof item.url === 'string' && item.url) {
    let download
    try {
      download = await fetch(item.url, { signal })
    } catch (err) {
      throw describeNetworkError(err, item.url, 'image host')
    }
    if (!download.ok) throw new Error(`Could not download the generated image (HTTP ${download.status}).`)
    return {
      buffer: Buffer.from(await download.arrayBuffer()),
      ext: extFromUrl(item.url),
      model: target.model,
      source: target.label,
    }
  }
  throw new Error('The image endpoint returned neither b64_json nor a url.')
}

async function errorFrom(response, detail) {
  let message = `Image API error ${response.status}`
  try {
    const parsed = JSON.parse(detail)
    message = parsed?.error?.message || parsed?.message || message
  } catch {
    if (detail) message = `${message}: ${detail.slice(0, 400)}`
  }
  const err = new Error(message)
  err.status = response.status
  if (response.status === 401 || response.status === 403) err.hint = 'Check the image API key in Settings.'
  else if (response.status === 404) err.hint = 'That endpoint has no /images/generations route, or the model name is wrong.'
  else if (response.status === 429) err.hint = 'Rate limited — wait a moment and retry.'
  return err
}

function extFromUrl(url) {
  const match = String(url).split('?')[0].match(/\.(png|jpe?g|webp|gif)$/i)
  if (!match) return 'png'
  return match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()
}

/**
 * Generate one image. Returns `{ buffer, ext, model, source }`.
 * Throws an Error whose message lists every attempt that was made, so a
 * failure is always explainable to the user.
 */
export async function generateImage({ settings, provider, prompt, size, signal }) {
  const text = String(prompt || '').trim()
  if (!text) throw new Error('An image prompt is required.')

  const targets = imageTargets(settings, provider)
  if (!targets.length) {
    const err = new Error(
      'No image generation capability is configured. Add an OpenAI-compatible image model in '
      + 'Settings → Image model, or configure an OpenAI-compatible text provider whose endpoint '
      + 'also serves /images/generations.',
    )
    err.hint = 'Settings → Image model: base URL, API key and model name.'
    err.code = 'NO_IMAGE_PROVIDER'
    throw err
  }

  const failures = []
  for (const target of targets) {
    if (signal?.aborted) break
    try {
      return await requestImage(target, { prompt: text, size, signal: combinedSignal(signal) })
    } catch (err) {
      if (signal?.aborted) break
      failures.push(`${target.label} "${target.model}" @ ${safeHost(target.baseUrl)} → ${err.message}`)
      if (err.status === 429) {
        // Throttling is worth one short pause before the fallback endpoint.
        await new Promise((resolve) => setTimeout(resolve, 3000))
      }
    }
  }

  const err = new Error(`Image generation failed.\n${failures.map((f) => `• ${f}`).join('\n')}`)
  err.hint = 'Check Settings → Image model: the base URL must point at an OpenAI-compatible endpoint '
    + 'that exposes POST /images/generations, and the model name must be an image model it serves.'
  err.code = 'IMAGE_FAILED'
  throw err
}

/**
 * Cheap connectivity check used by the Settings panel. Generates the smallest
 * possible image so a misconfigured endpoint is caught before the agent tries.
 */
export async function testImageConnection(settings, provider) {
  const started = Date.now()
  const capability = imageCapability(settings, provider)
  if (!capability.available) {
    return { ok: false, error: 'No image model configured.', hint: 'Fill in Settings → Image model.', latencyMs: 0 }
  }
  try {
    const result = await generateImage({
      settings,
      provider,
      prompt: 'A single small blue circle on a white background.',
      size: '256x256',
      signal: AbortSignal.timeout(60_000),
    })
    return {
      ok: true,
      model: result.model,
      source: result.source,
      bytes: result.buffer.length,
      format: result.ext,
      latencyMs: Date.now() - started,
    }
  } catch (err) {
    return { ok: false, error: err.message, hint: err.hint ?? null, latencyMs: Date.now() - started }
  }
}
