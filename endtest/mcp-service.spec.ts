import { describe, it, expect, vi } from 'vitest'
import * as path from 'node:path'

// ============================================================================
// 类型定义（从 @garlic-claw/shared 对齐）
// ============================================================================

type McpEnvValueSource = 'env-ref' | 'literal' | 'stored-secret'

interface EventLogSettings {
  maxFileSizeMb: number
}

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
  eventLog: EventLogSettings
}

interface PluginParamSchema {
  type: string
  description?: string
  required: boolean
}

// ============================================================================
// 内联纯函数（对齐 mcp.service.ts）
// ============================================================================

// ---- 辅助函数 ----

function isMcpRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// ---- createMcpRecord ----

type McpServerHealthStatus = 'healthy' | 'error' | 'unknown'
type McpServerStatus = { name: string; connected: boolean; enabled: boolean; health: McpServerHealthStatus; lastError: string | null; lastCheckedAt: string | null }
type McpToolDescriptor = { serverName: string; name: string; description?: string; inputSchema?: unknown }
type McpRecord = { status: McpServerStatus; tools: McpToolDescriptor[] }

function createMcpRecord(name: string, status: Partial<McpServerStatus>, tools: McpToolDescriptor[]): McpRecord {
  return { status: { name, connected: false, enabled: true, health: 'unknown', lastError: null, lastCheckedAt: null, ...status }, tools }
}

// ---- readMcpToolParameters ----

function readMcpToolParameters(schema: unknown): Record<string, PluginParamSchema> {
  if (!isMcpRecord(schema) || !isMcpRecord(schema.properties)) { return {} }
  const required = Array.isArray(schema.required) ? new Set(schema.required.filter((item): item is string => typeof item === 'string')) : new Set<string>()
  return Object.fromEntries(
    Object.entries(schema.properties).flatMap(([key, rawDefinition]) =>
      !isMcpRecord(rawDefinition)
        ? []
        : [[key, {
            type: rawDefinition.type === 'number' || rawDefinition.type === 'boolean' || rawDefinition.type === 'object' || rawDefinition.type === 'array' ? rawDefinition.type : 'string',
            ...(typeof rawDefinition.description === 'string' ? { description: rawDefinition.description } : {}),
            required: required.has(key),
          } satisfies PluginParamSchema]],
    ),
  )
}

// ---- withTimeout ----

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`操作超时: ${operation} (${timeoutMs}ms)`)), timeoutMs)
    timer.unref()
    promise.then((value) => { clearTimeout(timer); resolve(value) }, (error: unknown) => { clearTimeout(timer); reject(error) })
  })
}

// ---- MCP 命令允许列表 ----

const DEFAULT_MCP_COMMAND_NAMES = new Set(['node', 'npm', 'npx'])

function normalizeMcpCommandName(command: string): string {
  return path.basename(command).toLowerCase().replace(/\.(?:cmd|exe)$/u, '')
}

function isBareCommand(command: string): boolean {
  return !path.isAbsolute(command) && !command.includes('/') && !command.includes('\\')
}

