import { describe, it, expect } from 'vitest';
import type { BuiltinPluginDefinition } from '../packages/server/src/modules/plugin/builtin/builtin-plugin-definition';
import { BUILTIN_MEMORY_PLUGIN } from '../packages/server/src/modules/plugin/builtin/builtin-memory.plugin';
import { BUILTIN_AUTOMATION_PLUGIN } from '../packages/server/src/modules/plugin/builtin/builtin-automation.plugin';

const ALL_DEFINITIONS: BuiltinPluginDefinition[] = [
  BUILTIN_AUTOMATION_PLUGIN,
  BUILTIN_MEMORY_PLUGIN,
];

const RETIRED_IDS = [
  'builtin.memory-context',
  'builtin.memory-tools',
  'builtin.runtime-tools',
  'builtin.subagent-delegate',
  'builtin.conversation-title',
  'builtin.context-compaction',
] as const;

function cloneDefinition(def: BuiltinPluginDefinition): BuiltinPluginDefinition {
  return {
    ...structuredClone({
      ...(def.governance ? { governance: def.governance } : {}),
      manifest: def.manifest,
    }),
    ...(def.tools ? { tools: { ...def.tools } } : {}),
    ...(def.hooks ? { hooks: { ...def.hooks } } : {}),
    ...(def.routes ? { routes: { ...def.routes } } : {}),
  };
}

function hasDefinition(definitions: BuiltinPluginDefinition[], pluginId: string): boolean {
  return definitions.some((d) => d.manifest.id === pluginId);
}

function getDefinition(definitions: BuiltinPluginDefinition[], pluginId: string): BuiltinPluginDefinition | undefined {
  const d = definitions.find((entry) => entry.manifest.id === pluginId);
  return d ? cloneDefinition(d) : undefined;
}

function listDefinitions(definitions: BuiltinPluginDefinition[]): BuiltinPluginDefinition[] {
  return definitions.map(cloneDefinition);
}

describe('BuiltinPluginDefinition type', () => {
  it('extends PluginAuthorDefinition with optional governance', () => {
    const def: BuiltinPluginDefinition = {
      manifest: { id: 'test', name: 'Test', description: '', runtime: 'local', tools: [], version: '1.0.0' },
    };
    expect(def.manifest.id).toBe('test');
  });

  it('accepts full governance overrides', () => {
    const def: BuiltinPluginDefinition = {
      governance: { builtinRole: 'system-optional', canDisable: true, defaultEnabled: true },
      manifest: { id: 'test', name: 'Test', description: '', runtime: 'local', tools: [], version: '1.0.0' },
    };
    expect(def.governance?.builtinRole).toBe('system-optional');
  });
});

