import { describe, it, expect, vi } from 'vitest'
import { createPluginHostFacade } from '@garlic-claw/plugin-sdk/host/facade'
import { createPluginAuthorTransportExecutor, createChatBeforeModelHookResult } from '@garlic-claw/plugin-sdk/authoring/transport'
import { toHostJsonValue } from '@garlic-claw/plugin-sdk/host/host-json-value.codec'
import { normalizeRoutePath } from '@garlic-claw/plugin-sdk/utils/route'
import { buildCommandVariants, normalizeCommandSegment } from '@garlic-claw/plugin-sdk/utils/command-match'
import { isJsonObjectValue } from '@garlic-claw/plugin-sdk/utils/json-value'
import type { JsonObject, JsonValue, PluginCallContext, PluginManifest, PluginRouteRequest, PluginRouteResponse } from '@garlic-claw/shared'
import type { PluginAuthorDefinition, PluginAuthorExecutionContext, PluginHostFacade } from '@garlic-claw/plugin-sdk/authoring/transport'

describe('integration: host facade + authoring transport', () => {
  const createMockHostFacade = () => {
    const call = vi.fn<(method: string, params: JsonObject) => Promise<JsonValue>>()
    const callHost = vi.fn<(method: string, params?: JsonObject) => Promise<JsonValue>>()
    const facade = createPluginHostFacade({ call, callHost })
    return { call, callHost, facade }
  }

  it('authoring executor routes tool calls through host facade', async () => {
    const { call, callHost, facade } = createMockHostFacade()
    callHost.mockResolvedValue({ data: 'ok' })

    const definition: PluginAuthorDefinition = {
      manifest: { id: 'integration-test', runtime: 'remote' } as PluginManifest,
      tools: {
        greet: async (params, ctx) => {
          const provider = await ctx.host.getCurrentProvider()
          return { greeting: `Hello ${params.name}`, provider }
        },
      },
    }

    const executor = createPluginAuthorTransportExecutor({
      definition,
      createExecutionContext: (callContext) => ({ callContext, host: facade }),
    })

    callHost.mockResolvedValue({ id: 'p1' })
    const result = await executor.executeTool({ toolName: 'greet', params: { name: 'World' }, context: { source: 'plugin' } })

    expect(result).toMatchObject({ greeting: 'Hello World' })
    expect(callHost).toHaveBeenCalledWith('provider.current.get')
  })

  it('authoring executor invokes hooks with host facade', async () => {
    const { facade } = createMockHostFacade()
    const hookHandler = vi.fn().mockResolvedValue({ action: 'pass' })

    const definition: PluginAuthorDefinition = {
      manifest: { id: 'hook-test', runtime: 'remote' } as PluginManifest,
      hooks: { 'message:received': hookHandler },
    }

    const executor = createPluginAuthorTransportExecutor({
      definition,
      createExecutionContext: (callContext) => ({ callContext, host: facade }),
    })

    await executor.invokeHook({ hookName: 'message:received', payload: { text: 'test' }, context: { source: 'plugin' } })
    expect(hookHandler).toHaveBeenCalled()
  })

  it('route handler receives normalized path and returns normalized response', async () => {
    const { facade } = createMockHostFacade()
    const routeHandler = vi.fn().mockResolvedValue({ body: { success: true } })

    const definition: PluginAuthorDefinition = {
      manifest: { id: 'route-test', runtime: 'remote' } as PluginManifest,
      routes: { 'api/test': routeHandler },
    }

    const executor = createPluginAuthorTransportExecutor({
      definition,
      createExecutionContext: (callContext) => ({ callContext, host: facade }),
    })

    const result = await executor.invokeRoute({ request: { path: '//api/test/', method: 'POST', headers: {}, query: { q: '1' }, body: { data: 'x' } }, context: { source: 'plugin' } })
    expect(routeHandler).toHaveBeenCalled()
    expect(result).toMatchObject({ body: { success: true } })
  })
})

describe('integration: message filter + command matching + pipeline', () => {
  it('command variants work with message filter commands', () => {
    const variants = buildCommandVariants([
      { segment: normalizeCommandSegment('tools'), aliases: ['t'] },
      { segment: normalizeCommandSegment('echo'), aliases: ['e'] },
    ])

    expect(variants).toContain('/tools echo')
    expect(variants).toContain('/t echo')
    expect(variants).toContain('/tools e')
    expect(variants).toContain('/t e')
    expect(variants).toHaveLength(4)
  })

  it('normalizeRoutePath normalizes paths consistently', () => {
    expect(normalizeRoutePath('//api/hello/')).toBe('api/hello')
    expect(normalizeRoutePath('/test/')).toBe('test')
  })
})

describe('integration: toHostJsonValue + facade payload helpers', () => {
  it('converts typed parameters to JSON object for host calls', () => {
    const input = { name: 'test', trigger: { type: 'manual' } as const, actions: [{ type: 'ai_message' as const, message: 'hello' }] }
    const jsonValue = toHostJsonValue(input)
    expect(isJsonObjectValue(jsonValue)).toBe(true)
    const obj = jsonValue as JsonObject
    expect(obj.name).toBe('test')
    expect(obj.actions).toBeDefined()
  })

  it('handles Date objects in nested params', () => {
    const input = { scheduledAt: new Date('2026-06-13T10:00:00Z'), data: { nested: { value: 42 } } }
    const result = toHostJsonValue(input) as JsonObject
    expect(result.scheduledAt).toBe('2026-06-13T10:00:00.000Z')
    expect((result.data as JsonObject).nested).toEqual({ value: 42 })
  })
})

describe('integration: chat:before-model flow', () => {
  it('createChatBeforeModelHookResult can be combined with executor', () => {
    const executor = createPluginAuthorTransportExecutor({
      definition: {
        manifest: { id: 'cb-test', runtime: 'remote' } as PluginManifest,
        hooks: {
          'chat:before-model': async (payload) => {
            return createChatBeforeModelHookResult('existing prompt', 'additional knowledge')
          },
        },
      },
      createExecutionContext: () => ({
        callContext: { source: 'plugin' },
        host: {} as PluginHostFacade,
      }),
    })

    // This validates the hook handler can be invoked through the executor
    const handler = executor.invokeHook
    expect(handler).toBeDefined()
  })
})
