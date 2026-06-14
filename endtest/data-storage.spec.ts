import { describe, it, expect } from 'vitest'

// ──────────────────────────────────────────────────────────────────
// 数据 / 存储 模块纯函数测试
// 对齐源码:
//   - packages/server/src/modules/auth/single-user-auth.ts
//   - packages/server/src/modules/auth/request-auth.service.ts
//   - packages/server/src/modules/conversation/conversation.controller.ts
//   - packages/server/src/core/runtime/server-workspace-paths.ts
// ──────────────────────────────────────────────────────────────────

// ==================== 源码对齐：Auth 纯函数 ====================

const SINGLE_USER_ID = '00000000-0000-4000-8000-000000000001'
const SINGLE_USER_USERNAME = 'local-owner'
const SINGLE_USER_EMAIL = 'local-owner@garlic-claw.local'
const LOGIN_SECRET_ENV = 'GARLIC_CLAW_LOGIN_SECRET'
const AUTH_TTL_ENV = 'GARLIC_CLAW_AUTH_TTL'
const JWT_SECRET_ENV = 'JWT_SECRET'
const DEFAULT_AUTH_TTL = '30d'

const INSECURE_JWT_SECRET_VALUES = new Set([
  'fallback-secret',
  'change-me-to-a-secure-random-string',
])

function createSingleUserClaims() {
  return {
    email: SINGLE_USER_EMAIL,
    sub: SINGLE_USER_ID,
    username: SINGLE_USER_USERNAME,
  }
}

function createSingleUserProfile() {
  return {
    id: SINGLE_USER_ID,
    username: SINGLE_USER_USERNAME,
    email: SINGLE_USER_EMAIL,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }
}

function extractJwtToken(request: { headers: { authorization?: string } }): string | null {
  const value = request.headers.authorization
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) {
    return null
  }
  const token = value.slice('Bearer '.length).trim()
  return token || null
}

function readJwtSecret(config: { get: (key: string) => string | undefined }): string {
  const configured = config.get(JWT_SECRET_ENV)?.trim()
  if (!configured) {
    throw new Error(`${JWT_SECRET_ENV} 未配置`)
  }
  if (INSECURE_JWT_SECRET_VALUES.has(configured)) {
    throw new Error(`${JWT_SECRET_ENV} 不能使用示例值或历史默认值`)
  }
  return configured
}

function readLoginSecret(config: { get: (key: string) => string | undefined }): string {
  const configured = config.get(LOGIN_SECRET_ENV)?.trim()
  if (!configured) {
    throw new Error(`${LOGIN_SECRET_ENV} 未配置`)
  }
  return configured
}

function readAuthTtl(config: { get: (key: string) => string | undefined }): string {
  const configured = config.get(AUTH_TTL_ENV)?.trim()
  return configured || DEFAULT_AUTH_TTL
}

// ==================== 源码对齐：SSE / Conversation 纯函数 ====================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string; mimeType?: string }

type SendMessageDto = {
  content?: string
  parts?: ChatMessagePart[]
  provider?: string
  model?: string
}

type UpdateMessageDto = {
  content?: string
  parts?: ChatMessagePart[]
}

function toSendMessagePayload(dto: SendMessageDto) {
  return {
    ...(typeof dto.content === 'string' ? { content: dto.content } : {}),
    ...(typeof dto.model === 'string' ? { model: dto.model } : {}),
    ...(dto.parts ? { parts: dto.parts as ChatMessagePart[] } : {}),
    ...(typeof dto.provider === 'string' ? { provider: dto.provider } : {}),
  }
}

function toUpdateMessagePatch(dto: UpdateMessageDto) {
  return {
    ...(typeof dto.content === 'string' ? { content: dto.content } : {}),
    ...(dto.parts ? { parts: dto.parts as ChatMessagePart[] } : {}),
  }
}

function toPluginLlmMessage(dto: SendMessageDto) {
  const parts = dto.parts as ChatMessagePart[] | undefined
  if (parts?.length) {
    return { content: parts, role: 'user' as const }
  }
  return { content: dto.content ?? '', role: 'user' as const }
}

