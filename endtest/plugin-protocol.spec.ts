import { describe, it, expect } from 'vitest'

// ============================================================================
// 1. WS_TYPE / WS_ACTION 常量一致性
// ============================================================================

const WS_TYPE = {
  AUTH: 'auth',
  PLUGIN: 'plugin',
  COMMAND: 'command',
  HEARTBEAT: 'heartbeat',
  ERROR: 'error',
} as const

const WS_ACTION = {
  AUTHENTICATE: 'authenticate',
  AUTH_OK: 'auth_ok',
  AUTH_FAIL: 'auth_fail',
  REGISTER: 'register',
  REGISTER_OK: 'register_ok',
  UNREGISTER: 'unregister',
  STATUS: 'status',
  EXECUTE: 'execute',
  EXECUTE_RESULT: 'execute_result',
  EXECUTE_ERROR: 'execute_error',
  HOOK_INVOKE: 'hook_invoke',
  HOOK_RESULT: 'hook_result',
  HOOK_ERROR: 'hook_error',
  ROUTE_INVOKE: 'route_invoke',
  ROUTE_RESULT: 'route_result',
  ROUTE_ERROR: 'route_error',
  HOST_CALL: 'host_call',
  HOST_RESULT: 'host_result',
  HOST_ERROR: 'host_error',
  PING: 'ping',
  PONG: 'pong',
} as const

const SERVER_WS_TYPE = {
  AUTH: 'auth',
  PLUGIN: 'plugin',
  COMMAND: 'command',
  HEARTBEAT: 'heartbeat',
  ERROR: 'error',
} as const

const SERVER_WS_ACTION = {
  AUTHENTICATE: 'authenticate',
  AUTH_OK: 'auth_ok',
  AUTH_FAIL: 'auth_fail',
  REGISTER: 'register',
  REGISTER_OK: 'register_ok',
  UNREGISTER: 'unregister',
  STATUS: 'status',
  EXECUTE: 'execute',
  EXECUTE_RESULT: 'execute_result',
  EXECUTE_ERROR: 'execute_error',
  HOOK_INVOKE: 'hook_invoke',
  HOOK_RESULT: 'hook_result',
  HOOK_ERROR: 'hook_error',
  ROUTE_INVOKE: 'route_invoke',
  ROUTE_RESULT: 'route_result',
  ROUTE_ERROR: 'route_error',
  HOST_CALL: 'host_call',
  HOST_RESULT: 'host_result',
  HOST_ERROR: 'host_error',
  PING: 'ping',
  PONG: 'pong',
} as const

describe('Plugin Protocol — WS_TYPE 常量', () => {
  it('WS_TYPE 包含 5 个类型', () => {
    const keys = Object.keys(WS_TYPE)
    expect(keys).toEqual(['AUTH', 'PLUGIN', 'COMMAND', 'HEARTBEAT', 'ERROR'])
  })

  it('所有 WS_TYPE 值均为小写字符串', () => {
    for (const value of Object.values(WS_TYPE)) {
      expect(typeof value).toBe('string')
      expect(value).toEqual(value.toLowerCase())
    }
  })

  it('客户端与服务端 WS_TYPE 完全一致', () => {
    expect(WS_TYPE).toEqual(SERVER_WS_TYPE)
  })
})

describe('Plugin Protocol — WS_ACTION 常量', () => {
  it('WS_ACTION 包含 21 个动作', () => {
    const keys = Object.keys(WS_ACTION)
    expect(keys).toHaveLength(21)
    expect(keys).toContain('AUTHENTICATE')
    expect(keys).toContain('AUTH_OK')
    expect(keys).toContain('REGISTER')
    expect(keys).toContain('EXECUTE')
    expect(keys).toContain('HOOK_INVOKE')
    expect(keys).toContain('ROUTE_INVOKE')
    expect(keys).toContain('HOST_CALL')
    expect(keys).toContain('PING')
    expect(keys).toContain('PONG')
  })

  it('所有 WS_ACTION 值均为小写 snake_case', () => {
    const snakeCase = /^[a-z]+(_[a-z]+)*$/
    for (const value of Object.values(WS_ACTION)) {
      expect(value).toMatch(snakeCase)
    }
  })

  it('客户端与服务端 WS_ACTION 完全一致', () => {
    expect(WS_ACTION).toEqual(SERVER_WS_ACTION)
  })

  it('认证类动作命名规范', () => {
    expect(WS_ACTION.AUTHENTICATE).toBe('authenticate')
    expect(WS_ACTION.AUTH_OK).toBe('auth_ok')
    expect(WS_ACTION.AUTH_FAIL).toBe('auth_fail')
  })

  it('执行类动作命名规范', () => {
    expect(WS_ACTION.EXECUTE).toBe('execute')
    expect(WS_ACTION.EXECUTE_RESULT).toBe('execute_result')
    expect(WS_ACTION.EXECUTE_ERROR).toBe('execute_error')
  })
})

// ============================================================================
// 2. WsMessage 结构
// ============================================================================

interface WsMessage<T = unknown> {
  type: string
  action: string
  payload: T
  requestId?: string
}

describe('Plugin Protocol — WsMessage 结构', () => {
  it('构造最小 WsMessage (无 requestId)', () => {
    const msg: WsMessage<string> = { type: 'plugin', action: 'execute', payload: 'data' }
    expect(msg.type).toBe('plugin')
    expect(msg.action).toBe('execute')
    expect(msg.payload).toBe('data')
    expect(msg.requestId).toBeUndefined()
  })

  it('构造 WsMessage 带 requestId', () => {
    const msg: WsMessage = { type: 'command', action: 'execute_result', payload: { data: 'ok' }, requestId: 'req-001' }
    expect(msg.requestId).toBe('req-001')
  })

  it('payload 可以是任意 JsonValue', () => {
    const tests: WsMessage[] = [
      { type: 'auth', action: 'authenticate', payload: { pluginName: 'test' } },
      { type: 'command', action: 'execute', payload: null },
      { type: 'heartbeat', action: 'ping', payload: {} },
      { type: 'error', action: 'auth_fail', payload: 'error message' },
    ]
    for (const msg of tests) {
      expect(msg).toHaveProperty('type')
      expect(msg).toHaveProperty('action')
      expect(msg).toHaveProperty('payload')
    }
  })

  it('JSON 序列化与反序列化', () => {
    const original: WsMessage = { type: 'plugin', action: 'register', payload: { manifest: { id: 'p1' } }, requestId: 'r1' }
    const json = JSON.stringify(original)
    const parsed = JSON.parse(json) as WsMessage
    expect(parsed.type).toBe('plugin')
    expect(parsed.action).toBe('register')
    expect(parsed.requestId).toBe('r1')
    expect(parsed.payload).toEqual({ manifest: { id: 'p1' } })
  })
})

