import { describe, it, expect } from 'vitest'

// ============================================================================
// 类型定义（对齐 dto/mcp-server.dto.ts）
// ============================================================================

type McpEnvValueSource = 'env-ref' | 'literal' | 'stored-secret'

interface McpServerEnvEntry {
  key: string
  source: McpEnvValueSource
  value: string
  hasStoredValue?: boolean
}

interface McpServerConfig {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  envEntries?: McpServerEnvEntry[]
  eventLog: { maxFileSizeMb: number }
}

interface McpServerDto {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  envEntries?: Array<{
    key: string
    source?: 'env-ref' | 'literal' | 'stored-secret'
    value: string
    hasStoredValue?: boolean
  }>
  eventLog?: { maxFileSizeMb?: number }
}

// ============================================================================
// 内联纯函数（对齐 mcp.controller.ts）
// ============================================================================

function normalizeEventLogSettings(settings?: { maxFileSizeMb?: number } | null): { maxFileSizeMb: number } {
  return !settings || typeof settings.maxFileSizeMb !== 'number' || Number.isNaN(settings.maxFileSizeMb)
    ? { maxFileSizeMb: 1 }
    : { maxFileSizeMb: Math.max(0, settings.maxFileSizeMb) }
}

function inferEnvSource(value: string): McpEnvValueSource {
  const normalizedValue = value.trim()
  return normalizedValue.startsWith('${') && normalizedValue.endsWith('}')
    ? 'env-ref'
    : 'literal'
}

function normalizeEnvMap(env: McpServerDto['env']): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, value]) => [key.trim(), value.trim()] as const)
      .filter(([key]) => key.length > 0),
  )
}

function normalizeEnvEntries(envEntries: McpServerDto['envEntries']): McpServerEnvEntry[] {
  return (envEntries ?? [])
    .map((entry) => ({
      key: entry.key.trim(),
      source: entry.source ?? inferEnvSource(entry.value),
      value: entry.value.trim(),
      ...(entry.hasStoredValue ? { hasStoredValue: true } : {}),
    }))
    .filter((entry) => entry.key.length > 0)
}

function normalizeMcpEventLog(eventLog: McpServerDto['eventLog']): McpServerConfig['eventLog'] {
  return normalizeEventLogSettings(
    typeof eventLog?.maxFileSizeMb === 'number'
      ? { maxFileSizeMb: eventLog.maxFileSizeMb }
      : undefined,
  )
}

function toMcpServerConfig(input: McpServerDto): McpServerConfig {
  const envEntries = normalizeEnvEntries(input.envEntries)
  const env = {
    ...normalizeEnvMap(input.env),
    ...Object.fromEntries(
      envEntries
        .filter((entry) => entry.source !== 'stored-secret')
        .map((entry) => [entry.key, entry.value]),
    ),
  }
  return {
    name: input.name.trim(),
    command: input.command.trim(),
    args: input.args,
    env,
    ...(envEntries.length > 0 ? { envEntries } : {}),
    eventLog: normalizeMcpEventLog(input.eventLog),
  }
}

// ========================================================================
// 测试
// ========================================================================

describe('McpController — inferEnvSource', () => {
  it('${VAR} 格式识别为 env-ref', () => {
    expect(inferEnvSource('${API_KEY}')).toBe('env-ref')
  })

  it('普通字符串识别为 literal', () => {
    expect(inferEnvSource('plain_value')).toBe('literal')
    expect(inferEnvSource('')).toBe('literal')
  })

  it('trim 后判断', () => {
    expect(inferEnvSource('  ${API_KEY}  ')).toBe('env-ref')
  })

  it('缺少闭合括号识别为 literal', () => {
    expect(inferEnvSource('${API_KEY')).toBe('literal')
  })

  it('缺少开始符号识别为 literal', () => {
    expect(inferEnvSource('API_KEY}')).toBe('literal')
  })
})

describe('McpController — normalizeEnvMap', () => {
  it('undefined 返回空对象', () => {
    expect(normalizeEnvMap(undefined)).toEqual({})
  })

  it('过滤非字符串值', () => {
    expect(normalizeEnvMap({ str: 'ok', num: 123, nil: null } as Record<string, unknown>)).toEqual({ str: 'ok' })
  })

  it('trim key 和 value', () => {
    expect(normalizeEnvMap({ ' KEY ': ' VALUE ' })).toEqual({ KEY: 'VALUE' })
  })

  it('过滤空 key', () => {
    expect(normalizeEnvMap({ '': 'val', key: 'v' })).toEqual({ key: 'v' })
  })

  it('空对象返回空对象', () => {
    expect(normalizeEnvMap({})).toEqual({})
  })
})