describe('BUILTIN_MEMORY_PLUGIN', () => {
  it('has correct manifest metadata', () => {
    expect(BUILTIN_MEMORY_PLUGIN.manifest.id).toBe('builtin.memory');
    expect(BUILTIN_MEMORY_PLUGIN.manifest.name).toBe('记忆');
    expect(BUILTIN_MEMORY_PLUGIN.manifest.description).toBe('提供长期记忆写入与检索工具。');
    expect(BUILTIN_MEMORY_PLUGIN.manifest.version).toBe('1.0.0');
    expect(BUILTIN_MEMORY_PLUGIN.manifest.runtime).toBe('local');
  });

  it('has correct governance config', () => {
    expect(BUILTIN_MEMORY_PLUGIN.governance).toEqual({
      builtinRole: 'system-optional',
      canDisable: true,
      defaultEnabled: true,
    });
  });

  it('has correct permissions', () => {
    expect(BUILTIN_MEMORY_PLUGIN.manifest.permissions).toEqual(['memory:read', 'memory:write']);
  });

  it('has no hooks or config', () => {
    expect(BUILTIN_MEMORY_PLUGIN.manifest.config).toBeUndefined();
    expect(BUILTIN_MEMORY_PLUGIN.manifest.hooks ?? []).toEqual([]);
    expect(BUILTIN_MEMORY_PLUGIN.hooks).toBeUndefined();
  });

  it('declares save_memory and search_memory tools with correct parameter schemas', () => {
    const toolNames = BUILTIN_MEMORY_PLUGIN.manifest.tools.map((t) => t.name);
    expect(toolNames).toEqual(['save_memory', 'search_memory']);

    const saveMemoryDef = BUILTIN_MEMORY_PLUGIN.manifest.tools.find((t) => t.name === 'save_memory');
    expect(saveMemoryDef?.parameters).toHaveProperty('content');
    expect(saveMemoryDef?.parameters.content.required).toBe(true);
    expect(saveMemoryDef?.parameters.category.required).toBeUndefined();
    expect(saveMemoryDef?.parameters.keywords.required).toBeUndefined();

    const searchMemoryDef = BUILTIN_MEMORY_PLUGIN.manifest.tools.find((t) => t.name === 'search_memory');
    expect(searchMemoryDef?.parameters.query.required).toBe(true);
  });

  it('save_memory tool with all params calls host.saveMemory and returns saved result', async () => {
    const host = {
      saveMemory: async () => ({ id: 'mem-1' }),
    } as never;
    const result = await BUILTIN_MEMORY_PLUGIN.tools?.save_memory?.(
      { category: 'preference', content: '用户喜欢茶', keywords: '茶,偏好' },
      { host },
    ) as never;
    expect(result).toEqual({ saved: true, id: 'mem-1' });
  });

  it('save_memory tool without optional params works', async () => {
    const host = {
      saveMemory: async () => ({ id: 'mem-2' }),
    } as never;
    const result = await BUILTIN_MEMORY_PLUGIN.tools?.save_memory?.(
      { content: '记住这个' },
      { host },
    ) as never;
    expect(result).toEqual({ saved: true, id: 'mem-2' });
  });

  it('save_memory tool throws on missing required content', async () => {
    const host = { saveMemory: async () => ({ id: 'x' }) } as never;
    await expect(
      BUILTIN_MEMORY_PLUGIN.tools?.save_memory?.({}, { host }),
    ).rejects.toThrow('content 必填');
  });

  it('search_memory tool returns formatted memories', async () => {
    const host = {
      searchMemories: async () => [
        { category: 'fact', content: '地球是圆的', createdAt: '2026-01-15T00:00:00.000Z' },
        { category: 'preference', content: '用户喜欢蓝', createdAt: '2026-03-10T00:00:00.000Z' },
      ],
    } as never;
    const result = await BUILTIN_MEMORY_PLUGIN.tools?.search_memory?.(
      { query: '地球' },
      { host },
    ) as never;
    expect(result).toEqual({
      count: 2,
      memories: [
        { content: '地球是圆的', category: 'fact', date: '2026-01-15' },
        { content: '用户喜欢蓝', category: 'preference', date: '2026-03-10' },
      ],
    });
  });

  it('search_memory tool with empty results', async () => {
    const host = { searchMemories: async () => [] } as never;
    const result = await BUILTIN_MEMORY_PLUGIN.tools?.search_memory?.(
      { query: '不存在' },
      { host },
    ) as never;
    expect(result).toEqual({ count: 0, memories: [] });
  });

  it('search_memory tool throws on missing required query', async () => {
    const host = { searchMemories: async () => [] } as never;
    await expect(
      BUILTIN_MEMORY_PLUGIN.tools?.search_memory?.({}, { host }),
    ).rejects.toThrow('query 必填');
  });
});

