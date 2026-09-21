# 5 · Providers, settings & image generation

## Provider adapters

`server/llm/index.js` holds a registry and one entry point:

```js
const ADAPTERS = { openai: streamOpenAi, anthropic: streamAnthropic, mock: streamMock }
export async function streamChat(options) { return ADAPTERS[resolveProvider(options.settings, options.provider)](options) }
```

Every adapter takes the same options bag and returns the same shape, so `agent.js` never learns which
provider it is talking to:

```js
// in
{ settings, provider, system, messages, tools, model, maxTokens, signal, onText, onThinking, onToolStart }
// out
{ provider, model, text, thinking, toolCalls: [{ id, name, args }], stopReason, usage: { inputTokens, outputTokens } }
```

### `openai` — OpenAI-compatible chat completions

The workhorse. Speaks `POST {baseUrl}/chat/completions` with `stream: true` and
`stream_options.include_usage`, so it covers OpenAI, NVIDIA, Groq, OpenRouter, Together, Azure,
vLLM, and anything else that implements the schema.

Details worth knowing:

- **Reasoning capture.** Different gateways name chain-of-thought differently; `pickReasoning()`
  accepts `delta.reasoning_content`, `delta.reasoning`, and `delta.reasoning_details` (array of
  strings or `{text}`/`{summary}` objects). Whatever it finds is streamed as `assistant:thinking`.
- **Tool calls** arrive fragmented by streaming index. Fragments are accumulated in a map keyed by
  `index`, `onToolStart` fires once the name is known, and the assembled JSON is parsed at the end.
  Unparseable arguments become `{ __parseError: true, raw }` so the agent can tell the model to retry
  instead of crashing.
- **Message translation** (`toOpenAiMessages`) converts the internal Anthropic-shaped blocks:
  assistant text + `tool_use` blocks become one assistant turn with `tool_calls`; each `tool_result`
  becomes its own `role: 'tool'` turn keyed by `tool_call_id`; unknown block types (like `thinking`)
  are dropped.
- **Stop reason** comes from `finish_reason`, defaulting to `tool_calls` when calls are present.

### `anthropic` — Messages API

`POST {baseUrl}/v1/messages` with `anthropic-version`, streaming `content_block_delta` events
(`text_delta`, `thinking_delta`, `input_json_delta`) and `message_delta` for the stop reason and
usage. Tool definitions map `input_schema` straight across, since the internal format is already
Anthropic-shaped.

### `mock` — offline scripted provider

Returns canned text and tool calls with no network access, and sets `MOCK_WARNING`. The UI shows a
persistent banner when it is active. Use it to work on the interface without spending tokens.
`providerReady()` always returns true for it.

### Readiness and testing

```js
providerReady(settings, provider)  // mock → true, otherwise Boolean(settings[provider].apiKey)
testConnection(settings, provider) // a 16-token "reply with ok" call, 30 s timeout
```

`POST /api/settings/test` runs the latter and returns
`{ ok, provider, model, reply, latencyMs }` or `{ ok: false, error, status, hint, latencyMs }`.
The Settings panel saves the form first, so you are always testing what you just typed.

## Settings

### Shape

```js
{
  provider: 'openai' | 'anthropic' | 'mock',
  anthropic: { apiKey, baseUrl, model },
  openai:    { apiKey, baseUrl, model },
  image:     { apiKey, baseUrl, model, size },
  agent:     { maxSteps, autoInstall, autoCommit, reviewCommit },
}
```

### Layering

```
DEFAULT_SETTINGS  <  data/settings.json  <  environment
```

Deep-merged, so partial overrides work. `saveSettings(patch)` merges the patch into the stored file
and returns the re-layered result — the UI always gets back the effective configuration, not just
what it sent.

### Key handling

- `GET /api/settings` returns every key masked as `••••••••` plus `hasKey` and `keySource`.
- `PUT /api/settings` drops any `apiKey` containing `•` before merging, so saving the form with an
  untouched key field cannot overwrite the real key with the placeholder.
- `keySource(settings, provider)` reports `'settings'`, `'environment'` or `'none'` by comparing the
  effective key against the environment variables — useful because an env-provided key cannot be
  edited in the UI.
