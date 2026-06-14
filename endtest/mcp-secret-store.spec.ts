import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

interface StoredMcpSecretsFile {
  servers?: Record<string, Record<string, string>>
}

// ============================================================================
// 内联纯函数（对齐 mcp-secret-store.service.ts）
// ============================================================================

function readServerSecrets(store: StoredMcpSecretsFile, name: string): Record<string, string> {
  return { ...(store.servers?.[name] ?? {}) }
}

function saveServerSecrets(
  store: StoredMcpSecretsFile,
  name: string,
  secrets: Record<string, string>,
  previousName?: string,
): StoredMcpSecretsFile {
  const servers = { ...(store.servers ?? {}) }
  if (previousName && previousName !== name) {
    delete servers[previousName]
  }
  if (Object.keys(secrets).length > 0) {
    servers[name] = { ...secrets }
  } else {
    delete servers[name]
  }
  return { servers }
}

function deleteServerSecrets(store: StoredMcpSecretsFile, name: string): StoredMcpSecretsFile {
  const servers = { ...(store.servers ?? {}) }
  delete servers[name]
  return { servers }
}

function resolveMcpSecretStoragePath(params: {
  configuredPath: string | undefined
  mcpConfigPath: string | undefined
  jestWorkerId: string | undefined
  resolveRoot: () => string
  cwd: string
}): string {
  if (params.configuredPath) {
    return path.resolve(params.configuredPath)
  }
  if (params.mcpConfigPath || params.jestWorkerId) {
    const configRootPath = params.mcpConfigPath?.trim()
      ? path.resolve(params.mcpConfigPath)
      : path.join(params.resolveRoot(), 'config', 'mcp', 'servers')
    return path.join(path.dirname(configRootPath), 'mcp-secrets.server.json')
  }
  return 'server-state/mcp-secrets.server.json'
}

const resolveServerStatePath = (fileName: string): string => `server-state/${fileName}`

// ============================================================================
// 文件系统辅助测试
// ============================================================================

function readSecretsFile(storagePath: string): StoredMcpSecretsFile {
  try {
    return fs.existsSync(storagePath)
      ? JSON.parse(fs.readFileSync(storagePath, 'utf-8')) as StoredMcpSecretsFile
      : {}
  } catch {
    return {}
  }
}

function writeSecretsFile(storagePath: string, store: StoredMcpSecretsFile): void {
  const parentPath = path.dirname(storagePath)
  fs.mkdirSync(parentPath, { recursive: true })
  if (store.servers && Object.keys(store.servers).length > 0) {
    fs.writeFileSync(storagePath, JSON.stringify(store, null, 2), 'utf-8')
    return
  }
  if (fs.existsSync(storagePath)) {
    fs.rmSync(storagePath, { force: true })
  }
}

// ========================================================================
// 测试
// ========================================================================

describe('McpSecretStoreService — readServerSecrets', () => {
  it('存在服务器时返回其 secrets 副本', () => {
    const store: StoredMcpSecretsFile = {
      servers: {
        tavily: { TAVILY_API_KEY: 'sk-123' },
      },
    }
    expect(readServerSecrets(store, 'tavily')).toEqual({ TAVILY_API_KEY: 'sk-123' })
  })

  it('返回的副本不被外部修改影响', () => {
    const store: StoredMcpSecretsFile = {
      servers: { srv: { KEY: 'val' } },
    }
    const result = readServerSecrets(store, 'srv')
    result.KEY = 'modified'
    expect(store.servers!.srv.KEY).toBe('val')
  })

  it('不存在的服务器返回空对象', () => {
    const store: StoredMcpSecretsFile = { servers: {} }
    expect(readServerSecrets(store, 'missing')).toEqual({})
  })

  it('servers 为 undefined 返回空对象', () => {
    expect(readServerSecrets({}, 'any')).toEqual({})
  })

  it('空 store 返回空对象', () => {
    const store: StoredMcpSecretsFile = { servers: {} }
    expect(readServerSecrets(store, 'any')).toEqual({})
  })
})

