export default function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-10 text-center">
      <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs tracking-wide text-white/60">
        {{PROJECT_NAME}}
      </span>
      <h1 className="text-4xl font-semibold tracking-tight">Ready to build</h1>
      <p className="max-w-md text-sm leading-relaxed text-white/50">
        Describe what you want in the chat. This starter is React, TypeScript, Vite and Tailwind —
        the agent edits these files directly and the preview updates live.
      </p>
    </main>
  )
}