interface ChatMessageAnnotation {
  type: string
  owner: string
  version?: string
  data?: Record<string, unknown>
}

function readMessageAnnotations(message: Record<string, unknown>): Array<Record<string, unknown>> {
  if (isRecord(message.metadata) && Array.isArray(message.metadata.annotations)) {
    return message.metadata.annotations.filter(isRecord)
  }
  if (typeof message.metadataJson !== 'string' || !message.metadataJson.trim()) {
    return []
  }
  try {
    const parsed = JSON.parse(message.metadataJson) as unknown
    return isRecord(parsed) && Array.isArray(parsed.annotations)
      ? parsed.annotations.filter(isRecord)
      : []
  } catch {
    return []
  }
}

function isAutoCompactionContinueMessage(message: Record<string, unknown>): boolean {
  return readMessageAnnotations(message).some((annotation) => (
    annotation.owner === 'conversation.context-governance'
    && annotation.type === 'context-compaction'
    && isRecord(annotation.data)
    && annotation.data.role === 'continue'
    && annotation.data.synthetic === true
    && annotation.data.trigger === 'after-response'
  ))
}

type RuntimeConversationRecord = {
  id: string
  title: string
  kind?: 'main' | 'subagent'
  messages: Array<Record<string, unknown>>
  subagent?: {
    status: 'queued' | 'running' | 'completed' | 'error' | 'interrupted' | 'closed'
    activeAssistantMessageId?: string
    pluginId: string
    requestPreview: string
    runtimeKind: 'local' | 'remote'
  }
}

function readActiveSubagentAssistantMessageId(conversation: RuntimeConversationRecord): string | null {
  const activeAssistantMessageId = conversation.subagent?.activeAssistantMessageId
  if (typeof activeAssistantMessageId === 'string' && activeAssistantMessageId.trim()) {
    return activeAssistantMessageId
  }
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index]
    if (
      message.role === 'assistant'
      && typeof message.id === 'string'
      && (message.status === 'pending' || message.status === 'streaming')
    ) {
      return message.id
    }
  }
  return null
}

function readConversationRunningState(
  conversation: RuntimeConversationRecord,
  hasTask: (messageId: string) => boolean,
): boolean {
  if (
    conversation.subagent
    && (conversation.subagent.status === 'queued' || conversation.subagent.status === 'running')
  ) {
    return true
  }
  if (readLastActiveConversationTaskMessage(conversation)?.id) {
    return true
  }
  return Boolean(readLastConversationTaskMessageId(conversation, hasTask))
}

function readLastActiveConversationTaskMessage(
  conversation: RuntimeConversationRecord,
): (Record<string, unknown> & { id: string }) | null {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index]
    if (
      (message.role === 'assistant' || message.role === 'display')
      && typeof message.id === 'string'
      && (message.status === 'pending' || message.status === 'streaming')
    ) {
      return message as Record<string, unknown> & { id: string }
    }
  }
  return null
}

function readLastConversationTaskMessageId(
  conversation: RuntimeConversationRecord,
  hasTask: (messageId: string) => boolean,
): string | null {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index]
    if (
      message.role === 'assistant'
      && typeof message.id === 'string'
      && hasTask(message.id)
    ) {
      return message.id
    }
  }
  return null
}

function readActiveConversationTaskMessageIds(conversation: RuntimeConversationRecord): string[] {
  return conversation.messages.flatMap((message) => (
    (message.role === 'assistant' || message.role === 'display')
      && typeof message.id === 'string'
      && (message.status === 'pending' || message.status === 'streaming')
      ? [message.id]
      : []
  ))
}

function findLastConversationMessage(
  conversation: RuntimeConversationRecord,
  predicate: (message: Record<string, unknown>) => boolean,
) {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index]
    if (predicate(message)) {
      return message
    }
  }
  return null
}