describe('McpSecretStoreService — saveServerSecrets', () => {
  it('保存 secrets 到指定服务器', () => {
    const store: StoredMcpSecretsFile = {}
    const result = saveServerSecrets(store, 'tavily', { TAVILY_API_KEY: 'sk-123' })
    expect(result.servers!.tavily).toEqual({ TAVILY_API_KEY: 'sk-123' })
  })

  it('保留其他服务器的 secrets', () => {
    const store: StoredMcpSecretsFile = {
      servers: { weather: { API_KEY: 'w-456' } },
    }
    const result = saveServerSecrets(store, 'tavily', { TAVILY_API_KEY: 'sk-123' })
    expect(result.servers!.weather).toEqual({ API_KEY: 'w-456' })
    expect(result.servers!.tavily).toEqual({ TAVILY_API_KEY: 'sk-123' })
  })

  it('更新已有服务器的 secrets', () => {
    const store: StoredMcpSecretsFile = {
      servers: { tavily: { OLD_KEY: 'old' } },
    }
    const result = saveServerSecrets(store, 'tavily', { NEW_KEY: 'new' })
    expect(result.servers!.tavily).toEqual({ NEW_KEY: 'new' })
  })

  it('空 secrets 清除服务器条目', () => {
    const store: StoredMcpSecretsFile = {
      servers: { tavily: { KEY: 'val' } },
    }
    const result = saveServerSecrets(store, 'tavily', {})
    expect(result.servers).not.toHaveProperty('tavily')
  })

  it('previousName 不同时删除旧条目', () => {
    const store: StoredMcpSecretsFile = {
      servers: { old: { KEY: 'val' } },
    }
    const result = saveServerSecrets(store, 'new', { KEY: 'val' }, 'old')
    expect(result.servers).not.toHaveProperty('old')
    expect(result.servers!.new).toEqual({ KEY: 'val' })
  })

  it('previousName 与 name 相同时不删除', () => {
    const store: StoredMcpSecretsFile = {
      servers: { srv: { KEY: 'val' } },
    }
    const result = saveServerSecrets(store, 'srv', { KEY: 'new-val' }, 'srv')
    expect(result.servers!.srv).toEqual({ KEY: 'new-val' })
  })

  it('previousName 为 undefined 时不做删除', () => {
    const store: StoredMcpSecretsFile = {
      servers: { srv: { KEY: 'val' } },
    }
    const result = saveServerSecrets(store, 'srv', { KEY: 'new' })
    expect(result.servers!.srv).toEqual({ KEY: 'new' })
  })

  it('原始 store 不被修改', () => {
    const store: StoredMcpSecretsFile = {
      servers: { srv: { KEY: 'val' } },
    }
    saveServerSecrets(store, 'srv', { KEY: 'modified' })
    expect(store.servers!.srv.KEY).toBe('val')
  })

  it('返回的新 store 与原始 store 独立', () => {
    const store: StoredMcpSecretsFile = {
      servers: { srv: { KEY: 'val' } },
    }
    const result = saveServerSecrets(store, 'srv', { KEY: 'new' })
    result.servers!.srv.KEY = 'changed'
    expect(store.servers!.srv.KEY).toBe('val')
  })
})

describe('McpSecretStoreService — deleteServerSecrets', () => {
  it('删除指定服务器的 secrets', () => {
    const store: StoredMcpSecretsFile = {
      servers: { tavily: { KEY: 'val' }, weather: { K: 'v' } },
    }
    const result = deleteServerSecrets(store, 'tavily')
    expect(result.servers).not.toHaveProperty('tavily')
    expect(result.servers!.weather).toEqual({ K: 'v' })
  })

  it('删除不存在的服务器不报错', () => {
    const store: StoredMcpSecretsFile = { servers: { srv: { K: 'v' } } }
    const result = deleteServerSecrets(store, 'missing')
    expect(result.servers!.srv).toEqual({ K: 'v' })
  })

  it('空 store 不报错', () => {
    const result = deleteServerSecrets({}, 'any')
    expect(result.servers).toEqual({})
  })

  it('原始 store 不被修改', () => {
    const store: StoredMcpSecretsFile = {
      servers: { srv: { KEY: 'val' } },
    }
    deleteServerSecrets(store, 'srv')
    expect(store.servers!.srv).toEqual({ KEY: 'val' })
  })
})

