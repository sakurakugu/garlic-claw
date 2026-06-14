import { describe, it, expect, vi } from 'vitest'
import { toHostJsonValue } from '@garlic-claw/plugin-sdk/host/host-json-value.codec'
import { buildPluginMessageSendParams, buildPluginConversationSessionStartParams, buildPluginConversationSessionKeepParams, buildPluginRegisterCronParams, buildPluginCreateAutomationParams, buildPluginGenerateParams, buildPluginSubagentSpawnParams, buildPluginSubagentWaitParams, buildPluginSubagentSendInputParams, buildPluginSubagentInterruptParams, buildPluginSubagentCloseParams, buildPluginGenerateTextParams, buildPluginConversationHistoryPreviewParams, buildPluginConversationHistoryReplaceParams, toScopedStateParams } from '@garlic-claw/plugin-sdk/host/facade-payload.helpers'
import { createPluginHostFacade } from '@garlic-claw/plugin-sdk/host/facade'
import type { HostCallPayload, JsonObject, JsonValue } from '@garlic-claw/shared'

describe('host/host-json-value.codec', () => {
  describe('toHostJsonValue', () => {
    it('passes through primitives', () => {
      expect(toHostJsonValue(null)).toBe(null)
      expect(toHostJsonValue('str')).toBe('str')
      expect(toHostJsonValue(42)).toBe(42)
      expect(toHostJsonValue(true)).toBe(true)
    })

    it('converts arrays, skipping undefined', () => {
      expect(toHostJsonValue([1, undefined, 3])).toEqual([1, 3])
    })

    it('converts Date to ISO string', () => {
      const date = new Date('2026-01-01T00:00:00.000Z')
      expect(toHostJsonValue(date)).toBe('2026-01-01T00:00:00.000Z')
    })

    it('converts plain objects, skipping undefined keys', () => {
      expect(toHostJsonValue({ a: 1, b: undefined, c: 'x' })).toEqual({ a: 1, c: 'x' })
    })

    it('converts non-plain objects to string', () => {
      const map = new Map([['key', 'value']])
      expect(toHostJsonValue(map)).toBe('[object Map]')
    })

    it('converts nested structures', () => {
      const input = { outer: { inner: [1, 2, { key: 'val' }], date: new Date('2026-06-13') } }
      const result = toHostJsonValue(input) as JsonObject
      expect((result.outer as JsonObject).inner).toEqual([1, 2, { key: 'val' }])
      expect((result.outer as JsonObject).date).toBe('2026-06-13T00:00:00.000Z')
    })
  })
})