// ============================================================================
// 3. 服务端协议解析 — readAuthPayload
// ============================================================================

type PluginRemoteEnvironment = 'api' | 'iot'
interface AuthPayload {
  accessKey?: string | null
  pluginName: string
  remoteEnvironment: PluginRemoteEnvironment
}

function readAuthPayload(value: unknown): AuthPayload {
  const invalidMessage = '无效的认证负载'
  const record = readRecord(value, invalidMessage)
  if (
    typeof record.pluginName !== 'string'
    || (record.accessKey !== undefined && record.accessKey !== null && typeof record.accessKey !== 'string')
    || (record.remoteEnvironment !== 'api' && record.remoteEnvironment !== 'iot')
  ) {
    throw new Error(invalidMessage)
  }
  return {
    ...(typeof record.accessKey === 'string' || record.accessKey === null ? { accessKey: record.accessKey } : {}),
    pluginName: record.pluginName,
    remoteEnvironment: record.remoteEnvironment,
  }
}

function readRecord(value: unknown, invalidMessage: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(invalidMessage)
  return value as Record<string, unknown>
}

describe('Server Protocol — readAuthPayload', () => {
  it('解析合法认证负载 (含 accessKey)', () => {
    const result = readAuthPayload({ pluginName: 'plugin-pc', accessKey: 'sk-123', remoteEnvironment: 'api' })
    expect(result.pluginName).toBe('plugin-pc')
    expect(result.accessKey).toBe('sk-123')
    expect(result.remoteEnvironment).toBe('api')
  })

  it('解析合法认证负载 (accessKey 为 null)', () => {
    const result = readAuthPayload({ pluginName: 'test', accessKey: null, remoteEnvironment: 'api' })
    expect(result.accessKey).toBeNull()
  })

  it('解析合法认证负载 (无 accessKey)', () => {
    const result = readAuthPayload({ pluginName: 'test', remoteEnvironment: 'iot' })
    expect(result.accessKey).toBeUndefined()
  })

  it('拒绝缺少 pluginName', () => {
    expect(() => readAuthPayload({ remoteEnvironment: 'api' })).toThrow('无效的认证负载')
  })

  it('拒绝非字符串 pluginName', () => {
    expect(() => readAuthPayload({ pluginName: 123, remoteEnvironment: 'api' })).toThrow('无效的认证负载')
  })

  it('拒绝非法 remoteEnvironment', () => {
    expect(() => readAuthPayload({ pluginName: 'test', remoteEnvironment: 'invalid' })).toThrow('无效的认证负载')
  })

  it('拒绝非字符串 accessKey', () => {
    expect(() => readAuthPayload({ pluginName: 'test', accessKey: 123, remoteEnvironment: 'api' })).toThrow('无效的认证负载')
  })

  it('拒绝 null 输入', () => {
    expect(() => readAuthPayload(null)).toThrow('无效的认证负载')
  })

  it('拒绝数组输入', () => {
    expect(() => readAuthPayload([])).toThrow('无效的认证负载')
  })

  it('接受 iot 环境', () => {
    const result = readAuthPayload({ pluginName: 'iot-device', remoteEnvironment: 'iot' })
    expect(result.remoteEnvironment).toBe('iot')
  })
})

// ============================================================================
// 4. 服务端协议解析 — readHostCallPayload
// ============================================================================

interface HostCallPayload {
  method: string
  params: Record<string, unknown>
  context?: Record<string, unknown>
}

