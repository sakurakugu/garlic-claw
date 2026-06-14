import type { JsonValue } from '@garlic-claw/shared';

// ─── 内联：从 tool-management-settings.service.ts 对齐 ───

type ToolManagementConfigRecord = {
  sourceEnabled?: Record<string, boolean>;
  toolEnabled?: Record<string, boolean>;
};

function isJsonObject(value: JsonValue | unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeBooleanMap(value: unknown): Record<string, boolean> {
  if (!isJsonObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => typeof entry === 'boolean' ? [[key, entry]] : []),
  );
}

function sanitizeToolManagementConfig(values: Record<string, JsonValue>): {
  sourceEnabled: Record<string, boolean>;
  toolEnabled: Record<string, boolean>;
} {
  const record = values as ToolManagementConfigRecord;
  return {
    sourceEnabled: sanitizeBooleanMap(record.sourceEnabled),
    toolEnabled: sanitizeBooleanMap(record.toolEnabled),
  };
}

// ─── ToolManagementSettingsService（内联） ───

class ToolManagementSettingsService {
  private config: { sourceEnabled: Record<string, boolean>; toolEnabled: Record<string, boolean> };

  constructor(private readonly settingsStore: { readSection(section: string): Record<string, JsonValue>; writeSection(section: string, data: Record<string, unknown>): void }) {
    this.config = sanitizeToolManagementConfig(this.settingsStore.readSection('tools'));
  }

  readSourceEnabledOverride(key: string): boolean | undefined {
    return this.config.sourceEnabled[key];
  }

  writeSourceEnabledOverride(key: string, enabled: boolean): void {
    this.config.sourceEnabled[key] = enabled;
    this.persistConfig();
  }

  deleteSourceOverrides(sourceKey: string): void {
    let changed = false;
    if (sourceKey in this.config.sourceEnabled) {
      delete this.config.sourceEnabled[sourceKey];
      changed = true;
    }
    for (const toolKey of Object.keys(this.config.toolEnabled)) {
      if (toolKey.startsWith(`${sourceKey}:`)) {
        delete this.config.toolEnabled[toolKey];
        changed = true;
      }
    }
    if (changed) {
      this.persistConfig();
    }
  }

  readToolEnabledOverride(key: string): boolean | undefined {
    return this.config.toolEnabled[key];
  }

  writeToolEnabledOverride(key: string, enabled: boolean): void {
    this.config.toolEnabled[key] = enabled;
    this.persistConfig();
  }

  private persistConfig(): void {
    this.settingsStore.writeSection('tools', {
      sourceEnabled: { ...this.config.sourceEnabled },
      toolEnabled: { ...this.config.toolEnabled },
    });
  }
}

// ─── 测试 ───

describe('tool-management-settings: isJsonObject', () => {
  it('returns true for a plain object', () => {
    expect(isJsonObject({})).toBe(true);
    expect(isJsonObject({ key: 'value' })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isJsonObject(null)).toBe(false);
  });

  it('returns false for an array', () => {
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject([1, 2])).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isJsonObject('string')).toBe(false);
    expect(isJsonObject(42)).toBe(false);
    expect(isJsonObject(true)).toBe(false);
    expect(isJsonObject(undefined)).toBe(false);
  });
});

describe('tool-management-settings: sanitizeBooleanMap', () => {
  it('returns empty object for non-object input', () => {
    expect(sanitizeBooleanMap(null)).toEqual({});
    expect(sanitizeBooleanMap('string')).toEqual({});
    expect(sanitizeBooleanMap(undefined)).toEqual({});
    expect(sanitizeBooleanMap(42)).toEqual({});
  });

  it('filters out non-boolean values', () => {
    const input = { a: true, b: false, c: 'yes', d: 1, e: null, f: undefined };
    const result = sanitizeBooleanMap(input as unknown as Record<string, JsonValue>);
    expect(result).toEqual({ a: true, b: false });
    expect(Object.keys(result)).toEqual(['a', 'b']);
  });

  it('returns empty object for empty input', () => {
    expect(sanitizeBooleanMap({})).toEqual({});
  });

  it('preserves all boolean values', () => {
    const input = { x: true, y: true, z: false };
    expect(sanitizeBooleanMap(input as unknown as Record<string, JsonValue>)).toEqual(input);
  });
});

