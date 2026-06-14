import { describe, it, expect } from 'vitest'

class BadRequestException extends Error {
  constructor(message: string) { super(message); this.name = 'BadRequestException'; }
}

const DEFAULT_PERSONA_ID = 'builtin.default-assistant'
const DEFAULT_PROVIDER_ID = 'builtin.default'
const DEFAULT_PROVIDER_MODEL_ID = 'builtin.default.general'
const SCOPED_STORE_PREFIX = '__gc_scope__:'
const KNOWN_ASSISTANT_DELTA_KEYS = new Set(['audio', 'content', 'function_call', 'refusal', 'role', 'tool_calls'])
const PLUGIN_LLM_MESSAGE_ROLES = new Set(['assistant', 'system', 'tool', 'user'])

function isJsonArray(value: unknown): value is unknown[] { return Array.isArray(value) && value.every((entry) => isJsonValue(entry)) }
function isJsonObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((entry) => isJsonValue(entry)) }
function isJsonValue(value: unknown): value is unknown { return value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string' || isJsonArray(value) || isJsonObject(value) }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

function cloneJsonValue<T>(value: T): T { return structuredClone(value) }
function asJsonObject<T extends object>(value: T): Record<string, unknown> { return cloneJsonValue(value) as unknown as Record<string, unknown> }
function asJsonValue<T>(value: T): unknown { return cloneJsonValue(value) as unknown as unknown }
function readJsonObject(value: unknown): Record<string, unknown> | null { return isJsonObject(value) ? cloneJsonValue(value) : null }
function readJsonValue(value: unknown): unknown { return isJsonValue(value) ? cloneJsonValue(value) : null }

function readKeywords(value: unknown): string[] {
  return typeof value === 'string' ? value.split(',').map((entry) => entry.trim()).filter(Boolean) : Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : []
}

function readJsonStringRecord(value: unknown, invalidMessage: string): Record<string, string> | null {
  const record = readJsonObject(value)
  if (!record) return null
  if (Object.values(record).some((entry) => typeof entry !== 'string')) throw new BadRequestException(invalidMessage)
  return record as Record<string, string>
}

function sanitizeModelToolCallName(toolName: string): string {
  return toolName.trim().replace(/<\|channel\|>(?:[a-zA-Z0-9_-]+)?/gu, '').trim()
}

function createInvalidToolResult(input: { error: string; inputText?: string; phase: string; tool: string }) {
  return {
    error: input.error.trim() || '未知工具错误',
    ...(input.inputText?.trim() ? { inputText: input.inputText.trim() } : {}),
    phase: input.phase,
    recovered: true,
    tool: input.tool.trim() || 'unknown-tool',
    type: 'invalid-tool-result',
  }
}

function stringifyInvalidToolInput(value: unknown): string | undefined {
  if (typeof value === 'string') { const t = value.trim(); return t || undefined }
  if (isJsonValue(value)) return JSON.stringify(value, null, 2)
  return undefined
}

function readToolErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : typeof value === 'string' && value.trim().length > 0 ? value.trim() : '工具执行失败'
}

function readAssistantStreamPart(rawPart: unknown): { type: 'text-delta'; text: string } | { type: 'tool-call'; input: unknown; toolCallId: string; toolName: string } | { type: 'tool-result'; output: unknown; toolCallId: string; toolName: string } | null {
  if (!isRecord(rawPart) || typeof rawPart.type !== 'string') return null
  if (rawPart.type === 'text-delta' && typeof rawPart.text === 'string') return { text: rawPart.text, type: 'text-delta' }
  if ((rawPart.type === 'tool-call' || rawPart.type === 'tool-result') && typeof rawPart.toolCallId === 'string' && typeof rawPart.toolName === 'string') {
    const toolName = sanitizeModelToolCallName(rawPart.toolName)
    return rawPart.type === 'tool-call' ? { input: rawPart.input as unknown, toolCallId: rawPart.toolCallId, toolName, type: 'tool-call' } : { output: rawPart.output as unknown, toolCallId: rawPart.toolCallId, toolName, type: 'tool-result' }
  }
  if (rawPart.type === 'tool-error' && typeof rawPart.toolCallId === 'string' && typeof rawPart.toolName === 'string') {
    const inputText = stringifyInvalidToolInput(rawPart.input)
    const toolName = sanitizeModelToolCallName(rawPart.toolName)
    return {
      output: createInvalidToolResult({ error: readToolErrorMessage(rawPart.error), ...(inputText ? { inputText } : {}), phase: 'execute', tool: toolName }) as unknown,
      toolCallId: rawPart.toolCallId, toolName, type: 'tool-result',
    }
  }
  return null
}

