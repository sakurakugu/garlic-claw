import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import postcssCustomMedia from 'postcss-custom-media'
import { defineConfig, loadEnv } from 'vite'

const webSourceRoot = fileURLToPath(new URL('./src', import.meta.url))
const sharedSourceRoot = fileURLToPath(new URL('../shared/src', import.meta.url))
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, workspaceRoot, '')
  const devLoginSecret = command === 'serve'
    ? env.GARLIC_CLAW_LOGIN_SECRET?.trim() || ''
    : ''

  return {
    plugins: [vue()],
    envDir: workspaceRoot,
    define: {
      __GARLIC_CLAW_DEV_LOGIN_SECRET__: JSON.stringify(devLoginSecret),
    },
    css: {
      postcss: {
        plugins: [postcssCustomMedia()],
      },
    },
    resolve: {
      alias: [
        {
          find: '@',
          replacement: webSourceRoot,
        },
        {
          find: '@garlic-claw/shared',
          replacement: fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
        },
        {
          find: /^@garlic-claw\/shared\/(.*)$/,
          replacement: `${sharedSourceRoot}/$1`,
        },
      ],
    },
    test: {
      environment: 'jsdom',
      include: ['tests/**/*.spec.ts'],
    },
    server: {
      port: 23333,
      proxy: {
        '^/api/': {
          target: 'http://localhost:23330',
          changeOrigin: true,
        },
      },
    },
  }
})