describe('tool-management-settings: sanitizeToolManagementConfig', () => {
  it('extracts sourceEnabled and toolEnabled from valid config', () => {
    const config = {
      sourceEnabled: { plugin: true, mcp: false },
      toolEnabled: { 'plugin:builtin.memory:save': true },
    } as unknown as Record<string, JsonValue>;
    const result = sanitizeToolManagementConfig(config);
    expect(result.sourceEnabled).toEqual({ plugin: true, mcp: false });
    expect(result.toolEnabled).toEqual({ 'plugin:builtin.memory:save': true });
  });

  it('returns empty maps for missing sections', () => {
    const result = sanitizeToolManagementConfig({} as unknown as Record<string, JsonValue>);
    expect(result.sourceEnabled).toEqual({});
    expect(result.toolEnabled).toEqual({});
  });

  it('filters non-boolean entries in both sections', () => {
    const config = {
      sourceEnabled: { a: true, b: 'yes' },
      toolEnabled: { c: false, d: 42 },
    } as unknown as Record<string, JsonValue>;
    const result = sanitizeToolManagementConfig(config);
    expect(result.sourceEnabled).toEqual({ a: true });
    expect(result.toolEnabled).toEqual({ c: false });
  });

  it('handles null sections gracefully', () => {
    const config = { sourceEnabled: null, toolEnabled: null } as unknown as Record<string, JsonValue>;
    const result = sanitizeToolManagementConfig(config);
    expect(result.sourceEnabled).toEqual({});
    expect(result.toolEnabled).toEqual({});
  });
});

describe('tool-management-settings: ToolManagementSettingsService', () => {
  const createStore = (initial: Record<string, JsonValue> = {}) => {
    let data = { ...initial };
    return {
      readSection: vi.fn((_section: string) => data),
      writeSection: vi.fn((_section: string, d: Record<string, unknown>) => { data = d as Record<string, JsonValue>; }),
    };
  };

  it('reads source enabled override', () => {
    const store = createStore({ tools: { sourceEnabled: { plugin: true } } } as unknown as Record<string, JsonValue>);
    const svc = new ToolManagementSettingsService(store);
    expect(svc.readSourceEnabledOverride('plugin')).toBe(true);
    expect(svc.readSourceEnabledOverride('nonexistent')).toBeUndefined();
  });

  it('writes source enabled override and persists', () => {
    const store = createStore({ tools: { sourceEnabled: {} } } as unknown as Record<string, JsonValue>);
    const svc = new ToolManagementSettingsService(store);
    svc.writeSourceEnabledOverride('mcp', false);
    expect(svc.readSourceEnabledOverride('mcp')).toBe(false);
    expect(store.writeSection).toHaveBeenCalledWith('tools', expect.objectContaining({
      sourceEnabled: { mcp: false },
    }));
  });

  it('reads tool enabled override', () => {
    const store = createStore({ tools: { toolEnabled: { 'plugin:x:foo': true } } } as unknown as Record<string, JsonValue>);
    const svc = new ToolManagementSettingsService(store);
    expect(svc.readToolEnabledOverride('plugin:x:foo')).toBe(true);
    expect(svc.readToolEnabledOverride('nonexistent')).toBeUndefined();
  });

  it('writes tool enabled override and persists', () => {
    const store = createStore({ tools: { toolEnabled: {} } } as unknown as Record<string, JsonValue>);
    const svc = new ToolManagementSettingsService(store);
    svc.writeToolEnabledOverride('mcp:weather:search', true);
    expect(svc.readToolEnabledOverride('mcp:weather:search')).toBe(true);
    expect(store.writeSection).toHaveBeenCalledWith('tools', expect.objectContaining({
      toolEnabled: { 'mcp:weather:search': true },
    }));
  });

  it('deletes source overrides and associated tool overrides', () => {
    const store = createStore({ tools: { sourceEnabled: { plugin: true, mcp: false }, toolEnabled: { 'plugin:a:b': true, 'plugin:a:c': false, 'mcp:x:y': true } } } as unknown as Record<string, JsonValue>);
    const svc = new ToolManagementSettingsService(store);
    svc.deleteSourceOverrides('plugin');
    expect(svc.readSourceEnabledOverride('plugin')).toBeUndefined();
    expect(svc.readSourceEnabledOverride('mcp')).toBe(false);
    expect(svc.readToolEnabledOverride('plugin:a:b')).toBeUndefined();
    expect(svc.readToolEnabledOverride('plugin:a:c')).toBeUndefined();
    expect(svc.readToolEnabledOverride('mcp:x:y')).toBe(true);
    expect(store.writeSection).toHaveBeenCalled();
  });

  it('does not persist when nothing changed during delete', () => {
    const store = createStore({ tools: { sourceEnabled: {}, toolEnabled: {} } } as unknown as Record<string, JsonValue>);
    const svc = new ToolManagementSettingsService(store);
    store.writeSection.mockClear();
    svc.deleteSourceOverrides('nonexistent');
    expect(store.writeSection).not.toHaveBeenCalled();
  });

  it('isolates internal config from write output via shallow copy', () => {
    const store = createStore({ tools: { sourceEnabled: { plugin: true } } } as unknown as Record<string, JsonValue>);
    const svc = new ToolManagementSettingsService(store);
    svc.writeSourceEnabledOverride('plugin', false);
    const persisted = store.writeSection.mock.calls[0][1];
    expect(persisted.sourceEnabled.plugin).toBe(false);
    expect(svc.readSourceEnabledOverride('plugin')).toBe(false);
  });
});
