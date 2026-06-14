import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['endtest/**/*.spec.ts'],
    root: fileURLToPath(new URL('..', import.meta.url)),
  },
  resolve: {
    alias: [
      {
        find: '@',
        replacement: fileURLToPath(new URL('../packages/web/src', import.meta.url)),
      },
      {
        find: '@garlic-claw/shared',
        replacement: fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)),
      },
      {
        find: /^@garlic-claw\/shared\/(.*)$/,
        replacement: fileURLToPath(new URL('../packages/shared/src/$1', import.meta.url)),
      },
      {
        find: /^@garlic-claw\/plugin-sdk$/,
        replacement: fileURLToPath(new URL('../packages/plugin-sdk/src/index.ts', import.meta.url)),
      },
      {
        find: /^@garlic-claw\/plugin-sdk\/(.*)$/,
        replacement: fileURLToPath(new URL('../packages/plugin-sdk/src/$1', import.meta.url)),
      },
    ],
  },
})
