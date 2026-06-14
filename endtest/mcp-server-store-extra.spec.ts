import { describe, it, expect } from 'vitest'
import * as path from 'node:path'

// ============================================================================
// 类型定义（对齐 mcp-server-store.service.ts 和 @garlic-claw/shared）
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

interface StoredMcpServerRecord {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  eventLog: { maxFileSizeMb: number }
}

// ============================================================================
// 内联纯函数（对齐 mcp-server-store.service.ts 未覆盖部分）
// ============================================================================

function normalizeEventLogSettings(settings?: { maxFileSizeMb?: number } | null): { maxFileSizeMb: number } {
  return !settings || typeof settings.maxFileSizeMb !== 'number' || Number.isNaN(settings.maxFileSizeMb)
    ? { maxFileSizeMb: 1 }
    : { maxFileSizeMb: Math.max(0, settings.maxFileSizeMb) }
}

function isEnvReference(value: string): boolean {
  return value.startsWith('${') && value.endsWith('}')
}

// ---- normalizeIncomingEnvEntries ----

function normalizeEnvMap(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env)
      .map(([key, value]) => [key.trim(), value.trim()] as const)
      .filter(([key, value]) => key.length > 0 && value.length > 0),
  )
}

function normalizeIncomingEnvEntries(server: McpServerConfig): McpServerEnvEntry[] {
  if (!Array.isArray(server.envEntries) || server.envEntries.length === 0) {
    return Object.entries(normalizeEnvMap(server.env)).map(([key, value]) => ({
      key,
      source: isEnvReference(value) ? 'env-ref' : 'literal',
      value,
    }))
  }
  return server.envEntries
    .map((entry) => ({
      key: entry.key.trim(),
      source: entry.source,
      value: entry.value.trim(),
      ...(entry.hasStoredValue ? { hasStoredValue: true } : {}),
    }))
    .filter((entry) => entry.key.length > 0)
}

// ---- readNextSecretEnv ----

function readNextSecretEnv(
  server: McpServerConfig,
  currentSecrets: Record<string, string>,
): Record<string, string> {
  const nextSecrets: Record<string, string> = {}
  for (const entry of normalizeIncomingEnvEntries(server)) {
    if (entry.source !== 'stored-secret') { continue }
    const key = entry.key.trim()
    const value = entry.value.trim()
    if (value.length > 0) {
      nextSecrets[key] = value
      continue
    }
    if (entry.hasStoredValue && currentSecrets[key]) {
      nextSecrets[key] = currentSecrets[key]
    }
  }
  return nextSecrets
}

// ---- readVisibleEnv ----

function readVisibleEnv(
  server: McpServerConfig,
  fallbackEnv: Record<string, string>,
): Record<string, string> {
  const envFromField = normalizeEnvMap(server.env)
  const normalizedEntries = normalizeIncomingEnvEntries(server)
  const visibleEntries = normalizedEntries
    .filter((entry) => entry.source !== 'stored-secret')
    .map((entry) => [entry.key, entry.value] as const)
  if (
    Array.isArray(server.envEntries)
    && server.envEntries.length > 0
    && visibleEntries.length === 0
    && Object.keys(envFromField).length === 0
  ) {
    return { ...fallbackEnv }
  }
  return {
    ...envFromField,
    ...Object.fromEntries(visibleEntries),
  }
}

// ---- normalizeIncomingServer ----

function normalizeIncomingServer(
  server: McpServerConfig,
  currentSecrets: Record<string, string>,
  currentServer?: StoredMcpServerRecord,
): { record: StoredMcpServerRecord; secretEnv: Record<string, string> } {
  const visibleEnv = readVisibleEnv(server, currentServer?.env ?? {})
  const secretEnv = readNextSecretEnv(server, currentSecrets)
  const storedEnv = { ...visibleEnv }
  for (const secretKey of Object.keys(secretEnv)) {
    if (!isEnvReference(storedEnv[secretKey] ?? '')) {
      delete storedEnv[secretKey]
    }
  }
  return {
    record: {
      name: server.name,
      command: server.command,
      args: [...server.args],
      env: storedEnv,
      eventLog: normalizeEventLogSettings(server.eventLog),
    },
    secretEnv,
  }
}

