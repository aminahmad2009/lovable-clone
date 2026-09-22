# Changelog

All notable changes to **Lovable Local** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

- **Product ID:** `codewoxy-lovable-local`
- **Built by:** CodeWoxy
- **Version source of truth:** `package.json` → `version`, surfaced at runtime by
  `server/config.js` (`APP_VERSION`, `PRODUCT_ID`), by `GET /api/health`, and by the
  version chip in the sidebar (click it for the About panel).

---

## [Unreleased]

Nothing staged yet.

---

## [0.2.0] — 2026-09-22

### Added

- **Image generation.** New optional OpenAI-compatible image endpoint under
  Settings → Image model (base URL, API key, model name, default size). Blank
  base URL / key inherit from the OpenAI-compatible text provider, so a gateway
  that serves both only needs a model name. Environment overrides:
  `IMAGE_API_KEY`, `IMAGE_BASE_URL`, `IMAGE_MODEL`, `IMAGE_SIZE`.
- **`image_generation` agent tool.** Saves into the project (default
  `public/generated/<slug>-<id>.png`) and returns the URL path to reference in
  code. Resolution order: dedicated image model → active OpenAI-compatible text
  endpoint → a thrown error that lists every attempt made and what to fix.
  Handles `b64_json` and `url` responses, and retries once without
  `response_format` / `size` when a gateway rejects those parameters.
- **"Test image model"** button in Settings — generates a throwaway 256×256
  image and reports model, source, byte size and latency, or the exact failure.
- **Agent persona is image-aware.** The system prompt now states which image
  model is configured (or that none is) and instructs the agent to prefer
  generated imagery over SVG placeholders, and to report failures rather than
  stopping quietly.
- **Skills library.** Twelve built-in skills (accessibility, responsive layout,
  forms, loading states, motion, dark mode, data fetching, state management,
  performance, data viz, SEO metadata, testing) plus full CRUD for user-defined
  skills. Enabled skills are injected into the system prompt per project.
- **Collapsible "Thinking" blocks** in chat: reasoning streams live behind a
  dropdown arrow, is labelled `Thought for Ns` when it finishes, and is replayed
  collapsed from history on reload.
- **About panel** (sidebar version chip) showing product name, product ID,
  version, publisher, active text provider, image model, project count and both
  directories.
- **`system:notice` event** for non-fatal agent notices (empty-response retry,
  dev server that failed to start) rendered as a system line in chat.
- **`docs/`** — full project documentation: overview, architecture, server
  modules, agent loop, tool reference, providers, settings, HTTP API, UI guide,
  desktop packaging, skills and troubleshooting.
- **Build identity in metadata.** `package.json` now carries `company`,
  `productName`, `productId`, `repository`, `homepage`, `bugs` and
  `license`; electron-builder `appId` is `com.codewoxy.lovable-local`,
  `publisherName` is CodeWoxy, and installer artifacts are named
  `Lovable Local-Setup-<version>.exe`.
- **`npm run version:check`** — fails if `CHANGELOG.md` has no entry for the
  version in `package.json`, so a release cannot ship undocumented.

### Changed

- **No more silent agent stops.** Every turn now emits exactly one terminal
  event. An empty model response (no text and no tool calls — including the
  "reasoning only, then cut off" case) is retried twice with a visible notice,
  then reported as a proper error in the chat response area with the model name,
  stop reason and a hint. Failures after the model loop (history write, usage
  write) are also reported instead of being swallowed.
- The HTTP chat route re-emits `turn:error` as a safety net if the agent throws
  without having reported it.
- **Transport errors are translated.** Node's `fetch` rejects with the useless
  `fetch failed`; `describeNetworkError()` now converts connection-refused, DNS,
  timeout, dropped-socket and TLS failures into a sentence naming the host, with
  an actionable hint printed underneath. User aborts and HTTP errors pass through
  untouched. Retry detection now also matches the transient error codes, not just
  the wording.
- Aborts are reported consistently as `turn:aborted` and return
  `{ aborted: true }` whichever path detects them.
- The system prompt now requires the agent to end every turn with a short text
  reply, so an empty reply is always a bug rather than a valid outcome.
- `executeTool` takes a context object (`{ root, onLog, settings, provider, signal }`)
  and appends a `Hint:` line to tool errors that carry one.
- Removed the native File/Edit/View/Window menubar from the desktop app; the
  tray menu now shows the product name, version and publisher.
- Server startup banner prints product name, version, product ID, publisher,
  data directory, provider state and image model.

### Fixed

- Thinking-block animated dots stayed visible after the block was finalised.
- A turn that failed after the model loop left the chat panel spinning with no
  message and no error.
- An unreachable model endpoint surfaced in chat as the bare string
  `fetch failed`; it now names the host and says what to check.
- The startup banner reported the number of tracked dev servers where it meant
  the concurrency cap (`max 0 tracked`); it now prints the port range, the cap
  and the tracked count.

### Security

- `data/` (registry, settings, per-project files and chat history) is no longer
  tracked by git. `data/settings.json` holds provider API keys in plaintext, and
  an earlier commit included it — rotate any key that was ever committed and
  pushed.

---

## [0.1.0] — 2026-09-21

First working end-to-end build.

### Added

- Zero-dependency Node ESM control server on `127.0.0.1:4310` (no runtime
  packages; `node:` built-ins only).
- Multi-project registry with unique ports (5180–5380), per-project git
  repositories, and a cap on concurrently running dev servers.
- Project scaffolding for React 19 + Vite + TypeScript + Tailwind 4 and
  Vue 3 + Vite + TypeScript + Tailwind 4.
- Agent loop with streaming tool calls, retry/backoff on provider throttling,
  step cap, dev-server self-healing on build errors, auto-install when
  `package.json` changes, and auto-commit (or review-before-commit) per turn.
- Tool set: `list_files`, `read_file`, `write_file`, `edit_file`,
  `delete_file`, `search_files`, `run_command` (allowlisted).
- LLM adapters: OpenAI-compatible `/chat/completions` (OpenAI, Groq,
  OpenRouter, Together, Azure, NVIDIA, any gateway), Anthropic Messages, and an
  offline `mock` provider for UI work.
- SSE event bus streaming agent, tool, dev-server, git and file events to the UI.
- Web control panel (vanilla JS, no build step): project grid, chat with
  Plan/Agent modes, live iframe preview with device widths and console capture,
  code editor with file tree and regex search, commit history with diffs and
  restore, dev-server logs, settings modal with connection test.
- Reference-image attachments in chat (data URL or base64, up to 8).
- Design preset library with search, applied per project.
- Per-project cumulative token totals, typecheck runner, zip export, and
  import-existing-folder (adopted in place, git initialised if missing).
- Light/dark theme toggle.
- Electron desktop wrapper: in-process server, tray-resident, single-instance
  lock, writable `userData/data` when packaged, and an NSIS installer.

[Unreleased]: https://github.com/aminahmad2009/lovable-clone/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/aminahmad2009/lovable-clone/releases/tag/v0.2.0
[0.1.0]: https://github.com/aminahmad2009/lovable-clone/releases/tag/v0.1.0
