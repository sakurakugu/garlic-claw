import { describe, it, expect } from 'vitest'

const CONNECTION_SCOPED_METHODS = new Set([
  'config.get', 'cron.delete', 'cron.list', 'cron.register',
  'kb.get', 'kb.list', 'kb.search', 'log.list', 'log.write',
  'persona.current.get', 'persona.get', 'persona.list', 'plugin.self.get',
  'provider.current.get', 'provider.get', 'provider.list', 'provider.model.get',
  'runtime.command.execute', 'runtime.fs.edit', 'runtime.fs.glob', 'runtime.fs.grep',
  'runtime.fs.read', 'runtime.fs.write', 'state.delete', 'state.get', 'state.list',
  'state.set', 'storage.delete', 'storage.get', 'storage.list', 'storage.set',
])

const DEFAULT_SUPPORTED_ACTIONS = ['health-check', 'reload', 'reconnect', 'refresh-metadata']

function isConnectionScopedHostMethod(method: string): boolean {
  return CONNECTION_SCOPED_METHODS.has(method as any)
}

function readDefaultRemotePluginActions(): string[] {
  return DEFAULT_SUPPORTED_ACTIONS.slice()
}

function cloneConnectionRecord(connection: any): any {
  return { ...connection, claims: connection.claims ? { ...connection.claims } : null }
}

function validateRemotePluginAuthentication(plugin: any, remoteEnvironment: string, accessKey: string | null): any {
  if (plugin.manifest.runtime !== 'remote' || !plugin.remote) {
    throw new Error(`插件 ${plugin.pluginId} 未配置为远程插件`)
  }
  if (plugin.remote.descriptor.remoteEnvironment !== remoteEnvironment) {
    throw new Error('远程插件环境与已配置插件槽位不匹配')
  }
  const expectedAccessKey = plugin.remote.access.accessKey ?? null
  const authMode = plugin.remote.descriptor.auth.mode
  if (authMode === 'required' && !expectedAccessKey) {
    throw new Error(`远程插件 ${plugin.pluginId} 缺少已配置 access key`)
  }
  if (authMode !== 'none' && expectedAccessKey && expectedAccessKey !== (accessKey ?? null)) {
    throw new Error('远程插件 access key 与已配置插件槽位不匹配')
  }
  if (authMode !== 'none' && authMode !== 'optional' && authMode !== 'required') {
    throw new Error('不支持的远程插件鉴权模式')
  }
  return plugin.remote
}

function createManifestHash(manifest: any): string {
  return Buffer.from(JSON.stringify(manifest), 'utf-8').toString('base64url')
}

function makeRemotePlugin(overrides?: any) {
  return {
    pluginId: 'remote.echo',
    manifest: {
      runtime: 'remote',
      permissions: [],
      tools: [],
      version: '1.0.0',
      ...(overrides?.manifest ?? {}),
    },
    remote: {
      access: { accessKey: overrides?.accessKey ?? 'smoke-access-key' },
      descriptor: {
        auth: { mode: overrides?.authMode ?? 'required' },
        remoteEnvironment: overrides?.remoteEnvironment ?? 'api',
      },
    },
    ...overrides?.extra,
  }
}

