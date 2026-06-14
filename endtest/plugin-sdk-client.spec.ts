import { describe, it, expect } from 'vitest'
import { CHAT_MESSAGE_STATUS_VALUES, REMOTE_ENVIRONMENT, PLUGIN_HOOK_NAME_VALUES, PLUGIN_INVOCATION_SOURCE_VALUES, PLUGIN_ROUTE_METHOD_VALUES, WS_TYPE, WS_ACTION } from '@garlic-claw/plugin-sdk/client/plugin-client.constants'
import { isChatMessagePartArray, isPluginLlmMessageArray, readHookInvokePayload, readExecutePayload, readHostResultPayload, readRouteInvokePayload, readMessageReceivedHookPayload, cloneJsonValue } from '@garlic-claw/plugin-sdk/client/plugin-client-payload.helpers'
import { normalizeMessageListenerResult, normalizeRawMessageHookResult, applyMessageReceivedMutation, buildMessageReceivedMutationResult } from '@garlic-claw/plugin-sdk/client/plugin-client-message.helpers'
import type { MessageReceivedHookPayload, MessageReceivedHookResult, JsonValue } from '@garlic-claw/shared'

describe('client/plugin-client.constants', () => {
  describe('CHAT_MESSAGE_STATUS_VALUES', () => {
    it('contains all status values', () => {
      expect(CHAT_MESSAGE_STATUS_VALUES).toContain('pending')
      expect(CHAT_MESSAGE_STATUS_VALUES).toContain('streaming')
      expect(CHAT_MESSAGE_STATUS_VALUES).toContain('completed')
      expect(CHAT_MESSAGE_STATUS_VALUES).toContain('stopped')
      expect(CHAT_MESSAGE_STATUS_VALUES).toContain('error')
    })

    it('has 5 values', () => expect(CHAT_MESSAGE_STATUS_VALUES).toHaveLength(5))
  })

  describe('REMOTE_ENVIRONMENT', () => {
    it('has API and IOT', () => {
      expect(REMOTE_ENVIRONMENT.API).toBe('api')
      expect(REMOTE_ENVIRONMENT.IOT).toBe('iot')
    })
  })

  describe('PLUGIN_HOOK_NAME_VALUES', () => {
    it('contains message:received', () => expect(PLUGIN_HOOK_NAME_VALUES).toContain('message:received'))
    it('contains lifecycle hooks', () => {
      expect(PLUGIN_HOOK_NAME_VALUES).toContain('plugin:loaded')
      expect(PLUGIN_HOOK_NAME_VALUES).toContain('plugin:unloaded')
      expect(PLUGIN_HOOK_NAME_VALUES).toContain('plugin:error')
    })
    it('contains cron tick', () => expect(PLUGIN_HOOK_NAME_VALUES).toContain('cron:tick'))
    it('has 21 hooks', () => expect(PLUGIN_HOOK_NAME_VALUES).toHaveLength(21))
  })

  describe('PLUGIN_INVOCATION_SOURCE_VALUES', () => {
    it('contains all sources', () => {
      expect(PLUGIN_INVOCATION_SOURCE_VALUES).toContain('chat-tool')
      expect(PLUGIN_INVOCATION_SOURCE_VALUES).toContain('chat-hook')
      expect(PLUGIN_INVOCATION_SOURCE_VALUES).toContain('cron')
      expect(PLUGIN_INVOCATION_SOURCE_VALUES).toContain('automation')
      expect(PLUGIN_INVOCATION_SOURCE_VALUES).toContain('http-route')
      expect(PLUGIN_INVOCATION_SOURCE_VALUES).toContain('subagent')
      expect(PLUGIN_INVOCATION_SOURCE_VALUES).toContain('plugin')
    })
    it('has 7 sources', () => expect(PLUGIN_INVOCATION_SOURCE_VALUES).toHaveLength(7))
  })

  describe('PLUGIN_ROUTE_METHOD_VALUES', () => {
    it('contains all HTTP methods', () => {
      expect(PLUGIN_ROUTE_METHOD_VALUES).toContain('GET')
      expect(PLUGIN_ROUTE_METHOD_VALUES).toContain('POST')
      expect(PLUGIN_ROUTE_METHOD_VALUES).toContain('PUT')
      expect(PLUGIN_ROUTE_METHOD_VALUES).toContain('PATCH')
      expect(PLUGIN_ROUTE_METHOD_VALUES).toContain('DELETE')
    })
    it('has 5 methods', () => expect(PLUGIN_ROUTE_METHOD_VALUES).toHaveLength(5))
  })

  describe('WS_TYPE', () => {
    it('has all websocket types', () => {
      expect(WS_TYPE.AUTH).toBe('auth')
      expect(WS_TYPE.PLUGIN).toBe('plugin')
      expect(WS_TYPE.COMMAND).toBe('command')
      expect(WS_TYPE.HEARTBEAT).toBe('heartbeat')
      expect(WS_TYPE.ERROR).toBe('error')
    })
  })

  describe('WS_ACTION', () => {
    it('has auth actions', () => {
      expect(WS_ACTION.AUTHENTICATE).toBe('authenticate')
      expect(WS_ACTION.AUTH_OK).toBe('auth_ok')
      expect(WS_ACTION.AUTH_FAIL).toBe('auth_fail')
    })
    it('has register actions', () => {
      expect(WS_ACTION.REGISTER).toBe('register')
      expect(WS_ACTION.REGISTER_OK).toBe('register_ok')
    })
    it('has execute actions', () => {
      expect(WS_ACTION.EXECUTE).toBe('execute')
      expect(WS_ACTION.EXECUTE_RESULT).toBe('execute_result')
      expect(WS_ACTION.EXECUTE_ERROR).toBe('execute_error')
    })
    it('has hook actions', () => {
      expect(WS_ACTION.HOOK_INVOKE).toBe('hook_invoke')
      expect(WS_ACTION.HOOK_RESULT).toBe('hook_result')
      expect(WS_ACTION.HOOK_ERROR).toBe('hook_error')
    })
    it('has route actions', () => {
      expect(WS_ACTION.ROUTE_INVOKE).toBe('route_invoke')
      expect(WS_ACTION.ROUTE_RESULT).toBe('route_result')
      expect(WS_ACTION.ROUTE_ERROR).toBe('route_error')
    })
    it('has host actions', () => {
      expect(WS_ACTION.HOST_CALL).toBe('host_call')
      expect(WS_ACTION.HOST_RESULT).toBe('host_result')
      expect(WS_ACTION.HOST_ERROR).toBe('host_error')
    })
    it('has heartbeat actions', () => {
      expect(WS_ACTION.PING).toBe('ping')
      expect(WS_ACTION.PONG).toBe('pong')
    })
  })
})