- Keys that came from the environment are never written to disk.
- `data/` is git-ignored.

### Presets

`OPENAI_COMPATIBLE_PRESETS` powers the Preset dropdown: OpenAI, OpenRouter, Groq, Together AI, Azure
OpenAI, and Custom. Choosing one fills the base URL and a sensible default model name.

## Image generation

Optional. When configured, the agent gets an `image_generation` tool and a system-prompt section
telling it to prefer real artwork over SVG placeholders. When it is not configured, the tool still
exists but the prompt tells the agent to expect failure and to report it.

### Endpoint resolution

`imageTargets(settings, activeProvider)` in `server/llm/image.js` builds an ordered attempt list:

1. **The dedicated image model** — `settings.image.model` must be set. Its base URL and key fall back
   to the OpenAI-compatible text provider's when left blank, so a gateway serving both needs only a
   model name.
2. **The OpenAI-compatible text endpoint** — `settings.openai.model` + key, tried only if it differs
   from attempt 1. Skipped for an Anthropic-only setup (Anthropic has no image API).
3. **Nothing** → `generateImage` throws with `code: 'NO_IMAGE_PROVIDER'` and a message naming
   Settings → Image model.

Targets without an API key or base URL are filtered out. `imageCapability()` exposes the resolved
primary (model, host, source label, fallback list) for the health endpoint, the Settings UI and the
system prompt.

### The request

```
POST {baseUrl}/images/generations
authorization: Bearer <key>
{ model, prompt, n: 1, size, response_format: 'b64_json' }
```

Response handling:

- `data[0].b64_json` → decoded to a buffer, extension `png`.
- `data[0].url` → downloaded (extension taken from the URL).
- Empty `data` → error.
- **400 mentioning `response_format` or `size` as unsupported/invalid** → the offending parameter is
  dropped and the request is retried once. `gpt-image-1` and several gateways reject
  `response_format`; without this the whole feature would fail on a schema technicality.
- 401/403 → hint *"Check the image API key in Settings."*
- 404 → hint *"That endpoint has no /images/generations route, or the model name is wrong."*
- 429 → hint about rate limiting, plus a 3 s pause before trying the next target.

Every request has a 180 s timeout combined with the turn's abort signal (`AbortSignal.any`), so
pressing Stop cancels an in-flight image too.

### Failure reporting

If all attempts fail, the thrown error lists each one:

```
Image generation failed.
• image model "flux-1-schnell" @ api.example.com → Incorrect API key provided
• text model endpoint "gpt-4o" @ api.openai.com → That endpoint has no /images/generations route
```

with the hint: *"Check Settings → Image model: the base URL must point at an OpenAI-compatible
endpoint that exposes POST /images/generations, and the model name must be an image model it serves."*

Because `executeTool` never throws, this text goes back to the model as the tool result (prefixed
`ERROR:`, with the hint appended), the tool card in chat turns red with the same text, and the system
prompt instructs the agent to quote the error to you and continue with a non-image implementation
rather than stopping.

### The tool

```js
image_generation { prompt, path?, size? }
```

Saves to `public/generated/<slug>-<base36>.<ext>` by default, or to an explicit `path` (escape-guarded,
extension appended if missing). Returns:

```
Saved 1024x1024 image to public/generated/hero-fox-mubqev8i.png (184 KB, PNG)
Model: flux-1-schnell via image model
Reference it in code as "/generated/hero-fox-mubqev8i.png" — that path is served by the dev server.
```

A successful generation also emits `file:written` so an open Code tab refreshes its tree, and marks
the turn as having changed files so the commit picks the binary up.

### Testing it from the UI

Settings → **Test image model** calls `POST /api/settings/test-image`, which generates a 256×256
throwaway image and reports `model`, `source` (`image model` or `text model endpoint`), byte size,
format and latency — or the full failure text. It is the fastest way to tell a bad model name from a
bad base URL.

### Environment overrides

`IMAGE_API_KEY`, `IMAGE_BASE_URL`, `IMAGE_MODEL`, `IMAGE_SIZE`. Setting only `IMAGE_MODEL` is enough
when the text provider's endpoint also serves images.
