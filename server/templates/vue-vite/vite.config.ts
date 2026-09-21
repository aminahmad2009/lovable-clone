import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const port = Number(process.env.PORT) || 5180

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port,
    strictPort: false,
    allowedHosts: true,
    cors: true,
    hmr: { host: '127.0.0.1', protocol: 'ws' },
  },
  preview: {
    host: '127.0.0.1',
    port,
    allowedHosts: true,
  },
})