function readHostCallPayload(value: unknown): HostCallPayload {
  const record = readRecord(value, '无效的 Host API 调用负载')
  if (typeof record.method !== 'string' || !isRecord(record.params)) {
    throw new Error('无效的 Host API 调用负载')
  }
  return {
    ...(record.context ? { context: record.context as HostCallPayload['context'] } : {}),
    method: record.method as HostCallPayload['method'],
    params: record.params as Record<string, unknown>,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

describe('Server Protocol — readHostCallPayload', () => {
  it('解析合法 Host 调用负载 (含 context)', () => {
    const result = readHostCallPayload({
      method: 'llm.generate',
      params: { providerId: 'openai', modelId: 'gpt-4' },
      context: { source: 'plugin' },
    })
    expect(result.method).toBe('llm.generate')
    expect(result.params.providerId).toBe('openai')
    expect(result.context).toEqual({ source: 'plugin' })
  })

  it('解析合法 Host 调用负载 (无 context)', () => {
    const result = readHostCallPayload({
      method: 'conversation.get',
      params: {},
    })
    expect(result.method).toBe('conversation.get')
    expect(result.context).toBeUndefined()
  })

  it('拒绝非字符串 method', () => {
    expect(() => readHostCallPayload({ method: 123, params: {} })).toThrow('无效的 Host API 调用负载')
  })

  it('拒绝非对象 params', () => {
    expect(() => readHostCallPayload({ method: 'test', params: 'string' })).toThrow('无效的 Host API 调用负载')
  })

  it('拒绝非对象输入', () => {
    expect(() => readHostCallPayload('string')).toThrow('无效的 Host API 调用负载')
  })

  it('接受空 params', () => {
    const result = readHostCallPayload({ method: 'ping', params: {} })
    expect(result.params).toEqual({})
  })

  it('context 可含多个字段', () => {
    const result = readHostCallPayload({
      method: 'm',
      params: {},
      context: { source: 'chat-tool', userId: 'u1', conversationId: 'c1' },
    })
    expect(result.context).toHaveProperty('source')
    expect(result.context).toHaveProperty('userId')
    expect(result.context).toHaveProperty('conversationId')
  })
})

// ============================================================================
// 5. 服务端协议解析 — readRegisterPayload
// ============================================================================

interface RegisterPayload {
  manifest: Record<string, unknown>
}

function readRegisterPayload(value: unknown): RegisterPayload {
  const record = readRecord(value, '无效的插件注册负载')
  if (!('manifest' in record) || !isRecord(record.manifest)) {
    throw new Error('无效的插件注册负载')
  }
  return { manifest: record.manifest as Record<string, unknown> }
}

describe('Server Protocol — readRegisterPayload', () => {
  it('解析合法注册负载', () => {
    const result = readRegisterPayload({ manifest: { id: 'p1', name: 'Test', version: '1.0', runtime: 'remote', permissions: [], tools: [] } })
    expect(result.manifest.id).toBe('p1')
    expect(result.manifest.name).toBe('Test')
  })

  it('拒绝缺少 manifest', () => {
    expect(() => readRegisterPayload({})).toThrow('无效的插件注册负载')
  })

  it('拒绝非对象 manifest', () => {
    expect(() => readRegisterPayload({ manifest: 'string' })).toThrow('无效的插件注册负载')
  })

  it('拒绝 null 输入', () => {
    expect(() => readRegisterPayload(null)).toThrow('无效的插件注册负载')
  })
})

// ============================================================================
// 6. 服务端协议解析 — readWsMessage
// ============================================================================

function readWsMessage(raw: string): WsMessage {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('无效的 JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
    || !('type' in (parsed as Record<string, unknown>))
    || !('action' in (parsed as Record<string, unknown>))
    || !('payload' in (parsed as Record<string, unknown>))) {
    throw new Error('无效的插件协议消息')
  }
  return parsed as WsMessage
}

describe('Server Protocol — readWsMessage', () => {
  it('解析合法 JSON 消息', () => {
    const raw = JSON.stringify({ type: 'plugin', action: 'register', payload: { manifest: {} } })
    const msg = readWsMessage(raw)
    expect(msg.type).toBe('plugin')
    expect(msg.action).toBe('register')
    expect(msg.payload).toEqual({ manifest: {} })
  })

  it('解析带 requestId 的消息', () => {
    const raw = JSON.stringify({ type: 'command', action: 'execute_result', payload: { data: 'ok' }, requestId: 'req-1' })
    const msg = readWsMessage(raw)
    expect(msg.requestId).toBe('req-1')
  })

  it('解析 heartbeart ping', () => {
    const raw = JSON.stringify({ type: 'heartbeat', action: 'ping', payload: {} })
    const msg = readWsMessage(raw)
    expect(msg.type).toBe('heartbeat')
    expect(msg.action).toBe('ping')
  })

  it('拒绝非法 JSON', () => {
    expect(() => readWsMessage('not json')).toThrow('无效的 JSON')
  })

  it('拒绝缺少 type', () => {
    expect(() => readWsMessage(JSON.stringify({ action: 'test', payload: {} }))).toThrow('无效的插件协议消息')
  })

  it('拒绝缺少 action', () => {
    expect(() => readWsMessage(JSON.stringify({ type: 'plugin', payload: {} }))).toThrow('无效的插件协议消息')
  })

  it('拒绝缺少 payload', () => {
    expect(() => readWsMessage(JSON.stringify({ type: 'plugin', action: 'test' }))).toThrow('无效的插件协议消息')
  })

  it('拒绝数组根节点', () => {
    expect(() => readWsMessage(JSON.stringify([{ type: 'plugin', action: 'test', payload: {} }]))).toThrow('无效的插件协议消息')
  })
})

// ============================================================================
// 7. 服务端协议解析 — readRemoteSettlement
// ============================================================================

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue }

const SETTLE_KEY_MAP: Record<string, { errorMsg: string }> = {
  'command:execute_result': { errorMsg: '无效的远程命令返回负载' },
  'command:execute_error': { errorMsg: '无效的远程命令错误负载' },
  'plugin:hook_result': { errorMsg: '无效的 Hook 返回负载' },
  'plugin:route_result': { errorMsg: '无效的插件 Route 返回负载' },
  'plugin:hook_error': { errorMsg: '无效的 Hook 错误负载' },
  'plugin:route_error': { errorMsg: '无效的插件 Route 错误负载' },
}

function readRemoteSettlement(message: WsMessage):
  | { missingRequestId: true }
  | { settlement: { error?: string; requestId: string; result?: JsonValue } }
  | null {
  const key = `${message.type}:${message.action}`
  if (!SETTLE_KEY_MAP[key]) return null
  if (typeof message.requestId !== 'string' || message.requestId.length === 0) {
    return { missingRequestId: true }
  }
  const payload = message.payload as Record<string, unknown>
  if (message.action === 'execute_error' || message.action === 'hook_error' || message.action === 'route_error') {
    const error = typeof payload.error === 'string' ? payload.error : String(payload)
    return { settlement: { error, requestId: message.requestId } }
  }
  if (message.action === 'route_result') {
    const data = payload.data as Record<string, unknown> | undefined
    if (!data || typeof data.status !== 'number' || !('body' in data)) {
      return { settlement: { error: SETTLE_KEY_MAP[key].errorMsg, requestId: message.requestId } }
    }
    return { settlement: { requestId: message.requestId, result: payload as JsonValue } }
  }
  return { settlement: { requestId: message.requestId, result: payload as JsonValue } }
}

describe('Server Protocol — readRemoteSettlement', () => {
  it('识别 execute_result 并返回 settlement', () => {
    const result = readRemoteSettlement({
      type: 'command', action: 'execute_result',
      payload: { data: 'ok' }, requestId: 'r1',
    })
    expect(result).not.toBeNull()
    if (result && 'settlement' in result) {
      expect(result.settlement.requestId).toBe('r1')
    }
  })

  it('识别 hook_error 并返回错误', () => {
    const result = readRemoteSettlement({
      type: 'plugin', action: 'hook_error',
      payload: { error: 'something failed' }, requestId: 'r2',
    })
    expect(result).not.toBeNull()
    if (result && 'settlement' in result) {
      expect(result.settlement.error).toBe('something failed')
    }
  })

  it('识别 route_result 并返回 settlement', () => {
    const result = readRemoteSettlement({
      type: 'plugin', action: 'route_result',
      payload: { data: { status: 200, body: { ok: true } } }, requestId: 'r3',
    })
    expect(result).not.toBeNull()
    if (result && 'settlement' in result) {
      expect(result.settlement.requestId).toBe('r3')
    }
  })

  it('缺失 requestId 时返回 missingRequestId', () => {
    const result = readRemoteSettlement({
      type: 'command', action: 'execute_result',
      payload: { data: 'ok' },
    })
    expect(result).toEqual({ missingRequestId: true })
  })

  it('空字符串 requestId 时返回 missingRequestId', () => {
    const result = readRemoteSettlement({
      type: 'command', action: 'execute_result',
      payload: { data: 'ok' }, requestId: '',
    })
    expect(result).toEqual({ missingRequestId: true })
  })

  it('不认识的 type:action 返回 null', () => {
    const result = readRemoteSettlement({
      type: 'unknown', action: 'unknown',
      payload: {}, requestId: 'r4',
    })
    expect(result).toBeNull()
  })

  it('ping/pong 返回 null', () => {
    expect(readRemoteSettlement({ type: 'heartbeat', action: 'ping', payload: {}, requestId: 'r5' })).toBeNull()
    expect(readRemoteSettlement({ type: 'heartbeat', action: 'pong', payload: {}, requestId: 'r6' })).toBeNull()
  })
})

// ============================================================================
// 8. 客户端 Payload 辅助 — isChatMessagePartArray
// ============================================================================

type ChatMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: string; mimeType?: string }