// ---- serializeStoredServer / cloneStoredServerRecord ----

function serializeStoredServer(server: StoredMcpServerRecord): StoredMcpServerRecord {
  return {
    name: server.name,
    command: server.command,
    args: [...server.args],
    env: { ...server.env },
    eventLog: normalizeEventLogSettings(server.eventLog),
  }
}

function cloneStoredServerRecord(server: StoredMcpServerRecord): StoredMcpServerRecord {
  return serializeStoredServer(server)
}

// ---- toServerConfigWithSecrets ----

function mergeEnvEntries(
  configEnv: Record<string, string>,
  secretEnv: Record<string, string>,
  exposeStoredSecretValue: boolean,
): McpServerEnvEntry[] {
  const entriesByKey = new Map<string, McpServerEnvEntry>()
  for (const [key, value] of Object.entries(configEnv)) {
    entriesByKey.set(key, {
      key,
      source: isEnvReference(value) ? 'env-ref' : 'literal',
      value,
    })
  }
  for (const [key, value] of Object.entries(secretEnv)) {
    entriesByKey.set(key, {
      key,
      source: 'stored-secret',
      value: exposeStoredSecretValue ? value : '',
      hasStoredValue: true,
    })
  }
  return [...entriesByKey.values()].sort((left, right) => left.key.localeCompare(right.key))
}

function toServerConfigWithSecrets(
  server: StoredMcpServerRecord,
  secretEnv: Record<string, string>,
  exposeStoredSecretValue: boolean,
): McpServerConfig {
  const envEntries = mergeEnvEntries(server.env, secretEnv, exposeStoredSecretValue)
  const config: McpServerConfig = {
    name: server.name,
    command: server.command,
    args: [...server.args],
    env: Object.fromEntries(
      envEntries.map((entry) => [
        entry.key,
        entry.source === 'stored-secret' && !exposeStoredSecretValue ? '' : entry.value,
      ]),
    ),
    eventLog: normalizeEventLogSettings(server.eventLog),
  }
  if (envEntries.length > 0) {
    config.envEntries = envEntries
  }
  return config
}

function toSnapshotServerConfig(
  server: StoredMcpServerRecord,
  secretEnv: Record<string, string>,
): McpServerConfig {
  return toServerConfigWithSecrets(server, secretEnv, false)
}

function toRuntimeServerConfig(
  server: StoredMcpServerRecord,
  secretEnv: Record<string, string>,
): McpServerConfig {
  return toServerConfigWithSecrets(server, secretEnv, true)
}

// ---- readReportedMcpConfigPath ----

function readReportedMcpConfigPath(configRootPath: string): string {
  if (process.env.GARLIC_CLAW_MCP_CONFIG_PATH) { return configRootPath }
  return 'config/mcp/servers'
}

// ---- resolveServerFilePath ----

function resolveServerFilePath(configRootPath: string, serverName: string): string {
  return path.join(configRootPath, `${encodeURIComponent(serverName)}.json`)
}

// ========================================================================
// 测试
// ========================================================================

describe('McpServerStore — serializeStoredServer', () => {
  it('保留所有字段', () => {
    const server: StoredMcpServerRecord = {
      name: 'tavily',
      command: 'npx',
      args: ['-y', 'tavily-mcp@latest'],
      env: { KEY: 'val' },
      eventLog: { maxFileSizeMb: 5 },
    }
    const result = serializeStoredServer(server)
    expect(result).toEqual(server)
  })

  it('args 是副本', () => {
    const server: StoredMcpServerRecord = {
      name: 'srv', command: 'cmd', args: ['a', 'b'], env: {}, eventLog: { maxFileSizeMb: 1 },
    }
    const result = serializeStoredServer(server)
    result.args.push('c')
    expect(server.args).toEqual(['a', 'b'])
  })

  it('env 是副本', () => {
    const server: StoredMcpServerRecord = {
      name: 'srv', command: 'cmd', args: [], env: { K: 'v' }, eventLog: { maxFileSizeMb: 1 },
    }
    const result = serializeStoredServer(server)
    result.env.K = 'modified'
    expect(server.env.K).toBe('v')
  })

  it('eventLog 被规范化', () => {
    const server: StoredMcpServerRecord = {
      name: 'srv', command: 'cmd', args: [], env: {},
      eventLog: { maxFileSizeMb: -1 as unknown as number },
    }
    const result = serializeStoredServer(server)
    expect(result.eventLog.maxFileSizeMb).toBe(0)
  })

  it('NaN eventLog 回退默认', () => {
    const server: StoredMcpServerRecord = {
      name: 'srv', command: 'cmd', args: [], env: {},
      eventLog: { maxFileSizeMb: NaN },
    }
    const result = serializeStoredServer(server)
    expect(result.eventLog.maxFileSizeMb).toBe(1)
  })
})