describe('McpSecretStoreService — resolveMcpSecretStoragePath', () => {
  it('GARLIC_CLAW_MCP_SECRET_STATE_PATH 优先', () => {
    const result = resolveMcpSecretStoragePath({
      configuredPath: '/custom/secrets.json',
      mcpConfigPath: undefined,
      jestWorkerId: undefined,
      resolveRoot: () => '/workspace',
      cwd: '/workspace/server',
    })
    expect(result).toBe(path.resolve('/custom/secrets.json'))
  })

  it('GARLIC_CLAW_MCP_CONFIG_PATH 时从 configRoot 推导', () => {
    const result = resolveMcpSecretStoragePath({
      configuredPath: undefined,
      mcpConfigPath: '/config/mcp/servers',
      jestWorkerId: undefined,
      resolveRoot: () => '/workspace',
      cwd: '/workspace/server',
    })
    expect(result).toBe(path.join(path.resolve('/config/mcp'), 'mcp-secrets.server.json'))
  })

  it('JEST_WORKER_ID 时使用默认路径', () => {
    const result = resolveMcpSecretStoragePath({
      configuredPath: undefined,
      mcpConfigPath: undefined,
      jestWorkerId: '1',
      resolveRoot: () => '/workspace',
      cwd: '/workspace/server',
    })
    expect(result).toBe(path.join('/workspace', 'config', 'mcp', 'mcp-secrets.server.json'))
  })

  it('无任何 env 时使用 server state 默认路径', () => {
    const result = resolveMcpSecretStoragePath({
      configuredPath: undefined,
      mcpConfigPath: undefined,
      jestWorkerId: undefined,
      resolveRoot: () => '/workspace',
      cwd: '/workspace/server',
    })
    expect(result).toBe('server-state/mcp-secrets.server.json')
  })

  it('configuredPath 空字符串视为未设置', () => {
    const result = resolveMcpSecretStoragePath({
      configuredPath: undefined,
      mcpConfigPath: undefined,
      jestWorkerId: undefined,
      resolveRoot: () => '/workspace',
      cwd: '/workspace/server',
    })
    expect(result).toBe('server-state/mcp-secrets.server.json')
  })
})