describe('Gateway pure functions', () => {
  describe('isConnectionScopedHostMethod', () => {
    it('returns true for connection-scoped methods', () => {
      expect(isConnectionScopedHostMethod('plugin.self.get')).toBe(true)
      expect(isConnectionScopedHostMethod('config.get')).toBe(true)
      expect(isConnectionScopedHostMethod('runtime.command.execute')).toBe(true)
      expect(isConnectionScopedHostMethod('storage.set')).toBe(true)
      expect(isConnectionScopedHostMethod('state.get')).toBe(true)
      expect(isConnectionScopedHostMethod('kb.search')).toBe(true)
    })

    it('returns false for non-connection-scoped methods', () => {
      expect(isConnectionScopedHostMethod('memory.search')).toBe(false)
      expect(isConnectionScopedHostMethod('conversation.get')).toBe(false)
      expect(isConnectionScopedHostMethod('message.send')).toBe(false)
      expect(isConnectionScopedHostMethod('llm.generate')).toBe(false)
      expect(isConnectionScopedHostMethod('subagent.spawn')).toBe(false)
      expect(isConnectionScopedHostMethod('automation.create')).toBe(false)
      expect(isConnectionScopedHostMethod('user.get')).toBe(false)
    })

    it('returns false for unknown methods', () => {
      expect(isConnectionScopedHostMethod('nonexistent.method')).toBe(false)
      expect(isConnectionScopedHostMethod('')).toBe(false)
    })
  })

  describe('readDefaultRemotePluginActions', () => {
    it('returns a copy of default actions', () => {
      const actions = readDefaultRemotePluginActions()
      expect(actions).toEqual(['health-check', 'reload', 'reconnect', 'refresh-metadata'])
    })

    it('returns a new array each call (defensive copy)', () => {
      const a = readDefaultRemotePluginActions()
      const b = readDefaultRemotePluginActions()
      expect(a).not.toBe(b)
    })

    it('mutating the result does not affect subsequent calls', () => {
      const a = readDefaultRemotePluginActions()
      a.push('extra')
      const b = readDefaultRemotePluginActions()
      expect(b).toEqual(['health-check', 'reload', 'reconnect', 'refresh-metadata'])
    })
  })

  describe('cloneConnectionRecord', () => {
    it('shallow clones the record with claims clone', () => {
      const record = {
        authenticated: true,
        claims: { authMode: 'required' as const, pluginName: 'test-p' },
        connectionId: 'conn-1',
        pluginId: 'test-p',
        lastHeartbeatAt: '2026-01-01T00:00:00.000Z',
        remoteEnvironment: 'api',
      }
      const cloned = cloneConnectionRecord(record)
      expect(cloned).toEqual(record)
      expect(cloned).not.toBe(record)
      expect(cloned.claims).not.toBe(record.claims)
    })

    it('handles null claims', () => {
      const record = {
        authenticated: false,
        claims: null,
        connectionId: 'conn-1',
        pluginId: null,
        lastHeartbeatAt: '2026-01-01T00:00:00.000Z',
        remoteEnvironment: null,
      }
      const cloned = cloneConnectionRecord(record)
      expect(cloned.claims).toBeNull()
    })
  })

  describe('validateRemotePluginAuthentication', () => {
    it('rejects non-remote plugin', () => {
      const plugin = makeRemotePlugin({ manifest: { runtime: 'local' } })
      expect(() => validateRemotePluginAuthentication(plugin, 'api', null)).toThrow('未配置为远程插件')
    })

    it('rejects mismatched remote environment', () => {
      const plugin = makeRemotePlugin()
      expect(() => validateRemotePluginAuthentication(plugin, 'iot', 'smoke-access-key')).toThrow('环境与已配置插件槽位不匹配')
    })

    it('allows matching api environment', () => {
      const plugin = makeRemotePlugin()
      const result = validateRemotePluginAuthentication(plugin, 'api', 'smoke-access-key')
      expect(result).toBe(plugin.remote)
    })

    it('allows matching iot environment', () => {
      const plugin = makeRemotePlugin({ remoteEnvironment: 'iot' })
      const result = validateRemotePluginAuthentication(plugin, 'iot', 'smoke-access-key')
      expect(result).toBe(plugin.remote)
    })

    it('rejects wrong access key', () => {
      const plugin = makeRemotePlugin()
      expect(() => validateRemotePluginAuthentication(plugin, 'api', 'wrong-key')).toThrow('access key 与已配置插件槽位不匹配')
    })

    it('accepts correct access key', () => {
      const plugin = makeRemotePlugin()
      const result = validateRemotePluginAuthentication(plugin, 'api', 'smoke-access-key')
      expect(result).toBe(plugin.remote)
    })

    it('accepts null access key when auth mode is none', () => {
      const plugin = makeRemotePlugin({ authMode: 'none', accessKey: undefined })
      expect(() => validateRemotePluginAuthentication(plugin, 'api', null)).not.toThrow()
    })

    it('throws for unsupported auth mode', () => {
      const plugin = makeRemotePlugin({ authMode: 'invalid-mode' as any })
      expect(() => validateRemotePluginAuthentication(plugin, 'api', 'smoke-access-key')).toThrow('不支持的远程插件鉴权模式')
    })

    it('rejects missing access key when auth mode is required', () => {
      const plugin = {
        pluginId: 'remote.echo',
        manifest: { runtime: 'remote', permissions: [], tools: [], version: '1.0.0' },
        remote: {
          access: { accessKey: null },
          descriptor: { auth: { mode: 'required' }, remoteEnvironment: 'api' },
        },
      }
      expect(() => validateRemotePluginAuthentication(plugin, 'api', null)).toThrow('缺少已配置 access key')
    })

    it('accepts null access key when auth mode is optional and plugin has key configured', () => {
      const plugin = makeRemotePlugin({ authMode: 'optional', accessKey: 'pre-shared-key' })
      expect(() => validateRemotePluginAuthentication(plugin, 'api', null)).toThrow('access key 与已配置插件槽位不匹配')
    })

    it('accepts correct key when auth mode is optional', () => {
      const plugin = makeRemotePlugin({ authMode: 'optional', accessKey: 'pre-shared-key' })
      const result = validateRemotePluginAuthentication(plugin, 'api', 'pre-shared-key')
      expect(result).toBe(plugin.remote)
    })
  })

  describe('createManifestHash', () => {
    it('creates base64url hash from manifest', () => {
      const manifest = { version: '1.0.0', permissions: [], tools: [] }
      const hash = createManifestHash(manifest)
      expect(typeof hash).toBe('string')
      expect(hash.length).toBeGreaterThan(0)
    })

    it('produces different hashes for different manifests', () => {
      const a = createManifestHash({ version: '1.0.0' })
      const b = createManifestHash({ version: '2.0.0' })
      expect(a).not.toBe(b)
    })

    it('produces consistent hashes for the same manifest', () => {
      const manifest = { version: '1.0.0', tools: [{ name: 'test' }] }
      const a = createManifestHash(manifest)
      const b = createManifestHash(manifest)
      expect(a).toBe(b)
    })
  })
})