function isChatMessagePartArray(value: unknown): value is ChatMessagePart[] {
  return Array.isArray(value) && value.every((part) => {
    if (typeof part !== 'object' || part === null || typeof part.type !== 'string') return false
    if (part.type === 'text') return typeof part.text === 'string'
    if (part.type === 'image') return typeof part.image === 'string' && (!('mimeType' in part) || typeof part.mimeType === 'string')
    return false
  })
}

describe('Client Payload — isChatMessagePartArray', () => {
  it('接受 text part 数组', () => {
    const parts = [{ type: 'text', text: 'hello' }]
    expect(isChatMessagePartArray(parts)).toBe(true)
  })

  it('接受 image part 数组', () => {
    const parts = [{ type: 'image', image: 'data:image/png;base64,...' }]
    expect(isChatMessagePartArray(parts)).toBe(true)
  })

  it('接受 image part 含 mimeType', () => {
    const parts = [{ type: 'image', image: 'data:...', mimeType: 'image/png' }]
    expect(isChatMessagePartArray(parts)).toBe(true)
  })

  it('接受混合数组', () => {
    const parts = [
      { type: 'text', text: 'hello' },
      { type: 'image', image: 'data:...' },
    ]
    expect(isChatMessagePartArray(parts)).toBe(true)
  })

  it('拒绝非数组', () => {
    expect(isChatMessagePartArray(null)).toBe(false)
    expect(isChatMessagePartArray('string')).toBe(false)
    expect(isChatMessagePartArray({})).toBe(false)
  })

  it('拒绝空数组', () => {
    expect(isChatMessagePartArray([])).toBe(true)
  })

  it('拒绝缺少 text 字段的 text part', () => {
    expect(isChatMessagePartArray([{ type: 'text' }])).toBe(false)
  })

  it('拒绝缺少 image 字段的 image part', () => {
    expect(isChatMessagePartArray([{ type: 'image' }])).toBe(false)
  })

  it('拒绝无效类型', () => {
    expect(isChatMessagePartArray([{ type: 'unknown', data: 'x' }])).toBe(false)
  })

  it('拒绝非对象元素', () => {
    expect(isChatMessagePartArray(['string'])).toBe(false)
    expect(isChatMessagePartArray([null])).toBe(false)
  })
})

// ============================================================================
// 9. 客户端 Payload 辅助 — isPluginLlmMessageArray
// ============================================================================

type PluginLlmMessage = { role: 'user' | 'assistant' | 'system' | 'tool'; content: string | ChatMessagePart[] }

function isPluginLlmMessageArray(value: unknown): value is PluginLlmMessage[] {
  return Array.isArray(value) && value.every((message) => {
    if (typeof message !== 'object' || message === null) return false
    const msg = message as Record<string, unknown>
    if (typeof msg.role !== 'string' || !['user', 'assistant', 'system', 'tool'].includes(msg.role)) return false
    return typeof msg.content === 'string' || isChatMessagePartArray(msg.content)
  })
}

describe('Client Payload — isPluginLlmMessageArray', () => {
  it('接受含字符串 content 的消息', () => {
    const msgs = [{ role: 'user', content: 'hello' }]
    expect(isPluginLlmMessageArray(msgs)).toBe(true)
  })

  it('接受含 parts content 的消息', () => {
    const msgs = [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]
    expect(isPluginLlmMessageArray(msgs)).toBe(true)
  })

  it('接受所有 4 种角色', () => {
    const roles: PluginLlmMessage['role'][] = ['user', 'assistant', 'system', 'tool']
    for (const role of roles) {
      expect(isPluginLlmMessageArray([{ role, content: 'test' }])).toBe(true)
    }
  })

  it('拒绝非法角色', () => {
    expect(isPluginLlmMessageArray([{ role: 'invalid', content: 'test' }])).toBe(false)
  })

  it('拒绝非数组', () => {
    expect(isPluginLlmMessageArray(null)).toBe(false)
    expect(isPluginLlmMessageArray('string')).toBe(false)
  })

  it('拒绝缺少 content', () => {
    expect(isPluginLlmMessageArray([{ role: 'user' }])).toBe(false)
  })

  it('拒绝非法 content 类型', () => {
    expect(isPluginLlmMessageArray([{ role: 'user', content: 123 }])).toBe(false)
  })

  it('接受空数组', () => {
    expect(isPluginLlmMessageArray([])).toBe(true)
  })
})

// ============================================================================
// 10. 客户端 Payload 读取 — readHookInvokePayload
// ============================================================================

const PLUGIN_HOOK_NAME_VALUES = [
  'message:received', 'conversation:history-rewrite', 'chat:before-model', 'chat:waiting-model', 'chat:after-model', 'conversation:created',
  'message:created', 'message:updated', 'message:deleted', 'automation:before-run', 'automation:after-run',
  'subagent:before-run', 'subagent:after-run', 'tool:before-call', 'tool:after-call', 'response:before-send',
  'response:after-send', 'plugin:loaded', 'plugin:unloaded', 'plugin:error', 'cron:tick',
] as const

const PLUGIN_INVOCATION_SOURCE_VALUES = [
  'chat-tool', 'chat-hook', 'cron', 'automation', 'http-route', 'subagent', 'plugin',
] as const

type PluginHookName = typeof PLUGIN_HOOK_NAME_VALUES[number]
type PluginInvocationSource = typeof PLUGIN_INVOCATION_SOURCE_VALUES[number]

interface PluginCallContext {
  source: PluginInvocationSource
  userId?: string
  conversationId?: string
  automationId?: string
  cronJobId?: string
  activeProviderId?: string
  activeModelId?: string
  activePersonaId?: string
  metadata?: Record<string, unknown>
}

interface HookInvokePayload {
  hookName: PluginHookName
  context: PluginCallContext
  payload: unknown
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return allowed.includes(value as T)
}

function isJsonObjectValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPluginCallContext(value: unknown): value is PluginCallContext {
  if (!isJsonObjectValue(value) || !isOneOf(value.source, PLUGIN_INVOCATION_SOURCE_VALUES)) return false
  return true
}

function isPluginHookName(value: unknown): value is PluginHookName {
  return isOneOf(value, PLUGIN_HOOK_NAME_VALUES)
}

function readHookInvokePayload(value: unknown): HookInvokePayload {
  const payload = isJsonObjectValue(value) ? value : null
  if (!payload) throw new Error('Invalid hook invoke payload')
  if (!isPluginHookName(payload.hookName)) throw new Error('Invalid hook invoke payload: hookName')
  if (!isPluginCallContext(payload.context)) throw new Error('Invalid hook invoke payload: context')
  return {
    hookName: payload.hookName,
    context: payload.context,
    payload: payload.payload,
  }
}