describe('host/facade-payload.helpers', () => {
  describe('buildPluginMessageSendParams', () => {
    it('builds minimal params', () => {
      expect(buildPluginMessageSendParams({})).toEqual({})
    })

    it('includes optional fields', () => {
      const result = buildPluginMessageSendParams({
        content: 'hello',
        provider: 'openai',
        model: 'gpt-4',
        target: { type: 'user', id: 'u1' },
        parts: [{ type: 'text', text: 'hi' }],
      })
      expect(result.content).toBe('hello')
      expect(result.provider).toBe('openai')
      expect(result.model).toBe('gpt-4')
      expect(result.target).toBeDefined()
      expect(result.parts).toBeDefined()
    })
  })

  describe('buildPluginConversationSessionStartParams', () => {
    it('builds with required timeoutMs', () => {
      expect(buildPluginConversationSessionStartParams({ timeoutMs: 30000 })).toEqual({ timeoutMs: 30000 })
    })

    it('includes optional fields', () => {
      const result = buildPluginConversationSessionStartParams({ timeoutMs: 60000, captureHistory: true, metadata: { key: 'val' } })
      expect(result.timeoutMs).toBe(60000)
      expect(result.captureHistory).toBe(true)
      expect(result.metadata).toEqual({ key: 'val' })
    })
  })

  describe('buildPluginConversationSessionKeepParams', () => {
    it('builds with required timeoutMs', () => {
      expect(buildPluginConversationSessionKeepParams({ timeoutMs: 30000 })).toEqual({ timeoutMs: 30000 })
    })

    it('includes resetTimeout', () => {
      expect(buildPluginConversationSessionKeepParams({ timeoutMs: 30000, resetTimeout: true })).toEqual({ timeoutMs: 30000, resetTimeout: true })
    })
  })

  describe('buildPluginRegisterCronParams', () => {
    it('builds minimal params', () => {
      expect(buildPluginRegisterCronParams({ name: 'test', cron: '0 * * * *' })).toEqual({ name: 'test', cron: '0 * * * *' })
    })

    it('includes optional fields', () => {
      const result = buildPluginRegisterCronParams({ name: 'test', cron: '*/5 * * * *', description: 'every 5 min', enabled: true, data: { key: 1 } })
      expect(result.description).toBe('every 5 min')
      expect(result.enabled).toBe(true)
      expect(result.data).toEqual({ key: 1 })
    })
  })

  describe('buildPluginCreateAutomationParams', () => {
    it('builds automation params', () => {
      const result = buildPluginCreateAutomationParams({
        name: 'auto1',
        trigger: { type: 'manual' },
        actions: [{ type: 'ai_message', message: 'hello' }],
      })
      expect(result.name).toBe('auto1')
      expect(result.trigger).toBeDefined()
      expect(result.actions).toBeDefined()
    })
  })

  describe('buildPluginGenerateParams', () => {
    it('builds generate params', () => {
      const result = buildPluginGenerateParams({
        messages: [{ role: 'user', content: 'hi' }],
        providerId: 'openai',
        system: 'be helpful',
      })
      expect(result.messages).toBeDefined()
      expect(result.providerId).toBe('openai')
      expect(result.system).toBe('be helpful')
    })
  })

  describe('buildPluginSubagentSpawnParams', () => {
    it('builds spawn params with required messages', () => {
      const result = buildPluginSubagentSpawnParams({ messages: [{ role: 'user', content: [{ type: 'text', text: 'do it' }] }] })
      expect(result.messages).toBeDefined()
    })
  })

  describe('buildPluginSubagentWaitParams', () => {
    it('builds wait params', () => {
      expect(buildPluginSubagentWaitParams({ conversationId: 'c1' })).toEqual({ conversationId: 'c1' })
    })

    it('includes timeoutMs', () => {
      expect(buildPluginSubagentWaitParams({ conversationId: 'c1', timeoutMs: 5000 })).toEqual({ conversationId: 'c1', timeoutMs: 5000 })
    })
  })

  describe('buildPluginSubagentInterruptParams', () => {
    it('builds interrupt params', () => {
      expect(buildPluginSubagentInterruptParams({ conversationId: 'c1' })).toEqual({ conversationId: 'c1' })
    })
  })

  describe('buildPluginSubagentCloseParams', () => {
    it('builds close params', () => {
      expect(buildPluginSubagentCloseParams({ conversationId: 'c1' })).toEqual({ conversationId: 'c1' })
    })
  })

  describe('buildPluginGenerateTextParams', () => {
    it('builds text generation params', () => {
      const result = buildPluginGenerateTextParams({ prompt: 'hello' })
      expect(result.prompt).toBe('hello')
    })
  })

  describe('buildPluginConversationHistoryPreviewParams', () => {
    it('builds empty preview params', () => {
      expect(buildPluginConversationHistoryPreviewParams({})).toEqual({})
    })

    it('includes optional fields', () => {
      const result = buildPluginConversationHistoryPreviewParams({ modelId: 'gpt-4', providerId: 'openai' })
      expect(result.modelId).toBe('gpt-4')
      expect(result.providerId).toBe('openai')
    })
  })

  describe('buildPluginConversationHistoryReplaceParams', () => {
    it('builds replace params', () => {
      const result = buildPluginConversationHistoryReplaceParams({ expectedRevision: 'rev1', messages: [{ role: 'user', content: 'hi' }] })
      expect(result.expectedRevision).toBe('rev1')
      expect(result.messages).toBeDefined()
    })
  })

  describe('toScopedStateParams', () => {
    it('returns empty object for no scope', () => {
      expect(toScopedStateParams()).toEqual({})
      expect(toScopedStateParams({})).toEqual({})
    })

    it('includes scope', () => {
      expect(toScopedStateParams({ scope: 'plugin' })).toEqual({ scope: 'plugin' })
    })
  })
})

