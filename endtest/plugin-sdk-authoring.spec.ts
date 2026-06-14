import { describe, it, expect } from 'vitest'
import { readJsonObjectValue, readRequiredStringParam, readOptionalStringParam, readOptionalObjectParam, readRequiredTextValue, readBooleanFlag, pickOptionalStringFields, pickOptionalNumberFields, sanitizeOptionalText, textIncludesKeyword } from '@garlic-claw/plugin-sdk/authoring/common-helpers'
import { readMemorySearchResults, readMemorySaveResultId, readPluginCreateAutomationParams, createAutomationCreatedResult, createAutomationListResult, createMemorySaveToolResult, createMemoryRecallToolResult, createCurrentTimeToolResult, createSystemInfoToolResult, createCalculateSuccessResult, createRouteInspectorContextResponse } from '@garlic-claw/plugin-sdk/authoring/builtin-results'
import { readConversationSummary, readConversationMessages, readConversationTitleConfig, resolveConversationTitleRuntimeConfig, readTextGenerationResult, shouldGenerateConversationTitle, buildConversationTitlePrompt, sanitizeConversationTitle, normalizePositiveInteger } from '@garlic-claw/plugin-sdk/authoring/conversation-helpers'
import { readContextCompactionConfig, resolveContextCompactionRuntimeConfig, CONTEXT_COMPACTION_DEFAULT_STRATEGY } from '@garlic-claw/plugin-sdk/authoring/context-compaction'
import { buildAutomationRunSummary, buildMessageReceivedSummary, buildWaitingModelSummary, buildConversationCreatedSummary, buildMessageLifecycleSummary, buildResponseSendSummary, buildPluginGovernanceSummary, buildPluginGovernanceMessage, buildToolAuditSummary, describeJsonValueKind, buildToolAuditStorageKey } from '@garlic-claw/plugin-sdk/authoring/observation-summaries'
import { createChatBeforeModelLineBlockResult, filterAllowedToolNames, sameToolNames, KB_CONTEXT_DEFAULT_LIMIT, KB_CONTEXT_DEFAULT_PROMPT_PREFIX } from '@garlic-claw/plugin-sdk/authoring/prompt-helpers'
import { readProviderRouterConfig, readCurrentProviderInfo, readPersonaRouterConfig, readCurrentPersonaInfo, readPersonaSummaryInfo } from '@garlic-claw/plugin-sdk/authoring/router-helpers'
import { readSubagentConfig, buildSubagentSpawnParams, buildSubagentWaitParams, buildSubagentSendInputParams, buildSubagentInterruptParams, buildSubagentCloseParams, createSubagentSummaryResult, buildSubagentToolDefinitions } from '@garlic-claw/plugin-sdk/authoring/subagent'
import { createPluginAuthorTransportExecutor, createChatBeforeModelHookResult, createPassHookResult, createSystemPromptMutateResult, createProviderRouterShortCircuitResult, createProviderRouterMutateResult, readPluginHookPayload, asChatBeforeModelPayload, asChatAfterModelPayload, asConversationHistoryRewritePayload } from '@garlic-claw/plugin-sdk/authoring/transport'
import type { JsonValue, PluginRouteRequest, PluginRouteResponse, PluginCallContext, PluginManifest } from '@garlic-claw/shared'
import type { PluginAuthorDefinition, PluginAuthorExecutionContext, PluginHostFacade } from '@garlic-claw/plugin-sdk/authoring/transport'
import type { PluginAuthorTransportExecutor } from '@garlic-claw/plugin-sdk/authoring/transport'

