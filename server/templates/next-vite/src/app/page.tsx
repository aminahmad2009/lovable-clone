export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-24">
      <div className="z-10 max-w-5xl w-full items-center font-mono text-sm md:flex md:justify-center md:gap-5">
        <p className="fixed left-0 top-0 flex w-full justify-center border-b border-neutral-300 bg-gradient-to-b from-white via-white to-neutral-100 pb-6 pt-8 backdrop-blur-2xl dark:border-neutral-600 dark:bg-gradient-to-b from-gray-900 via-gray-900 to-neutral-800 dark:pb-8 dark:pt-12">
          Built with <a href="https://lovable-local.codewoxy.com" className="text-blue-600 hover:underline dark:text-blue-400" target="_blank" rel="noopener noreferrer">
            Lovable Local
          </a>
        </p>
      </div>

      <div className="mb-32 grid text-center max-w-5xl w-full gap-y-10 gap-x-6 md:mb-0 md:grid-cols-3 md:text-left">
        <div className="group rounded-lg border border-transparent px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-100 hover:dark:border-neutral-700 hover:dark:bg-neutral-800">
          <h2 className="mb-3 text-2xl font-semibold">
            Next.js + Tailwind + TypeScript
            <span className="inline-block transition-transform group-hover:translate-x-1 motion-reduce:transition-none">
              {' '}→
            </span>
          </h2>
          <p className="m-0 max-w-[30ch] text-sm opacity-50">
            This is a Next.js 14+ project with App Router, TypeScript, and Tailwind CSS configured.
            The agent can edit files and run commands to build your application.
          </p>
        </div>

        <div className="group rounded-lg border border-transparent px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-100 hover:dark:border-neutral-700 hover:dark:bg-neutral-800">
          <h2 className="mb-3 text-2xl font-semibold">
            Edit & Preview
            <span className="inline-block transition-transform group-hover:translate-x-1 motion-reduce:transition-none">
              {' '}→
            </span>
          </h2>
          <p className="m-0 max-w-[30ch] text-sm opacity-50">
            Use the chat panel to describe what you want to build. The agent will create and edit
            files, and the preview will update automatically with hot reload.
          </p>
        </div>

        <div className="group rounded-lg border border-transparent px-5 py-4 transition-colors hover:border-gray-300 hover:bg-gray-100 hover:dark:border-neutral-700 hover:dark:bg-neutral-800">
          <h2 className="mb-3 text-2xl font-semibold">
            Deploy Anywhere
            <span className="inline-block transition-transform group-hover:translate-x-1 motion-reduce:transition-none">
              {' '}→
            </span>
          </h2>
          <p className="m-0 max-w-[30ch] text-sm opacity-50">
            When ready, run <code>npm run build</code> and deploy to Vercel, Netlify, or any
            platform that supports Next.js.
          </p>
        </div>
      </div>
    </main>
  )
}