describe('McpServerStore — cloneStoredServerRecord', () => {
  it('返回相同值的独立对象', () => {
    const server: StoredMcpServerRecord = {
      name: 'srv', command: 'cmd', args: ['a'], env: { K: 'v' }, eventLog: { maxFileSizeMb: 1 },
    }
    const clone = cloneStoredServerRecord(server)
    expect(clone).toEqual(server)
    clone.name = 'modified'
    expect(server.name).toBe('srv')
  })
})

describe('McpServerStore — toServerConfigWithSecrets / toSnapshotServerConfig / toRuntimeServerConfig', () => {
  const server: StoredMcpServerRecord = {
    name: 'tavily',
    command: 'npx',
    args: ['-y', 'tavily-mcp@latest'],
    env: { TAVILY_API_KEY: '${TAVILY_API_KEY}', SEARCH_DEPTH: 'advanced' },
    eventLog: { maxFileSizeMb: 1 },
  }

  it('toSnapshotServerConfig 隐藏 secret value', () => {
    const result = toSnapshotServerConfig(server, { TAVILY_API_KEY: 'sk-real' })
    expect(result.env.TAVILY_API_KEY).toBe('')
    expect(result.env.SEARCH_DEPTH).toBe('advanced')
    expect(result.envEntries).toEqual([
      { key: 'SEARCH_DEPTH', source: 'literal', value: 'advanced' },
      { key: 'TAVILY_API_KEY', source: 'stored-secret', value: '', hasStoredValue: true },
    ])
  })

  it('toRuntimeServerConfig 暴露 secret value', () => {
    const result = toRuntimeServerConfig(server, { TAVILY_API_KEY: 'sk-real' })
    expect(result.env.TAVILY_API_KEY).toBe('sk-real')
    expect(result.env.SEARCH_DEPTH).toBe('advanced')
  })

  it('无 secrets 时 snapshot 与 runtime 相同', () => {
    const snap = toSnapshotServerConfig(server, {})
    const runtime = toRuntimeServerConfig(server, {})
    expect(snap.env).toEqual(runtime.env)
  })

  it('空 envEntries 时省略该字段', () => {
    const emptyServer: StoredMcpServerRecord = {
      name: 'empty', command: 'cmd', args: [], env: {}, eventLog: { maxFileSizeMb: 1 },
    }
    const result = toServerConfigWithSecrets(emptyServer, {}, false)
    expect(result.envEntries).toBeUndefined()
  })

  it('envEntries 按 key 排序', () => {
    const srv: StoredMcpServerRecord = {
      name: 's', command: 'c', args: [], env: { B: 'b', A: 'a' }, eventLog: { maxFileSizeMb: 1 },
    }
    const result = toServerConfigWithSecrets(srv, { C: 'c' }, true)
    expect(result.envEntries!.map((e) => e.key)).toEqual(['A', 'B', 'C'])
  })

  it('exposeStoredSecretValue=false 时 secret 值为空字符串', () => {
    const result = toServerConfigWithSecrets(server, { TAVILY_API_KEY: 'sk-real' }, false)
    const secretEntry = result.envEntries!.find((e) => e.source === 'stored-secret')
    expect(secretEntry!.value).toBe('')
    expect(secretEntry!.hasStoredValue).toBe(true)
  })

  it('exposeStoredSecretValue=true 时 secret 值暴露', () => {
    const result = toServerConfigWithSecrets(server, { TAVILY_API_KEY: 'sk-real' }, true)
    const secretEntry = result.envEntries!.find((e) => e.source === 'stored-secret')
    expect(secretEntry!.value).toBe('sk-real')
  })
})