describe('authoring/common-helpers', () => {
  describe('sanitizeOptionalText', () => {
    it('trims string', () => expect(sanitizeOptionalText('  hello  ')).toBe('hello'))
    it('returns empty for undefined', () => expect(sanitizeOptionalText(undefined)).toBe(''))
    it('returns empty for null', () => expect(sanitizeOptionalText(null as unknown as string)).toBe(''))
  })

  describe('readJsonObjectValue', () => {
    it('returns object for valid JsonObject', () => expect(readJsonObjectValue({ a: 1 })).toEqual({ a: 1 }))
    it('returns null for array', () => expect(readJsonObjectValue([1])).toBeNull())
    it('returns null for primitive', () => expect(readJsonObjectValue('str')).toBeNull())
  })

  describe('readRequiredStringParam', () => {
    it('returns string value', () => expect(readRequiredStringParam({ key: 'val' }, 'key')).toBe('val'))
    it('throws on missing key', () => expect(() => readRequiredStringParam({}, 'key')).toThrow('必填'))
    it('throws on empty string', () => expect(() => readRequiredStringParam({ key: '' }, 'key')).toThrow('必填'))
    it('throws on non-string', () => expect(() => readRequiredStringParam({ key: 123 }, 'key')).toThrow('必填'))
  })

  describe('readOptionalStringParam', () => {
    it('returns null for undefined', () => expect(readOptionalStringParam({}, 'key')).toBeNull())
    it('returns null for null', () => expect(readOptionalStringParam({ key: null }, 'key')).toBeNull())
    it('returns string for valid', () => expect(readOptionalStringParam({ key: 'val' }, 'key')).toBe('val'))
    it('throws on non-string', () => expect(() => readOptionalStringParam({ key: 123 }, 'key')).toThrow('必须是字符串'))
  })

  describe('readOptionalObjectParam', () => {
    it('returns undefined for missing', () => expect(readOptionalObjectParam({}, 'key')).toBeUndefined())
    it('returns object for valid', () => expect(readOptionalObjectParam({ key: { a: 1 } }, 'key')).toEqual({ a: 1 }))
    it('throws on non-object', () => expect(() => readOptionalObjectParam({ key: 'str' }, 'key')).toThrow('必须是对象'))
  })

  describe('readRequiredTextValue', () => {
    it('returns trimmed string', () => expect(readRequiredTextValue('  hello  ', 'label')).toBe('hello'))
    it('throws on empty', () => expect(() => readRequiredTextValue('', 'label')).toThrow('必须是非空字符串'))
    it('throws on non-string', () => expect(() => readRequiredTextValue(123, 'label')).toThrow('必须是非空字符串'))
  })

  describe('readBooleanFlag', () => {
    it('returns boolean if provided', () => {
      expect(readBooleanFlag(true, false)).toBe(true)
      expect(readBooleanFlag(false, true)).toBe(false)
    })
    it('returns fallback for non-boolean', () => {
      expect(readBooleanFlag(undefined, true)).toBe(true)
      expect(readBooleanFlag('str', false)).toBe(false)
    })
  })

  describe('pickOptionalStringFields', () => {
    it('picks string fields', () => {
      expect(pickOptionalStringFields({ a: 'x', b: 123, c: 'y' }, ['a', 'b', 'c'] as const)).toEqual({ a: 'x', c: 'y' })
    })
    it('returns empty for null', () => expect(pickOptionalStringFields(null, ['a'] as const)).toEqual({}))
  })

  describe('pickOptionalNumberFields', () => {
    it('picks number fields', () => {
      expect(pickOptionalNumberFields({ a: 1, b: 'str', c: 2 }, ['a', 'b', 'c'] as const)).toEqual({ a: 1, c: 2 })
    })
  })

  describe('textIncludesKeyword', () => {
    it('returns true when keyword found', () => expect(textIncludesKeyword('hello world', 'world')).toBe(true))
    it('returns false for empty keyword', () => expect(textIncludesKeyword('hello', '')).toBe(false))
    it('returns false for undefined keyword', () => expect(textIncludesKeyword('hello', undefined)).toBe(false))
    it('returns false when not found', () => expect(textIncludesKeyword('hello', 'world')).toBe(false))
  })
})

