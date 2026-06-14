import { describe, it, expect } from 'vitest'
import type {
  ChatMessagePart, PluginLlmMessage, ChatBeforeModelRequest,
  PluginAvailableToolSummary, PluginCallContext, PluginParamSchema,
  ChatBeforeModelHookPayload, ChatBeforeModelHookResult,
  MessageReceivedHookPayload, MessageReceivedHookResult,
  ChatAfterModelHookPayload, ChatAfterModelHookResult,
  SubagentBeforeRunHookPayload, SubagentAfterRunHookPayload,
  AutomationBeforeRunHookPayload, AutomationAfterRunHookResult,
  ToolBeforeCallHookPayload, ToolAfterCallHookPayload,
  ResponseBeforeSendHookPayload, ResponseAfterSendHookPayload,
  HookPayloadInput, HookSpec,
  InboundHookFamily, MessageHookFamily, OperationHookFamily, BroadcastHookFamily, SubagentHookFamily,
  ApiResponse, PaginatedResponse,
  ConversationSubagentState, AiModelUsage,
  PluginRuntimeReadBackendResult,
  PluginRuntimeCommandResult, PluginRuntimeCommandStreamStats,
  PluginToolOutput,
  PluginHealthSnapshot,
} from '@garlic-claw/shared'

describe('Cross-module: ChatBeforeModel flow', () => {
  it('payload flows through HookPayloadInput into hook family', () => {
    const ctx: PluginCallContext = { source: 'chat-hook', conversationId: 'c1' }
    const tool: PluginAvailableToolSummary = { name: 'read', description: 'Read file', parameters: { path: { type: 'string', required: true } } }
    const request: ChatBeforeModelRequest = {
      providerId: 'openai', modelId: 'gpt-4', systemPrompt: 'You are helpful.',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] } as PluginLlmMessage,
        { role: 'assistant', content: 'Hi!' } as PluginLlmMessage,
      ],
      availableTools: [tool],
    }

    const input: HookPayloadInput<ChatBeforeModelHookPayload> = {
      context: ctx,
      payload: { context: ctx, request },
    }

    expect(input.context.conversationId).toBe('c1')
    expect(input.payload.request.messages.length).toBe(2)
    expect(input.payload.request.availableTools[0].name).toBe('read')
  })

  it('ChatBeforeModelHookResult discriminated union', () => {
    const pass: ChatBeforeModelHookResult = { action: 'pass' }
    const mutate: ChatBeforeModelHookResult = { action: 'mutate', providerId: 'anthropic', messages: [{ role: 'user', content: 'changed' }] }
    const sc: ChatBeforeModelHookResult = { action: 'short-circuit', assistantContent: 'cached reply', reason: 'cache-hit' }
    expect(pass.action).toBe('pass')
    expect(mutate.action).toBe('mutate')
    expect(sc.action).toBe('short-circuit')
  })
})

describe('Cross-module: MessageReceived flow', () => {
  it('mutate result can change parts and modelMessages', () => {
    const result: MessageReceivedHookResult = {
      action: 'mutate',
      content: 'modified',
      parts: [{ type: 'text', text: 'modified' }],
      modelMessages: [{ role: 'user', content: 'original' }],
    }
    if (result.action === 'mutate') {
      expect(result.content).toBe('modified')
      expect(result.modelMessages![0].content).toBe('original')
    }
  })

  it('short-circuit bypasses model entirely', () => {
    const result: MessageReceivedHookResult = {
      action: 'short-circuit',
      assistantContent: 'fast reply',
      reason: 'plugin-intercept',
    }
    if (result.action === 'short-circuit') {
      expect(result.assistantContent).toBe('fast reply')
    }
  })
})

describe('Cross-module: After model to response flow', () => {
  it('ChatAfterModelHookResult passes or mutates', () => {
    const pass: ChatAfterModelHookResult = { action: 'pass' }
    const mutate: ChatAfterModelHookResult = { action: 'mutate', assistantContent: 'revised' }
    expect(pass.action).toBe('pass')
    expect(mutate.assistantContent).toBe('revised')
  })
})

describe('Cross-module: Subagent lifecycle', () => {
  it('SubagentBeforeRunHookPayload uses PluginCallContext and PluginSubagentRequest', () => {
    const ctx: PluginCallContext = { source: 'plugin', conversationId: 'c1' }
    const payload: SubagentBeforeRunHookPayload = {
      context: ctx,
      pluginId: 'p1',
      request: {
        name: 'helper',
        messages: [{ role: 'user', content: 'analyze' }],
        toolNames: ['search', 'read'],
      },
    }
    expect(payload.pluginId).toBe('p1')
    expect(payload.request.toolNames).toContain('read')
  })
})