describe('host/facade', () => {
  describe('createPluginHostFacade', () => {
    it('returns facade with all methods', () => {
      const call = vi.fn<(method: string, params: JsonObject) => Promise<JsonValue>>().mockResolvedValue(null)
      const callHost = vi.fn().mockResolvedValue(null)
      const facade = createPluginHostFacade({ call, callHost })

      expect(facade.call).toBe(call)
      expect(typeof facade.getCurrentProvider).toBe('function')
      expect(typeof facade.listProviders).toBe('function')
      expect(typeof facade.executeRuntimeCommand).toBe('function')
      expect(typeof facade.readRuntimePath).toBe('function')
      expect(typeof facade.globRuntimePaths).toBe('function')
      expect(typeof facade.grepRuntimeContent).toBe('function')
      expect(typeof facade.writeRuntimeFile).toBe('function')
      expect(typeof facade.editRuntimeFile).toBe('function')
      expect(typeof facade.getConversation).toBe('function')
      expect(typeof facade.getConversationHistory).toBe('function')
      expect(typeof facade.previewConversationHistory).toBe('function')
      expect(typeof facade.replaceConversationHistory).toBe('function')
      expect(typeof facade.getCurrentMessageTarget).toBe('function')
      expect(typeof facade.sendMessage).toBe('function')
      expect(typeof facade.startConversationSession).toBe('function')
      expect(typeof facade.getConversationSession).toBe('function')
      expect(typeof facade.keepConversationSession).toBe('function')
      expect(typeof facade.finishConversationSession).toBe('function')
      expect(typeof facade.listKnowledgeBaseEntries).toBe('function')
      expect(typeof facade.searchKnowledgeBase).toBe('function')
      expect(typeof facade.getKnowledgeBaseEntry).toBe('function')
      expect(typeof facade.getCurrentPersona).toBe('function')
      expect(typeof facade.listPersonas).toBe('function')
      expect(typeof facade.getPersona).toBe('function')
      expect(typeof facade.activatePersona).toBe('function')
      expect(typeof facade.registerCron).toBe('function')
      expect(typeof facade.listCrons).toBe('function')
      expect(typeof facade.deleteCron).toBe('function')
      expect(typeof facade.createAutomation).toBe('function')
      expect(typeof facade.listAutomations).toBe('function')
      expect(typeof facade.toggleAutomation).toBe('function')
      expect(typeof facade.runAutomation).toBe('function')
      expect(typeof facade.emitAutomationEvent).toBe('function')
      expect(typeof facade.getPluginSelf).toBe('function')
      expect(typeof facade.listLogs).toBe('function')
      expect(typeof facade.writeLog).toBe('function')
      expect(typeof facade.searchMemories).toBe('function')
      expect(typeof facade.saveMemory).toBe('function')
      expect(typeof facade.listConversationMessages).toBe('function')
      expect(typeof facade.getStorage).toBe('function')
      expect(typeof facade.setStorage).toBe('function')
      expect(typeof facade.deleteStorage).toBe('function')
      expect(typeof facade.listStorage).toBe('function')
      expect(typeof facade.getState).toBe('function')
      expect(typeof facade.setState).toBe('function')
      expect(typeof facade.deleteState).toBe('function')
      expect(typeof facade.listState).toBe('function')
      expect(typeof facade.getConfig).toBe('function')
      expect(typeof facade.getUser).toBe('function')
      expect(typeof facade.setConversationTitle).toBe('function')
      expect(typeof facade.generate).toBe('function')
      expect(typeof facade.generateText).toBe('function')
      expect(typeof facade.spawnSubagent).toBe('function')
      expect(typeof facade.waitSubagent).toBe('function')
      expect(typeof facade.sendInputSubagent).toBe('function')
      expect(typeof facade.interruptSubagent).toBe('function')
      expect(typeof facade.closeSubagent).toBe('function')
      expect(typeof facade.listSubagents).toBe('function')
      expect(typeof facade.getSubagent).toBe('function')
    })

    it('forwards callHost for no-arg methods', async () => {
      const callHost = vi.fn().mockResolvedValue({ id: 'p1' })
      const facade = createPluginHostFacade({
        call: vi.fn(),
        callHost,
      })
      await facade.getCurrentProvider()
      expect(callHost).toHaveBeenCalledWith('provider.current.get')
    })

    it('forwards callHost for key-based methods', async () => {
      const callHost = vi.fn().mockResolvedValue({ id: 'p1' })
      const facade = createPluginHostFacade({ call: vi.fn(), callHost })
      await facade.getProvider('p1')
      expect(callHost).toHaveBeenCalledWith('provider.get', { providerId: 'p1' })
    })

    it('conversation session methods delegate to controller if provided', async () => {
      const controller = {
        start: vi.fn().mockResolvedValue({ conversationId: 'c1', pluginId: 'p', timeoutMs: 30000, startedAt: '2026-01-01', expiresAt: '2026-01-02', captureHistory: false, historyMessages: [] }),
        get: vi.fn().mockResolvedValue(null),
        keep: vi.fn().mockResolvedValue(null),
        finish: vi.fn().mockResolvedValue(true),
      }
      const facade = createPluginHostFacade({
        call: vi.fn(),
        callHost: vi.fn(),
        conversationSessionController: controller,
      })
      await facade.startConversationSession({ timeoutMs: 30000 })
      expect(controller.start).toHaveBeenCalled()
      await facade.getConversationSession()
      expect(controller.get).toHaveBeenCalled()
      await facade.finishConversationSession()
      expect(controller.finish).toHaveBeenCalled()
    })
  })
})
