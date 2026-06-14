import { describe, it, expect } from 'vitest'
import type {
  HookPayloadInput, HookSpec,
  InboundHookFamily, MessageHookFamily, OperationHookFamily,
  BroadcastHookFamily, LifecycleBroadcastHookFamily, AllBroadcastHookFamily, SubagentHookFamily,
  HookFamilyInput, HookChainInput, HookChainRunnerMap,
} from '@garlic-claw/shared'
import type {
  ChatBeforeModelHookPayload, MessageReceivedHookPayload,
  ChatAfterModelHookPayload, MessageCreatedHookPayload, MessageUpdatedHookPayload,
  AutomationBeforeRunHookPayload, AutomationAfterRunHookPayload,
  ToolBeforeCallHookPayload, ToolAfterCallHookPayload,
  ResponseBeforeSendHookPayload, ResponseAfterSendHookPayload,
  ChatWaitingModelHookPayload, ConversationCreatedHookPayload,
  MessageDeletedHookPayload,
  PluginLoadedHookPayload, PluginUnloadedHookPayload, PluginErrorHookPayload,
  SubagentBeforeRunHookPayload, SubagentAfterRunHookPayload,
  PluginSubagentExecutionResult,
  PluginCallContext,
} from '@garlic-claw/shared'

describe('Hook payload input', () => {
  it('HookPayloadInput wraps context and payload', () => {
    const ctx: PluginCallContext = { source: 'chat-hook' }
    const input: HookPayloadInput<ChatBeforeModelHookPayload> = {
      context: ctx,
      payload: {
        context: ctx,
        request: {
          providerId: 'o', modelId: 'gpt-4', systemPrompt: 'You are...',
          messages: [{ role: 'user', content: 'hi' }],
          availableTools: [],
        },
      },
    }
    expect(input.context.source).toBe('chat-hook')
    expect(input.payload.request.providerId).toBe('o')
  })
})

describe('HookSpec', () => {
  it('HookSpec is a tuple of [payload, result]', () => {
    const spec: HookSpec<string, number> = ['hello', 42]
    expect(spec[0]).toBe('hello')
    expect(spec[1]).toBe(42)
  })
})

describe('InboundHookFamily', () => {
  it('has chat:before-model and message:received hooks', () => {
    const ctx: PluginCallContext = { source: 'chat-hook' }
    const chatInput: InboundHookFamily<{ modified: boolean }, { received: boolean }>['chat:before-model'] = [
      { context: ctx, request: { providerId: 'o', modelId: 'gpt-4', systemPrompt: '', messages: [], availableTools: [] } },
      { modified: true },
    ]
    const msgInput: InboundHookFamily<{ modified: boolean }, { received: boolean }>['message:received'] = [
      { context: ctx, conversationId: 'c1', providerId: 'o', modelId: 'gpt-4', message: { role: 'user', content: 'hi', parts: [] }, modelMessages: [] },
      { received: false },
    ]
    expect(chatInput[1].modified).toBe(true)
    expect(msgInput[1].received).toBe(false)
  })
})

describe('MessageHookFamily', () => {
  it('result type equals payload type for lifecycle hooks', () => {
    const ctx: PluginCallContext = { source: 'chat-hook' }
    const after: MessageHookFamily['chat:after-model'] = [
      { providerId: 'o', modelId: 'gpt-4', assistantMessageId: 'm1', assistantContent: 'hi', assistantParts: [{ type: 'text', text: 'hi' }], toolCalls: [], toolResults: [] },
      { providerId: 'o', modelId: 'gpt-4', assistantMessageId: 'm1', assistantContent: 'hi', assistantParts: [{ type: 'text', text: 'hi' }], toolCalls: [], toolResults: [] },
    ]
    expect(after[0].assistantContent).toBe(after[1].assistantContent)
  })
})

describe('OperationHookFamily', () => {
  it('all operation hooks have correct payload/result types', () => {
    const ctx: PluginCallContext = { source: 'automation' }
    const before: OperationHookFamily<{ modified: boolean }, { skipped: boolean }>['automation:before-run'] = [
      { context: ctx, automation: { id: 'a1', name: 'test', trigger: { type: 'manual' }, actions: [], enabled: true, lastRunAt: null, createdAt: '', updatedAt: '' }, actions: [] },
      { modified: false },
    ]
    const tool: OperationHookFamily<{ modified: boolean }, { skipped: boolean }>['tool:before-call'] = [
      { context: ctx, source: { kind: 'plugin', id: 'p1', label: 'P' }, tool: { name: 'read', description: '', parameters: {} }, params: {} },
      { skipped: false },
    ]
    expect(before[0].automation.name).toBe('test')
    expect(tool[1].skipped).toBe(false)
  })
})