function readAssistantCustomBlockEntry(key: string, value: unknown): { key: string; kind: 'json' | 'text'; value: unknown }[] {
  if (KNOWN_ASSISTANT_DELTA_KEYS.has(key)) return []
  if (typeof value === 'string') return value.length > 0 ? [{ key, kind: 'text' as const, value }] : []
  return isJsonValue(value) ? [{ key, kind: 'json' as const, value }] : []
}

function readAssistantCustomBlocks(value: unknown, field: 'delta' | 'message'): { key: string; kind: 'json' | 'text'; value: unknown }[] {
  const choice = isRecord(value) && Array.isArray(value.choices) ? value.choices[0] : null
  const container = isRecord(choice) && isRecord(choice[field]) ? choice[field] : null
  return container ? Object.entries(container).flatMap(([key, entry]) => readAssistantCustomBlockEntry(key, entry)) : []
}

function readAssistantRawCustomBlocks(rawPart: unknown): { key: string; kind: 'json' | 'text'; value: unknown }[] {
  return readAssistantCustomBlocks(isRecord(rawPart) && rawPart.type === 'raw' ? rawPart.rawValue : null, 'delta')
}

function readAssistantResponseCustomBlocks(responseBody: unknown): { key: string; kind: 'json' | 'text'; value: unknown }[] {
  return readAssistantCustomBlocks(responseBody, 'message')
}

function readMessageTarget(value: unknown): { id: string; type: 'conversation' } | null {
  if (!isRecord(value)) return null
  if (value.type !== 'conversation') throw new BadRequestException('message.send target.type 目前只支持 conversation')
  if (typeof value.id !== 'string' || value.id.trim().length === 0) throw new BadRequestException('message.send target.id 不能为空')
  return { id: value.id.trim(), type: 'conversation' }
}

function readOptionalBoolean(params: Record<string, unknown>, key: string): boolean | null {
  const value = params[key]
  if (value === undefined) return null
  if (typeof value !== 'boolean') throw new BadRequestException(`${key} 必须是布尔值`)
  return value
}

function readOptionalString(params: Record<string, unknown>, key: string): string | null {
  const value = params[key]; const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || null
}

function readPositiveInteger(params: Record<string, unknown>, key: string): number | null {
  const value = params[key]
  if (value === undefined) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new BadRequestException(`${key} 必须是正整数`)
  return value
}

function readRequiredJsonValue(params: Record<string, unknown>, key: string): unknown {
  const value = readJsonValue(params[key])
  if (value === null) throw new BadRequestException(`${key} 必须是合法 JSON 数据`)
  return value
}

function readRequiredString(params: Record<string, unknown>, key: string): string {
  const value = readOptionalString(params, key)
  if (value) return value
  throw new BadRequestException(`${key} 不能为空`)
}

function readScope(params: Record<string, unknown>): 'conversation' | 'plugin' | 'user' {
  const scope = readOptionalString(params, 'scope') ?? 'plugin'
  if (scope === 'conversation' || scope === 'plugin' || scope === 'user') return scope
  throw new BadRequestException('scope 只能是 plugin、conversation 或 user')
}

function readScopedKey(params: Record<string, unknown>): string {
  const key = readRequiredString(params, 'key')
  if (key.startsWith(SCOPED_STORE_PREFIX)) throw new BadRequestException(`key 不能以保留前缀 ${SCOPED_STORE_PREFIX} 开头`)
  return key
}

function requireContextField(context: Record<string, unknown>, field: string): string {
  const value = context[field]
  if (value) return String(value)
  throw new BadRequestException(`Host API 调用上下文缺少 ${field}`)
}

function readPluginLlmMessages(value: unknown, emptyMessage: string, createError: (message: string) => Error = (message) => new BadRequestException(message), label = 'plugin'): { content: unknown; role: string }[] {
  if (!Array.isArray(value) || value.length === 0) throw createError(emptyMessage)
  return value.flatMap((message, index) => {
    if (message === null || message === undefined) return []
    const record = readJsonObject(message)
    if (!record) throw createError(`${label}: messages[${index}] 必须是对象`)
    if (!PLUGIN_LLM_MESSAGE_ROLES.has(String(record.role))) throw createError(`${label}: messages[${index}].role 不合法`)
    if (typeof record.content !== 'string' && !Array.isArray(record.content)) throw createError(`${label}: messages[${index}].content 不合法`)
    return [cloneJsonValue({ content: record.content, role: record.role }) as { content: unknown; role: string }]
  })
}