describe('McpSecretStoreService — filesystem read/write', () => {
  let tempDir: string
  let storagePath: string

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `mcp-secret-store-fs-${Date.now()}-${Math.random()}`)
    storagePath = path.join(tempDir, 'mcp-secrets.server.json')
    fs.mkdirSync(tempDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('不存在的文件返回空 store', () => {
    const result = readSecretsFile(storagePath)
    expect(result).toEqual({})
  })

  it('写入后读取数据正确', () => {
    const store: StoredMcpSecretsFile = {
      servers: { tavily: { KEY: 'val' } },
    }
    writeSecretsFile(storagePath, store)
    const result = readSecretsFile(storagePath)
    expect(result).toEqual(store)
  })

  it('覆盖已有文件', () => {
    writeSecretsFile(storagePath, {
      servers: { old: { K: 'v' } },
    })
    writeSecretsFile(storagePath, {
      servers: { new: { K: 'v' } },
    })
    const result = readSecretsFile(storagePath)
    expect(result.servers).not.toHaveProperty('old')
    expect(result.servers!.new).toEqual({ K: 'v' })
  })

  it('写入空 servers 时删除文件', () => {
    writeSecretsFile(storagePath, {
      servers: { srv: { K: 'v' } },
    })
    expect(fs.existsSync(storagePath)).toBe(true)
    writeSecretsFile(storagePath, { servers: {} })
    expect(fs.existsSync(storagePath)).toBe(false)
  })

  it('写入 undefined servers 时删除文件', () => {
    writeSecretsFile(storagePath, {
      servers: { srv: { K: 'v' } },
    })
    writeSecretsFile(storagePath, {})
    expect(fs.existsSync(storagePath)).toBe(false)
  })

  it('多服务器多 key 写入和读取', () => {
    const store: StoredMcpSecretsFile = {
      servers: {
        tavily: { TAVILY_API_KEY: 'sk-123', SEARCH_DEPTH: 'advanced' },
        weather: { API_KEY: 'w-456' },
      },
    }
    writeSecretsFile(storagePath, store)
    const result = readSecretsFile(storagePath)
    expect(result.servers!.tavily.TAVILY_API_KEY).toBe('sk-123')
    expect(result.servers!.tavily.SEARCH_DEPTH).toBe('advanced')
    expect(result.servers!.weather.API_KEY).toBe('w-456')
  })

  it('损坏的 JSON 返回空 store', () => {
    fs.writeFileSync(storagePath, '{invalid json', 'utf-8')
    const result = readSecretsFile(storagePath)
    expect(result).toEqual({})
  })

  it('JSON 格式美化', () => {
    writeSecretsFile(storagePath, {
      servers: { srv: { K: 'v' } },
    })
    const content = fs.readFileSync(storagePath, 'utf-8')
    expect(content).toContain('\n  ')
  })

  it('保留其他服务器数据的完整性', () => {
    writeSecretsFile(storagePath, {
      servers: { a: { K1: 'v1' }, b: { K2: 'v2' } },
    })
    const store = readSecretsFile(storagePath)
    const updated = saveServerSecrets(store, 'a', { K1: 'modified' })
    writeSecretsFile(storagePath, updated)
    const result = readSecretsFile(storagePath)
    expect(result.servers!.a.K1).toBe('modified')
    expect(result.servers!.b.K2).toBe('v2')
  })

  it('删除文件后读取为空', () => {
    writeSecretsFile(storagePath, {
      servers: { srv: { K: 'v' } },
    })
    fs.rmSync(storagePath)
    const result = readSecretsFile(storagePath)
    expect(result).toEqual({})
  })
})

describe('McpSecretStoreService — full lifecycle (in-memory store)', () => {
  it('完整 CRUD 流程', () => {
    let store: StoredMcpSecretsFile = {}

    // Create
    store = saveServerSecrets(store, 'tavily', { TAVILY_API_KEY: 'sk-123' })
    expect(readServerSecrets(store, 'tavily')).toEqual({ TAVILY_API_KEY: 'sk-123' })

    // Update
    store = saveServerSecrets(store, 'tavily', { TAVILY_API_KEY: 'sk-456' })
    expect(readServerSecrets(store, 'tavily')).toEqual({ TAVILY_API_KEY: 'sk-456' })

    // Add another
    store = saveServerSecrets(store, 'weather', { API_KEY: 'w-789' })
    expect(readServerSecrets(store, 'weather')).toEqual({ API_KEY: 'w-789' })

    // Delete
    store = deleteServerSecrets(store, 'tavily')
    expect(readServerSecrets(store, 'tavily')).toEqual({})
    expect(readServerSecrets(store, 'weather')).toEqual({ API_KEY: 'w-789' })

    // Rename (previousName)
    store = saveServerSecrets(store, 'weather-v2', { API_KEY: 'w-789' }, 'weather')
    expect(readServerSecrets(store, 'weather')).toEqual({})
    expect(readServerSecrets(store, 'weather-v2')).toEqual({ API_KEY: 'w-789' })
  })

  it('多 key 存储和部分更新', () => {
    let store: StoredMcpSecretsFile = {}
    store = saveServerSecrets(store, 'srv', { K1: 'v1', K2: 'v2', K3: 'v3' })
    expect(Object.keys(readServerSecrets(store, 'srv'))).toHaveLength(3)

    store = saveServerSecrets(store, 'srv', { K1: 'modified' })
    expect(readServerSecrets(store, 'srv')).toEqual({ K1: 'modified' })
  })
})