describe('authoring/builtin-results', () => {
  describe('readMemorySearchResults', () => {
    it('parses array of entries', () => {
      const result = readMemorySearchResults([{ content: 'test', category: 'general', createdAt: '2026-01-01T00:00:00Z' }])
      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('test')
    })

    it('handles non-array', () => expect(readMemorySearchResults('str')).toEqual([]))
  })

  describe('readMemorySaveResultId', () => {
    it('extracts id from object', () => expect(readMemorySaveResultId({ id: 'mem1' })).toBe('mem1'))
    it('returns null for non-object', () => expect(readMemorySaveResultId('str')).toBeNull())
  })

  describe('readPluginCreateAutomationParams', () => {
    it('parses manual trigger', () => {
      const result = readPluginCreateAutomationParams({ name: 'test', triggerType: 'manual', actions: [{ type: 'ai_message', message: 'hi' }] })
      expect(result.name).toBe('test')
      expect(result.trigger.type).toBe('manual')
    })

    it('parses cron trigger', () => {
      const result = readPluginCreateAutomationParams({ name: 'test', triggerType: 'cron', cronInterval: '0 * * * *', actions: [] })
      expect(result.trigger.type).toBe('cron')
      expect(result.trigger.cron).toBe('0 * * * *')
    })

    it('throws on invalid triggerType', () => {
      expect(() => readPluginCreateAutomationParams({ name: 'test', triggerType: 'invalid', actions: [] })).toThrow('必须是 cron/manual/event')
    })
  })

  describe('createAutomationCreatedResult', () => {
    it('returns created result', () => expect(createAutomationCreatedResult({ id: 'a1', name: 'auto1' })).toEqual({ created: true, id: 'a1', name: 'auto1' }))
  })

  describe('createAutomationListResult', () => {
    it('maps automation list', () => {
      const result = createAutomationListResult([{ id: 'a1', name: 'auto1', trigger: { type: 'manual' }, enabled: true, lastRunAt: null }])
      expect(result).toHaveLength(1)
      expect((result as Array<unknown>)[0]).toMatchObject({ id: 'a1', name: 'auto1', enabled: true })
    })
  })

  describe('createMemorySaveToolResult', () => {
    it('returns save result', () => expect(createMemorySaveToolResult('mem1')).toEqual({ saved: true, id: 'mem1' }))
  })

  describe('createMemoryRecallToolResult', () => {
    it('formats memory recall', () => {
      const result = createMemoryRecallToolResult([{ content: 'test', category: 'general', createdAt: '2026-01-01T12:00:00Z' }])
      expect(result.count).toBe(1)
      expect(result.memories[0].date).toBe('2026-01-01')
    })
  })

  describe('createCurrentTimeToolResult', () => {
    it('returns time', () => expect(createCurrentTimeToolResult('12:00')).toEqual({ time: '12:00' }))
  })

  describe('createSystemInfoToolResult', () => {
    it('returns system info', () => expect(createSystemInfoToolResult({ platform: 'win32', nodeVersion: 'v22', uptime: 100, memoryUsage: 50 })).toEqual({ platform: 'win32', nodeVersion: 'v22', uptime: 100, memoryUsage: 50 }))
  })

  describe('createCalculateSuccessResult', () => {
    it('returns calculation', () => expect(createCalculateSuccessResult('1+1', 2)).toEqual({ expression: '1+1', result: 2 }))
  })

  describe('createRouteInspectorContextResponse', () => {
    it('builds response', () => {
      const result = createRouteInspectorContextResponse({ plugin: { id: 'p1' }, user: { name: 'user1' }, conversation: { id: 'c1', title: 'test' }, messageCount: 5 })
      expect(result.status).toBe(200)
      expect(result.body).toBeDefined()
    })
  })
})