describe('McpController — normalizeEnvEntries', () => {
  it('undefined 返回空数组', () => {
    expect(normalizeEnvEntries(undefined)).toEqual([])
  })

  it('无 source 时从 value 推断', () => {
    const result = normalizeEnvEntries([
      { key: 'K1', value: '${VAR}' },
      { key: 'K2', value: 'plain' },
    ])
    expect(result[0].source).toBe('env-ref')
    expect(result[1].source).toBe('literal')
  })

  it('保留显式 source', () => {
    const result = normalizeEnvEntries([
      { key: 'K', source: 'stored-secret', value: '' },
    ])
    expect(result[0].source).toBe('stored-secret')
  })

  it('保留 hasStoredValue', () => {
    const result = normalizeEnvEntries([
      { key: 'K', source: 'stored-secret', value: '', hasStoredValue: true },
    ])
    expect(result[0].hasStoredValue).toBe(true)
  })

  it('不保留未设置的 hasStoredValue', () => {
    const result = normalizeEnvEntries([
      { key: 'K', source: 'literal', value: 'v' },
    ])
    expect(result[0]).not.toHaveProperty('hasStoredValue')
  })

  it('trim key 和 value', () => {
    const result = normalizeEnvEntries([
      { key: '  KEY  ', source: 'env-ref', value: '  ${VAL}  ' },
    ])
    expect(result[0].key).toBe('KEY')
    expect(result[0].value).toBe('${VAL}')
  })

  it('过滤空 key', () => {
    const result = normalizeEnvEntries([
      { key: '', source: 'literal', value: 'v' },
      { key: 'ok', source: 'literal', value: 'v' },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].key).toBe('ok')
  })
})

describe('McpController — normalizeMcpEventLog', () => {
  it('undefined 返回默认', () => {
    expect(normalizeMcpEventLog(undefined)).toEqual({ maxFileSizeMb: 1 })
  })

  it('{} 返回默认', () => {
    expect(normalizeMcpEventLog({})).toEqual({ maxFileSizeMb: 1 })
  })

  it('合法值保留', () => {
    expect(normalizeMcpEventLog({ maxFileSizeMb: 5 })).toEqual({ maxFileSizeMb: 5 })
  })

  it('负数钳制为 0', () => {
    expect(normalizeMcpEventLog({ maxFileSizeMb: -1 })).toEqual({ maxFileSizeMb: 0 })
  })

  it('NaN 回退默认', () => {
    expect(normalizeMcpEventLog({ maxFileSizeMb: NaN })).toEqual({ maxFileSizeMb: 1 })
  })

  it('0 保留', () => {
    expect(normalizeMcpEventLog({ maxFileSizeMb: 0 })).toEqual({ maxFileSizeMb: 0 })
  })
})

describe('McpController — toMcpServerConfig', () => {
  it('基本转换', () => {
    const result = toMcpServerConfig({
      name: '  my-server  ',
      command: '  npx  ',
      args: ['-y', 'tool'],
      env: { KEY: 'val' },
    })
    expect(result.name).toBe('my-server')
    expect(result.command).toBe('npx')
    expect(result.args).toEqual(['-y', 'tool'])
    expect(result.env.KEY).toBe('val')
    expect(result.envEntries).toBeUndefined()
    expect(result.eventLog).toEqual({ maxFileSizeMb: 1 })
  })

  it('envEntries 非空时包含 envEntries 字段', () => {
    const result = toMcpServerConfig({
      name: 'srv', command: 'cmd', args: [],
      envEntries: [{ key: 'K', source: 'env-ref', value: '${V}' }],
    })
    expect(result.envEntries).toBeDefined()
    expect(result.envEntries).toHaveLength(1)
  })

  it('envEntries 中的 stored-secret 不出现在 env 中', () => {
    const result = toMcpServerConfig({
      name: 'srv', command: 'cmd', args: [],
      envEntries: [
        { key: 'VISIBLE', source: 'literal', value: 'v' },
        { key: 'SECRET', source: 'stored-secret', value: '' },
      ],
    })
    expect(result.env.VISIBLE).toBe('v')
    expect(result.env).not.toHaveProperty('SECRET')
  })

  it('envEntries 覆盖 env 中同名 key', () => {
    const result = toMcpServerConfig({
      name: 'srv', command: 'cmd', args: [],
      env: { KEY: 'from-env' },
      envEntries: [{ key: 'KEY', source: 'literal', value: 'from-entry' }],
    })
    expect(result.env.KEY).toBe('from-entry')
  })

  it('env 与 envEntries 合并结果', () => {
    const result = toMcpServerConfig({
      name: 'srv', command: 'cmd', args: [],
      env: { A: 'a' },
      envEntries: [{ key: 'B', source: 'literal', value: 'b' }],
    })
    expect(result.env).toEqual({ A: 'a', B: 'b' })
  })

  it('trim 所有字符串字段', () => {
    const result = toMcpServerConfig({
      name: '  n  ', command: '  c  ', args: ['a'],
      env: { KEY: ' val ' },
    })
    expect(result.name).toBe('n')
    expect(result.command).toBe('c')
    expect(result.env.KEY).toBe('val')
  })

  it('args 不 trim（保留原样）', () => {
    const result = toMcpServerConfig({
      name: 'srv', command: 'cmd', args: ['  with-spaces  '],
    })
    expect(result.args[0]).toBe('  with-spaces  ')
  })
})