function isSameExecutablePath(left: string, right: string): boolean {
  if (!path.isAbsolute(left) || !path.isAbsolute(right)) { return false }
  const normalizedLeft = path.resolve(left)
  const normalizedRight = path.resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function readConfiguredMcpCommandAllowlist(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function configuredCommandAllows(command: string, commandName: string, allowedCommand: string): boolean {
  const allowedName = normalizeMcpCommandName(allowedCommand)
  if (isBareCommand(command) && isBareCommand(allowedCommand)) {
    return commandName === allowedName
  }
  return !isBareCommand(command) && !isBareCommand(allowedCommand) && isSameExecutablePath(command, allowedCommand)
}

function isAllowedMcpCommand(command: string, configuredAllowlist?: string): boolean {
  const trimmedCommand = command.trim()
  if (!trimmedCommand) { return false }
  if (isSameExecutablePath(trimmedCommand, process.execPath)) { return true }
  const commandName = normalizeMcpCommandName(trimmedCommand)
  if (isBareCommand(trimmedCommand) && DEFAULT_MCP_COMMAND_NAMES.has(commandName)) { return true }
  return readConfiguredMcpCommandAllowlist(configuredAllowlist)
    .some((allowedCommand) => configuredCommandAllows(trimmedCommand, commandName, allowedCommand))
}

// ---- Transport env helpers ----

const MCP_BASE_PROCESS_ENV_KEYS = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'HOME',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP',
  'ComSpec', 'PROCESSOR_ARCHITECTURE',
]

function readTransportEnvEntries(config: McpServerConfig): Array<[string, string]> {
  if (Array.isArray(config.envEntries) && config.envEntries.length > 0) {
    return config.envEntries
      .map((entry): [string, string] => [entry.key, entry.value])
      .filter(([key]) => key.trim().length > 0)
  }
  return Object.entries(config.env ?? {})
}

function readProcessEnvEntry(env: NodeJS.ProcessEnv, key: string): [string, string] | null {
  const value = env[key]
  if (typeof value === 'string') { return [key, value] }
  if (process.platform !== 'win32') { return null }
  const matchedKey = Object.keys(env).find((candidate) => candidate.toLowerCase() === key.toLowerCase())
  const matchedValue = matchedKey ? env[matchedKey] : undefined
  return typeof matchedValue === 'string' && matchedKey ? [matchedKey, matchedValue] : null
}

function readBaseMcpProcessEnvEntries(env: NodeJS.ProcessEnv = process.env): Array<[string, string]> {
  const entries = new Map<string, string>()
  for (const key of MCP_BASE_PROCESS_ENV_KEYS) {
    const entry = readProcessEnvEntry(env, key)
    if (entry) { entries.set(entry[0], entry[1]) }
  }
  return [...entries]
}

// ---- resolveTransportEnvValue ----

interface ConfigServiceMock {
  get: (key: string) => string | undefined
}

function resolveTransportEnvValue(key: string, value: string, configService: ConfigServiceMock): string {
  const normalizedValue = value.trim()
  if (normalizedValue.startsWith('${') && normalizedValue.endsWith('}')) {
    return configService.get(normalizedValue.slice(2, -1)) || ''
  }
  return normalizedValue
}

// ========================================================================
// 测试
// ========================================================================

describe('McpService — createMcpRecord', () => {
  it('创建默认记录含默认值', () => {
    const r = createMcpRecord('test', {}, [])
    expect(r.status.name).toBe('test')
    expect(r.status.connected).toBe(false)
    expect(r.status.enabled).toBe(true)
    expect(r.status.health).toBe('unknown')
    expect(r.status.lastError).toBeNull()
    expect(r.status.lastCheckedAt).toBeNull()
    expect(r.tools).toEqual([])
  })

  it('部分覆盖默认值', () => {
    const r = createMcpRecord('srv', { enabled: false, health: 'error', lastError: 'fail' }, [])
    expect(r.status.enabled).toBe(false)
    expect(r.status.health).toBe('error')
    expect(r.status.lastError).toBe('fail')
    expect(r.status.connected).toBe(false)
  })

  it('保留 tools 列表', () => {
    const tools: McpToolDescriptor[] = [{ serverName: 'srv', name: 't1' }]
    const r = createMcpRecord('srv', {}, tools)
    expect(r.tools).toHaveLength(1)
    expect(r.tools[0].name).toBe('t1')
  })
})

describe('McpService — readMcpToolParameters', () => {
  it('null schema 返回空对象', () => {
    expect(readMcpToolParameters(null)).toEqual({})
  })

  it('非对象 schema 返回空对象', () => {
    expect(readMcpToolParameters('string')).toEqual({})
  })

  it('无 properties 返回空对象', () => {
    expect(readMcpToolParameters({})).toEqual({})
  })

  it('解析 string 参数', () => {
    const result = readMcpToolParameters({
      properties: {
        name: { type: 'string', description: 'The name' },
      },
      required: ['name'],
    })
    expect(result.name).toEqual({ type: 'string', description: 'The name', required: true })
  })

  it('解析 number 参数', () => {
    const result = readMcpToolParameters({
      properties: { count: { type: 'number' } },
    })
    expect(result.count).toEqual({ type: 'number', required: false })
  })

  it('解析 boolean 参数', () => {
    const result = readMcpToolParameters({
      properties: { flag: { type: 'boolean' } },
    })
    expect(result.flag).toEqual({ type: 'boolean', required: false })
  })

  it('解析 object 参数', () => {
    const result = readMcpToolParameters({
      properties: { config: { type: 'object' } },
    })
    expect(result.config).toEqual({ type: 'object', required: false })
  })

  it('解析 array 参数', () => {
    const result = readMcpToolParameters({
      properties: { items: { type: 'array' } },
    })
    expect(result.items).toEqual({ type: 'array', required: false })
  })

  it('未知类型回退 string', () => {
    const result = readMcpToolParameters({
      properties: { val: { type: 'unknown_type' } },
    })
    expect(result.val).toEqual({ type: 'string', required: false })
  })

  it('过滤非对象定义条目', () => {
    const result = readMcpToolParameters({
      properties: { good: { type: 'string' }, bad: 'not-object' },
    })
    expect(result.good).toBeDefined()
    expect(result.bad).toBeUndefined()
  })

  it('required 数组中非字符串项被忽略', () => {
    const result = readMcpToolParameters({
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      required: ['a', 123, null],
    })
    expect(result.a.required).toBe(true)
    expect(result.b.required).toBe(false)
  })

  it('空 properties 返回空', () => {
    expect(readMcpToolParameters({ properties: {} })).toEqual({})
  })

  it('嵌套 schema 作为描述（不递归）', () => {
    const result = readMcpToolParameters({
      properties: {
        obj: {
          type: 'object',
          properties: { inner: { type: 'string' } },
        },
      },
    })
    expect(result.obj.type).toBe('object')
  })
})

describe('McpService — withTimeout', () => {
  it('promise 在超时前 resolve', async () => {
    const result = await withTimeout(Promise.resolve('ok'), 1000, 'test')
    expect(result).toBe('ok')
  })

  it('promise 在超时前 reject', async () => {
    await expect(withTimeout(Promise.reject(new Error('fail')), 1000, 'test')).rejects.toThrow('fail')
  })

  it('超时触发 reject', async () => {
    await expect(withTimeout(new Promise(() => {}), 50, 'slow op')).rejects.toThrow('操作超时: slow op (50ms)')
  })

  it('超时 timer 调用 unref', async () => {
    const promise = new Promise(() => {})
    const start = Date.now()
    await expect(withTimeout(promise, 30, 'fast')).rejects.toThrow()
    expect(Date.now() - start).toBeGreaterThanOrEqual(25)
  })
})

describe('McpService — normalizeMcpCommandName', () => {
  it('去除 .exe 扩展名', () => {
    expect(normalizeMcpCommandName('node.exe')).toBe('node')
  })

  it('去除 .cmd 扩展名', () => {
    expect(normalizeMcpCommandName('NPM.CMD')).toBe('npm')
  })

  it('转小写', () => {
    expect(normalizeMcpCommandName('NPX')).toBe('npx')
  })

  it('返回 basename', () => {
    expect(normalizeMcpCommandName('/usr/local/bin/node')).toBe('node')
  })

  it('无扩展名保持原样转小写', () => {
    expect(normalizeMcpCommandName('Python')).toBe('python')
  })
})

describe('McpService — isBareCommand', () => {
  it('裸命令返回 true', () => {
    expect(isBareCommand('node')).toBe(true)
    expect(isBareCommand('npx')).toBe(true)
    expect(isBareCommand('npm')).toBe(true)
  })

  it('绝对路径返回 false', () => {
    expect(isBareCommand('/usr/bin/node')).toBe(false)
    expect(isBareCommand('C:\\node\\node.exe')).toBe(false)
  })

  it('含斜杠返回 false', () => {
    expect(isBareCommand('./node')).toBe(false)
    expect(isBareCommand('../npx')).toBe(false)
  })

  it('空字符串返回 true', () => {
    expect(isBareCommand('')).toBe(true)
  })
})

describe('McpService — isSameExecutablePath', () => {
  it('相同路径返回 true', () => {
    const resolved = path.resolve('/usr/bin/node')
    expect(isSameExecutablePath(resolved, resolved)).toBe(true)
  })

  it('非绝对路径返回 false', () => {
    expect(isSameExecutablePath('node', 'node')).toBe(false)
  })

  it('混合绝对/相对返回 false', () => {
    expect(isSameExecutablePath(path.resolve('/usr/bin/node'), 'node')).toBe(false)
  })
})

describe('McpService — readConfiguredMcpCommandAllowlist', () => {
  it('undefined 返回空数组', () => {
    expect(readConfiguredMcpCommandAllowlist(undefined)).toEqual([])
  })

  it('空字符串返回空数组', () => {
    expect(readConfiguredMcpCommandAllowlist('')).toEqual([])
  })

  it('逗号分隔列表被 trim 并过滤空', () => {
    expect(readConfiguredMcpCommandAllowlist('node, npx , , python')).toEqual(['node', 'npx', 'python'])
  })

  it('单个条目返回单元素数组', () => {
    expect(readConfiguredMcpCommandAllowlist('python')).toEqual(['python'])
  })
})

describe('McpService — configuredCommandAllows', () => {
  it('裸命令匹配命令名', () => {
    expect(configuredCommandAllows('node', 'node', 'node')).toBe(true)
  })

  it('裸命令不匹配不同名', () => {
    expect(configuredCommandAllows('node', 'node', 'python')).toBe(false)
  })

  it('绝对路径匹配相同路径', () => {
    const p = path.resolve('/usr/bin/python')
    expect(configuredCommandAllows(p, 'python', p)).toBe(true)
  })

  it('绝对路径不匹配不同路径', () => {
    const p1 = path.resolve('/usr/bin/python')
    const p2 = path.resolve('/usr/local/bin/python')
    expect(configuredCommandAllows(p1, 'python', p2)).toBe(false)
  })

  it('混合裸命令和绝对路径不匹配', () => {
    expect(configuredCommandAllows('node', 'node', path.resolve('/usr/bin/node'))).toBe(false)
  })
})

describe('McpService — isAllowedMcpCommand', () => {
  const originalExecPath = process.execPath

  it('空命令返回 false', () => {
    expect(isAllowedMcpCommand('')).toBe(false)
    expect(isAllowedMcpCommand('  ')).toBe(false)
  })

  it('默认允许的裸命令返回 true', () => {
    expect(isAllowedMcpCommand('node')).toBe(true)
    expect(isAllowedMcpCommand('npm')).toBe(true)
    expect(isAllowedMcpCommand('npx')).toBe(true)
  })

  it('process.execPath 始终允许', () => {
    expect(isAllowedMcpCommand(originalExecPath)).toBe(true)
  })

  it('不在默认列表的裸命令返回 false', () => {
    expect(isAllowedMcpCommand('python')).toBe(false)
    expect(isAllowedMcpCommand('docker')).toBe(false)
  })

  it('配置 allowlist 允许额外命令', () => {
    expect(isAllowedMcpCommand('python', 'python,docker')).toBe(true)
  })

  it('配置 allowlist 逗号分隔多个', () => {
    expect(isAllowedMcpCommand('docker', 'python, docker')).toBe(true)
  })

  it('大小写不敏感匹配', () => {
    expect(isAllowedMcpCommand('NODE')).toBe(true)
    expect(isAllowedMcpCommand('NPX')).toBe(true)
  })

  it('allowlist 覆盖默认不禁止', () => {
    expect(isAllowedMcpCommand('deno', 'deno')).toBe(true)
  })
})

describe('McpService — readTransportEnvEntries', () => {
  it('envEntries 为空时回退到 env', () => {
    const config: McpServerConfig = { name: 't', command: 'c', args: [], env: { KEY: 'val' }, eventLog: { maxFileSizeMb: 1 } }
    expect(readTransportEnvEntries(config)).toEqual([['KEY', 'val']])
  })

  it('envEntries 存在时使用 envEntries', () => {
    const config: McpServerConfig = {
      name: 't', command: 'c', args: [], env: { KEY: 'ignored' },
      envEntries: [{ key: 'K1', source: 'literal', value: 'v1' }, { key: 'K2', source: 'env-ref', value: '${V2}' }],
      eventLog: { maxFileSizeMb: 1 },
    }
    expect(readTransportEnvEntries(config)).toEqual([['K1', 'v1'], ['K2', '${V2}']])
  })

  it('过滤 envEntries 空 key', () => {
    const config: McpServerConfig = {
      name: 't', command: 'c', args: [], env: {},
      envEntries: [{ key: '', source: 'literal', value: 'v' }, { key: 'ok', source: 'literal', value: 'v' }],
      eventLog: { maxFileSizeMb: 1 },
    }
    expect(readTransportEnvEntries(config)).toEqual([['ok', 'v']])
  })

  it('envEntries 空数组时回退到 env', () => {
    const config: McpServerConfig = { name: 't', command: 'c', args: [], env: { A: 'b' }, envEntries: [], eventLog: { maxFileSizeMb: 1 } }
    expect(readTransportEnvEntries(config)).toEqual([['A', 'b']])
  })
})

describe('McpService — readProcessEnvEntry', () => {
  it('存在 key 返回条目', () => {
    expect(readProcessEnvEntry({ PATH: '/usr/bin' }, 'PATH')).toEqual(['PATH', '/usr/bin'])
  })

  it('不存在 key 且非 win32 返回 null', () => {
    const orig = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      expect(readProcessEnvEntry({}, 'PATH')).toBeNull()
    } finally {
      Object.defineProperty(process, 'platform', { value: orig })
    }
  })

  it('win32 大小写不敏感匹配', () => {
    const result = readProcessEnvEntry({ Path: '/usr/bin' }, 'PATH')
    if (process.platform === 'win32') {
      expect(result).toEqual(['Path', '/usr/bin'])
    }
  })

  it('value 非字符串返回 null', () => {
    expect(readProcessEnvEntry({ PATH: undefined }, 'PATH')).toBeNull()
  })
})