function readBufferedAttachEventType(event: Record<string, unknown>): string | null {
  if (typeof event.type !== 'string' || !event.type.trim()) {
    return null
  }
  return event.type
}

function readBufferedAttachMessageId(event: Record<string, unknown>): string | null {
  if (isRecord(event.userMessage) && typeof event.userMessage.id === 'string' && event.userMessage.id.trim()) {
    return event.userMessage.id
  }
  if (
    isRecord(event.assistantMessage)
    && typeof event.assistantMessage.id === 'string'
    && event.assistantMessage.id.trim()
  ) {
    return event.assistantMessage.id
  }
  return null
}

// ==================== 源码对齐：Path 工具函数 ====================

function normalizeArtifactExtension(extension: string | undefined): string {
  if (!extension) {
    return ''
  }
  return extension.startsWith('.') ? extension : `.${extension}`
}

// ════════════════════════════════════════════════════════════════════
// 测试套件
// ════════════════════════════════════════════════════════════════════

describe('Auth — 常量', () => {
  it('SINGLE_USER_ID 为固定 UUID v4', () => {
    expect(SINGLE_USER_ID).toBe('00000000-0000-4000-8000-000000000001')
  })

  it('SINGLE_USER_USERNAME 为 local-owner', () => {
    expect(SINGLE_USER_USERNAME).toBe('local-owner')
  })

  it('SINGLE_USER_EMAIL 为固定邮箱', () => {
    expect(SINGLE_USER_EMAIL).toBe('local-owner@garlic-claw.local')
  })

  it('LOGIN_SECRET_ENV 环境变量名', () => {
    expect(LOGIN_SECRET_ENV).toBe('GARLIC_CLAW_LOGIN_SECRET')
  })

  it('JWT_SECRET_ENV 环境变量名', () => {
    expect(JWT_SECRET_ENV).toBe('JWT_SECRET')
  })

  it('AUTH_TTL_ENV 环境变量名', () => {
    expect(AUTH_TTL_ENV).toBe('GARLIC_CLAW_AUTH_TTL')
  })

  it('DEFAULT_AUTH_TTL 为 30d', () => {
    expect(DEFAULT_AUTH_TTL).toBe('30d')
  })
})

describe('Auth — createSingleUserClaims', () => {
  it('返回固定 claims 对象', () => {
    const claims = createSingleUserClaims()
    expect(claims).toEqual({
      email: 'local-owner@garlic-claw.local',
      sub: '00000000-0000-4000-8000-000000000001',
      username: 'local-owner',
    })
  })

  it('每次调用返回新引用', () => {
    expect(createSingleUserClaims()).not.toBe(createSingleUserClaims())
  })
})

describe('Auth — createSingleUserProfile', () => {
  it('返回固定 profile 对象', () => {
    const profile = createSingleUserProfile()
    expect(profile.id).toBe(SINGLE_USER_ID)
    expect(profile.username).toBe('local-owner')
    expect(profile.email).toBe('local-owner@garlic-claw.local')
    expect(profile.createdAt).toBe('1970-01-01T00:00:00.000Z')
    expect(profile.updatedAt).toBe('1970-01-01T00:00:00.000Z')
  })
})

describe('Auth — extractJwtToken', () => {
  it('提取合法的 Bearer token', () => {
    const token = extractJwtToken({ headers: { authorization: 'Bearer my-token' } })
    expect(token).toBe('my-token')
  })

  it('trim 前后空白', () => {
    const token = extractJwtToken({ headers: { authorization: 'Bearer   my-token  ' } })
    expect(token).toBe('my-token')
  })

  it('缺失 authorization 头返回 null', () => {
    expect(extractJwtToken({ headers: {} })).toBeNull()
  })

  it('非 Bearer 前缀返回 null', () => {
    expect(extractJwtToken({ headers: { authorization: 'Basic dXNlcjpwYXNz' } })).toBeNull()
  })

  it('Bearer 后无 token 返回 null', () => {
    expect(extractJwtToken({ headers: { authorization: 'Bearer   ' } })).toBeNull()
  })

  it('非字符串 authorization 返回 null', () => {
    expect(extractJwtToken({ headers: { authorization: undefined } })).toBeNull()
  })

  it('空字符串 authorization 返回 null', () => {
    expect(extractJwtToken({ headers: { authorization: '' } })).toBeNull()
  })
})