describe('McpServerStore — readNextSecretEnv', () => {
  it('提取 stored-secret 条目并保留新值', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: {},
      envEntries: [
        { key: 'KEY1', source: 'stored-secret', value: 'new-value' },
      ],
      eventLog: { maxFileSizeMb: 1 },
    }
    const result = readNextSecretEnv(server, {})
    expect(result).toEqual({ KEY1: 'new-value' })
  })

  it('空 value + hasStoredValue 保留现有 secret', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: {},
      envEntries: [
        { key: 'KEY1', source: 'stored-secret', value: '', hasStoredValue: true },
      ],
      eventLog: { maxFileSizeMb: 1 },
    }
    const result = readNextSecretEnv(server, { KEY1: 'existing-value' })
    expect(result).toEqual({ KEY1: 'existing-value' })
  })

  it('空 value + 无 hasStoredValue 不保留', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: {},
      envEntries: [
        { key: 'KEY1', source: 'stored-secret', value: '' },
      ],
      eventLog: { maxFileSizeMb: 1 },
    }
    const result = readNextSecretEnv(server, { KEY1: 'existing-value' })
    expect(result).toEqual({})
  })

  it('空 value + hasStoredValue 但 currentSecrets 无该 key', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: {},
      envEntries: [
        { key: 'KEY1', source: 'stored-secret', value: '', hasStoredValue: true },
      ],
      eventLog: { maxFileSizeMb: 1 },
    }
    const result = readNextSecretEnv(server, {})
    expect(result).toEqual({})
  })

  it('非 stored-secret 条目被忽略', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: {},
      envEntries: [
        { key: 'K1', source: 'literal', value: 'v1' },
        { key: 'K2', source: 'env-ref', value: '${V2}' },
        { key: 'K3', source: 'stored-secret', value: 'v3' },
      ],
      eventLog: { maxFileSizeMb: 1 },
    }
    const result = readNextSecretEnv(server, {})
    expect(result).toEqual({ K3: 'v3' })
  })

  it('trim key 和 value', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: {},
      envEntries: [
        { key: '  KEY  ', source: 'stored-secret', value: '  val  ' },
      ],
      eventLog: { maxFileSizeMb: 1 },
    }
    const result = readNextSecretEnv(server, {})
    expect(result).toEqual({ KEY: 'val' })
  })

  it('env 对象也支持 stored-secret 推断', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: {},
      envEntries: [
        { key: 'K', source: 'stored-secret', value: 'v' },
      ],
      eventLog: { maxFileSizeMb: 1 },
    }
    const result = readNextSecretEnv(server, {})
    expect(result).toEqual({ K: 'v' })
  })
})

describe('McpServerStore — normalizeIncomingEnvEntries (补充边界)', () => {
  it('env 中的 env-ref 被正确标记', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: { KEY: '${SOME_VAR}' }, eventLog: { maxFileSizeMb: 1 },
    }
    const result = normalizeIncomingEnvEntries(server)
    expect(result[0].source).toBe('env-ref')
    expect(result[0].value).toBe('${SOME_VAR}')
  })

  it('env 中的空 value 过滤后不出现', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: { K1: 'v1', K2: '' }, eventLog: { maxFileSizeMb: 1 },
    }
    const result = normalizeIncomingEnvEntries(server)
    expect(result).toHaveLength(1)
    expect(result[0].key).toBe('K1')
  })

  it('envEntries 中空 key 被过滤', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: {},
      envEntries: [
        { key: '', source: 'literal', value: 'v' },
        { key: 'ok', source: 'literal', value: 'v' },
      ],
      eventLog: { maxFileSizeMb: 1 },
    }
    const result = normalizeIncomingEnvEntries(server)
    expect(result).toHaveLength(1)
    expect(result[0].key).toBe('ok')
  })
})