describe('authoring/conversation-helpers', () => {
  describe('readConversationSummary', () => {
    it('extracts id and title', () => expect(readConversationSummary({ id: 'c1', title: 'chat' })).toEqual({ id: 'c1', title: 'chat' }))
  })

  describe('readConversationMessages', () => {
    it('parses message array', () => {
      const result = readConversationMessages([{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }])
      expect(result).toHaveLength(2)
    })
    it('handles non-array', () => expect(readConversationMessages('str')).toEqual([]))
  })

  describe('readConversationTitleConfig', () => {
    it('reads config', () => {
      expect(readConversationTitleConfig({ defaultTitle: 'Chat', maxMessages: 10 })).toEqual({ defaultTitle: 'Chat', maxMessages: 10 })
    })
  })

  describe('resolveConversationTitleRuntimeConfig', () => {
    it('fills defaults', () => {
      const result = resolveConversationTitleRuntimeConfig({})
      expect(result.defaultTitle).toBeTruthy()
      expect(result.maxMessages).toBeGreaterThan(0)
    })
  })

  describe('readTextGenerationResult', () => {
    it('extracts text', () => expect(readTextGenerationResult({ text: 'result' })).toEqual({ text: 'result' }))
    it('returns empty for missing text', () => expect(readTextGenerationResult({})).toEqual({ text: '' }))
  })

  describe('shouldGenerateConversationTitle', () => {
    it('returns true if title matches default', () => expect(shouldGenerateConversationTitle('新的对话', '新的对话')).toBe(true))
    it('returns false if different', () => expect(shouldGenerateConversationTitle('Custom', '新的对话')).toBe(false))
    it('handles undefined title', () => expect(shouldGenerateConversationTitle(undefined, '新的对话')).toBe(false))
  })

  describe('buildConversationTitlePrompt', () => {
    it('builds prompt from messages', () => {
      const result = buildConversationTitlePrompt([{ role: 'user', content: 'hello' }], 4)
      expect(result).toContain('请为下面这段对话生成一个简洁中文标题')
      expect(result).toContain('hello')
    })

    it('returns empty for no messages with content', () => {
      expect(buildConversationTitlePrompt([{ role: 'user', content: '' }], 4)).toBe('')
    })
  })

  describe('sanitizeConversationTitle', () => {
    it('cleans title', () => expect(sanitizeConversationTitle('"测试标题"')).toBe('测试标题'))
    it('returns empty for invalid', () => expect(sanitizeConversationTitle('')).toBe(''))
  })

  describe('normalizePositiveInteger', () => {
    it('returns value if positive', () => expect(normalizePositiveInteger(5, 10)).toBe(5))
    it('returns fallback for zero', () => expect(normalizePositiveInteger(0, 10)).toBe(10))
    it('returns fallback for undefined', () => expect(normalizePositiveInteger(undefined, 10)).toBe(10))
  })
})

describe('authoring/context-compaction', () => {
  describe('readContextCompactionConfig', () => {
    it('reads strategy', () => expect(readContextCompactionConfig({ strategy: 'sliding' }).strategy).toBe('sliding'))
    it('ignores invalid strategy', () => expect(readContextCompactionConfig({ strategy: 'invalid' }).strategy).toBeUndefined())
  })

  describe('resolveContextCompactionRuntimeConfig', () => {
    it('fills defaults', () => {
      const result = resolveContextCompactionRuntimeConfig({})
      expect(result.enabled).toBe(true)
      expect(result.strategy).toBe(CONTEXT_COMPACTION_DEFAULT_STRATEGY)
      expect(result.compressionThreshold).toBeGreaterThan(0)
      expect(result.keepRecentMessages).toBeGreaterThanOrEqual(0)
      expect(result.reservedTokens).toBeGreaterThan(0)
    })

    it('clamps values to range', () => {
      const result = resolveContextCompactionRuntimeConfig({ compressionThreshold: 200, keepRecentMessages: 100 })
      expect(result.compressionThreshold).toBe(100)
      expect(result.keepRecentMessages).toBe(64)
    })
  })
})

