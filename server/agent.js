import path from 'node:path'
import { TOOL_DEFINITIONS, executeTool } from './tools.js'
import { streamChat } from './llm/index.js'
import { manager, emit } from './devserver.js'
import { loadHistory, appendHistory, touchProject, addProjectUsage } from './registry.js'
import { gitCommitAll, gitStatusShort } from './git.js'
import { listProjectTree } from './files.js'
import { designBrief } from './designs.js'

const HISTORY_TURNS = 24

/** Providers throttle; a one-shot turn that dies on a 429 wastes the work. */
const RETRYABLE = /overloaded|rate limit|too many requests|temporarily unavailable|service unavailable|connection (?:reset|error)|ECONNRESET/i
const RETRY_DELAYS = [6000, 15000]

async function streamWithRetry(options, projectId) {
  let attempt = 0
  for (;;) {
    try {
      return await streamChat(options)
    } catch (err) {
      const retryable = err.status === 429
        || (err.status >= 500 && err.status < 600)
        || RETRYABLE.test(err.message || '')
      if (!retryable || attempt >= RETRY_DELAYS.length || options.signal?.aborted) throw err
      const delay = RETRY_DELAYS[attempt]
      attempt++
      emit(projectId, 'agent:retry', { attempt, delayMs: delay, message: err.message })
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

function frameworkNotes(template) {
  if (template === 'vue-vite') {
    return {
      stack: 'Vue 3 (SFCs), TypeScript, Vite 8, Tailwind CSS 4.',
      conventions: `- \`index.html\` loads \`/src/main.ts\`. Do not change that script tag.
- \`src/main.ts\` mounts \`App.vue\` from \`src/App.vue\` onto \`#app\`. Keep that entry point stable.
- Components are single-file components in \`src/components/\` (\`.vue\`), routes in \`src/pages/\`, shared helpers in \`src/lib/\`, composables in \`src/composables/\`.
- Use \`<script setup lang="ts">\` in SFCs. Style with Tailwind utility classes in the template.`,
    }
  }
  return {
    stack: 'React 19, TypeScript, Vite 8, Tailwind CSS 4.',
    conventions: `- \`index.html\` loads \`/src/main.tsx\`. Do not change that script tag.
- \`src/main.tsx\` renders \`<App />\` from \`src/App.tsx\`. Keep that entry point stable.
- Components go in \`src/components/\`, routes in \`src/pages/\`, shared helpers in \`src/lib/\`, hooks in \`src/hooks/\`.`,
  }
}

function systemPrompt(project, tree, mode) {
  const fw = frameworkNotes(project.template)
  const stack = `
## Project
- Name: ${project.name}
- Root directory: ${project.path}
- Stack: ${fw.stack}

## How Tailwind 4 works here
- Tailwind is wired through the \`@tailwindcss/vite\` plugin. There is NO tailwind.config.js and you must not create one.
- \`src/index.css\` contains \`@import "tailwindcss";\`. Design tokens live in an \`@theme\` block there.
- Style with utility classes in JSX. Only add plain CSS to src/index.css for global rules or keyframes.

## Project conventions
${fw.conventions}
- The \`@/\` path alias maps to \`src/\`. Use it for imports.
- Prefer small focused files over one large component.

## Rules
- Write complete, working files. Never leave TODO comments, placeholders, or "rest of code here" stubs.
- For changes to an existing file prefer \`edit_file\` with exact text over rewriting the whole file.
- Read a file before editing it. Do not guess at existing content or indentation.
- Add dependencies with \`run_command\` using \`npm install <packages>\`. They are installed into the project automatically.
- Do NOT run \`npm run dev\`, \`vite\`, or any long-lived server. The platform already runs the dev server and streams its output; starting another one will conflict on the port.
- Do NOT run \`git commit\`. The platform commits automatically after each turn.
- You may run \`npx tsc --noEmit\` to typecheck when a change is intricate.
- The app is rendered inside an iframe in a preview panel, so avoid anything that requires top-level navigation.
${designBrief(project.designId)}
## Current file tree
${tree}
`

  if (mode === 'plan') {
    return `${stack}
## Mode: PLAN
You are planning only. You have no tools in this mode and must not claim to have changed files.
Discuss approach, structure, data model and trade-offs. Be concrete and brief. When the user is
happy they will switch to Agent mode to have the work done.`
  }

  return `${stack}
## Mode: AGENT
You have tools to read and write this project directly. Use them to complete the request end to end.

Working method:
1. Look at the file tree above. Read the files you intend to change before changing them.
2. Make the edits. Build features completely rather than sketching them.
3. When you add dependencies, install them before importing them.
4. Finish with one or two sentences on what changed and what to look at in the preview. Do not
   recap every file and do not narrate the diff.

If a tool returns an error, or the platform reports a build error, fix it and keep going rather
than stopping to ask. Only ask the user a question when the request is genuinely ambiguous in a way
that would change what you build.`
}

function trimHistory(messages) {
  if (messages.length <= HISTORY_TURNS * 2) return messages
  const kept = messages.slice(-HISTORY_TURNS * 2)
  // Never start on a tool_result: it would reference a tool_use we dropped.
  while (kept.length && kept[0].role === 'user'
    && Array.isArray(kept[0].content)
    && kept[0].content.some((b) => b.type === 'tool_result')) {
    kept.shift()
  }
  return kept
}

/**
 * Run one agent turn: stream the model, execute its tool calls, feed build
 * errors back in, and keep going until the model stops or the step cap hits.
 */
export async function runAgentTurn({
  project,
  userMessage,
  settings,
  mode = 'agent',
  provider,
  signal,
  images = [],
}) {
  const tree = await listProjectTree(project.path)
  const history = await loadHistory(project.id)

  const userContent = [
    ...(images.length
      ? images.map((img) => ({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType || 'image/png', data: img.data },
      }))
      : []),
    { type: 'text', text: userMessage },
  ]

  const messages = [
    ...trimHistory(history),
    { role: 'user', content: userContent },
  ]

  const persisted = [{ role: 'user', content: [{ type: 'text', text: userMessage }] }]

  emit(project.id, 'turn:start', { mode, model: settings[provider || settings.provider]?.model })

  let steps = 0
  const maxSteps = settings.agent?.maxSteps ?? 24
  const changedFiles = new Set()
  let totalInput = 0
  let totalOutput = 0
  let finalText = ''
  let buildErrorReported = false

  while (steps < maxSteps) {
    if (signal?.aborted) {
      emit(project.id, 'turn:aborted', {})
      break
    }
    steps++

    let result
    try {
      result = await streamWithRetry({
        settings,
        provider,
        system: systemPrompt(project, tree, mode),
        messages,
        tools: mode === 'agent' ? TOOL_DEFINITIONS : [],
        signal,
        onText: (delta) => emit(project.id, 'assistant:delta', { delta, step: steps }),
        onToolStart: (call) => emit(project.id, 'tool:start', { id: call.id, name: call.name, step: steps }),
      }, project.id)
    } catch (err) {
      emit(project.id, 'turn:error', { message: err.message, hint: err.hint })
      persisted.push({ role: 'assistant', content: [{ type: 'text', text: `_(error: ${err.message})_` }] })
      await appendHistory(project.id, persisted)
      throw err
    }

    totalInput += result.usage?.inputTokens ?? 0
    totalOutput += result.usage?.outputTokens ?? 0
    finalText = result.text || finalText

    if (result.text) {
      messages.push({ role: 'assistant', content: [{ type: 'text', text: result.text }] })
      persisted.push({ role: 'assistant', content: [{ type: 'text', text: result.text }] })
      emit(project.id, 'assistant:text', { text: result.text, step: steps })
    }

    if (mode !== 'agent' || !result.toolCalls?.length) {
      // In plan mode, or when the model produced no tool calls, the turn is over.
      break
    }

    // Assistant turn must carry the tool_use blocks so results can attach.
    if (result.text) messages.pop()
    messages.push({
      role: 'assistant',
      content: [
        ...(result.text ? [{ type: 'text', text: result.text }] : []),
        ...result.toolCalls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args })),
      ],
    })

    const toolResults = []
    for (const call of result.toolCalls) {
      if (signal?.aborted) break

      if (call.args?.__parseError) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: 'ERROR: tool arguments were not valid JSON. Retry with well-formed arguments.',
          is_error: true,
        })
        emit(project.id, 'tool:end', { id: call.id, name: call.name, ok: false, result: 'invalid JSON arguments' })
        continue
      }

      emit(project.id, 'tool:args', { id: call.id, name: call.name, args: redactArgs(call.name, call.args) })

      const output = await executeTool(call.name, call.args, {
        root: project.path,
        onLog: (text) => emit(project.id, 'tool:log', { id: call.id, name: call.name, text }),
      })

      const ok = !output.startsWith('ERROR:') && !output.startsWith('Refused:')
      if (isMutating(call.name) && ok) changedFiles.add(call.args?.path || call.name)
      if (call.name === 'run_command' && /npm\s+(install|i|add)\b/.test(call.args?.command || '')) {
        emit(project.id, 'deps:changed', {})
      }

      toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: output, is_error: !ok })
      emit(project.id, 'tool:end', {
        id: call.id,
        name: call.name,
        ok,
        result: output.length > 1200 ? `${output.slice(0, 1200)}\n… truncated` : output,
      })
    }

    messages.push({ role: 'user', content: toolResults })

    // Self-healing: if the dev server broke because of these edits, hand the
    // error straight back instead of waiting for the user to notice.
    const devServer = manager.peek(project.id)
    if (devServer?.status === 'error' && devServer.lastError && !buildErrorReported) {
      buildErrorReported = true
      messages.push({
        role: 'user',
        content: [{
          type: 'text',
          text: `The dev server reported a build error after your changes:\n\n${devServer.lastError.slice(0, 3000)}\n\nFix it now.`,
        }],
      })
      emit(project.id, 'agent:selfheal', { error: devServer.lastError.slice(0, 500) })
    }

    // package.json edits need an install before the next import resolves.
    if ([...changedFiles].some((f) => f.endsWith('package.json')) && settings.agent?.autoInstall !== false) {
      const installOut = await executeTool('run_command', { command: 'npm install --no-audit --no-fund' }, { root: project.path })
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: `package.json changed, so dependencies were installed automatically.\n\n${installOut.slice(-1500)}` }],
      })
      changedFiles.clear()
      emit(project.id, 'deps:changed', {})
    }
  }

  if (steps >= maxSteps) {
    emit(project.id, 'turn:maxsteps', { maxSteps })
  }

  const usage = { inputTokens: totalInput, outputTokens: totalOutput }
  if (mode === 'agent') await addProjectUsage(project.id, usage)

  let commit = null
  const reviewMode = settings.agent?.reviewCommit === true
  if (mode === 'agent' && reviewMode) {
    // Hold the changes for a human decision instead of committing blindly.
    const pending = await gitStatusShort(project.path)
    if (pending.length) {
      emit(project.id, 'review:pending', { files: pending.map((p) => p.file) })
    }
  } else if (mode === 'agent' && settings.agent?.autoCommit !== false) {
    try {
      const pending = await gitStatusShort(project.path)
      if (pending.length) {
        const message = commitMessage(userMessage, pending)
        commit = await gitCommitAll(project.path, message)
        emit(project.id, 'git:commit', { ...commit, files: pending.length })
      }
    } catch (err) {
      emit(project.id, 'git:error', { message: err.message })
    }
  }

  await appendHistory(project.id, persisted)
  await touchProject(project.id)
  emit(project.id, 'turn:end', {
    steps,
    usage,
    commit,
  })

  return { text: finalText, steps, usage, commit }
}

function isMutating(name) {
  return name === 'write_file' || name === 'edit_file' || name === 'delete_file'
}

/** Tool arguments can contain whole files; keep the event stream small. */
function redactArgs(name, args = {}) {
  const out = { ...args }
  for (const key of ['content', 'old_string', 'new_string']) {
    if (typeof out[key] === 'string' && out[key].length > 400) {
      out[key] = `${out[key].slice(0, 400)}… (${out[key].length} chars)`
    }
  }
  return out
}

function commitMessage(userMessage, changed) {
  const subject = String(userMessage || 'Update').replace(/\s+/g, ' ').trim().slice(0, 72)
  const files = changed.map((c) => c.file).slice(0, 8)
  return `${subject || 'Update project'}\n\n${files.join('\n')}${changed.length > 8 ? `\n… +${changed.length - 8} more` : ''}`
}

export { systemPrompt }
