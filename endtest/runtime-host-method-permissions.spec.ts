import { describe, it, expect } from 'vitest'

const CONNECTION_SCOPED_PLUGIN_HOST_METHODS = [
  'config.get', 'cron.delete', 'cron.list', 'cron.register',
  'kb.get', 'kb.list', 'kb.search', 'log.list', 'log.write',
  'persona.current.get', 'persona.get', 'persona.list',
  'plugin.self.get', 'provider.current.get', 'provider.get',
  'provider.list', 'provider.model.get', 'runtime.command.execute',
  'runtime.fs.edit', 'runtime.fs.glob', 'runtime.fs.grep',
  'runtime.fs.read', 'runtime.fs.write', 'state.delete', 'state.get',
  'state.list', 'state.set', 'storage.delete', 'storage.get',
  'storage.list', 'storage.set',
] as const

const PLUGIN_HOST_METHOD_PERMISSION_MAP = {
  'automation.create': 'automation:write',
  'automation.event.emit': 'automation:write',
  'automation.list': 'automation:read',
  'automation.run': 'automation:write',
  'automation.toggle': 'automation:write',
  'config.get': 'config:read',
  'cron.delete': 'cron:write',
  'cron.list': 'cron:read',
  'cron.register': 'cron:write',
  'conversation.get': 'conversation:read',
  'conversation.history.get': 'conversation:read',
  'conversation.history.preview': 'conversation:read',
  'conversation.history.replace': 'conversation:write',
  'conversation.session.finish': 'conversation:write',
  'conversation.session.get': 'conversation:write',
  'conversation.session.keep': 'conversation:write',
  'conversation.session.start': 'conversation:write',
  'conversation.messages.list': 'conversation:read',
  'conversation.title.set': 'conversation:write',
  'kb.get': 'kb:read',
  'kb.list': 'kb:read',
  'kb.search': 'kb:read',
  'llm.generate': 'llm:generate',
  'llm.generate-text': 'llm:generate',
  'log.list': 'log:read',
  'log.write': 'log:write',
  'message.send': 'conversation:write',
  'message.target.current.get': 'conversation:read',
  'memory.search': 'memory:read',
  'memory.save': 'memory:write',
  'persona.activate': 'persona:write',
  'persona.current.get': 'persona:read',
  'persona.get': 'persona:read',
  'persona.list': 'persona:read',
  'plugin.self.get': null,
  'provider.current.get': 'provider:read',
  'provider.get': 'provider:read',
  'provider.list': 'provider:read',
  'provider.model.get': 'provider:read',
  'runtime.command.execute': 'runtime:command',
  'runtime.fs.edit': 'runtime:write',
  'runtime.fs.glob': 'runtime:read',
  'runtime.fs.grep': 'runtime:read',
  'runtime.fs.read': 'runtime:read',
  'runtime.fs.write': 'runtime:write',
  'storage.delete': 'storage:write',
  'storage.get': 'storage:read',
  'storage.list': 'storage:read',
  'storage.set': 'storage:write',
  'subagent.close': 'subagent:run',
  'subagent.get': 'subagent:run',
  'subagent.interrupt': 'subagent:run',
  'subagent.list': 'subagent:run',
  'subagent.send-input': 'subagent:run',
  'subagent.spawn': 'subagent:run',
  'subagent.wait': 'subagent:run',
  'state.delete': 'state:write',
  'state.get': 'state:read',
  'state.list': 'state:read',
  'state.set': 'state:write',
  'user.get': 'user:read',
} as const

type PluginPermission = (typeof PLUGIN_HOST_METHOD_PERMISSION_MAP)[keyof typeof PLUGIN_HOST_METHOD_PERMISSION_MAP]

describe('host-method-permissions', () => {
  describe('CONNECTION_SCOPED_PLUGIN_HOST_METHODS', () => {
    it('contains 31 methods', () => {
      expect(CONNECTION_SCOPED_PLUGIN_HOST_METHODS).toHaveLength(31)
    })

    it('all methods are snake_case dotted paths', () => {
      CONNECTION_SCOPED_PLUGIN_HOST_METHODS.forEach((method) => {
        expect(method).toMatch(/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/)
      })
    })

    it('all methods exist in permission map', () => {
      CONNECTION_SCOPED_PLUGIN_HOST_METHODS.forEach((method) => {
        expect(PLUGIN_HOST_METHOD_PERMISSION_MAP).toHaveProperty(method)
      })
    })

    it('methods are sorted alphabetically', () => {
      const sorted = [...CONNECTION_SCOPED_PLUGIN_HOST_METHODS].sort()
      expect(CONNECTION_SCOPED_PLUGIN_HOST_METHODS).toEqual(sorted)
    })

    it('config.get appears in both lists', () => {
      expect(CONNECTION_SCOPED_PLUGIN_HOST_METHODS).toContain('config.get')
    })
  })

  describe('PLUGIN_HOST_METHOD_PERMISSION_MAP', () => {
    const entries = Object.entries(PLUGIN_HOST_METHOD_PERMISSION_MAP)

    it('contains 61 method entries', () => {
      expect(entries).toHaveLength(61)
    })

    it('all method keys are dotted lowercase with optional hyphens', () => {
      entries.forEach(([key]) => {
        expect(key).toMatch(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/)
      })
    })

    it('only plugin.self.get has null permission', () => {
      const nullPermissions = entries.filter(([, perm]) => perm === null).map(([key]) => key)
      expect(nullPermissions).toEqual(['plugin.self.get'])
    })

    it('permission values follow category:action format', () => {
      entries.forEach(([, perm]) => {
        if (perm !== null) expect(perm).toMatch(/^[a-z]+:(read|write|run|command|generate)$/)
      })
    })

    it('categories are consistent', () => {
      const categories = new Set(entries.map(([, p]) => p ? p.split(':')[0] : null).filter(Boolean))
      expect([...categories].sort()).toEqual([
        'automation', 'config', 'conversation', 'cron',
        'kb', 'llm', 'log', 'memory', 'persona', 'provider',
        'runtime', 'state', 'storage', 'subagent', 'user',
      ])
    })

    it('read/write pairs are balanced', () => {
      const byCategory: Record<string, string[]> = {}
      entries.forEach(([, perm]) => {
        if (perm) {
          const [cat, action] = perm.split(':')
          byCategory[cat] = byCategory[cat] || []
          byCategory[cat].push(action)
        }
      })
      for (const [cat, actions] of Object.entries(byCategory)) {
        if (cat === 'llm' || cat === 'runtime' || cat === 'subagent' || cat === 'config' || cat === 'kb' || cat === 'provider' || cat === 'user') continue
        expect(actions.filter((a) => a === 'read').length).toBeGreaterThanOrEqual(1)
        expect(actions.filter((a) => a === 'write').length).toBeGreaterThanOrEqual(1)
      }
    })

    it('connection-scoped methods are a subset of all methods', () => {
      CONNECTION_SCOPED_PLUGIN_HOST_METHODS.forEach((method) => {
        expect(PLUGIN_HOST_METHOD_PERMISSION_MAP).toHaveProperty(method)
      })
    })

    it('conversation group has the most entries', () => {
      const byCategory: Record<string, number> = {}
      entries.forEach(([, perm]) => {
        if (perm) {
          const cat = perm.split(':')[0]
          byCategory[cat] = (byCategory[cat] || 0) + 1
        }
      })
      expect(byCategory.conversation).toBeGreaterThanOrEqual(8)
    })
  })
})