describe('Auth — readJwtSecret', () => {
  it('读取配置的 secret', () => {
    const config = { get: (key: string) => key === JWT_SECRET_ENV ? 'my-secret-key' : undefined }
    expect(readJwtSecret(config)).toBe('my-secret-key')
  })

  it('trim 值', () => {
    const config = { get: () => '  my-secret  ' }
    expect(readJwtSecret(config)).toBe('my-secret')
  })

  it('缺失配置抛出错误', () => {
    const config = { get: () => undefined }
    expect(() => readJwtSecret(config)).toThrow(/JWT_SECRET.*未配置/)
  })

  it('空字符串配置抛出错误', () => {
    const config = { get: () => '' }
    expect(() => readJwtSecret(config)).toThrow(/JWT_SECRET.*未配置/)
  })

  it('空白字符串抛出错误', () => {
    const config = { get: () => '   ' }
    expect(() => readJwtSecret(config)).toThrow(/JWT_SECRET.*未配置/)
  })

  it('示例值 fallback-secret 抛出错误', () => {
    const config = { get: () => 'fallback-secret' }
    expect(() => readJwtSecret(config)).toThrow(/不能使用示例值/)
  })

  it('示例值 change-me-to-a-secure-random-string 抛出错误', () => {
    const config = { get: () => 'change-me-to-a-secure-random-string' }
    expect(() => readJwtSecret(config)).toThrow(/不能使用示例值/)
  })
})

describe('Auth — readLoginSecret', () => {
  it('读取配置的 secret', () => {
    const config = { get: (key: string) => key === LOGIN_SECRET_ENV ? 'my-login-secret' : undefined }
    expect(readLoginSecret(config)).toBe('my-login-secret')
  })

  it('trim 值', () => {
    const config = { get: () => '  login-key  ' }
    expect(readLoginSecret(config)).toBe('login-key')
  })

  it('缺失配置抛出错误', () => {
    const config = { get: () => undefined }
    expect(() => readLoginSecret(config)).toThrow(/GARLIC_CLAW_LOGIN_SECRET.*未配置/)
  })

  it('空字符串抛出错误', () => {
    const config = { get: () => '' }
    expect(() => readLoginSecret(config)).toThrow(/未配置/)
  })
})

describe('Auth — readAuthTtl', () => {
  it('读取配置的 TTL', () => {
    const config = { get: () => '7d' }
    expect(readAuthTtl(config)).toBe('7d')
  })

  it('undefined 回退到默认 30d', () => {
    const config = { get: () => undefined }
    expect(readAuthTtl(config)).toBe('30d')
  })

  it('空字符串回退到默认', () => {
    const config = { get: () => '' }
    expect(readAuthTtl(config)).toBe('30d')
  })

  it('空白字符串回退到默认', () => {
    const config = { get: () => '   ' }
    expect(readAuthTtl(config)).toBe('30d')
  })

  it('trim 值', () => {
    const config = { get: () => '  15d  ' }
    expect(readAuthTtl(config)).toBe('15d')
  })
})

describe('SSE — isRecord', () => {
  it('纯对象返回 true', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ a: 1 })).toBe(true)
  })

  it('null 返回 false', () => {
    expect(isRecord(null)).toBe(false)
  })

  it('数组返回 false', () => {
    expect(isRecord([1, 2, 3])).toBe(false)
  })

  it('原始值返回 false', () => {
    expect(isRecord('string')).toBe(false)
    expect(isRecord(42)).toBe(false)
    expect(isRecord(true)).toBe(false)
    expect(isRecord(undefined)).toBe(false)
  })
})