describe('McpServerStore — readVisibleEnv (补充边界)', () => {
  it('envEntries 全为 stored-secret 时回退到 fallbackEnv', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: {},
      envEntries: [
        { key: 'K', source: 'stored-secret', value: '' },
      ],
      eventLog: { maxFileSizeMb: 1 },
    }
    const result = readVisibleEnv(server, { FALLBACK: 'val' })
    expect(result).toEqual({ FALLBACK: 'val' })
  })

  it('混合 stored-secret 和 visible 时保留 visible', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: {},
      envEntries: [
        { key: 'VISIBLE', source: 'literal', value: 'v' },
        { key: 'SECRET', source: 'stored-secret', value: '' },
      ],
      eventLog: { maxFileSizeMb: 1 },
    }
    const result = readVisibleEnv(server, { FALLBACK: 'val' })
    expect(result).toEqual({ VISIBLE: 'v' })
  })

  it('envEntries 为空时使用 env 字段', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: { KEY: 'val' }, eventLog: { maxFileSizeMb: 1 },
    }
    const result = readVisibleEnv(server, {})
    expect(result).toEqual({ KEY: 'val' })
  })

  it('envEntries 结果覆盖 env 同名 key', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: { KEY: 'from-env' },
      envEntries: [{ key: 'KEY', source: 'literal', value: 'from-entry' }],
      eventLog: { maxFileSizeMb: 1 },
    }
    const result = readVisibleEnv(server, {})
    expect(result.KEY).toBe('from-entry')
  })
})

describe('McpServerStore — normalizeIncomingServer', () => {
  it('基本转换 — 纯 env', () => {
    const server: McpServerConfig = {
      name: 'tavily',
      command: 'npx',
      args: ['-y', 'tavily-mcp@latest'],
      env: { KEY: 'val' },
      eventLog: { maxFileSizeMb: 1 },
    }
    const result = normalizeIncomingServer(server, {})
    expect(result.record.name).toBe('tavily')
    expect(result.record.command).toBe('npx')
    expect(result.record.env).toEqual({ KEY: 'val' })
    expect(result.secretEnv).toEqual({})
  })

  it('stored-secret 条目移入 secretEnv', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: {},
      envEntries: [
        { key: 'VISIBLE', source: 'literal', value: 'v' },
        { key: 'SECRET', source: 'stored-secret', value: 'secret-val' },
      ],
      eventLog: { maxFileSizeMb: 1 },
    }
    const result = normalizeIncomingServer(server, {})
    expect(result.record.env).toEqual({ VISIBLE: 'v' })
    expect(result.secretEnv).toEqual({ SECRET: 'secret-val' })
  })

  it('stored-secret key 从 record.env 中删除（非 env-ref）', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: {},
      envEntries: [
        { key: 'KEY', source: 'stored-secret', value: 'secret-val' },
      ],
      eventLog: { maxFileSizeMb: 1 },
    }
    const result = normalizeIncomingServer(server, {})
    expect(result.record.env).not.toHaveProperty('KEY')
  })

  it('env-ref 引用的 key 保留在 storedEnv 中', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: {},
      envEntries: [
        { key: 'API_KEY', source: 'env-ref', value: '${API_KEY}' },
      ],
      eventLog: { maxFileSizeMb: 1 },
    }
    const result = normalizeIncomingServer(server, {})
    expect(result.record.env).toEqual({ API_KEY: '${API_KEY}' })
  })

  it('previousName 用于 fallbackEnv', () => {
    const currentServer: StoredMcpServerRecord = {
      name: 'old-name', command: 'cmd', args: [], env: { EXISTING: 'keep' }, eventLog: { maxFileSizeMb: 1 },
    }
    const server: McpServerConfig = {
      name: 'new-name', command: 'cmd', args: [],
      env: {},
      envEntries: [{ key: 'K', source: 'stored-secret', value: '' }],
      eventLog: { maxFileSizeMb: 1 },
    }
    const result = normalizeIncomingServer(server, {}, currentServer)
    expect(result.record.env).toEqual({ EXISTING: 'keep' })
  })

  it('仅有 stored-secret 且无 fallback 时 env 为空', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: {},
      envEntries: [
        { key: 'SECRET', source: 'stored-secret', value: 'v' },
      ],
      eventLog: { maxFileSizeMb: 1 },
    }
    const result = normalizeIncomingServer(server, {})
    expect(result.record.env).toEqual({})
    expect(result.secretEnv).toEqual({ SECRET: 'v' })
  })

  it('保留 currentSecrets 中未变更的秘密', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: {},
      envEntries: [
        { key: 'SECRET', source: 'stored-secret', value: '', hasStoredValue: true },
      ],
      eventLog: { maxFileSizeMb: 1 },
    }
    const result = normalizeIncomingServer(server, { SECRET: 'previous-value' })
    expect(result.secretEnv).toEqual({ SECRET: 'previous-value' })
  })

  it('args 被复制（非引用）', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: ['a', 'b'], env: {}, eventLog: { maxFileSizeMb: 1 },
    }
    const result = normalizeIncomingServer(server, {})
    result.record.args.push('c')
    expect(server.args).toEqual(['a', 'b'])
  })

  it('eventLog 被规范化', () => {
    const server: McpServerConfig = {
      name: 'srv', command: 'cmd', args: [], env: {}, eventLog: { maxFileSizeMb: -1 },
    }
    const result = normalizeIncomingServer(server, {})
    expect(result.record.eventLog.maxFileSizeMb).toBe(0)
  })

  it('多 key 混合场景', () => {
    const server: McpServerConfig = {
      name: 'full', command: 'cmd', args: ['arg'],
      env: { VISIBLE_FROM_ENV: 'ev' },
      envEntries: [
        { key: 'VISIBLE_FROM_ENTRY', source: 'literal', value: 've' },
        { key: 'ENV_REF_KEY', source: 'env-ref', value: '${ENV_VAR}' },
        { key: 'SECRET_KEY', source: 'stored-secret', value: 'secret' },
      ],
      eventLog: { maxFileSizeMb: 5 },
    }
    const result = normalizeIncomingServer(server, {})
    expect(result.record.env).toEqual({
      VISIBLE_FROM_ENV: 'ev',
      VISIBLE_FROM_ENTRY: 've',
      ENV_REF_KEY: '${ENV_VAR}',
    })
    expect(result.secretEnv).toEqual({ SECRET_KEY: 'secret' })
    expect(result.record.name).toBe('full')
    expect(result.record.args).toEqual(['arg'])
    expect(result.record.eventLog).toEqual({ maxFileSizeMb: 5 })
  })
})

