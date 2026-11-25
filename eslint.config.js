import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'server/node_modules']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // The game server runs on Node, not in a browser.
    files: ['server/**/*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // The Cloudflare Worker: browser-style globals plus WebSocketPair.
    files: ['cloudflare/**/*.js'],
    languageOptions: { globals: { ...globals.serviceworker, WebSocketPair: 'readonly' } },
  },
])