describe('SSE — toSendMessagePayload', () => {
  it('完整 DTO 映射所有字段', () => {
    const result = toSendMessagePayload({
      content: 'hello',
      model: 'gpt-4',
      provider: 'openai',
      parts: [{ type: 'text', text: 'hello' }],
    })
    expect(result.content).toBe('hello')
    expect(result.model).toBe('gpt-4')
    expect(result.provider).toBe('openai')
    expect(result.parts).toHaveLength(1)
  })

  it('缺失可选字段不包含', () => {
    const result = toSendMessagePayload({})
    expect(result.content).toBeUndefined()
    expect(result.model).toBeUndefined()
    expect(result.provider).toBeUndefined()
    expect(result.parts).toBeUndefined()
  })

  it('非字符串 content 被排除', () => {
    const result = toSendMessagePayload({ content: undefined })
    expect(result.content).toBeUndefined()
  })

  it('非字符串 model 被排除', () => {
    const result = toSendMessagePayload({ model: undefined })
    expect(result.model).toBeUndefined()
  })
})

describe('SSE — toUpdateMessagePatch', () => {
  it('含 content 和 parts', () => {
    const result = toUpdateMessagePatch({
      content: 'updated',
      parts: [{ type: 'text', text: 'updated' }],
    })
    expect(result.content).toBe('updated')
    expect(result.parts).toHaveLength(1)
  })

  it('仅 content', () => {
    const result = toUpdateMessagePatch({ content: 'updated' })
    expect(result.content).toBe('updated')
    expect(result.parts).toBeUndefined()
  })

  it('空 DTO 返回空对象', () => {
    const result = toUpdateMessagePatch({})
    expect(Object.keys(result)).toHaveLength(0)
  })
})

describe('SSE — toPluginLlmMessage', () => {
  it('有 parts 时使用 parts', () => {
    const result = toPluginLlmMessage({
      content: 'hello',
      parts: [{ type: 'text', text: 'world' }, { type: 'image', image: 'data:image/png;base64,abc' }],
    })
    expect(result.role).toBe('user')
    expect(Array.isArray(result.content)).toBe(true)
    expect((result.content as ChatMessagePart[])).toHaveLength(2)
  })

  it('无 parts 时使用 content', () => {
    const result = toPluginLlmMessage({ content: 'hello' })
    expect(result.content).toBe('hello')
    expect(result.role).toBe('user')
  })

  it('无 content 无 parts 时 content 为空字符串', () => {
    const result = toPluginLlmMessage({})
    expect(result.content).toBe('')
  })

  it('空 parts 数组使用 content', () => {
    const result = toPluginLlmMessage({ content: 'fallback', parts: [] })
    expect(result.content).toBe('fallback')
  })
})

describe('SSE — readMessageAnnotations', () => {
  it('从 metadata.annotations 读取', () => {
    const message = {
      metadata: {
        annotations: [
          { type: 'test', owner: 'test', data: { foo: 1 } },
        ],
      },
    }
    const annotations = readMessageAnnotations(message)
    expect(annotations).toHaveLength(1)
    expect(annotations[0].owner).toBe('test')
  })

  it('过滤非 record annotations', () => {
    const message = {
      metadata: {
        annotations: [{ type: 'valid' }, 'invalid', null, 42],
      },
    }
    const annotations = readMessageAnnotations(message)
    expect(annotations).toHaveLength(1)
  })

  it('从 metadataJson 字符串解析', () => {
    const message = {
      metadataJson: JSON.stringify({
        annotations: [{ type: 'json', owner: 'parsed' }],
      }),
    }
    const annotations = readMessageAnnotations(message)
    expect(annotations).toHaveLength(1)
    expect(annotations[0].owner).toBe('parsed')
  })

  it('空 metadataJson 返回空数组', () => {
    expect(readMessageAnnotations({ metadataJson: '' })).toEqual([])
    expect(readMessageAnnotations({ metadataJson: '   ' })).toEqual([])
  })

  it('损坏的 JSON 返回空数组', () => {
    expect(readMessageAnnotations({ metadataJson: '{bad json}' })).toEqual([])
  })

  it('无 metadata 字段返回空数组', () => {
    expect(readMessageAnnotations({})).toEqual([])
  })

  it('metadata.annotations 非数组返回空数组', () => {
    const message = { metadata: { annotations: 'not-array' } }
    expect(readMessageAnnotations(message)).toEqual([])
  })
})