describe('authoring/observation-summaries', () => {
  const context = { source: 'plugin' as const }

  it('buildAutomationRunSummary', () => {
    const payload = { automation: { id: 'a1', name: 'auto1', trigger: { type: 'manual' } }, status: 'success', results: [1, 2, 3] }
    const result = buildAutomationRunSummary(payload as never)
    expect(result.automationId).toBe('a1')
    expect(result.resultCount).toBe(3)
  })

  it('buildMessageReceivedSummary', () => {
    const payload = { conversationId: 'c1', providerId: 'p1', modelId: 'm1', message: { content: 'hello', parts: [{ type: 'text', text: 'hello' }] }, context }
    const result = buildMessageReceivedSummary(payload as never)
    expect(result.conversationId).toBe('c1')
    expect(result.contentLength).toBe(5)
  })

  it('buildWaitingModelSummary', () => {
    const payload = { conversationId: 'c1', assistantMessageId: 'm1', providerId: 'p1', modelId: 'm1', request: { messages: [], availableTools: [] }, context }
    const result = buildWaitingModelSummary(payload as never)
    expect(result.conversationId).toBe('c1')
  })

  it('buildConversationCreatedSummary', () => {
    const payload = { conversation: { id: 'c1', title: 'test' }, context }
    const result = buildConversationCreatedSummary(payload as never)
    expect(result.conversationId).toBe('c1')
    expect(result.titleLength).toBe(4)
  })

  it('buildMessageLifecycleSummary', () => {
    const result = buildMessageLifecycleSummary('created', 'c1', { id: 'msg1', role: 'user', content: 'hi', parts: [], status: 'completed' }, 'u1')
    expect(result.eventType).toBe('created')
    expect(result.messageId).toBe('msg1')
  })

  it('buildResponseSendSummary', () => {
    const payload = { assistantMessageId: 'm1', providerId: 'p1', modelId: 'm1', responseSource: 'llm', assistantContent: 'hello', toolCalls: [], toolResults: [], sentAt: '2026-01-01T00:00:00Z', context: { ...context, conversationId: 'c1' } }
    const result = buildResponseSendSummary(payload as never)
    expect(result.assistantMessageId).toBe('m1')
  })

  describe('buildPluginGovernanceSummary', () => {
    it('builds summary', () => {
      const result = buildPluginGovernanceSummary({ eventType: 'plugin:loaded', pluginId: 'p1', runtimeKind: 'remote', remoteEnvironment: 'api', occurredAt: '2026-01-01' })
      expect(result.eventType).toBe('plugin:loaded')
    })
  })

  describe('buildPluginGovernanceMessage', () => {
    it('returns loaded message', () => {
      const summary = buildPluginGovernanceSummary({ eventType: 'plugin:loaded', pluginId: 'p1', runtimeKind: 'remote', remoteEnvironment: 'api', occurredAt: '2026-01-01' })
      expect(buildPluginGovernanceMessage(summary)).toContain('已加载')
    })
    it('returns error message', () => {
      const summary = buildPluginGovernanceSummary({ eventType: 'plugin:error', pluginId: 'p1', runtimeKind: 'remote', remoteEnvironment: 'api', occurredAt: '2026-01-01', errorType: 'timeout' })
      expect(buildPluginGovernanceMessage(summary)).toContain('失败')
    })
  })

  it('buildToolAuditSummary', () => {
    const payload = { source: { kind: 'plugin', id: 'p1' }, pluginId: 'p1', runtimeKind: 'remote', tool: { toolId: 't1', callName: 'tool', name: 'test-tool' }, params: { key: 'val' }, output: 'result', context: { ...context, conversationId: 'c1' } }
    const result = buildToolAuditSummary(payload as never)
    expect(result.toolName).toBe('test-tool')
  })

  describe('describeJsonValueKind', () => {
    it('detects array', () => expect(describeJsonValueKind([1])).toBe('array'))
    it('detects null', () => expect(describeJsonValueKind(null)).toBe('null'))
    it('detects string', () => expect(describeJsonValueKind('str')).toBe('string'))
  })

  describe('buildToolAuditStorageKey', () => {
    it('builds key for plugin', () => expect(buildToolAuditStorageKey({ source: { kind: 'plugin', id: 'p1' }, pluginId: 'p1', tool: { name: 'test-tool' } } as never)).toBe('tool.p1.test-tool.last-call'))
  })
})

describe('authoring/prompt-helpers', () => {
  describe('default values', () => {
    it('exposes KB_CONTEXT_DEFAULT_LIMIT', () => expect(KB_CONTEXT_DEFAULT_LIMIT).toBe(3))
    it('exposes KB_CONTEXT_DEFAULT_PROMPT_PREFIX', () => expect(KB_CONTEXT_DEFAULT_PROMPT_PREFIX).toBeTruthy())
  })

  describe('createChatBeforeModelLineBlockResult', () => {
    it('returns null for empty lines', () => expect(createChatBeforeModelLineBlockResult('sys', 'prefix', [])).toBeNull())
    it('creates result for non-empty lines', () => {
      const result = createChatBeforeModelLineBlockResult('', '相关知识', ['line1', 'line2'])
      expect(result?.action).toBe('mutate')
    })
  })

  describe('filterAllowedToolNames', () => {
    it('returns null for empty allowed list', () => expect(filterAllowedToolNames(undefined, ['a', 'b'])).toBeNull())
    it('returns null for empty allowed array', () => expect(filterAllowedToolNames([], ['a'])).toBeNull())
    it('filters tool names', () => expect(filterAllowedToolNames(['a', 'c'], ['a', 'b', 'c'])).toEqual(['a', 'c']))
  })

  describe('sameToolNames', () => {
    it('returns true for identical arrays', () => expect(sameToolNames(['a', 'b'], ['a', 'b'])).toBe(true))
    it('returns false for different length', () => expect(sameToolNames(['a'], ['a', 'b'])).toBe(false))
    it('returns false for different order', () => expect(sameToolNames(['b', 'a'], ['a', 'b'])).toBe(false))
  })
})

