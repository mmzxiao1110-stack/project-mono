import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// One version for everything: package.json's, shown beside every title.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const page = (name) => resolve(import.meta.dirname, `${name}.html`)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: {
    rollupOptions: {
      // The game, T-Terminal, and the site's pages: one build, one theme.
      input: {
        main: page('index'), terminal: page('terminal'),
        about: page('about'), news: page('news'), download: page('download'), help: page('help'),
      },
    },
  },
  server: {
    watch: {
      ignored: ['**/server/**'],
    },
  },
})