describe('Client Payload — readHookInvokePayload', () => {
  it('解析合法 hook invoke 负载', () => {
    const result = readHookInvokePayload({
      hookName: 'message:received',
      context: { source: 'chat-hook' },
      payload: { text: 'hello' },
    })
    expect(result.hookName).toBe('message:received')
    expect(result.context.source).toBe('chat-hook')
    expect(result.payload).toEqual({ text: 'hello' })
  })

  it('解析 chat:before-model hook', () => {
    const result = readHookInvokePayload({
      hookName: 'chat:before-model',
      context: { source: 'plugin' },
      payload: { messages: [] },
    })
    expect(result.hookName).toBe('chat:before-model')
  })

  it('拒绝非法 hookName', () => {
    expect(() => readHookInvokePayload({
      hookName: 'unknown-hook',
      context: { source: 'plugin' },
      payload: {},
    })).toThrow()
  })

  it('拒绝非法 context source', () => {
    expect(() => readHookInvokePayload({
      hookName: 'message:received',
      context: { source: 'invalid' },
      payload: {},
    })).toThrow()
  })

  it('拒绝非对象输入', () => {
    expect(() => readHookInvokePayload(null)).toThrow()
    expect(() => readHookInvokePayload('string')).toThrow()
  })

  it('接受 automation:before-run / automation:after-run', () => {
    for (const hookName of ['automation:before-run', 'automation:after-run'] as PluginHookName[]) {
      const result = readHookInvokePayload({ hookName, context: { source: 'automation' }, payload: {} })
      expect(result.hookName).toBe(hookName)
    }
  })

  it('接受 cron:tick', () => {
    const result = readHookInvokePayload({ hookName: 'cron:tick', context: { source: 'cron' }, payload: { scheduledAt: '2024-01-01' } })
    expect(result.hookName).toBe('cron:tick')
  })
})

// ============================================================================
// 11. 客户端 Payload 读取 — readExecutePayload
// ============================================================================

interface ExecutePayload {
  toolName?: string
  capability?: string
  params: Record<string, unknown>
  context?: PluginCallContext
}

function readExecutePayload(value: unknown): ExecutePayload {
  const payload = isJsonObjectValue(value) ? value : null
  if (!payload) throw new Error('Invalid execute payload')
  const toolName = typeof payload.toolName === 'string' ? payload.toolName : undefined
  const capability = typeof payload.capability === 'string' ? payload.capability : undefined
  const context = isPluginCallContext(payload.context) ? payload.context : undefined
  if (!isJsonObjectValue(payload.params)) throw new Error('Invalid execute payload: params')
  return { ...(toolName ? { toolName } : {}), ...(capability ? { capability } : {}), params: payload.params, ...(context ? { context } : {}) }
}

describe('Client Payload — readExecutePayload', () => {
  it('解析含 toolName 的执行负载', () => {
    const result = readExecutePayload({ toolName: 'get_pc_info', params: {} })
    expect(result.toolName).toBe('get_pc_info')
    expect(result.params).toEqual({})
  })

  it('解析含 capability 的执行负载', () => {
    const result = readExecutePayload({ capability: 'read_file', params: { path: '/a.txt' } })
    expect(result.capability).toBe('read_file')
    expect(result.params.path).toBe('/a.txt')
  })

  it('解析含 context 的执行负载', () => {
    const result = readExecutePayload({ toolName: 't1', params: {}, context: { source: 'chat-tool' } })
    expect(result.context).toEqual({ source: 'chat-tool' })
  })

  it('toolName 优先于 capability', () => {
    const result = readExecutePayload({ toolName: 'tool_a', capability: 'cap_b', params: {} })
    expect(result.toolName).toBe('tool_a')
    expect(result.capability).toBe('cap_b')
  })

  it('拒绝非对象 params', () => {
    expect(() => readExecutePayload({ toolName: 't1', params: 'string' })).toThrow()
  })

  it('拒绝非对象输入', () => {
    expect(() => readExecutePayload(undefined)).toThrow()
  })

  it('toolName 和 capability 均可选', () => {
    const result = readExecutePayload({ params: {} })
    expect(result.toolName).toBeUndefined()
    expect(result.capability).toBeUndefined()
  })
})

// ============================================================================
// 12. 客户端 Payload 读取 — readHostResultPayload
// ============================================================================

interface HostResultPayload {
  data: unknown
}

function readHostResultPayload(value: unknown): HostResultPayload {
  const payload = isJsonObjectValue(value) ? value : null
  if (!payload || !('data' in payload)) throw new Error('Invalid host result payload')
  return { data: payload.data }
}

describe('Client Payload — readHostResultPayload', () => {
  it('解析合法 host result', () => {
    const result = readHostResultPayload({ data: { id: 'p1' } })
    expect(result.data).toEqual({ id: 'p1' })
  })

  it('接受原始值 data', () => {
    expect(readHostResultPayload({ data: 'ok' }).data).toBe('ok')
    expect(readHostResultPayload({ data: null }).data).toBeNull()
    expect(readHostResultPayload({ data: 42 }).data).toBe(42)
  })

  it('拒绝缺少 data', () => {
    expect(() => readHostResultPayload({})).toThrow()
  })

  it('拒绝非对象输入', () => {
    expect(() => readHostResultPayload(null)).toThrow()
  })
})

// ============================================================================
// 13. 客户端 Payload 读取 — readMessageReceivedHookPayload
// ============================================================================

interface PluginMessageHookInfo {
  role: string
  content: string | null
  parts: ChatMessagePart[]
  id?: string
  metadata?: Record<string, unknown> | undefined
  provider?: string | null
  model?: string | null
  status?: string | undefined
}

interface PluginConversationSessionInfo {
  pluginId: string
  conversationId: string
  timeoutMs: number
  startedAt: string
  expiresAt: string
  lastMatchedAt: string | null
  captureHistory: boolean
  historyMessages: PluginMessageHookInfo[]
  metadata?: unknown
}

interface MessageReceivedHookPayload {
  context: PluginCallContext
  conversationId: string
  providerId: string
  modelId: string
  session?: PluginConversationSessionInfo | null
  message: PluginMessageHookInfo
  modelMessages: PluginLlmMessage[]
}

function isPluginMessageHookInfo(value: unknown): value is PluginMessageHookInfo {
  if (!isJsonObjectValue(value) || typeof value.role !== 'string') return false
  return true
}

function isPluginConversationSessionInfo(value: unknown): value is PluginConversationSessionInfo {
  if (!isJsonObjectValue(value) || typeof value.pluginId !== 'string' || typeof value.conversationId !== 'string') return false
  return true
}