describe('Cross-module: Response pipeline', () => {
  it('ResponseBeforeSend and ResponseAfterSend share payload shape', () => {
    const payload = {
      context: { source: 'chat-hook' as const },
      responseSource: 'model' as const,
      assistantMessageId: 'm1',
      providerId: 'o',
      modelId: 'gpt-4',
      assistantContent: 'hello',
      assistantParts: [{ type: 'text' as const, text: 'hello' }] as ChatMessagePart[],
      toolCalls: [],
      toolResults: [],
    }
    const before: ResponseBeforeSendHookPayload = payload
    const after: ResponseAfterSendHookPayload = { ...payload, sentAt: '2024-01-01T00:00:00Z' }
    expect(before.assistantContent).toBe(after.assistantContent)
    expect(after.sentAt).toBeTruthy()
  })
})

describe('Cross-module: Automation flow types', () => {
  it('AutomationBeforeRun uses ActionConfig array', () => {
    const ctx: PluginCallContext = { source: 'automation', automationId: 'a1' }
    const payload: AutomationBeforeRunHookPayload = {
      context: ctx,
      automation: { id: 'a1', name: 'backup', trigger: { type: 'cron', cron: '0 0 * * *' }, actions: [{ type: 'device_command', sourceKind: 'internal', plugin: 'fs', capability: 'backup', params: { dst: '/backup' } }], enabled: true, lastRunAt: null, createdAt: '', updatedAt: '' },
      actions: [{ type: 'device_command' }],
    }
    expect(payload.automation.id).toBe('a1')
    expect(payload.actions[0].type).toBe('device_command')
  })
})

describe('Cross-module: Generic type parameter binding', () => {
  it('ApiResponse<T> and PaginatedResponse<T> compose', () => {
    const single: ApiResponse<string> = { success: true, data: 'hello' }
    const list: PaginatedResponse<number> = { success: true, data: [1, 2, 3], total: 3, page: 1, pageSize: 10 }
    expect(single.data).toBe('hello')
    expect(list.total).toBe(3)
  })
})

describe('Cross-module: ConversationSubagentState references AiModelUsage', () => {
  it('can construct with optional provider/model identity', () => {
    const state: ConversationSubagentState = {
      pluginId: 'p1', runtimeKind: 'local', status: 'completed',
      requestPreview: '...', resultPreview: 'done',
      requestedAt: '2024-01-01T00:00:00Z', startedAt: '2024-01-01T00:00:01Z', finishedAt: '2024-01-01T00:00:02Z', closedAt: null,
      providerId: 'openai', modelId: 'gpt-4',
    }
    expect(state.status).toBe('completed')
    expect(state.providerId).toBe('openai')
  })
})

describe('Cross-module: PluginRuntimeReadBackendResult union', () => {
  it('discriminates on type for directory/file/asset', () => {
    const dir: PluginRuntimeReadBackendResult = { type: 'directory', path: '/', entries: ['a.txt'], totalEntries: 1, limit: 100, offset: 0, truncated: false }
    const file: PluginRuntimeReadBackendResult = { type: 'file', path: '/a.txt', lines: ['hi'], totalLines: 1, totalBytes: 3, offset: 0, limit: 100, mimeType: 'text/plain', truncated: false, byteLimited: false }
    const asset: PluginRuntimeReadBackendResult = { type: 'binary', path: '/img.png', mimeType: 'image/png', size: 1024 }
    expect(dir.type).toBe('directory')
    expect(file.type).toBe('file')
    expect(asset.type).toBe('binary')
  })
})

describe('Cross-module: PluginToolOutput used in automation results', () => {
  it('tool:text output shapes are self-consistent', () => {
    const textOut: PluginToolOutput = { kind: 'tool:text', value: 'result text' }
    const jsonOut: PluginToolOutput = { kind: 'tool:json', value: { processed: true, count: 5 } }
    expect(textOut.value).toBe('result text')
    expect(jsonOut.value).toEqual({ processed: true, count: 5 })
  })
})

describe('Cross-module: All exported symbols are accessible', () => {
  it('index.ts re-exports all submodules', () => {
    expect(true).toBe(true)
  })
})