describe('authoring/router-helpers', () => {
  describe('readProviderRouterConfig', () => {
    it('reads routing config', () => {
      const result = readProviderRouterConfig({ routing: { targetProviderId: 'p1', targetModelId: 'm1' }, tools: { allowedToolNames: ['t1'] }, shortCircuit: { shortCircuitKeyword: 'stop', shortCircuitReply: 'done' } })
      expect(result.targetProviderId).toBe('p1')
      expect(result.targetModelId).toBe('m1')
      expect(result.allowedToolNames).toEqual(['t1'])
      expect(result.shortCircuitKeyword).toBe('stop')
    })
  })

  describe('readCurrentProviderInfo', () => {
    it('reads provider info', () => expect(readCurrentProviderInfo({ providerId: 'p1', modelId: 'm1' })).toEqual({ providerId: 'p1', modelId: 'm1' }))
  })

  describe('readPersonaRouterConfig', () => {
    it('reads persona config', () => expect(readPersonaRouterConfig({ targetPersonaId: 'helper', switchKeyword: 'switch' })).toEqual({ targetPersonaId: 'helper', switchKeyword: 'switch' }))
  })

  describe('readCurrentPersonaInfo', () => {
    it('reads persona info', () => expect(readCurrentPersonaInfo({ personaId: 'p1' })).toEqual({ personaId: 'p1' }))
  })

  describe('readPersonaSummaryInfo', () => {
    it('reads persona summary', () => expect(readPersonaSummaryInfo({ id: 'p1', prompt: 'hello' })).toEqual({ id: 'p1', prompt: 'hello' }))
  })
})

describe('authoring/subagent', () => {
  describe('readSubagentConfig', () => {
    it('reads subagent config', () => {
      const result = readSubagentConfig({ llm: { targetSubagentType: 'general', targetProviderId: 'p1' }, session: { maxConversationSubagents: 5 }, tools: { allowedToolNames: ['t1'] } })
      expect(result.targetSubagentType).toBe('general')
      expect(result.targetProviderId).toBe('p1')
      expect(result.maxConversationSubagents).toBe(5)
      expect(result.allowedToolNames).toEqual(['t1'])
    })
  })

  describe('buildSubagentSpawnParams', () => {
    it('builds spawn params', () => {
      const result = buildSubagentSpawnParams({ config: {}, prompt: 'do task' })
      expect(result.messages).toBeDefined()
      expect((result.messages[0] as { role: string; content: Array<{ type: string; text: string }> }).content[0].text).toBe('do task')
    })
  })

  describe('buildSubagentWaitParams', () => {
    it('builds wait params', () => expect(buildSubagentWaitParams({ conversationId: 'c1', timeoutMs: 5000 })).toEqual({ conversationId: 'c1', timeoutMs: 5000 }))
  })

  describe('buildSubagentSendInputParams', () => {
    it('builds send input params', () => {
      const result = buildSubagentSendInputParams({ config: {}, conversationId: 'c1', prompt: 'continue' })
      expect(result.messages).toBeDefined()
      expect(result.conversationId).toBe('c1')
    })

    it('uses config defaults for provider/model', () => {
      const result = buildSubagentSendInputParams({ config: { targetProviderId: 'p1', targetModelId: 'm1' }, conversationId: 'c1', prompt: 'continue' })
      expect(result.providerId).toBe('p1')
      expect(result.modelId).toBe('m1')
    })

    it('prefers explicit provider/model over config', () => {
      const result = buildSubagentSendInputParams({ config: { targetProviderId: 'p1', targetModelId: 'm1' }, conversationId: 'c1', prompt: 'continue', providerId: 'p2', modelId: 'm2' })
      expect(result.providerId).toBe('p2')
      expect(result.modelId).toBe('m2')
    })
  })

  describe('buildSubagentInterruptParams', () => {
    it('builds interrupt params', () => expect(buildSubagentInterruptParams({ conversationId: 'c1' })).toEqual({ conversationId: 'c1' }))
  })

  describe('buildSubagentCloseParams', () => {
    it('builds close params', () => expect(buildSubagentCloseParams({ conversationId: 'c1' })).toEqual({ conversationId: 'c1' }))
  })

  describe('createSubagentSummaryResult', () => {
    it('converts handle to JsonValue', () => {
      const result = createSubagentSummaryResult({ conversationId: 'c1', status: 'running', title: 'sub1' } as never)
      expect(result).toBeDefined()
    })
  })

  describe('buildSubagentToolDefinitions', () => {
    it('builds 5 tool definitions', () => {
      const defs = buildSubagentToolDefinitions()
      expect(defs).toHaveLength(5)
      expect(defs.map((d) => d.name)).toEqual(['spawn_subagent', 'wait_subagent', 'send_input_subagent', 'interrupt_subagent', 'close_subagent'])
    })

    it('includes type guide in spawn_subagent description', () => {
      const defs = buildSubagentToolDefinitions({ subagentTypes: [{ id: 'explore', name: 'Explorer', description: 'Explores code' }] })
      const spawnDef = defs.find((d) => d.name === 'spawn_subagent')
      expect(spawnDef?.parameters.subagentType.description).toContain('explore')
    })
  })
})