describe('client/plugin-client-payload.helpers', () => {
  describe('cloneJsonValue', () => {
    it('deep clones', () => {
      const obj = { a: { b: [1, 2] } }
      const cloned = cloneJsonValue(obj)
      expect(cloned).toEqual(obj)
      expect(cloned).not.toBe(obj)
    })
  })

  describe('isChatMessagePartArray', () => {
    it('accepts valid text parts', () => {
      expect(isChatMessagePartArray([{ type: 'text', text: 'hello' }])).toBe(true)
    })

    it('accepts valid image parts', () => {
      expect(isChatMessagePartArray([{ type: 'image', image: 'data:image/png;base64,...' }])).toBe(true)
    })

    it('rejects non-array', () => expect(isChatMessagePartArray('str')).toBe(false))
    it('rejects array with invalid types', () => expect(isChatMessagePartArray([{ type: 'unknown' }])).toBe(false))
  })

  describe('isPluginLlmMessageArray', () => {
    it('accepts valid LLM message array', () => {
      const messages = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }]
      expect(isPluginLlmMessageArray(messages)).toBe(true)
    })

    it('rejects invalid roles', () => {
      expect(isPluginLlmMessageArray([{ role: 'invalid', content: 'test' }])).toBe(false)
    })
  })

  describe('readHookInvokePayload', () => {
    it('parses valid hook invoke payload', () => {
      const payload = { hookName: 'message:received', context: { source: 'plugin' }, payload: { text: 'hi' } }
      const result = readHookInvokePayload(payload)
      expect(result.hookName).toBe('message:received')
      expect(result.context.source).toBe('plugin')
    })

    it('throws on invalid hook name', () => {
      expect(() => readHookInvokePayload({ hookName: 'invalid', context: { source: 'plugin' }, payload: {} })).toThrow('hookName')
    })

    it('throws on invalid payload (non-object)', () => {
      expect(() => readHookInvokePayload('str' as never)).toThrow('hook invoke payload')
    })
  })

  describe('readExecutePayload', () => {
    it('parses valid execute payload', () => {
      const result = readExecutePayload({ toolName: 'test', params: { key: 'val' } })
      expect(result.toolName).toBe('test')
      expect(result.params).toEqual({ key: 'val' })
    })

    it('parses with capability fallback', () => {
      const result = readExecutePayload({ capability: 'cap', params: {} })
      expect(result.capability).toBe('cap')
    })
  })

  describe('readHostResultPayload', () => {
    it('parses host result', () => {
      const result = readHostResultPayload({ data: { result: 'ok' } })
      expect(result.data).toEqual({ result: 'ok' })
    })
  })

  describe('readRouteInvokePayload', () => {
    it('parses route invoke', () => {
      const result = readRouteInvokePayload({ request: { path: '/test', method: 'GET', headers: {}, query: {}, body: null }, context: { source: 'plugin' } })
      expect(result.request.path).toBe('/test')
    })
  })

  describe('readMessageReceivedHookPayload', () => {
    it('parses message:received payload', () => {
      const payload = {
        context: { source: 'plugin' },
        conversationId: 'c1',
        providerId: 'p1',
        modelId: 'm1',
        message: { role: 'user', content: 'hello', parts: [] },
        modelMessages: [],
      }
      const result = readMessageReceivedHookPayload(payload)
      expect(result.conversationId).toBe('c1')
      expect(result.message.content).toBe('hello')
    })

    it('parses with session', () => {
      const payload = {
        context: { source: 'plugin' },
        conversationId: 'c1',
        providerId: 'p1',
        modelId: 'm1',
        message: { role: 'user', content: 'hello', parts: [] },
        modelMessages: [],
        session: { pluginId: 'p1', conversationId: 'c1', timeoutMs: 30000, startedAt: '2026-01-01T00:00:00Z', expiresAt: '2026-01-02T00:00:00Z', lastMatchedAt: null, captureHistory: false, historyMessages: [] },
      }
      const result = readMessageReceivedHookPayload(payload)
      expect(result.session).toBeDefined()
      expect(result.session?.pluginId).toBe('p1')
    })
  })
})