describe('BroadcastHookFamily', () => {
  it('broadcast hooks return void', () => {
    const ctx: PluginCallContext = { source: 'chat-hook' }
    const waiting: BroadcastHookFamily['chat:waiting-model'] = [
      { context: ctx, conversationId: 'c1', assistantMessageId: 'm1', providerId: 'o', modelId: 'gpt-4', request: { providerId: 'o', modelId: 'gpt-4', systemPrompt: '', messages: [], availableTools: [] } },
      undefined,
    ]
    const created: BroadcastHookFamily['conversation:created'] = [
      { context: ctx, conversation: { id: 'c1', title: 'test', createdAt: '', updatedAt: '' } },
      undefined,
    ]
    expect(waiting[1]).toBeUndefined()
    expect(created[0].conversation.title).toBe('test')
  })
})

describe('LifecycleBroadcastHookFamily', () => {
  it('plugin lifecycle hooks exist and return void', () => {
    const ctx: PluginCallContext = { source: 'plugin' }
    const loaded: LifecycleBroadcastHookFamily['plugin:loaded'] = [
      { context: ctx, plugin: { id: 'p1', runtimeKind: 'local', remote: null, manifest: null }, loadedAt: '' },
      undefined,
    ]
    const unloaded: LifecycleBroadcastHookFamily['plugin:unloaded'] = [
      { context: ctx, plugin: { id: 'p1', runtimeKind: 'local', remote: null, manifest: null }, unloadedAt: '' },
      undefined,
    ]
    expect(loaded[1]).toBeUndefined()
    expect(unloaded[0].plugin.id).toBe('p1')
  })
})

describe('AllBroadcastHookFamily', () => {
  it('is the intersection of Broadcast and LifecycleBroadcast families', () => {
    const ctx: PluginCallContext = { source: 'chat-hook' }
    const del: AllBroadcastHookFamily['message:deleted'] = [
      { context: ctx, conversationId: 'c1', messageId: 'm1', message: { role: 'user', content: 'bye', parts: [] } },
      undefined,
    ]
    const err: AllBroadcastHookFamily['plugin:error'] = [
      { context: ctx, plugin: { id: 'p1', runtimeKind: 'local', remote: null, manifest: null }, error: { type: 'err', message: 'fail', metadata: null }, occurredAt: '' },
      undefined,
    ]
    expect(del[0].messageId).toBe('m1')
    expect(err[0].error.message).toBe('fail')
  })
})

describe('SubagentHookFamily', () => {
  it('before-run result is a discriminated union', () => {
    const ctx: PluginCallContext = { source: 'plugin' }
    const before: SubagentHookFamily['subagent:before-run'] = [
      { context: ctx, pluginId: 'p1', request: { messages: [{ role: 'user', content: 'do it' }] } },
      { action: 'continue', payload: { context: ctx, pluginId: 'p1', request: { messages: [{ role: 'user', content: 'do it' }] } } },
    ]
    expect(before[1].action).toBe('continue')
  })

  it('after-run result passes payload through', () => {
    const ctx: PluginCallContext = { source: 'plugin' }
    const result: PluginSubagentExecutionResult = { providerId: 'o', modelId: 'gpt-4', text: 'done', message: { role: 'assistant', content: 'done' }, toolCalls: [], toolResults: [] }
    const after: SubagentHookFamily['subagent:after-run'] = [
      { context: ctx, pluginId: 'p1', request: { messages: [] }, result },
      { context: ctx, pluginId: 'p1', request: { messages: [] }, result },
    ]
    expect(after[1].result.text).toBe('done')
  })
})

describe('HookFamilyInput', () => {
  it('is a generic type deriving from a family', () => {
    const input: HookFamilyInput<InboundHookFamily<number, string>, 'chat:before-model'> = {
      hookName: 'chat:before-model',
      context: { source: 'chat-hook' },
      payload: { context: { source: 'chat-hook' }, request: { providerId: 'o', modelId: 'gpt-4', systemPrompt: '', messages: [], availableTools: [] } },
    }
    expect(input.hookName).toBe('chat:before-model')
  })
})

describe('HookChainInput', () => {
  it('carries records, context, payload, and invokeHook', () => {
    type Invoke = (record: string) => Promise<string>
    const input: HookChainInput<string, Invoke> = {
      records: ['a', 'b'],
      context: { source: 'chat-hook' },
      payload: 'data',
      invokeHook: async (r: string) => r,
    }
    expect(input.context.source).toBe('chat-hook')
    expect(input.payload).toBe('data')
  })
})

describe('HookChainRunnerMap', () => {
  it('maps each hook name to a runner function', () => {
    type MyFamily = { 'test:hook': HookSpec<string, number> }
    type Invoke = (record: string) => Promise<string>
    const runners: HookChainRunnerMap<MyFamily, Invoke, string> = {
      'test:hook': async (input) => {
        return input.payload.length
      },
    }
    expect(typeof runners['test:hook']).toBe('function')
  })
})