describe('authoring/transport', () => {
  const createMockContext = (): PluginAuthorExecutionContext => ({
    callContext: { source: 'plugin' },
    host: {} as PluginHostFacade,
  })

  describe('createPluginAuthorTransportExecutor', () => {
    it('executes tools', async () => {
      const definition: PluginAuthorDefinition = {
        manifest: { id: 'test-plugin', runtime: 'remote' } as PluginManifest,
        tools: { echo: (params) => params },
      }
      const executor = createPluginAuthorTransportExecutor({
        definition,
        createExecutionContext: createMockContext,
      })
      const result = await executor.executeTool({ toolName: 'echo', params: { msg: 'hi' }, context: { source: 'plugin' } })
      expect(result).toEqual({ msg: 'hi' })
    })

    it('throws for unknown tool', () => {
      const executor = createPluginAuthorTransportExecutor({
        definition: { manifest: { id: 'test', runtime: 'remote' } as PluginManifest },
        createExecutionContext: createMockContext,
      })
      expect(() => executor.executeTool({ toolName: 'unknown', params: {}, context: { source: 'plugin' } })).toThrow('未知的插件工具')
    })

    it('invokes hooks', async () => {
      const hookHandler = vi.fn().mockResolvedValue({ action: 'pass' })
      const executor = createPluginAuthorTransportExecutor({
        definition: { manifest: { id: 'test', runtime: 'remote' } as PluginManifest, hooks: { 'message:received': hookHandler } },
        createExecutionContext: createMockContext,
      })
      const result = await executor.invokeHook({ hookName: 'message:received', payload: { text: 'hi' }, context: { source: 'plugin' } })
      expect(result).toEqual({ action: 'pass' })
    })

    it('returns null for unregistered hook', async () => {
      const executor = createPluginAuthorTransportExecutor({
        definition: { manifest: { id: 'test', runtime: 'remote' } as PluginManifest },
        createExecutionContext: createMockContext,
      })
      const result = await executor.invokeHook({ hookName: 'message:received', payload: {}, context: { source: 'plugin' } })
      expect(result).toBeNull()
    })

    it('invokes routes', async () => {
      const executor = createPluginAuthorTransportExecutor({
        definition: {
          manifest: { id: 'test', runtime: 'remote' } as PluginManifest,
          routes: { 'api/hello': async () => ({ body: { msg: 'hello' } }) },
        },
        createExecutionContext: createMockContext,
      })
      const result = await executor.invokeRoute({ request: { path: '/api/hello/', method: 'GET', headers: {}, query: {}, body: null }, context: { source: 'plugin' } })
      expect(result).toEqual({ body: { msg: 'hello' } })
    })

    it('throws for unknown route', () => {
      const executor = createPluginAuthorTransportExecutor({
        definition: { manifest: { id: 'test', runtime: 'remote' } as PluginManifest },
        createExecutionContext: createMockContext,
      })
      expect(() => executor.invokeRoute({ request: { path: '/unknown', method: 'GET', headers: {}, query: {}, body: null }, context: { source: 'plugin' } })).toThrow('未知的插件 Route')
    })

    describe('governance', () => {
      it('throws reload if not supported', async () => {
        const executor = createPluginAuthorTransportExecutor({
          definition: { manifest: { id: 'test', runtime: 'remote' } as PluginManifest },
          createExecutionContext: createMockContext,
        })
        await expect(executor.reload()).rejects.toThrow('不支持治理动作 reload')
      })

      it('calls reload if supported', async () => {
        const reload = vi.fn().mockResolvedValue(undefined)
        const executor = createPluginAuthorTransportExecutor({
          definition: { manifest: { id: 'test', runtime: 'remote' } as PluginManifest },
          governance: { reload },
          createExecutionContext: createMockContext,
        })
        await executor.reload()
        expect(reload).toHaveBeenCalled()
      })

      it('checkHealth defaults to ok', async () => {
        const executor = createPluginAuthorTransportExecutor({
          definition: { manifest: { id: 'test', runtime: 'remote' } as PluginManifest },
          createExecutionContext: createMockContext,
        })
        const result = await executor.checkHealth()
        expect(result).toEqual({ ok: true })
      })

      it('listSupportedActions returns health-check always', () => {
        const executor = createPluginAuthorTransportExecutor({
          definition: { manifest: { id: 'test', runtime: 'remote' } as PluginManifest },
          createExecutionContext: createMockContext,
        })
        expect(executor.listSupportedActions()).toEqual(['health-check'])
      })

      it('listSupportedActions includes reload/reconnect if handlers exist', () => {
        const executor = createPluginAuthorTransportExecutor({
          definition: { manifest: { id: 'test', runtime: 'remote' } as PluginManifest },
          governance: { reload: vi.fn(), reconnect: vi.fn() },
          createExecutionContext: createMockContext,
        })
        const actions = executor.listSupportedActions()
        expect(actions).toContain('health-check')
        expect(actions).toContain('reload')
        expect(actions).toContain('reconnect')
      })
    })
  })

  describe('createChatBeforeModelHookResult', () => {
    it('appends system prompt', () => {
      const result = createChatBeforeModelHookResult('', 'additional instruction')
      expect(result).toEqual({ action: 'mutate', systemPrompt: 'additional instruction' })
    })

    it('joins with newlines', () => {
      const result = createChatBeforeModelHookResult('be helpful', 'be concise')
      expect(result.systemPrompt).toContain('be helpful')
      expect(result.systemPrompt).toContain('be concise')
    })
  })

  describe('createPassHookResult', () => {
    it('returns pass action', () => expect(createPassHookResult()).toEqual({ action: 'pass' }))
  })

  describe('createSystemPromptMutateResult', () => {
    it('returns mutate with system prompt', () => expect(createSystemPromptMutateResult('be nice')).toEqual({ action: 'mutate', systemPrompt: 'be nice' }))
  })

  describe('createProviderRouterShortCircuitResult', () => {
    it('creates short circuit result', () => {
      const result = createProviderRouterShortCircuitResult({ requestProviderId: 'p1', requestModelId: 'm1' })
      expect(result.action).toBe('short-circuit')
      expect(result.assistantContent).toBeTruthy()
    })
  })

  describe('createProviderRouterMutateResult', () => {
    it('creates mutate result with routing', () => {
      const result = createProviderRouterMutateResult({ shouldRoute: true, targetProviderId: 'p2', targetModelId: 'm2', toolNames: ['t1'] })
      expect(result.action).toBe('mutate')
      expect(result.providerId).toBe('p2')
    })

    it('creates mutate result without routing', () => {
      const result = createProviderRouterMutateResult({ shouldRoute: false, targetProviderId: 'p2', targetModelId: 'm2', toolNames: ['t1'] })
      expect(result.action).toBe('mutate')
      expect(result.providerId).toBeUndefined()
    })
  })

  describe('payload readers', () => {
    it('readPluginHookPayload casts', () => expect(readPluginHookPayload({ key: 'val' })).toEqual({ key: 'val' }))
    it('asChatBeforeModelPayload', () => expect(asChatBeforeModelPayload({ messages: [] })).toBeDefined())
    it('asChatAfterModelPayload', () => expect(asChatAfterModelPayload({ messages: [] })).toBeDefined())
    it('asConversationHistoryRewritePayload', () => expect(asConversationHistoryRewritePayload({ messages: [] })).toBeDefined())
  })
})