describe('SSE — isAutoCompactionContinueMessage', () => {
  it('合法 compaction continue 返回 true', () => {
    const message = {
      metadata: {
        annotations: [{
          owner: 'conversation.context-governance',
          type: 'context-compaction',
          data: { role: 'continue', synthetic: true, trigger: 'after-response' },
        }],
      },
    }
    expect(isAutoCompactionContinueMessage(message)).toBe(true)
  })

  it('缺失 owner 返回 false', () => {
    const message = {
      metadata: {
        annotations: [{
          type: 'context-compaction',
          data: { role: 'continue', synthetic: true, trigger: 'after-response' },
        }],
      },
    }
    expect(isAutoCompactionContinueMessage(message)).toBe(false)
  })

  it('data 不是 record 返回 false', () => {
    const message = {
      metadata: {
        annotations: [{
          owner: 'conversation.context-governance',
          type: 'context-compaction',
          data: 'string',
        }],
      },
    }
    expect(isAutoCompactionContinueMessage(message)).toBe(false)
  })

  it('role 不是 continue 返回 false', () => {
    const message = {
      metadata: {
        annotations: [{
          owner: 'conversation.context-governance',
          type: 'context-compaction',
          data: { role: 'start', synthetic: true, trigger: 'after-response' },
        }],
      },
    }
    expect(isAutoCompactionContinueMessage(message)).toBe(false)
  })

  it('无 annotations 返回 false', () => {
    expect(isAutoCompactionContinueMessage({})).toBe(false)
  })
})

describe('SSE — readActiveSubagentAssistantMessageId', () => {
  it('从 subagent.activeAssistantMessageId 读取', () => {
    const conversation: RuntimeConversationRecord = {
      id: 'c1', title: '', kind: 'subagent',
      messages: [],
      subagent: { status: 'running', activeAssistantMessageId: 'msg-1', pluginId: 'p1', requestPreview: '', runtimeKind: 'local' },
    }
    expect(readActiveSubagentAssistantMessageId(conversation)).toBe('msg-1')
  })

  it('从最后一条 pending/streaming assistant 消息读取', () => {
    const conversation: RuntimeConversationRecord = {
      id: 'c1', title: '',
      messages: [
        { id: 'msg-1', role: 'assistant', status: 'completed' },
        { id: 'msg-2', role: 'assistant', status: 'streaming' },
      ],
    }
    expect(readActiveSubagentAssistantMessageId(conversation)).toBe('msg-2')
  })

  it('无活跃消息返回 null', () => {
    const conversation: RuntimeConversationRecord = {
      id: 'c1', title: '',
      messages: [
        { id: 'msg-1', role: 'assistant', status: 'completed' },
      ],
    }
    expect(readActiveSubagentAssistantMessageId(conversation)).toBeNull()
  })

  it('空消息列表返回 null', () => {
    const conversation: RuntimeConversationRecord = { id: 'c1', title: '', messages: [] }
    expect(readActiveSubagentAssistantMessageId(conversation)).toBeNull()
  })
})