describe('host-input.codec', () => {
  describe('constants', () => {
    it('DEFAULT_PERSONA_ID', () => { expect(DEFAULT_PERSONA_ID).toBe('builtin.default-assistant') })
    it('DEFAULT_PROVIDER_ID', () => { expect(DEFAULT_PROVIDER_ID).toBe('builtin.default') })
    it('DEFAULT_PROVIDER_MODEL_ID', () => { expect(DEFAULT_PROVIDER_MODEL_ID).toBe('builtin.default.general') })
    it('SCOPED_STORE_PREFIX', () => { expect(SCOPED_STORE_PREFIX).toBe('__gc_scope__:') })
  })

  describe('isJsonValue / isJsonObject / isJsonArray / isRecord', () => {
    it('isJsonValue accepts null/boolean/number/string', () => {
      expect(isJsonValue(null)).toBe(true)
      expect(isJsonValue(true)).toBe(true)
      expect(isJsonValue(42)).toBe(true)
      expect(isJsonValue('hello')).toBe(true)
    })
    it('isJsonValue accepts arrays and objects with JSON values', () => {
      expect(isJsonValue([1, 'a', null])).toBe(true)
      expect(isJsonValue({ a: 1 })).toBe(true)
    })
    it('isJsonValue rejects undefined and functions', () => {
      expect(isJsonValue(undefined)).toBe(false)
      expect(isJsonValue(() => 1)).toBe(false)
    })
    it('isJsonObject rejects arrays', () => { expect(isJsonObject([1, 2])).toBe(false) })
    it('isJsonObject accepts plain objects', () => { expect(isJsonObject({ a: 1 })).toBe(true) })
    it('isJsonArray accepts arrays of JSON values', () => { expect(isJsonArray([1, 'x', null])).toBe(true) })
    it('isJsonArray rejects arrays with non-JSON values', () => { expect(isJsonArray([1, undefined])).toBe(false) })
    it('isRecord accepts plain objects, rejects arrays/null', () => {
      expect(isRecord({})).toBe(true)
      expect(isRecord([1, 2])).toBe(false)
      expect(isRecord(null)).toBe(false)
    })
  })

  describe('cloneJsonValue', () => {
    it('deep clones nested objects', () => {
      const obj = { a: { b: [1, 2, { c: 3 }] } }
      const cloned = cloneJsonValue(obj)
      expect(cloned).toEqual(obj)
      expect(cloned).not.toBe(obj)
      expect(cloned.a).not.toBe(obj.a)
    })
    it('clones primitive values', () => {
      expect(cloneJsonValue(42)).toBe(42)
      expect(cloneJsonValue('str')).toBe('str')
      expect(cloneJsonValue(null)).toBe(null)
    })
  })

  describe('asJsonObject / asJsonValue', () => {
    it('asJsonObject clones and casts', () => {
      const obj = { x: 1 }
      const result = asJsonObject(obj)
      expect(result).toEqual({ x: 1 })
      expect(result).not.toBe(obj)
    })
    it('asJsonValue clones and casts', () => {
      const val = [1, 2, 3]
      const result = asJsonValue(val)
      expect(result).toEqual([1, 2, 3])
      expect(result).not.toBe(val)
    })
  })

  describe('readJsonObject / readJsonValue', () => {
    it('readJsonObject returns cloned object for valid input', () => {
      const obj = { a: 1 }
      const result = readJsonObject(obj)
      expect(result).toEqual(obj)
      expect(result).not.toBe(obj)
    })
    it('readJsonObject returns null for non-object', () => {
      expect(readJsonObject('string')).toBeNull()
      expect(readJsonObject(null)).toBeNull()
    })
    it('readJsonValue returns cloned value for valid input', () => {
      expect(readJsonValue(42)).toBe(42)
      expect(readJsonValue('str')).toBe('str')
      expect(readJsonValue(null)).toBeNull()
    })
    it('readJsonValue returns null for invalid input', () => {
      expect(readJsonValue(undefined)).toBeNull()
      expect(readJsonValue(() => 1)).toBeNull()
    })
  })

  describe('readKeywords', () => {
    it('parses comma-separated string', () => {
      expect(readKeywords('a, b, c')).toEqual(['a', 'b', 'c'])
    })
    it('filters empty entries from string', () => {
      expect(readKeywords('a,, b,')).toEqual(['a', 'b'])
    })
    it('accepts string array', () => {
      expect(readKeywords(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
    })
    it('filters non-strings from array', () => {
      expect(readKeywords(['a', 42, null, 'b'])).toEqual(['a', 'b'])
    })
    it('returns empty array for non-string non-array', () => {
      expect(readKeywords(42)).toEqual([])
      expect(readKeywords(null)).toEqual([])
      expect(readKeywords(undefined)).toEqual([])
    })
    it('filters empty/whitespace strings from array', () => {
      expect(readKeywords(['a', '', '  '])).toEqual(['a'])
    })
  })

  describe('readJsonStringRecord', () => {
    it('returns null for non-object', () => {
      expect(readJsonStringRecord(null, 'bad')).toBeNull()
    })
    it('returns the record for valid string-valued object', () => {
      expect(readJsonStringRecord({ a: '1', b: '2' }, 'bad')).toEqual({ a: '1', b: '2' })
    })
    it('throws for non-string values', () => {
      expect(() => readJsonStringRecord({ a: 42 }, 'bad')).toThrow(BadRequestException)
      expect(() => readJsonStringRecord({ a: 42 }, 'bad')).toThrow('bad')
    })
  })

  describe('readPluginLlmMessages', () => {
    it('throws for empty array', () => {
      expect(() => readPluginLlmMessages([], 'empty')).toThrow('empty')
    })
    it('throws for non-array', () => {
      expect(() => readPluginLlmMessages(null, 'nope')).toThrow('nope')
    })
    it('parses valid messages', () => {
      const result = readPluginLlmMessages([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ], 'empty')
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({ content: 'hello', role: 'user' })
      expect(result[1]).toEqual({ content: 'hi', role: 'assistant' })
    })
    it('skips null/undefined entries', () => {
      const result = readPluginLlmMessages([{ role: 'user', content: 'hi' }, null, { role: 'assistant', content: 'ok' }], 'empty')
      expect(result).toHaveLength(2)
    })
    it('rejects invalid role', () => {
      expect(() => readPluginLlmMessages([{ role: 'invalid', content: 'x' }], 'empty')).toThrow('role 不合法')
    })
    it('rejects invalid content', () => {
      expect(() => readPluginLlmMessages([{ role: 'user', content: 42 }], 'empty')).toThrow('content 不合法')
    })
    it('rejects non-object message', () => {
      expect(() => readPluginLlmMessages(['string'], 'empty')).toThrow('必须是对象')
    })
    it('supports all 4 roles', () => {
      const result = readPluginLlmMessages([
        { role: 'user', content: 'u' },
        { role: 'assistant', content: 'a' },
        { role: 'system', content: 's' },
        { role: 'tool', content: 't' },
      ], 'empty')
      expect(result).toHaveLength(4)
    })
    it('uses custom label in error messages', () => {
      expect(() => readPluginLlmMessages([{ role: 'bad', content: 'x' }], 'nope', (m) => new Error(m), 'customLabel')).toThrow('customLabel')
    })
    it('uses custom error factory', () => {
      class CustomError extends Error {}
      expect(() => readPluginLlmMessages([], 'err', () => new CustomError('err'))).toThrow(CustomError)
    })
    it('deep clones each message', () => {
      const original = { role: 'user', content: [{ type: 'text', text: 'hi' }] }
      const result = readPluginLlmMessages([original], 'empty')
      expect(result[0]).toEqual({ content: [{ type: 'text', text: 'hi' }], role: 'user' })
    })
    it('accepts array content', () => {
      const result = readPluginLlmMessages([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], 'empty')
      expect(result).toHaveLength(1)
      expect(Array.isArray(result[0].content)).toBe(true)
    })
  })

  describe('readAssistantStreamPart', () => {
    it('returns null for non-record', () => {
      expect(readAssistantStreamPart(null)).toBeNull()
      expect(readAssistantStreamPart('str')).toBeNull()
    })
    it('returns null for unknown type', () => {
      expect(readAssistantStreamPart({ type: 'unknown' })).toBeNull()
    })
    it('parses text-delta', () => {
      expect(readAssistantStreamPart({ type: 'text-delta', text: 'Hello' })).toEqual({ type: 'text-delta', text: 'Hello' })
    })
    it('parses tool-call', () => {
      const result = readAssistantStreamPart({ type: 'tool-call', toolCallId: 'call-1', toolName: 'my_tool', input: { x: 1 } })
      expect(result).toEqual({ type: 'tool-call', toolCallId: 'call-1', toolName: 'my_tool', input: { x: 1 } })
    })
    it('parses tool-result', () => {
      const result = readAssistantStreamPart({ type: 'tool-result', toolCallId: 'call-1', toolName: 'my_tool', output: { ok: true } })
      expect(result).toEqual({ type: 'tool-result', toolCallId: 'call-1', toolName: 'my_tool', output: { ok: true } })
    })
    it('parses tool-error as invalid tool result', () => {
      const result = readAssistantStreamPart({ type: 'tool-error', toolCallId: 'call-1', toolName: 'my_tool', error: 'Failed', input: { x: 1 } })
      expect(result).not.toBeNull()
      expect(result!.type).toBe('tool-result')
      if (result && 'output' in result) {
        const output = result.output as any
        expect(output.type).toBe('invalid-tool-result')
        expect(output.tool).toBe('my_tool')
        expect(output.error).toBe('Failed')
      }
    })
    it('sanitizes channel suffix from tool name', () => {
      const result = readAssistantStreamPart({ type: 'tool-call', toolCallId: 'c1', toolName: 'my_tool<|channel|>abc123', input: {} })
      expect(result).not.toBeNull()
      if (result && 'toolName' in result) expect(result.toolName).toBe('my_tool')
    })
    it('uses default error message when no error text', () => {
      const result = readAssistantStreamPart({ type: 'tool-error', toolCallId: 'c1', toolName: 't', error: null, input: null })
      expect(result).not.toBeNull()
      if (result && 'output' in result) {
        const output = result.output as any
        expect(output.error).toBe('工具执行失败')
      }
    })
    it('returns null for tool-call missing strings', () => {
      expect(readAssistantStreamPart({ type: 'tool-call', toolCallId: 42, toolName: null, input: {} })).toBeNull()
    })
  })

  describe('readAssistantRawCustomBlocks / readAssistantResponseCustomBlocks', () => {
    it('extracts custom blocks from raw delta', () => {
      const result = readAssistantRawCustomBlocks({ type: 'raw', rawValue: { choices: [{ delta: { customKey: 'customValue', content: 'skip' } }] } })
      expect(result).toEqual([{ key: 'customKey', kind: 'text', value: 'customValue' }])
    })
    it('skips known delta keys', () => {
      const result = readAssistantRawCustomBlocks({ type: 'raw', rawValue: { choices: [{ delta: { audio: 'x', content: 'y', role: 'z' } }] } })
      expect(result).toEqual([])
    })
    it('extracts json custom blocks', () => {
      const result = readAssistantRawCustomBlocks({ type: 'raw', rawValue: { choices: [{ delta: { stats: { ok: true } } }] } })
      expect(result).toEqual([{ key: 'stats', kind: 'json', value: { ok: true } }])
    })
    it('skips empty text blocks', () => {
      const result = readAssistantRawCustomBlocks({ type: 'raw', rawValue: { choices: [{ delta: { empty: '' } }] } })
      expect(result).toEqual([])
    })
    it('returns empty for non-raw type', () => {
      expect(readAssistantRawCustomBlocks({ type: 'other', rawValue: null })).toEqual([])
    })
    it('returns empty for null rawValue', () => {
      expect(readAssistantRawCustomBlocks(null)).toEqual([])
    })
    it('reads response custom blocks from message field', () => {
      const result = readAssistantResponseCustomBlocks({ choices: [{ message: { summary: 'short' } }] })
      expect(result).toEqual([{ key: 'summary', kind: 'text', value: 'short' }])
    })
    it('returns empty for response without choices', () => {
      expect(readAssistantResponseCustomBlocks({})).toEqual([])
    })
  })

  describe('readMessageTarget', () => {
    it('returns null for non-record', () => { expect(readMessageTarget('str')).toBeNull() })
    it('parses valid target', () => {
      expect(readMessageTarget({ type: 'conversation', id: 'conv-1' })).toEqual({ id: 'conv-1', type: 'conversation' })
    })
    it('throws for non-conversation type', () => {
      expect(() => readMessageTarget({ type: 'channel', id: 'x' })).toThrow('目前只支持 conversation')
    })
    it('throws for empty id', () => {
      expect(() => readMessageTarget({ type: 'conversation', id: '' })).toThrow('不能为空')
    })
    it('throws for whitespace-only id', () => {
      expect(() => readMessageTarget({ type: 'conversation', id: '  ' })).toThrow('不能为空')
    })
    it('trims id', () => {
      expect(readMessageTarget({ type: 'conversation', id: '  conv-1  ' })).toEqual({ id: 'conv-1', type: 'conversation' })
    })
  })

  describe('readOptionalBoolean', () => {
    it('returns null for undefined', () => { expect(readOptionalBoolean({}, 'key')).toBeNull() })
    it('returns boolean value', () => { expect(readOptionalBoolean({ key: true }, 'key')).toBe(true) })
    it('throws for non-boolean', () => { expect(() => readOptionalBoolean({ key: 42 }, 'key')).toThrow('必须是布尔值') })
  })

  describe('readOptionalString', () => {
    it('returns null for undefined', () => { expect(readOptionalString({}, 'key')).toBeNull() })
    it('returns trimmed string', () => { expect(readOptionalString({ key: ' hello ' }, 'key')).toBe('hello') })
    it('returns null for empty string', () => { expect(readOptionalString({ key: '' }, 'key')).toBeNull() })
    it('returns null for whitespace', () => { expect(readOptionalString({ key: '  ' }, 'key')).toBeNull() })
    it('returns null for non-string', () => { expect(readOptionalString({ key: 42 }, 'key')).toBeNull() })
  })

  describe('readPositiveInteger', () => {
    it('returns null for undefined', () => { expect(readPositiveInteger({}, 'key')).toBeNull() })
    it('returns positive integer', () => { expect(readPositiveInteger({ key: 5 }, 'key')).toBe(5) })
    it('throws for zero', () => { expect(() => readPositiveInteger({ key: 0 }, 'key')).toThrow('必须是正整数') })
    it('throws for negative', () => { expect(() => readPositiveInteger({ key: -1 }, 'key')).toThrow('必须是正整数') })
    it('throws for float', () => { expect(() => readPositiveInteger({ key: 3.5 }, 'key')).toThrow('必须是正整数') })
    it('throws for non-number', () => { expect(() => readPositiveInteger({ key: '5' }, 'key')).toThrow('必须是正整数') })
  })

  describe('readRequiredJsonValue', () => {
    it('returns valid JSON value', () => { expect(readRequiredJsonValue({ key: { a: 1 } }, 'key')).toEqual({ a: 1 }) })
    it('throws for invalid JSON', () => { expect(() => readRequiredJsonValue({ key: undefined }, 'key')).toThrow('必须是合法 JSON 数据') })
    it('throws for function', () => { expect(() => readRequiredJsonValue({ key: () => 1 }, 'key')).toThrow('必须是合法 JSON 数据') })
  })

  describe('readRequiredString', () => {
    it('returns trimmed string', () => { expect(readRequiredString({ key: ' value ' }, 'key')).toBe('value') })
    it('throws for missing', () => { expect(() => readRequiredString({}, 'key')).toThrow('不能为空') })
    it('throws for empty', () => { expect(() => readRequiredString({ key: '' }, 'key')).toThrow('不能为空') })
  })

  describe('readScope', () => {
    it('defaults to plugin', () => { expect(readScope({})).toBe('plugin') })
    it('accepts conversation', () => { expect(readScope({ scope: 'conversation' })).toBe('conversation') })
    it('accepts plugin', () => { expect(readScope({ scope: 'plugin' })).toBe('plugin') })
    it('accepts user', () => { expect(readScope({ scope: 'user' })).toBe('user') })
    it('throws for invalid scope', () => { expect(() => readScope({ scope: 'admin' })).toThrow('只能是 plugin、conversation 或 user') })
  })

  describe('readScopedKey', () => {
    it('reads valid key', () => { expect(readScopedKey({ key: 'myKey' })).toBe('myKey') })
    it('throws for reserved prefix', () => {
      expect(() => readScopedKey({ key: `${SCOPED_STORE_PREFIX}key` })).toThrow('不能以保留前缀')
    })
    it('throws for empty', () => { expect(() => readScopedKey({})).toThrow('不能为空') })
  })

  describe('requireContextField', () => {
    it('returns existing field', () => { expect(requireContextField({ userId: 'u1' }, 'userId')).toBe('u1') })
    it('throws for missing field', () => { expect(() => requireContextField({}, 'userId')).toThrow('缺少') })
    it('throws for empty string', () => { expect(() => requireContextField({ conversationId: '' }, 'conversationId')).toThrow('缺少') })
  })
})