function readMessageReceivedHookPayload(value: unknown): MessageReceivedHookPayload {
  const payload = isJsonObjectValue(value) ? value : null
  if (!payload) throw new Error('Invalid message:received payload')
  if (typeof payload.conversationId !== 'string') throw new Error('Invalid message:received: conversationId')
  if (typeof payload.providerId !== 'string') throw new Error('Invalid message:received: providerId')
  if (typeof payload.modelId !== 'string') throw new Error('Invalid message:received: modelId')
  if (!isPluginCallContext(payload.context)) throw new Error('Invalid message:received: context')
  if (!isPluginMessageHookInfo(payload.message)) throw new Error('Invalid message:received: message')
  return payload as unknown as MessageReceivedHookPayload
}

describe('Client Payload — readMessageReceivedHookPayload', () => {
  it('解析合法 message:received 负载', () => {
    const result = readMessageReceivedHookPayload({
      context: { source: 'chat-hook' },
      conversationId: 'c1',
      providerId: 'openai',
      modelId: 'gpt-4',
      message: { role: 'user', content: 'hello', parts: [] },
      modelMessages: [{ role: 'user', content: 'hello' }],
    })
    expect(result.conversationId).toBe('c1')
    expect(result.providerId).toBe('openai')
    expect(result.modelId).toBe('gpt-4')
    expect(result.message.role).toBe('user')
  })

  it('拒绝缺少 conversationId', () => {
    expect(() => readMessageReceivedHookPayload({
      context: { source: 'plugin' },
      providerId: 'o', modelId: 'm',
      message: { role: 'user', content: 'hi', parts: [] },
      modelMessages: [],
    })).toThrow()
  })

  it('拒绝非字符串 providerId', () => {
    expect(() => readMessageReceivedHookPayload({
      context: { source: 'plugin' },
      conversationId: 'c1', providerId: null, modelId: 'm',
      message: { role: 'user', content: 'hi', parts: [] },
      modelMessages: [],
    })).toThrow()
  })
})

// ============================================================================
// 14. 客户端消息处理 — normalizeMessageListenerResult
// ============================================================================

type MessageReceivedHookResult =
  | { action: 'pass' }
  | { action: 'mutate'; providerId?: string; modelId?: string; content?: string | null; parts?: ChatMessagePart[] | null; modelMessages?: PluginLlmMessage[] }
  | { action: 'short-circuit'; assistantContent: string; assistantParts?: ChatMessagePart[] | null; providerId?: string; modelId?: string; reason?: string }

function isChatMessagePartArraySimple(value: unknown): value is ChatMessagePart[] {
  return Array.isArray(value as ChatMessagePart[])
}

function normalizeMessageListenerResult(result: unknown): MessageReceivedHookResult | null {
  if (result === null || result === undefined) return null
  if (typeof result === 'object' && !Array.isArray(result) && result !== null && 'action' in (result as Record<string, unknown>)) {
    const r = result as Record<string, unknown>
    if (r.action === 'pass') return { action: 'pass' }
    if (r.action === 'mutate') {
      const m: MessageReceivedHookResult = { action: 'mutate' }
      if (typeof r.providerId === 'string') (m as Record<string, unknown>).providerId = r.providerId
      if (typeof r.modelId === 'string') (m as Record<string, unknown>).modelId = r.modelId
      if ('content' in r) (m as Record<string, unknown>).content = r.content ?? null
      return m
    }
    if (r.action === 'short-circuit') {
      if (typeof r.assistantContent !== 'string') throw new Error('Invalid short-circuit')
      return { action: 'short-circuit', assistantContent: r.assistantContent }
    }
    throw new Error('Invalid action')
  }
  if (typeof result === 'string') {
    return { action: 'short-circuit', assistantContent: result }
  }
  if (typeof result === 'object' && result !== null && 'content' in (result as Record<string, unknown>)) {
    const r = result as Record<string, unknown>
    return { action: 'short-circuit', assistantContent: typeof r.content === 'string' ? r.content : '' }
  }
  throw new Error('SDK message handler must return string, { content }, or standard Hook result')
}

describe('Client Message — normalizeMessageListenerResult', () => {
  it('null 输入返回 null', () => {
    expect(normalizeMessageListenerResult(null)).toBeNull()
  })

  it('undefined 输入返回 null', () => {
    expect(normalizeMessageListenerResult(undefined)).toBeNull()
  })

  it('pass action 透传', () => {
    const result = normalizeMessageListenerResult({ action: 'pass' })
    expect(result).toEqual({ action: 'pass' })
  })

  it('string 输入转为 short-circuit', () => {
    const result = normalizeMessageListenerResult('直接回复')
    expect(result).toEqual({ action: 'short-circuit', assistantContent: '直接回复' })
  })

  it('{ content } 输入转为 short-circuit', () => {
    const result = normalizeMessageListenerResult({ content: '回复内容' })
    expect(result).toEqual({ action: 'short-circuit', assistantContent: '回复内容' })
  })

  it('mutate action 透传', () => {
    const result = normalizeMessageListenerResult({ action: 'mutate', content: 'modified' })
    expect(result).toEqual({ action: 'mutate', content: 'modified' })
  })

  it('short-circuit action 透传', () => {
    const result = normalizeMessageListenerResult({ action: 'short-circuit', assistantContent: 'short' })
    expect(result).toEqual({ action: 'short-circuit', assistantContent: 'short' })
  })

  it('非法 action 抛出错误', () => {
    expect(() => normalizeMessageListenerResult({ action: 'unknown' })).toThrow()
  })

  it('short-circuit 缺少 assistantContent 抛出错误', () => {
    expect(() => normalizeMessageListenerResult({ action: 'short-circuit' })).toThrow()
  })
})

// ============================================================================
// 15. 客户端消息处理 — normalizeRawMessageHookResult
// ============================================================================

function normalizeRawMessageHookResult(result: unknown): unknown {
  if (result === null || result === undefined) return { action: 'pass' }
  if (typeof result === 'object' && !Array.isArray(result) && result !== null && 'action' in (result as Record<string, unknown>)) {
    return result
  }
  if (typeof result === 'string') return { action: 'short-circuit', assistantContent: result }
  if (typeof result === 'object' && result !== null && 'content' in (result as Record<string, unknown>)) {
    const r = result as Record<string, unknown>
    return { action: 'short-circuit', assistantContent: typeof r.content === 'string' ? r.content : '' }
  }
  return result
}