describe('client/plugin-client-message.helpers', () => {
  describe('normalizeMessageListenerResult', () => {
    it('normalizes string to short-circuit', () => {
      const result = normalizeMessageListenerResult('hello')
      expect(result?.action).toBe('short-circuit')
      expect((result as Extract<MessageReceivedHookResult, { action: 'short-circuit' }>).assistantContent).toBe('hello')
    })

    it('normalizes { content } to short-circuit', () => {
      const result = normalizeMessageListenerResult({ content: 'reply' })
      expect(result?.action).toBe('short-circuit')
    })

    it('passes through standard hook result', () => {
      const result = normalizeMessageListenerResult({ action: 'pass' })
      expect(result).toEqual({ action: 'pass' })
    })

    it('throws on invalid result', () => {
      expect(() => normalizeMessageListenerResult(123 as never)).toThrow('必须返回 string')
    })

    it('returns null for null/undefined', () => {
      expect(normalizeMessageListenerResult(null)).toBeNull()
      expect(normalizeMessageListenerResult(undefined)).toBeNull()
    })
  })

  describe('normalizeRawMessageHookResult', () => {
    it('normalizes null to pass', () => {
      expect(normalizeRawMessageHookResult(null)).toEqual({ action: 'pass' })
    })

    it('passes through valid results', () => {
      const result = normalizeRawMessageHookResult({ action: 'mutate', content: 'new' })
      expect(result).toEqual({ action: 'mutate', content: 'new' })
    })
  })

  describe('applyMessageReceivedMutation', () => {
    const makePayload = (): MessageReceivedHookPayload => ({
      context: { source: 'plugin' },
      conversationId: 'c1',
      providerId: 'p1',
      modelId: 'm1',
      message: { role: 'user', content: 'original', parts: [] },
      modelMessages: [],
    } as MessageReceivedHookPayload)

    it('mutates providerId', () => {
      const result = applyMessageReceivedMutation(makePayload(), { action: 'mutate', providerId: 'p2' })
      expect(result.providerId).toBe('p2')
    })

    it('mutates modelId', () => {
      const result = applyMessageReceivedMutation(makePayload(), { action: 'mutate', modelId: 'm2' })
      expect(result.modelId).toBe('m2')
    })

    it('mutates content', () => {
      const result = applyMessageReceivedMutation(makePayload(), { action: 'mutate', content: 'modified' })
      expect(result.message.content).toBe('modified')
    })

    it('mutates parts', () => {
      const result = applyMessageReceivedMutation(makePayload(), { action: 'mutate', parts: [{ type: 'text', text: 'new' }] })
      expect(result.message.parts).toHaveLength(1)
    })

    it('mutates modelMessages', () => {
      const result = applyMessageReceivedMutation(makePayload(), { action: 'mutate', modelMessages: [{ role: 'user', content: 'new' }] })
      expect(result.modelMessages).toHaveLength(1)
    })
  })

  describe('buildMessageReceivedMutationResult', () => {
    it('returns pass if nothing changed', () => {
      const payload = { context: { source: 'plugin' }, conversationId: 'c1', providerId: 'p1', modelId: 'm1', message: { role: 'user', content: 'text', parts: [] }, modelMessages: [] } as MessageReceivedHookPayload
      const result = buildMessageReceivedMutationResult(payload, { ...payload })
      expect(result.action).toBe('pass')
    })

    it('returns mutation if providerId changed', () => {
      const original = { providerId: 'p1', modelId: 'm1', message: { content: 'text', parts: [] }, modelMessages: [] } as MessageReceivedHookPayload
      const current = { ...original, providerId: 'p2' }
      const result = buildMessageReceivedMutationResult(original, current)
      expect(result.action).toBe('mutate')
      expect((result as Extract<MessageReceivedHookResult, { action: 'mutate' }>).providerId).toBe('p2')
    })
  })
})
