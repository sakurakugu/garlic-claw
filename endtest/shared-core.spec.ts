import { describe, it, expect } from 'vitest'
import {
  DEFAULT_AI_CHAT_AUTO_RETRY_CONFIG,
} from '@garlic-claw/shared'
import type {
  JsonValue, JsonObject,
  Role,
  ApiResponse, PaginatedResponse, AuthTokens, LoginRequest, RegisterRequest,
  ApiKeyScope, ApiKeySummary, CreateApiKeyRequest, CreateApiKeyResponse, WriteAssistantMessageRequest, UserInfo,
  ProviderProtocolDriver, AiProviderCatalogDriver, AiProviderCatalogKind,
  AiModelCapabilities, AiModelApiConfig, AiModelConfig, AiModelUsage,
  AiProviderCatalogItem, AiProviderSummary, AiDefaultProviderSelection, AiProviderConfig,
  VisionFallbackConfig, AiModelRouteTarget, AiUtilityModelRole, AiUtilityModelRolesConfig,
  AiChatAutoRetryConfig, AiHostModelRoutingConfig, DiscoveredAiModel, AiProviderConnectionTestResult,
  AutomationActionTargetRef, TriggerConfig, ActionConfig,
  AutomationEventDispatchInfo, AutomationLogInfo, AutomationInfo,
  ChatTextPart, ChatImagePart, ChatMessagePart, ChatMessageStatus, ChatMessageRole,
  ChatVisionFallbackEntrySource, ChatVisionFallbackEntry, ChatVisionFallbackMetadata,
  ChatMessageCustomBlockState, ChatMessageCustomBlockSource,
  ChatMessageTextBlock, ChatMessageJsonBlock, ChatMessageCustomBlock, ChatMessageAnnotation, ChatMessageMetadata,
  ConversationCount, ConversationTodoStatus, ConversationTodoPriority, ConversationKind, ConversationSubagentStatus,
  ConversationSubagentState, ConversationTodoItem, Conversation,
  Message, ChatRetryState, ConversationDetail,
  SSEEvent, SendMessagePayload, UpdateMessagePayload, RetryMessagePayload, ConversationContextWindowPreview,
  RuntimeBackendKind, RuntimeCapabilityName, RuntimeOperationName,
  RuntimePermissionPolicyAction, RuntimePermissionDecision, RuntimePermissionResolution,
  RuntimePermissionRequest, RuntimePermissionReplyResult,
} from '@garlic-claw/shared'

describe('JSON types', () => {
  it('JsonValue accepts all primitive types', () => {
    const values: JsonValue[] = ['string', 42, true, null, [1, 2], { a: 1 }]
    expect(values.length).toBe(6)
  })

  it('JsonObject is a record of string to JsonValue', () => {
    const obj: JsonObject = { name: 'test', count: 42, nested: { key: true } }
    expect(obj.name).toBe('test')
    expect(obj.count).toBe(42)
  })

  it('JsonValue supports nested arrays and objects', () => {
    const data: JsonValue = { list: [1, { a: 2 }, null], flag: false }
    expect(typeof data).toBe('object')
  })
})

describe('Role', () => {
  it('accepts all valid role values', () => {
    const roles: Role[] = ['super_admin', 'admin', 'user', 'ai', 'device']
    expect(roles).toContain('user')
    expect(roles).toContain('ai')
  })
})