describe('BUILTIN_AUTOMATION_PLUGIN', () => {
  it('has correct manifest metadata', () => {
    expect(BUILTIN_AUTOMATION_PLUGIN.manifest.id).toBe('builtin.automation');
    expect(BUILTIN_AUTOMATION_PLUGIN.manifest.name).toBe('自动化');
    expect(BUILTIN_AUTOMATION_PLUGIN.manifest.description).toBe('提供自动化任务的创建与管理。');
    expect(BUILTIN_AUTOMATION_PLUGIN.manifest.version).toBe('1.0.0');
    expect(BUILTIN_AUTOMATION_PLUGIN.manifest.runtime).toBe('local');
  });

  it('has correct governance config', () => {
    expect(BUILTIN_AUTOMATION_PLUGIN.governance).toEqual({
      builtinRole: 'system-optional',
      canDisable: true,
      defaultEnabled: true,
    });
  });

  it('has correct permissions and single tool', () => {
    expect(BUILTIN_AUTOMATION_PLUGIN.manifest.permissions).toEqual(['automation:read', 'automation:write']);
    expect(BUILTIN_AUTOMATION_PLUGIN.manifest.tools).toHaveLength(1);
    expect(BUILTIN_AUTOMATION_PLUGIN.manifest.tools[0].name).toBe('create_automation');
  });

  it('declares create_automation with all parameter schemas', () => {
    const toolDef = BUILTIN_AUTOMATION_PLUGIN.manifest.tools[0];
    expect(toolDef.parameters.name.required).toBe(true);
    expect(toolDef.parameters.trigger_type.required).toBe(true);
    expect(toolDef.parameters.action_type.required).toBe(true);
    expect(toolDef.parameters.trigger_cron.required).toBeUndefined();
    expect(toolDef.parameters.trigger_event.required).toBeUndefined();
    expect(toolDef.parameters.action_message.required).toBeUndefined();
    expect(toolDef.parameters.action_command.required).toBeUndefined();
  });

  it('creates cron + ai_message automation', async () => {
    const host = {
      createAutomation: async (input: unknown) => ({ id: 'auto-1', name: (input as any).name }),
    } as never;
    const result = await BUILTIN_AUTOMATION_PLUGIN.tools?.create_automation?.(
      {
        name: '每日问候',
        trigger_type: 'cron',
        trigger_cron: '0 8 * * *',
        action_type: 'ai_message',
        action_message: '早安！',
      },
      { host },
    ) as never;
    expect(result).toEqual({ created: true, id: 'auto-1', name: '每日问候' });
  });

  it('creates event + device_command automation', async () => {
    const host = {
      createAutomation: async (input: unknown) => ({ id: 'auto-2', name: (input as any).name }),
    } as never;
    const result = await BUILTIN_AUTOMATION_PLUGIN.tools?.create_automation?.(
      {
        name: '设备触发',
        trigger_type: 'event',
        trigger_event: 'door_open',
        action_type: 'device_command',
        action_command: 'lock_door',
      },
      { host },
    ) as never;
    expect(result).toEqual({ created: true, id: 'auto-2', name: '设备触发' });
  });

  it('creates manual trigger automation without optional fields', async () => {
    const host = {
      createAutomation: async (input: unknown) => ({ id: 'auto-3', name: (input as any).name }),
    } as never;
    const result = await BUILTIN_AUTOMATION_PLUGIN.tools?.create_automation?.(
      {
        name: '手动任务',
        trigger_type: 'manual',
        action_type: 'ai_message',
        action_message: '手动消息',
      },
      { host },
    ) as never;
    expect(result).toEqual({ created: true, id: 'auto-3', name: '手动任务' });
  });

  it('passes correct trigger and action shapes to host.createAutomation', async () => {
    let captured: unknown;
    const host = {
      createAutomation: async (input: unknown) => {
        captured = input;
        return { id: 'auto-4', name: (input as any).name };
      },
    } as never;
    await BUILTIN_AUTOMATION_PLUGIN.tools?.create_automation?.(
      {
        name: '验证',
        trigger_type: 'cron',
        trigger_cron: '*/5 * * * *',
        action_type: 'ai_message',
        action_message: '检查',
      },
      { host },
    ) as never;
    expect(captured).toEqual({
      name: '验证',
      trigger: { type: 'cron', cron: '*/5 * * * *' },
      actions: [{ type: 'ai_message', message: '检查' }],
    });
  });

  it('throws on missing required name', async () => {
    const host = { createAutomation: async () => ({ id: '', name: '' }) } as never;
    await expect(
      BUILTIN_AUTOMATION_PLUGIN.tools?.create_automation?.(
        { trigger_type: 'manual', action_type: 'ai_message', action_message: 'x' },
        { host },
      ),
    ).rejects.toThrow('name 必填');
  });

  it('throws on missing required trigger_type', async () => {
    const host = { createAutomation: async () => ({ id: '', name: '' }) } as never;
    await expect(
      BUILTIN_AUTOMATION_PLUGIN.tools?.create_automation?.(
        { name: 'x', action_type: 'ai_message', action_message: 'x' },
        { host },
      ),
    ).rejects.toThrow('trigger_type 必填');
  });

  it('throws on missing required action_type', async () => {
    const host = { createAutomation: async () => ({ id: '', name: '' }) } as never;
    await expect(
      BUILTIN_AUTOMATION_PLUGIN.tools?.create_automation?.(
        { name: 'x', trigger_type: 'manual', action_message: 'x' },
        { host },
      ),
    ).rejects.toThrow('action_type 必填');
  });
});