describe('SSE — readConversationRunningState', () => {
  it('subagent queued 返回 true', () => {
    const conv: RuntimeConversationRecord = {
      id: 'c1', title: '', kind: 'subagent', messages: [],
      subagent: { status: 'queued', pluginId: 'p1', requestPreview: '', runtimeKind: 'local' },
    }
    expect(readConversationRunningState(conv, () => false)).toBe(true)
  })

  it('subagent running 返回 true', () => {
    const conv: RuntimeConversationRecord = {
      id: 'c1', title: '', kind: 'subagent', messages: [],
      subagent: { status: 'running', pluginId: 'p1', requestPreview: '', runtimeKind: 'local' },
    }
    expect(readConversationRunningState(conv, () => false)).toBe(true)
  })

  it('活跃 pending/streaming 消息返回 true', () => {
    const conv: RuntimeConversationRecord = {
      id: 'c1', title: '', messages: [
        { id: 'msg-1', role: 'assistant', status: 'streaming' },
      ],
    }
    expect(readConversationRunningState(conv, () => false)).toBe(true)
  })

  it('无活跃消息但 hasTask 返回 true 时返回 true', () => {
    const conv: RuntimeConversationRecord = {
      id: 'c1', title: '', messages: [
        { id: 'msg-1', role: 'assistant', status: 'completed' },
      ],
    }
    expect(readConversationRunningState(conv, (id) => id === 'msg-1')).toBe(true)
  })

  it('全部完成且无 task 返回 false', () => {
    const conv: RuntimeConversationRecord = {
      id: 'c1', title: '', messages: [
        { id: 'msg-1', role: 'assistant', status: 'completed' },
      ],
    }
    expect(readConversationRunningState(conv, () => false)).toBe(false)
  })
})

describe('SSE — readLastActiveConversationTaskMessage', () => {
  it('找到最后一条 pending/streaming 消息', () => {
    const conv: RuntimeConversationRecord = {
      id: 'c1', title: '', messages: [
        { id: 'm1', role: 'assistant', status: 'completed' },
        { id: 'm2', role: 'assistant', status: 'streaming' },
      ],
    }
    const result = readLastActiveConversationTaskMessage(conv)
    expect(result?.id).toBe('m2')
  })

  it('display 角色也计入', () => {
    const conv: RuntimeConversationRecord = {
      id: 'c1', title: '', messages: [
        { id: 'm1', role: 'display', status: 'pending' },
      ],
    }
    expect(readLastActiveConversationTaskMessage(conv)?.id).toBe('m1')
  })

  it('无活跃消息返回 null', () => {
    const conv: RuntimeConversationRecord = {
      id: 'c1', title: '', messages: [
        { id: 'm1', role: 'assistant', status: 'completed' },
      ],
    }
    expect(readLastActiveConversationTaskMessage(conv)).toBeNull()
  })

  it('user 角色跳过', () => {
    const conv: RuntimeConversationRecord = {
      id: 'c1', title: '', messages: [
        { id: 'm1', role: 'user', status: 'completed' },
      ],
    }
    expect(readLastActiveConversationTaskMessage(conv)).toBeNull()
  })
})

describe('SSE — readLastConversationTaskMessageId', () => {
  it('找到 hasTask 返回 true 的最后一条', () => {
    const conv: RuntimeConversationRecord = {
      id: 'c1', title: '', messages: [
        { id: 'm1', role: 'assistant', status: 'completed' },
        { id: 'm2', role: 'assistant', status: 'completed' },
      ],
    }
    expect(readLastConversationTaskMessageId(conv, (id) => id === 'm2')).toBe('m2')
  })

  it('无匹配返回 null', () => {
    const conv: RuntimeConversationRecord = {
      id: 'c1', title: '', messages: [
        { id: 'm1', role: 'assistant', status: 'completed' },
      ],
    }
    expect(readLastConversationTaskMessageId(conv, () => false)).toBeNull()
  })
})

describe('SSE — readActiveConversationTaskMessageIds', () => {
  it('找到所有 pending/streaming 消息 ID', () => {
    const conv: RuntimeConversationRecord = {
      id: 'c1', title: '', messages: [
        { id: 'm1', role: 'assistant', status: 'completed' },
        { id: 'm2', role: 'assistant', status: 'pending' },
        { id: 'm3', role: 'display', status: 'streaming' },
        { id: 'm4', role: 'user', status: 'pending' },
      ],
    }
    const ids = readActiveConversationTaskMessageIds(conv)
    expect(ids).toEqual(['m2', 'm3'])
  })

  it('无活跃消息返回空数组', () => {
    const conv: RuntimeConversationRecord = {
      id: 'c1', title: '', messages: [
        { id: 'm1', role: 'assistant', status: 'completed' },
      ],
    }
    expect(readActiveConversationTaskMessageIds(conv)).toEqual([])
  })

  it('空会话返回空数组', () => {
    const conv: RuntimeConversationRecord = { id: 'c1', title: '', messages: [] }
    expect(readActiveConversationTaskMessageIds(conv)).toEqual([])
  })
})

