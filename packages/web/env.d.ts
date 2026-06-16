/// <reference types="vite/client" />

interface ImportMetaEnv {
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare const __GARLIC_CLAW_DEV_LOGIN_SECRET__: string

declare module 'markdown-it-footnote' {
  import type { PluginSimple } from 'markdown-it'

  const markdownItFootnote: PluginSimple
  export default markdownItFootnote
}

declare module 'markdown-it-task-lists' {
  import type { PluginWithOptions } from 'markdown-it'

  interface MarkdownItTaskListOptions {
    enabled?: boolean
    label?: boolean
    labelAfter?: boolean
  }

  const markdownItTaskLists: PluginWithOptions<MarkdownItTaskListOptions>
  export default markdownItTaskLists
}