describe('McpService — readBaseMcpProcessEnvEntries', () => {
  it('返回 Map 不会有重复 key', () => {
    const result = readBaseMcpProcessEnvEntries({ PATH: '/usr/bin', TEMP: '/tmp' })
    const keys = result.map(([k]) => k)
    const uniqueKeys = new Set(keys)
    expect(keys.length).toBe(uniqueKeys.size)
  })

  it('只包含 MCP_BASE_PROCESS_ENV_KEYS 中的 key', () => {
    const result = readBaseMcpProcessEnvEntries({ PATH: '/usr/bin', CUSTOM: 'val' })
    expect(result.find(([k]) => k === 'CUSTOM')).toBeUndefined()
  })
})

describe('McpService — resolveTransportEnvValue', () => {
  const configService: ConfigServiceMock = {
    get: (key: string) => key === 'TAVILY_API_KEY' ? 'sk-real-key' : undefined,
  }

  it('非引用值原样返回', () => {
    expect(resolveTransportEnvValue('K', 'plain', configService)).toBe('plain')
  })

  it('引用值从 configService 解析', () => {
    expect(resolveTransportEnvValue('K', '${TAVILY_API_KEY}', configService)).toBe('sk-real-key')
  })

  it('引用值未配置返回空字符串', () => {
    expect(resolveTransportEnvValue('K', '${MISSING_KEY}', configService)).toBe('')
  })

  it('trim 值', () => {
    expect(resolveTransportEnvValue('K', '  plain  ', configService)).toBe('plain')
  })

  it('trim 引用值', () => {
    expect(resolveTransportEnvValue('K', '  ${TAVILY_API_KEY}  ', configService)).toBe('sk-real-key')
  })
})
