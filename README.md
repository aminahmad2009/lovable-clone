# Lovable Local

A single-user, on-device clone of a prompt-to-app builder. You describe an app in a chat panel, an
agent edits real files in a real project on your disk, and a live preview updates as it works.
Every project is an ordinary Vite + React + TypeScript + Tailwind app with its own git history —
nothing here is a proprietary format.

No multi-tenancy, no billing, no hosted publishing. One machine, one user, as many projects as you
want.

## Quick start

```bash
node server/index.js        # or: npm start
```

Then open <http://127.0.0.1:4310>. There is no install step for the platform itself — the server
and the control panel use only Node built-ins.

Requirements: Node 20.10+ (tested on 22), git on PATH. Generated projects install their own
dependencies with npm on first start.

## Adding a model

The agent needs an LLM. Open **Settings** in the panel and either pick a preset (OpenAI,
OpenRouter, Groq, Together, Azure, custom endpoint) or enter any OpenAI-compatible base URL, key
and model name. **Test connection** verifies it with a one-token call before you spend anything.

Environment variables work too and take effect when the matching field is left blank:
`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, and for the Anthropic adapter
`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`.

Keys you type into Settings are stored in `data/settings.json` on this machine. Keys that come
from the environment are never written to disk.

A third provider, `mock`, is scripted rather than a model. It exists so the agent loop can be
exercised without spending tokens; the UI shows a banner whenever it is active.

## What a turn looks like

1. You send a message in **Plan** mode (discussion only, no tools) or **Agent** mode.
2. The agent gets a system prompt containing the project's live file tree and the stack rules,
   plus the conversation so far.
3. It calls tools — `list_files`, `read_file`, `write_file`, `edit_file`, `delete_file`,
   `search_files`, `run_command` — streamed to the panel as collapsible events.
4. The dev server for that project is already running, so a broken edit is caught immediately:
   Vite's transform error is parsed and handed straight back to the agent to fix in the same turn.
5. When the model stops calling tools, the working tree is committed with your message as the
   subject, and the History tab shows the diff.

## Multi-project model

Each project lives in `data/projects/<slug>/` with its own git repo and its own dev server on a
reserved port (5180 by default, allocated upward). Duplicate names get `-2`, `-3` suffixes.
Servers are started on demand and evicted least-recently-used when more than
`MAX_RUNNING_SERVERS` (default 4) would run at once. The registry survives restarts; servers do
not auto-start.

## Safety model

The agent has full read/write access **inside its project directory only** — every file tool
resolves paths against the project root and refuses escapes. The shell is the exception and is
allowlisted: package-manager commands, `node` on project scripts, `tsc`, and read-mostly git.
Anything else is refused and reported back to the model. The preview iframe is sandboxed with
`allow-scripts allow-same-origin`, which is required for HMR and `localStorage` in generated apps
but means generated code runs with its own origin's privileges — acceptable for local use, worth
knowing about.

## Layout

```
server/
  index.js       HTTP API, SSE event stream, static hosting for the panel
  config.js      paths, settings layering (defaults < settings.json < env), presets
  registry.js    project registry, ports, chat history, orphan detection
  scaffold.js    template instantiation with {{PLACEHOLDER}} expansion
  devserver.js   per-project Vite process manager, log ring buffer, error detection
  agent.js       the loop: system prompt, tool dispatch, self-healing, auto-commit
  tools.js       sandboxed file tools + command allowlist
  files.js       file tree and read/write used by the panel
  git.js         init, commit, log, diff, restore
  llm/           provider adapters: openai.js, anthropic.js, mock.js, shared SSE parser
  templates/     the react-vite starter copied into every new project
web/             the control panel: index.html, styles.css, app.js (no build step)
data/            runtime state: projects/, meta/, registry.json, settings.json
```

## What this is not

Compared with the hosted product it imitates, there is no credit metering, no team permissions,
no database/auth integration wizard, no one-click public deployment, and no native mobile target.
The agent's quality is exactly the quality of the model you point it at — the platform supplies
the loop, the sandbox and the feedback, not the intelligence.

## Verified

Tested end to end on Windows with Node 22: scaffold install and boot, two concurrent dev servers,
duplicate-name handling, registry persistence across restarts, tool execution and auto-commit,
SSE streaming of every event type, build-error detection and recovery, path-traversal refusal,
and the full panel UI in a browser. The OpenAI and Anthropic adapters are verified for request
shape and error handling; live model output depends on the key you supply.