describe('BuiltinPluginRegistryService logic', () => {
  describe('hasDefinition', () => {
    it('returns true for existing plugin IDs', () => {
      expect(hasDefinition(ALL_DEFINITIONS, 'builtin.memory')).toBe(true);
      expect(hasDefinition(ALL_DEFINITIONS, 'builtin.automation')).toBe(true);
    });

    it('returns false for unknown plugin IDs', () => {
      expect(hasDefinition(ALL_DEFINITIONS, 'builtin.nonexistent')).toBe(false);
      expect(hasDefinition(ALL_DEFINITIONS, '')).toBe(false);
    });
  });

  describe('getDefinition', () => {
    it('returns a cloned definition for existing ID', () => {
      const def = getDefinition(ALL_DEFINITIONS, 'builtin.memory');
      expect(def).toBeDefined();
      expect(def!.manifest.id).toBe('builtin.memory');
      expect(def!.manifest.name).toBe('记忆');
    });

    it('returns a deep clone (mutating clone does not affect original)', () => {
      const def = getDefinition(ALL_DEFINITIONS, 'builtin.memory');
      def!.manifest.name = 'MUTATED';
      expect(BUILTIN_MEMORY_PLUGIN.manifest.name).toBe('记忆');
    });

    it('returns undefined for unknown ID', () => {
      expect(getDefinition(ALL_DEFINITIONS, 'builtin.unknown')).toBeUndefined();
    });
  });

  describe('listDefinitions', () => {
    it('returns all definitions as clones', () => {
      const all = listDefinitions(ALL_DEFINITIONS);
      expect(all).toHaveLength(2);
      expect(all.map((d) => d.manifest.id)).toEqual(['builtin.automation', 'builtin.memory']);
    });

    it('returned clones are independent of originals', () => {
      const all = listDefinitions(ALL_DEFINITIONS);
      all[0].manifest.name = 'MUTATED';
      expect(BUILTIN_AUTOMATION_PLUGIN.manifest.name).toBe('自动化');
    });
  });

  describe('listRetiredPluginIds', () => {
    it('returns all retired plugin IDs', () => {
      const ids = [...RETIRED_IDS];
      expect(ids).toHaveLength(6);
    });

    it('includes known retired IDs', () => {
      expect(RETIRED_IDS).toContain('builtin.memory-context');
      expect(RETIRED_IDS).toContain('builtin.memory-tools');
      expect(RETIRED_IDS).toContain('builtin.runtime-tools');
      expect(RETIRED_IDS).toContain('builtin.subagent-delegate');
      expect(RETIRED_IDS).toContain('builtin.conversation-title');
      expect(RETIRED_IDS).toContain('builtin.context-compaction');
    });
  });

  describe('cloneDefinition', () => {
    it('produces an equal but independent copy', () => {
      const clone = cloneDefinition(BUILTIN_AUTOMATION_PLUGIN);
      expect(clone.manifest.id).toBe(BUILTIN_AUTOMATION_PLUGIN.manifest.id);
      expect(clone.manifest.tools).toEqual(BUILTIN_AUTOMATION_PLUGIN.manifest.tools);
      expect(clone.governance).toEqual(BUILTIN_AUTOMATION_PLUGIN.governance);
    });

    it('tools reference is shallow-copied (different object, same handler refs)', () => {
      const clone = cloneDefinition(BUILTIN_AUTOMATION_PLUGIN);
      expect(clone.tools).not.toBe(BUILTIN_AUTOMATION_PLUGIN.tools);
      expect(clone.tools?.create_automation).toBe(BUILTIN_AUTOMATION_PLUGIN.tools?.create_automation);
    });

    it('handles definitions without governance', () => {
      const noGov: BuiltinPluginDefinition = {
        manifest: { id: 'no-gov', name: '', description: '', runtime: 'local', tools: [], version: '1.0.0' },
      };
      const clone = cloneDefinition(noGov);
      expect(clone.governance).toBeUndefined();
    });
  });
});