describe('Client Message — normalizeRawMessageHookResult', () => {
  it('null/undefined 返回 { action: "pass" }', () => {
    expect(normalizeRawMessageHookResult(null)).toEqual({ action: 'pass' })
    expect(normalizeRawMessageHookResult(undefined)).toEqual({ action: 'pass' })
  })

  it('action 对象透传', () => {
    expect(normalizeRawMessageHookResult({ action: 'pass' })).toEqual({ action: 'pass' })
    expect(normalizeRawMessageHookResult({ action: 'short-circuit', assistantContent: 'hi' })).toEqual({ action: 'short-circuit', assistantContent: 'hi' })
  })

  it('string 转为 short-circuit', () => {
    expect(normalizeRawMessageHookResult('hello')).toEqual({ action: 'short-circuit', assistantContent: 'hello' })
  })

  it('{ content } 转为 short-circuit', () => {
    expect(normalizeRawMessageHookResult({ content: 'reply' })).toEqual({ action: 'short-circuit', assistantContent: 'reply' })
  })
})

// ============================================================================
// 16. 客户端消息处理 — applyMessageReceivedMutation
// ============================================================================

function applyMessageReceivedMutation(
  payload: MessageReceivedHookPayload,
  mutation: Extract<MessageReceivedHookResult, { action: 'mutate' }>,
): MessageReceivedHookPayload {
  const next = JSON.parse(JSON.stringify(payload))
  if ('providerId' in mutation && typeof mutation.providerId === 'string') next.providerId = mutation.providerId
  if ('modelId' in mutation && typeof mutation.modelId === 'string') next.modelId = mutation.modelId
  if ('content' in mutation) next.message.content = mutation.content ?? null
  if ('parts' in mutation) next.message.parts = mutation.parts ?? []
  return next as MessageReceivedHookPayload
}

describe('Client Message — applyMessageReceivedMutation', () => {
  const basePayload: MessageReceivedHookPayload = {
    context: { source: 'chat-hook' },
    conversationId: 'c1',
    providerId: 'openai',
    modelId: 'gpt-4',
    message: { role: 'user', content: 'original', parts: [] },
    modelMessages: [{ role: 'user', content: 'hello' }],
  }

  it('突变 providerId', () => {
    const result = applyMessageReceivedMutation(basePayload, { action: 'mutate', providerId: 'anthropic' })
    expect(result.providerId).toBe('anthropic')
    expect(result.conversationId).toBe('c1')
  })

  it('突变 modelId', () => {
    const result = applyMessageReceivedMutation(basePayload, { action: 'mutate', modelId: 'claude-3' })
    expect(result.modelId).toBe('claude-3')
  })

  it('突变 content', () => {
    const result = applyMessageReceivedMutation(basePayload, { action: 'mutate', content: 'modified' })
    expect(result.message.content).toBe('modified')
  })

  it('突变 content 为 null', () => {
    const result = applyMessageReceivedMutation(basePayload, { action: 'mutate', content: null })
    expect(result.message.content).toBeNull()
  })

  it('不传 content 时不改变', () => {
    const result = applyMessageReceivedMutation(basePayload, { action: 'mutate' })
    expect(result.message.content).toBe('original')
  })

  it('原始负载不被改变 (immutable)', () => {
    const originalContent = basePayload.message.content
    applyMessageReceivedMutation(basePayload, { action: 'mutate', content: 'changed' })
    expect(basePayload.message.content).toBe(originalContent)
  })
})

// ============================================================================
// 17. 客户端消息处理 — buildMessageReceivedMutationResult
// ============================================================================

function isJsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function buildMessageReceivedMutationResult(
  original: MessageReceivedHookPayload,
  current: MessageReceivedHookPayload,
): MessageReceivedHookResult {
  const mutation: Record<string, unknown> = { action: 'mutate' }
  let changed = false
  if (current.providerId !== original.providerId) { mutation.providerId = current.providerId; changed = true }
  if (current.modelId !== original.modelId) { mutation.modelId = current.modelId; changed = true }
  if (current.message.content !== original.message.content) { mutation.content = current.message.content; changed = true }
  if (!isJsonEqual(current.message.parts, original.message.parts)) { mutation.parts = JSON.parse(JSON.stringify(current.message.parts)); changed = true }
  return changed ? (mutation as MessageReceivedHookResult) : { action: 'pass' }
}

describe('Client Message — buildMessageReceivedMutationResult', () => {
  const base: MessageReceivedHookPayload = {
    context: { source: 'chat-hook' },
    conversationId: 'c1',
    providerId: 'openai',
    modelId: 'gpt-4',
    message: { role: 'user', content: 'hi', parts: [] },
    modelMessages: [{ role: 'user', content: 'hello' }],
  }

  it('无变化时返回 pass', () => {
    const result = buildMessageReceivedMutationResult(base, base)
    expect(result).toEqual({ action: 'pass' })
  })

  it('providerId 变化时返回 mutate', () => {
    const current = JSON.parse(JSON.stringify(base))
    current.providerId = 'anthropic'
    const result = buildMessageReceivedMutationResult(base, current)
    expect(result).toHaveProperty('action', 'mutate')
    expect((result as Record<string, unknown>).providerId).toBe('anthropic')
  })

  it('content 变化时返回 mutate', () => {
    const current = JSON.parse(JSON.stringify(base))
    current.message.content = 'modified'
    const result = buildMessageReceivedMutationResult(base, current)
    expect(result).toHaveProperty('action', 'mutate')
  })
})

// ============================================================================
// 18. 整合测试 — 完整消息生命周期
// ============================================================================