describe('API types', () => {
  it('ApiResponse<T> carries success and optional data', () => {
    const res: ApiResponse<string[]> = { success: true, data: ['a', 'b'] }
    expect(res.success).toBe(true)
    expect(res.data).toEqual(['a', 'b'])
  })

  it('ApiResponse can carry an error message', () => {
    const res: ApiResponse = { success: false, message: 'not found' }
    expect(res.message).toBe('not found')
  })

  it('PaginatedResponse<T> includes pagination fields', () => {
    const res: PaginatedResponse<number> = { success: true, data: [1, 2], total: 10, page: 1, pageSize: 2 }
    expect(res.total).toBe(10)
    expect(res.page).toBe(1)
  })

  it('AuthTokens has access and refresh tokens', () => {
    const t: AuthTokens = { accessToken: 'abc', refreshToken: 'def' }
    expect(t.accessToken).toBe('abc')
  })

  it('LoginRequest and RegisterRequest have required fields', () => {
    const login: LoginRequest = { username: 'u', password: 'p' }
    const reg: RegisterRequest = { username: 'u', email: 'e@x.com', password: 'p' }
    expect(login.username).toBe('u')
    expect(reg.email).toBe('e@x.com')
  })

  it('UserInfo has all identity fields', () => {
    const u: UserInfo = { id: '1', username: 'u', email: 'e', role: 'admin', createdAt: '2024-01-01' }
    expect(u.role).toBe('admin')
  })

  it('ApiKeyScope accepts valid scope strings', () => {
    const scopes: ApiKeyScope[] = ['plugin.route.invoke', 'conversation.message.write']
    expect(scopes.length).toBe(2)
  })

  it('ApiKeySummary supports nullable fields', () => {
    const k: ApiKeySummary = {
      id: '1', name: 'key', keyPrefix: 'gc_', scopes: ['plugin.route.invoke'],
      lastUsedAt: null, expiresAt: null, revokedAt: null,
      createdAt: '2024-01-01', updatedAt: '2024-01-01',
    }
    expect(k.lastUsedAt).toBeNull()
    expect(k.revokedAt).toBeNull()
  })

  it('CreateApiKeyResponse extends ApiKeySummary with token', () => {
    const r: CreateApiKeyResponse = {
      id: '1', name: 'k', keyPrefix: 'gc_', scopes: ['plugin.route.invoke'],
      lastUsedAt: null, expiresAt: null, revokedAt: null,
      createdAt: '2024-01-01', updatedAt: '2024-01-01', token: 'secret',
    }
    expect(r.token).toBe('secret')
  })
})

describe('AI types', () => {
  it('ProviderProtocolDriver and AiProviderCatalogDriver share values', () => {
    const drivers: ProviderProtocolDriver[] = ['openai', 'anthropic', 'gemini']
    const cat: AiProviderCatalogDriver = 'openai'
    expect(drivers).toContain(cat)
  })

  it('AiModelCapabilities has text and image flags', () => {
    const caps: AiModelCapabilities = { text: true, image: false }
    expect(caps.text).toBe(true)
  })

  it('AiModelConfig has all required fields', () => {
    const cfg: AiModelConfig = {
      id: 'gpt-4', providerId: 'openai', name: 'GPT-4',
      capabilities: { reasoning: true, toolCall: true, input: { text: true, image: true }, output: { text: true, image: false } },
      contextLength: 8192,
      api: { id: 'gpt-4', url: 'https://api.openai.com', npm: '@ai-sdk/openai' },
    }
    expect(cfg.contextLength).toBe(8192)
    expect(cfg.capabilities.reasoning).toBe(true)
  })

  it('AiModelUsage distinguishes source', () => {
    const est: AiModelUsage = { inputTokens: 10, outputTokens: 20, totalTokens: 30, source: 'estimated' }
    const prov: AiModelUsage = { inputTokens: 10, cachedInputTokens: 5, outputTokens: 20, totalTokens: 30, source: 'provider' }
    expect(est.source).toBe('estimated')
    expect(prov.cachedInputTokens).toBe(5)
  })

  it('AiProviderCatalogItem is well-formed', () => {
    const item: AiProviderCatalogItem = {
      id: 'openai', kind: 'core', protocol: 'openai', name: 'OpenAI',
      defaultBaseUrl: 'https://api.openai.com', defaultModel: 'gpt-4',
    }
    expect(item.defaultBaseUrl).toBe('https://api.openai.com')
  })

  it('AiProviderSummary has modelCount', () => {
    const s: AiProviderSummary = { id: 'o', name: 'O', driver: 'openai', modelCount: 10, available: true }
    expect(s.modelCount).toBe(10)
  })

  it('VisionFallbackConfig has optional fields', () => {
    const v: VisionFallbackConfig = { enabled: true }
    expect(v.enabled).toBe(true)
    expect(v.providerId).toBeUndefined()
  })

  it('AiUtilityModelRole is a discriminated union', () => {
    const roles: AiUtilityModelRole[] = ['conversationTitle', 'pluginGenerateText']
    expect(roles).toContain('conversationTitle')
  })

  it('AiHostModelRoutingConfig has fallbackChatModels array', () => {
    const cfg: AiHostModelRoutingConfig = {
      fallbackChatModels: [{ providerId: 'o', modelId: 'gpt-4' }],
      utilityModelRoles: {},
    }
    expect(cfg.fallbackChatModels.length).toBe(1)
  })

  it('DEFAULT_AI_CHAT_AUTO_RETRY_CONFIG values are as expected', () => {
    expect(DEFAULT_AI_CHAT_AUTO_RETRY_CONFIG.enabled).toBe(true)
    expect(DEFAULT_AI_CHAT_AUTO_RETRY_CONFIG.maxRetries).toBe(2)
    expect(DEFAULT_AI_CHAT_AUTO_RETRY_CONFIG.initialDelayMs).toBe(2000)
    expect(DEFAULT_AI_CHAT_AUTO_RETRY_CONFIG.maxDelayMs).toBe(30000)
    expect(DEFAULT_AI_CHAT_AUTO_RETRY_CONFIG.backoffFactor).toBe(2)
  })
})