describe('McpServerStore — readReportedMcpConfigPath', () => {
  const originalEnv = process.env.GARLIC_CLAW_MCP_CONFIG_PATH

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GARLIC_CLAW_MCP_CONFIG_PATH
    } else {
      process.env.GARLIC_CLAW_MCP_CONFIG_PATH = originalEnv
    }
  })

  it('env 未设置时返回相对路径', () => {
    delete process.env.GARLIC_CLAW_MCP_CONFIG_PATH
    expect(readReportedMcpConfigPath('/any/path')).toBe('config/mcp/servers')
  })

  it('env 设置时返回 configRootPath', () => {
    process.env.GARLIC_CLAW_MCP_CONFIG_PATH = '/custom/path'
    expect(readReportedMcpConfigPath('/custom/path')).toBe('/custom/path')
  })
})

describe('McpServerStore — resolveServerFilePath', () => {
  it('URL 编码服务器名', () => {
    const result = resolveServerFilePath('/config/mcp/servers', 'tavily mcp')
    expect(result).toContain(encodeURIComponent('tavily mcp'))
    expect(result).toContain('.json')
  })

  it('普通服务器名', () => {
    const result = resolveServerFilePath('/root', 'weather')
    expect(result).toBe(path.join('/root', 'weather.json'))
  })

  it('特殊字符被编码', () => {
    const result = resolveServerFilePath('/root', 'a/b:c')
    expect(result).not.toContain('/')
    expect(result).toContain(encodeURIComponent('/'))
  })

  it('路径拼接正确', () => {
    const result = resolveServerFilePath('/config/mcp/servers', 'tavily')
    expect(result).toContain(path.join('config', 'mcp', 'servers', 'tavily.json'))
    expect(path.basename(result)).toBe('tavily.json')
  })
})