describe('Plugin Protocol — 完整消息生命周期', () => {
  it('客户端发送 authenticate → 服务端解析', () => {
    const raw = JSON.stringify({
      type: 'auth',
      action: 'authenticate',
      payload: { pluginName: 'plugin-pc', accessKey: 'sk-abc', remoteEnvironment: 'api' },
    })
    const msg = readWsMessage(raw)
    expect(msg.type).toBe('auth')
    expect(msg.action).toBe('authenticate')
    const authPayload = readAuthPayload(msg.payload)
    expect(authPayload.pluginName).toBe('plugin-pc')
    expect(authPayload.accessKey).toBe('sk-abc')
  })

  it('客户端发送 register → 服务端解析', () => {
    const raw = JSON.stringify({
      type: 'plugin',
      action: 'register',
      payload: {
        manifest: {
          id: 'test-plugin',
          name: 'Test',
          version: '1.0.0',
          runtime: 'remote',
          permissions: ['conversation:read'],
          tools: [{ name: 'tool1', description: 'desc', parameters: {} }],
        },
      },
    })
    const msg = readWsMessage(raw)
    const regPayload = readRegisterPayload(msg.payload)
    expect(regPayload.manifest.id).toBe('test-plugin')
    expect(regPayload.manifest.tools).toHaveLength(1)
  })

  it('服务端发送 hook_invoke → 客户端解析', () => {
    const raw = JSON.stringify({
      type: 'plugin',
      action: 'hook_invoke',
      payload: {
        hookName: 'message:received',
        context: { source: 'chat-hook' },
        payload: {
          context: { source: 'chat-hook' },
          conversationId: 'c1',
          providerId: 'openai',
          modelId: 'gpt-4',
          message: { role: 'user', content: 'test', parts: [] },
          modelMessages: [],
        },
      },
    })
    const msg = readWsMessage(raw)
    const hookPayload = readHookInvokePayload(msg.payload)
    expect(hookPayload.hookName).toBe('message:received')

    const msgReceivedPayload = readMessageReceivedHookPayload(hookPayload.payload)
    expect(msgReceivedPayload.conversationId).toBe('c1')
    expect(msgReceivedPayload.message.content).toBe('test')
  })

  it('客户端发送 host_call → 服务端接收 host_result', () => {
    const hostCall: WsMessage = {
      type: 'plugin',
      action: 'host_call',
      payload: { method: 'provider.current.get', params: {}, context: { source: 'plugin' } },
      requestId: 'req-001',
    }
    const parsed = readHostCallPayload(hostCall.payload)
    expect(parsed.method).toBe('provider.current.get')
    expect(parsed.params).toEqual({})

    const hostResult: WsMessage = {
      type: 'plugin',
      action: 'host_result',
      payload: { data: { id: 'p1' } },
      requestId: 'req-001',
    }
    const resultPayload = readHostResultPayload(hostResult.payload)
    expect(resultPayload.data).toEqual({ id: 'p1' })
  })

  it('服务端发送 execute → 客户端执行并返回 execute_result', () => {
    const executeMsg: WsMessage = {
      type: 'command',
      action: 'execute',
      payload: { toolName: 'get_pc_info', params: {} },
    }
    const execPayload = readExecutePayload(executeMsg.payload)
    expect(execPayload.toolName).toBe('get_pc_info')

    const resultMsg: WsMessage = {
      type: 'command',
      action: 'execute_result',
      payload: { data: { os: 'Windows' } },
      requestId: 'req-002',
    }
    const settlement = readRemoteSettlement(resultMsg)
    expect(settlement).not.toBeNull()
    if (settlement && 'settlement' in settlement) {
      expect(settlement.settlement.requestId).toBe('req-002')
    }
  })

  it('服务端发送 ping → 客户端响应 pong', () => {
    const ping: WsMessage = { type: 'heartbeat', action: 'ping', payload: {} }
    expect(ping.type).toBe('heartbeat')
    expect(ping.action).toBe('ping')
    const pong: WsMessage = { type: 'heartbeat', action: 'pong', payload: {} }
    expect(pong.action).toBe('pong')
  })
})

// ============================================================================
// 19. 边界和错误情况
// ============================================================================

describe('Plugin Protocol — 边界与错误', () => {
  it('空字符串 JSON 抛出错误', () => {
    expect(() => readWsMessage('')).toThrow()
  })

  it('超大 payload 仍可解析', () => {
    const large = { type: 'plugin', action: 'register', payload: { manifest: { id: 'x', tools: Array(100).fill({ name: 't', description: 'd', parameters: {} }) } } }
    const msg = readWsMessage(JSON.stringify(large))
    expect(msg.payload.manifest.tools).toHaveLength(100)
  })

  it('服务端 host_call 拒绝非字符串 method', () => {
    expect(() => readHostCallPayload({ method: null, params: {} })).toThrow()
  })

  it('客户端 normalizeMessageListenerResult 拒绝非标准格式', () => {
    expect(() => normalizeMessageListenerResult(42)).toThrow()
  })

  it('客户端 normalizeMessageListenerResult 拒绝数组', () => {
    expect(() => normalizeMessageListenerResult(['a', 'b'])).toThrow()
  })

  it('readAuthPayload 拒绝布尔值 accessKey', () => {
    expect(() => readAuthPayload({ pluginName: 't', accessKey: false, remoteEnvironment: 'api' })).toThrow()
  })

  it('readExecutePayload 拒绝 null params', () => {
    expect(() => readExecutePayload({ toolName: 't', params: null })).toThrow()
  })

  it('readWsMessage 拒绝带 BOM 的 JSON', () => {
    expect(() => readWsMessage('\uFEFF{"type":"plugin","action":"test","payload":{}}')).toThrow('无效的 JSON')
  })

  it('readRemoteSettlement 对 command:execute 返回 null', () => {
    const msg: WsMessage = { type: 'command', action: 'execute', payload: {}, requestId: 'r1' }
    expect(readRemoteSettlement(msg)).toBeNull()
  })

  it('readRemoteSettlement 对 auth:authenticate 返回 null', () => {
    const msg: WsMessage = { type: 'auth', action: 'authenticate', payload: {}, requestId: 'r1' }
    expect(readRemoteSettlement(msg)).toBeNull()
  })
})

// ============================================================================
// 20. 协议常量完整性检查
// ============================================================================

describe('Plugin Protocol — 常量完整性', () => {
  it('WS_TYPE 和 WS_ACTION 的 product 覆盖所有远程结算场景', () => {
    const settlementKeys = [
      'command:execute_result',
      'command:execute_error',
      'plugin:hook_result',
      'plugin:route_result',
      'plugin:hook_error',
      'plugin:route_error',
    ]
    for (const key of settlementKeys) {
      const [type, action] = key.split(':') as [string, string]
      expect(Object.values(WS_TYPE)).toContain(type)
      expect(Object.values(WS_ACTION)).toContain(action)
    }
  })

  it('WS_ACTION 中每对 result/error 都有对应的 invoke', () => {
    const pairs = [
      ['EXECUTE', 'EXECUTE_RESULT', 'EXECUTE_ERROR'],
      ['HOOK_INVOKE', 'HOOK_RESULT', 'HOOK_ERROR'],
      ['ROUTE_INVOKE', 'ROUTE_RESULT', 'ROUTE_ERROR'],
      ['HOST_CALL', 'HOST_RESULT', 'HOST_ERROR'],
    ]
    for (const [invoke, result, error] of pairs) {
      expect(WS_ACTION).toHaveProperty(invoke)
      expect(WS_ACTION).toHaveProperty(result)
      expect(WS_ACTION).toHaveProperty(error)
    }
  })

  it('认证动作完整', () => {
    expect(WS_ACTION.AUTHENTICATE).toBe('authenticate')
    expect(WS_ACTION.AUTH_OK).toBe('auth_ok')
    expect(WS_ACTION.AUTH_FAIL).toBe('auth_fail')
  })

  it('所有 WS_ACTION 命名风格一致 (snake_case)', () => {
    for (const key of Object.keys(WS_ACTION)) {
      const value = WS_ACTION[key as keyof typeof WS_ACTION]
      expect(value).toMatch(/^[a-z]+(_[a-z]+)*$/)
    }
  })
})