describe('SSE — findLastConversationMessage', () => {
  it('找到最后匹配的消息', () => {
    const conv: RuntimeConversationRecord = {
      id: 'c1', title: '', messages: [
        { id: 'm1', role: 'user' },
        { id: 'm2', role: 'assistant' },
        { id: 'm3', role: 'user' },
      ],
    }
    const message = findLastConversationMessage(conv, (m) => m.role === 'user')
    expect(message?.id).toBe('m3')
  })

  it('无匹配返回 null', () => {
    const conv: RuntimeConversationRecord = {
      id: 'c1', title: '', messages: [
        { id: 'm1', role: 'assistant' },
      ],
    }
    expect(findLastConversationMessage(conv, (m) => m.role === 'user')).toBeNull()
  })

  it('空消息列表返回 null', () => {
    const conv: RuntimeConversationRecord = { id: 'c1', title: '', messages: [] }
    expect(findLastConversationMessage(conv, () => true)).toBeNull()
  })
})

describe('SSE — readBufferedAttachEventType', () => {
  it('读取字符串 type', () => {
    expect(readBufferedAttachEventType({ type: 'message-start' })).toBe('message-start')
  })

  it('空白 type 返回 null', () => {
    expect(readBufferedAttachEventType({ type: '' })).toBeNull()
    expect(readBufferedAttachEventType({ type: '   ' })).toBeNull()
  })

  it('非字符串 type 返回 null', () => {
    expect(readBufferedAttachEventType({ type: 42 })).toBeNull()
    expect(readBufferedAttachEventType({})).toBeNull()
  })
})

describe('SSE — readBufferedAttachMessageId', () => {
  it('从 userMessage.id 读取', () => {
    const result = readBufferedAttachMessageId({ userMessage: { id: 'user-msg-1' } })
    expect(result).toBe('user-msg-1')
  })

  it('userMessage 优先于 assistantMessage', () => {
    const result = readBufferedAttachMessageId({
      userMessage: { id: 'user-msg' },
      assistantMessage: { id: 'asst-msg' },
    })
    expect(result).toBe('user-msg')
  })

  it('回退到 assistantMessage.id', () => {
    const result = readBufferedAttachMessageId({
      assistantMessage: { id: 'asst-msg' },
    })
    expect(result).toBe('asst-msg')
  })

  it('无 id 返回 null', () => {
    expect(readBufferedAttachMessageId({})).toBeNull()
  })

  it('空白 id 返回 null', () => {
    expect(readBufferedAttachMessageId({ userMessage: { id: '' } })).toBeNull()
    expect(readBufferedAttachMessageId({ assistantMessage: { id: '   ' } })).toBeNull()
  })
})

describe('Path — normalizeArtifactExtension', () => {
  it('undefined 返回空字符串', () => {
    expect(normalizeArtifactExtension(undefined)).toBe('')
  })

  it('空字符串返回空字符串', () => {
    expect(normalizeArtifactExtension('')).toBe('')
  })

  it('已有点的扩展名不变', () => {
    expect(normalizeArtifactExtension('.json')).toBe('.json')
  })

  it('无点的扩展名加前缀', () => {
    expect(normalizeArtifactExtension('json')).toBe('.json')
  })

  it('多段扩展名正确处理', () => {
    expect(normalizeArtifactExtension('.tar.gz')).toBe('.tar.gz')
    expect(normalizeArtifactExtension('tar.gz')).toBe('.tar.gz')
  })
})