describe('Automation types', () => {
  it('TriggerConfig discriminates on type', () => {
    const cron: TriggerConfig = { type: 'cron', cron: '0 * * * *' }
    const ev: TriggerConfig = { type: 'event', event: 'file.change' }
    const manual: TriggerConfig = { type: 'manual' }
    expect(cron.type).toBe('cron')
    expect(ev.event).toBe('file.change')
    expect(manual.type).toBe('manual')
  })

  it('AutomationInfo has all scheduling fields', () => {
    const a: AutomationInfo = {
      id: '1', name: 'backup',
      trigger: { type: 'cron', cron: '0 0 * * *' },
      actions: [{ type: 'device_command', sourceKind: 'internal', plugin: 'fs', capability: 'copy', params: { src: '/a', dst: '/b' } }],
      enabled: true, lastRunAt: null, createdAt: '2024-01-01', updatedAt: '2024-01-01',
    }
    expect(a.actions[0].type).toBe('device_command')
    expect(a.enabled).toBe(true)
  })
})

describe('Chat types', () => {
  it('ChatMessagePart is discriminated by type', () => {
    const text: ChatMessagePart = { type: 'text', text: 'hello' }
    const img: ChatMessagePart = { type: 'image', image: 'data:...', mimeType: 'image/png' }
    expect(text.type).toBe('text')
    expect(img.type).toBe('image')
  })

  it('ChatMessageStatus and ChatMessageRole accept defined values', () => {
    const statuses: ChatMessageStatus[] = ['pending', 'streaming', 'completed', 'stopped', 'error']
    const roles: ChatMessageRole[] = ['assistant', 'user', 'system', 'display']
    expect(statuses).toContain('streaming')
    expect(roles).toContain('display')
  })

  it('ChatMessageCustomBlock is discriminated by kind', () => {
    const tb: ChatMessageCustomBlock = { id: '1', title: 'T', kind: 'text', text: 'content' }
    const jb: ChatMessageCustomBlock = { id: '2', title: 'J', kind: 'json', data: { key: 'val' } }
    expect(tb.kind).toBe('text')
    expect(jb.kind).toBe('json')
  })

  it('ChatMessageAnnotation has owner and version', () => {
    const a: ChatMessageAnnotation = { type: 'test', owner: 'plugin-x', version: '1.0' }
    expect(a.owner).toBe('plugin-x')
  })

  it('SSEEvent union discriminates on type', () => {
    const ev1: SSEEvent = { type: 'message-start', assistantMessage: { id: '1', role: 'assistant', content: 'hi', partsJson: null, toolCalls: null, toolResults: null, metadataJson: null, provider: null, model: null, status: 'completed', error: null, createdAt: '', updatedAt: '' } }
    const ev2: SSEEvent = { type: 'finish', messageId: '1', status: 'completed' }
    const ev3: SSEEvent = { type: 'error', error: 'fail' }
    expect(ev1.type).toBe('message-start')
    expect(ev2.status).toBe('completed')
    expect(ev3.error).toBe('fail')
  })

  it('SSEEvent - all variants construct correctly', () => {
    const msg: Message = { id: '1', role: 'assistant', content: 'hi', partsJson: null, toolCalls: null, toolResults: null, metadataJson: null, provider: null, model: null, status: 'completed', error: null, createdAt: '', updatedAt: '' }

    const variants: SSEEvent[] = [
      { type: 'message-start', assistantMessage: msg },
      { type: 'status', messageId: '1', status: 'streaming' },
      { type: 'retry', messageId: '1', attempt: 1, message: 'retry', next: 5000 },
      { type: 'text-delta', messageId: '1', text: 'hi' },
      { type: 'tool-call', messageId: '1', toolCallId: 'tc1', toolName: 'read', input: {} },
      { type: 'tool-result', messageId: '1', toolCallId: 'tc1', toolName: 'read', output: { ok: true } },
      { type: 'message-patch', messageId: '1', content: 'new' },
      { type: 'message-metadata', messageId: '1', metadata: {} },
      { type: 'todo-updated', conversationId: 'c1', todos: [{ content: 'do it', status: 'pending', priority: 'high' }] },
      { type: 'permission-request', messageId: '1', request: { id: 'r1', conversationId: 'c1', backendKind: 'pwsh', toolName: 'read', operations: ['file.read'], createdAt: '', summary: 'read' } },
      { type: 'permission-resolved', messageId: '1', result: { requestId: 'r1', resolution: 'approved' } },
      { type: 'finish', messageId: '1', status: 'completed' },
      { type: 'error', error: 'fail' },
    ]
    expect(variants.length).toBe(13)
  })

  it('Conversation has optional subagent state', () => {
    const conv: Conversation = { id: '1', title: 'test', createdAt: '', updatedAt: '' }
    expect(conv.subagent).toBeUndefined()
  })

  it('ConversationSubagentState has all runtime fields', () => {
    const s: ConversationSubagentState = {
      pluginId: 'p1', runtimeKind: 'local', status: 'running', requestPreview: '...',
      requestedAt: '', startedAt: null, finishedAt: null, closedAt: null,
    }
    expect(s.runtimeKind).toBe('local')
    expect(s.status).toBe('running')
  })

  it('ConversationDetail extends Conversation with messages', () => {
    const msg: Message = { id: '1', role: 'user', content: 'hi', partsJson: null, toolCalls: null, toolResults: null, metadataJson: null, provider: null, model: null, status: 'completed', error: null, createdAt: '', updatedAt: '' }
    const d: ConversationDetail = { id: '1', title: 't', createdAt: '', updatedAt: '', messages: [msg] }
    expect(d.messages[0].role).toBe('user')
  })

  it('ConversationContextWindowPreview has strategy union', () => {
    const sliding: ConversationContextWindowPreview = { enabled: true, strategy: 'sliding', includedMessageIds: [], excludedMessageIds: [], estimatedTokens: 0, source: 'estimated', contextLength: 8192, keepRecentMessages: 10, frontendMessageWindowSize: 50, slidingWindowUsagePercent: 80 }
    expect(sliding.strategy).toBe('sliding')
  })
})

describe('Runtime Permission types', () => {
  it('RuntimePermissionPolicyAction accepts allow/ask/deny', () => {
    const actions: RuntimePermissionPolicyAction[] = ['allow', 'ask', 'deny']
    expect(actions).toContain('ask')
  })

  it('RuntimePermissionDecision accepts once/always/reject', () => {
    const d: RuntimePermissionDecision[] = ['once', 'always', 'reject']
    expect(d).toContain('once')
  })

  it('RuntimePermissionRequest has all fields', () => {
    const req: RuntimePermissionRequest = {
      id: 'r1', conversationId: 'c1', backendKind: 'pwsh', toolName: 'read',
      operations: ['file.read'], createdAt: '', summary: 'read file',
    }
    expect(req.operations).toContain('file.read')
  })

  it('RuntimePermissionReplyResult ties requestId to resolution', () => {
    const r: RuntimePermissionReplyResult = { requestId: 'r1', resolution: 'approved' }
    expect(r.resolution).toBe('approved')
  })
})
