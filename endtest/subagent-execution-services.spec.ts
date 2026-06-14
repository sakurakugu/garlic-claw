import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── 类型定义 ───

interface JsonObject {
  [key: string]: JsonValue;
}
type JsonValue = JsonObject | JsonValue[] | string | number | boolean | null;

interface PluginSubagentTypeSummary {
  id: string;
  name: string;
  description?: string;
}

interface PluginSubagentDetail {
  context: { conversationId: string; source: string; userId?: string };
  request: { messages: unknown[] };
  result: unknown;
}

interface PluginSubagentOverview {
  types: PluginSubagentTypeSummary[];
}

interface PluginCallContext {
  conversationId: string;
  source: string;
  userId?: string;
}

interface PluginConfigSnapshot {
  schema: unknown;
  values: JsonObject;
}

interface PluginSubagentConfig {
  targetSubagentType?: string;
  targetProviderId?: string;
  targetModelId?: string;
  maxConversationSubagents?: number;
  allowedToolNames?: string[];
}

interface ToolInfo {
  callName: string;
  description: string;
  enabled: boolean;
  name: string;
  parameters: Record<string, unknown>;
  sourceId: string;
  sourceKind: 'internal';
  sourceLabel: string;
  toolId: string;
}

// ─── 常量 ───

const INTERNAL_SUBAGENT_SOURCE_ID = 'subagent';
const INTERNAL_SUBAGENT_SOURCE_LABEL = 'Subagent';
const SUBAGENT_TOOL_NAMES = new Set(['spawn_subagent', 'wait_subagent', 'send_input_subagent', 'interrupt_subagent', 'close_subagent']);

const SUBAGENT_CONFIG_SCHEMA = null; // 测试中简化为 null

// ─── 工具函数 ───

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ─── Mock SubagentRunner ───

function createMockSubagentRunner() {
  let overviewResult: PluginSubagentOverview = { types: [] };
  let typesResult: PluginSubagentTypeSummary[] = [];
  let detailResult: PluginSubagentDetail | null = null;
  let lastCloseArgs: { pluginId: string; conversationId: string; userId?: string } | null = null;
  let lastInterruptArgs: { pluginId: string; conversationId: string; userId: string } | null = null;
  let lastSpawnArgs: { sourceId: string; sourceLabel: string; context: PluginCallContext; params: JsonObject } | null = null;
  let lastWaitArgs: { sourceId: string; params: { conversationId: string; timeoutMs?: number | null } } | null = null;
  let lastSendInputArgs: { sourceId: string; context: PluginCallContext; params: unknown } | null = null;
  let closeError: Error | null = null;

  const runner = {
    listOverview: () => overviewResult,
    listTypes: () => typesResult,
    getSubagentOrThrow: (conversationId: string): PluginSubagentDetail => {
      if (!detailResult) {
        throw new Error(`Subagent conversation not found: ${conversationId}`);
      }
      return detailResult;
    },
    closeSubagent: async (pluginId: string, params: { conversationId: string }, userId?: string) => {
      lastCloseArgs = { pluginId, conversationId: params.conversationId, userId };
      if (closeError) throw closeError;
    },
    interruptSubagent: async (pluginId: string, conversationId: string, userId: string) => {
      lastInterruptArgs = { pluginId, conversationId, userId };
    },
    spawnSubagent: async (sourceId: string, sourceLabel: string, context: PluginCallContext, params: JsonObject) => {
      lastSpawnArgs = { sourceId, sourceLabel, context, params };
      return { conversationId: 'spawned-conv-1', status: 'running', title: 'Spawned Agent' };
    },
    waitSubagent: async (sourceId: string, params: { conversationId: string; timeoutMs?: number | null }) => {
      lastWaitArgs = { sourceId, params };
      return { conversationId: params.conversationId, status: 'completed', title: 'Wait Result' };
    },
    sendInputSubagent: async (sourceId: string, context: PluginCallContext, params: unknown) => {
      lastSendInputArgs = { sourceId, context, params };
      return { conversationId: 'input-conv-1', status: 'running' };
    },

    _setOverview: (value: PluginSubagentOverview) => { overviewResult = value; },
    _setTypes: (value: PluginSubagentTypeSummary[]) => { typesResult = value; },
    _setDetail: (value: PluginSubagentDetail | null) => { detailResult = value; },
    _setCloseError: (error: Error | null) => { closeError = error; },
    _getLastCloseArgs: () => lastCloseArgs,
    _getLastInterruptArgs: () => lastInterruptArgs,
    _getLastSpawnArgs: () => lastSpawnArgs,
    _getLastWaitArgs: () => lastWaitArgs,
    _getLastSendInputArgs: () => lastSendInputArgs,
    _reset: () => {
      overviewResult = { types: [] };
      typesResult = [];
      detailResult = null;
      lastCloseArgs = null; lastInterruptArgs = null; lastSpawnArgs = null;
      lastWaitArgs = null; lastSendInputArgs = null;
      closeError = null;
    },
  };
  return runner;
}

type MockSubagentRunner = ReturnType<typeof createMockSubagentRunner>;

// ─── 内联 SubagentSettingsService ───

class InlineSubagentSettingsService {
  private readonly configPath: string;
  private configValues: JsonObject;

  constructor(configDir: string) {
    this.configPath = path.join(configDir, 'settings.json');
    this.configValues = this.loadConfig();
  }

  private loadConfig(): JsonObject {
    try {
      if (!fs.existsSync(this.configPath)) return {};
      const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      return isJsonObject(parsed) ? this.sanitizeConfig(parsed) : {};
    } catch { return {}; }
  }

  getSourceId(): string { return INTERNAL_SUBAGENT_SOURCE_ID; }

  getConfigSnapshot(): PluginConfigSnapshot {
    return { schema: SUBAGENT_CONFIG_SCHEMA, values: structuredClone(this.configValues) };
  }

  getStoredConfig(): JsonObject {
    return structuredClone(this.configValues);
  }

  updateConfig(values: JsonObject): PluginConfigSnapshot {
    this.configValues = this.sanitizeConfig(values);
    this.persistConfig();
    return this.getConfigSnapshot();
  }

  readSubagentConfig(): PluginSubagentConfig {
    const config = this.configValues;
    const llm = isJsonObject(config.llm) ? config.llm : null;
    const session = isJsonObject(config.session) ? config.session : null;
    const tools = isJsonObject(config.tools) ? config.tools : null;
    const allowedToolNames = Array.isArray(tools?.allowedToolNames)
      ? tools.allowedToolNames.filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
      : [];
    return {
      ...(typeof llm?.targetSubagentType === 'string' ? { targetSubagentType: llm.targetSubagentType } : {}),
      ...(typeof llm?.targetProviderId === 'string' ? { targetProviderId: llm.targetProviderId } : {}),
      ...(typeof llm?.targetModelId === 'string' ? { targetModelId: llm.targetModelId } : {}),
      ...(typeof session?.maxConversationSubagents === 'number' ? { maxConversationSubagents: session.maxConversationSubagents } : {}),
      ...(allowedToolNames.length > 0 ? { allowedToolNames } : {}),
    };
  }

  private sanitizeConfig(values: JsonObject): JsonObject {
    const next: JsonObject = {};
    if (isJsonObject(values.llm)) {
      const llm: JsonObject = {};
      this.writeOptionalText(llm, 'targetSubagentType', values.llm.targetSubagentType);
      this.writeOptionalText(llm, 'targetProviderId', values.llm.targetProviderId);
      this.writeOptionalText(llm, 'targetModelId', values.llm.targetModelId);
      if (Object.keys(llm).length > 0) next.llm = llm;
    }
    if (isJsonObject(values.session)) {
      const session: JsonObject = {};
      if (values.session.maxConversationSubagents !== undefined) {
        session.maxConversationSubagents = values.session.maxConversationSubagents;
      }
      if (Object.keys(session).length > 0) next.session = session;
    }
    if (isJsonObject(values.tools)) {
      const tools: JsonObject = {};
      const allowed = Array.isArray(values.tools.allowedToolNames)
        ? values.tools.allowedToolNames.filter((e): e is string => typeof e === 'string').map((e: string) => e.trim()).filter(Boolean)
        : [];
      if (allowed.length > 0) tools.allowedToolNames = allowed;
      if (Object.keys(tools).length > 0) next.tools = tools;
    }
    return next;
  }

  private writeOptionalText(target: JsonObject, key: string, value: unknown): void {
    if (typeof value !== 'string') return;
    const n = value.trim();
    if (n) target[key] = n;
  }

  private persistConfig(): void {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(this.configValues, null, 2), 'utf-8');
  }
}

// ─── 内联 SubagentToolService ───

class InlineSubagentToolService {
  constructor(
    private readonly runner: MockSubagentRunner,
    private readonly settings: InlineSubagentSettingsService,
  ) {}

  getSourceId(): string { return INTERNAL_SUBAGENT_SOURCE_ID; }
  getSourceLabel(): string { return INTERNAL_SUBAGENT_SOURCE_LABEL; }

  getToolInfos(): ToolInfo[] {
    const sourceId = this.getSourceId();
    const sourceLabel = this.getSourceLabel();
    return [...SUBAGENT_TOOL_NAMES].map((name) => ({
      callName: name,
      description: `Subagent tool: ${name}`,
      enabled: true,
      name,
      parameters: {},
      sourceId,
      sourceKind: 'internal' as const,
      sourceLabel,
      toolId: `internal:${sourceId}:${name}`,
    }));
  }

  async executeTool(toolName: string, args: Record<string, unknown>, context: PluginCallContext) {
    if (!SUBAGENT_TOOL_NAMES.has(toolName)) {
      throw new Error(`Internal subagent tool not found: ${toolName}`);
    }
    switch (toolName) {
      case 'wait_subagent':
        return this.runner.waitSubagent(this.getSourceId(), {
          conversationId: String(args.conversationId),
          ...(typeof args.timeoutMs === 'number' ? { timeoutMs: args.timeoutMs } : {}),
        });
      case 'interrupt_subagent':
        return this.runner.interruptSubagent(this.getSourceId(), String(args.conversationId), context.userId ?? '');
      case 'close_subagent':
        return this.runner.closeSubagent(this.getSourceId(), { conversationId: String(args.conversationId) }, context.userId);
      case 'send_input_subagent':
        return this.runner.sendInputSubagent(this.getSourceId(), context, { config: this.settings.readSubagentConfig(), conversationId: String(args.conversationId), prompt: String(args.prompt) });
      default:
        return this.runner.spawnSubagent(this.getSourceId(), this.getSourceLabel(), context, args as JsonObject);
    }
  }
}

// ─── 内联 SubagentController ───

class InlineSubagentController {
  constructor(private readonly runner: MockSubagentRunner) {}

  listOverview(): PluginSubagentOverview { return this.runner.listOverview(); }
  listTypes(): PluginSubagentTypeSummary[] { return this.runner.listTypes(); }

  getSubagent(conversationId: string): PluginSubagentDetail {
    return this.runner.getSubagentOrThrow(conversationId);
  }

  async closeSubagent(conversationId: string) {
    const sa = this.runner.getSubagentOrThrow(conversationId);
    await this.runner.closeSubagent(sa.context.source, { conversationId });
    return this.runner.getSubagentOrThrow(conversationId);
  }
}

// ========================================================================
// 测试
// ========================================================================

describe('execution/subagent/ 服务层测试', () => {
  let tmpDir: string;
  let runner: MockSubagentRunner;
  let settings: InlineSubagentSettingsService;
  let toolService: InlineSubagentToolService;
  let controller: InlineSubagentController;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `subagent-exec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    runner = createMockSubagentRunner();
    settings = new InlineSubagentSettingsService(tmpDir);
    toolService = new InlineSubagentToolService(runner, settings);
    controller = new InlineSubagentController(runner);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1. SubagentSettingsService ──

  describe('1. SubagentSettingsService', () => {
    it('getSourceId 返回 subagent', () => {
      expect(settings.getSourceId()).toBe('subagent');
    });

    it('getConfigSnapshot 返回 schema 和 values', () => {
      const snapshot = settings.getConfigSnapshot();
      expect(snapshot).toHaveProperty('schema');
      expect(snapshot).toHaveProperty('values');
      expect(snapshot.values).toEqual({});
    });

    it('getStoredConfig 返回克隆副本', () => {
      const a = settings.getStoredConfig();
      const b = settings.getStoredConfig();
      expect(a).toEqual({});
      expect(b).not.toBe(a);
    });

    it('updateConfig 保存并返回快照', () => {
      const snapshot = settings.updateConfig({
        llm: { targetSubagentType: 'explore' },
        session: { maxConversationSubagents: 5 },
      });
      expect(snapshot.values.llm).toBeDefined();
      expect((snapshot.values.llm as JsonObject).targetSubagentType).toBe('explore');
      expect(settings.getStoredConfig()).toEqual(snapshot.values);
    });

    it('updateConfig 写入磁盘', () => {
      settings.updateConfig({ llm: { targetSubagentType: 'general' } });
      const cp = path.join(tmpDir, 'settings.json');
      expect(fs.existsSync(cp)).toBe(true);
      const disk = JSON.parse(fs.readFileSync(cp, 'utf-8'));
      expect((disk.llm as JsonObject).targetSubagentType).toBe('general');
    });

    it('readSubagentConfig 返回扁平配置', () => {
      settings.updateConfig({
        llm: { targetSubagentType: 'explore', targetProviderId: 'openai', targetModelId: 'gpt-4' },
        session: { maxConversationSubagents: 3 },
        tools: { allowedToolNames: ['read', 'write'] },
      });
      const cfg = settings.readSubagentConfig();
      expect(cfg.targetSubagentType).toBe('explore');
      expect(cfg.targetProviderId).toBe('openai');
      expect(cfg.targetModelId).toBe('gpt-4');
      expect(cfg.maxConversationSubagents).toBe(3);
      expect(cfg.allowedToolNames).toEqual(['read', 'write']);
    });

    it('空配置的 readSubagentConfig 返回空对象', () => {
      expect(Object.keys(settings.readSubagentConfig()).length).toBe(0);
    });

    it('updateConfig 过滤无效子节', () => {
      const snapshot = settings.updateConfig({
        llm: { targetSubagentType: '' },
        session: {},
        tools: { allowedToolNames: [] },
        extra: { some: 'value' },
      });
      expect(snapshot.values).toEqual({});
    });

    it('updateConfig 替换旧值', () => {
      settings.updateConfig({ llm: { targetSubagentType: 'explore' }, session: { maxConversationSubagents: 3 } });
      settings.updateConfig({ session: { maxConversationSubagents: 10 } });
      const cfg = settings.readSubagentConfig();
      expect(cfg.targetSubagentType).toBeUndefined();
      expect(cfg.maxConversationSubagents).toBe(10);
    });
  });

  // ── 2. SubagentToolService ──

  describe('2. SubagentToolService', () => {
    it('getSourceId 返回 subagent', () => {
      expect(toolService.getSourceId()).toBe('subagent');
    });

    it('getSourceLabel 返回 Subagent', () => {
      expect(toolService.getSourceLabel()).toBe('Subagent');
    });

    it('getToolInfos 返回 5 个工具定义', () => {
      runner._setTypes([{ id: 'general', name: '通用' }, { id: 'explore', name: '探索' }]);
      const tools = toolService.getToolInfos();
      expect(tools).toHaveLength(5);
      const names = tools.map((t) => t.callName);
      expect(names).toContain('spawn_subagent');
      expect(names).toContain('wait_subagent');
      expect(names).toContain('close_subagent');
      expect(tools[0].sourceId).toBe('subagent');
      expect(tools[0].sourceKind).toBe('internal');
      expect(tools[0].enabled).toBe(true);
    });

    it('executeTool 对未知工具名抛出错误', async () => {
      await expect(toolService.executeTool('unknown_tool', {}, { conversationId: 'c1', source: 'test' }))
        .rejects.toThrow('Internal subagent tool not found: unknown_tool');
    });

    it('executeTool(spawn_subagent) 派生子代理', async () => {
      const result = await toolService.executeTool('spawn_subagent', { prompt: 'Do something', name: 'Test Agent' }, { conversationId: 'c1', source: 'test', userId: 'u1' });
      const spawnArgs = runner._getLastSpawnArgs();
      expect(spawnArgs).not.toBeNull();
      expect(spawnArgs!.sourceId).toBe('subagent');
      expect(spawnArgs!.context.userId).toBe('u1');
      expect(result).toBeDefined();
    });

    it('executeTool(close_subagent) 关闭子代理', async () => {
      runner._setDetail({ context: { conversationId: 'c1', source: 'http-route' }, request: { messages: [] }, result: null });
      await toolService.executeTool('close_subagent', { conversationId: 'c1' }, { conversationId: 'c1', source: 'test', userId: 'u1' });
      expect(runner._getLastCloseArgs()!.conversationId).toBe('c1');
    });

    it('executeTool(wait_subagent) 等待子代理', async () => {
      await toolService.executeTool('wait_subagent', { conversationId: 'c1', timeoutMs: 30000 }, { conversationId: 'c1', source: 'test' });
      expect(runner._getLastWaitArgs()!.params.conversationId).toBe('c1');
      expect(runner._getLastWaitArgs()!.params.timeoutMs).toBe(30000);
    });

    it('executeTool(wait_subagent) 无 timeoutMs', async () => {
      await toolService.executeTool('wait_subagent', { conversationId: 'c1' }, { conversationId: 'c1', source: 'test' });
      expect(runner._getLastWaitArgs()!.params.timeoutMs).toBeUndefined();
    });

    it('executeTool(interrupt_subagent) 中断子代理', async () => {
      await toolService.executeTool('interrupt_subagent', { conversationId: 'c1' }, { conversationId: 'c1', source: 'test', userId: 'u1' });
      expect(runner._getLastInterruptArgs()!.conversationId).toBe('c1');
      expect(runner._getLastInterruptArgs()!.userId).toBe('u1');
    });

    it('executeTool(send_input_subagent) 发送输入', async () => {
      await toolService.executeTool('send_input_subagent', { conversationId: 'c1', prompt: 'Continue...' }, { conversationId: 'c1', source: 'test', userId: 'u1' });
      expect(runner._getLastSendInputArgs()).not.toBeNull();
      expect(runner._getLastSendInputArgs()!.sourceId).toBe('subagent');
    });

    it('getToolInfos 随 runner 类型变化', () => {
      runner._setTypes([]);
      expect(toolService.getToolInfos()).toHaveLength(5);
    });
  });

  // ── 3. SubagentController ──

  describe('3. SubagentController', () => {
    it('listOverview 委托给 runner', () => {
      runner._setOverview({ types: [{ id: 'general', name: '通用' }] });
      expect(controller.listOverview().types).toHaveLength(1);
    });

    it('listTypes 委托给 runner', () => {
      runner._setTypes([{ id: 'explore', name: '探索' }, { id: 'general', name: '通用' }]);
      expect(controller.listTypes()).toHaveLength(2);
    });

    it('getSubagent 返回子代理详情', () => {
      runner._setDetail({ context: { conversationId: 'conv-1', source: 'http-route' }, request: { messages: [] }, result: null });
      expect(controller.getSubagent('conv-1').context.conversationId).toBe('conv-1');
    });

    it('getSubagent 对不存在抛出错误', () => {
      expect(() => controller.getSubagent('nonexistent'))
        .toThrow('Subagent conversation not found: nonexistent');
    });

    it('closeSubagent 关闭并返回更新后详情', async () => {
      runner._setDetail({ context: { conversationId: 'conv-1', source: 'http-route' }, request: { messages: [] }, result: null });
      const result = await controller.closeSubagent('conv-1');
      expect(result.context.conversationId).toBe('conv-1');
    });

    it('closeSubagent 对不存在抛出错误', async () => {
      await expect(controller.closeSubagent('nonexistent'))
        .rejects.toThrow('Subagent conversation not found: nonexistent');
    });

    it('listOverview 返回空类型列表', () => {
      expect(controller.listOverview().types).toEqual([]);
    });

    it('listTypes 返回空数组', () => {
      expect(controller.listTypes()).toEqual([]);
    });
  });

  // ── 4. 边界条件 ──

  describe('4. 边界条件', () => {
    it('executeTool 大参数', async () => {
      const largePrompt = 'x'.repeat(10000);
      await toolService.executeTool('spawn_subagent', { prompt: largePrompt }, { conversationId: 'c1', source: 'test' });
      expect(runner._getLastSpawnArgs()).not.toBeNull();
    });

    it('updateConfig 超大 maxConversationSubagents', () => {
      settings.updateConfig({ session: { maxConversationSubagents: 1_000_001 } });
      const cfg = settings.readSubagentConfig();
      expect(cfg.maxConversationSubagents).toBe(1_000_001);
    });

    it('readSubagentConfig 忽略未知字段', () => {
      settings.updateConfig({ unknown: { foo: 'bar' } } as unknown as JsonObject);
      expect(settings.readSubagentConfig()).toEqual({});
    });

    it('getConfigSnapshot 不可变', () => {
      const s1 = settings.getConfigSnapshot();
      (s1.values as JsonObject).llm = { targetSubagentType: 'hacked' } as JsonObject;
      const s2 = settings.getConfigSnapshot();
      expect(s2.values).not.toHaveProperty('llm');
    });

    it('getStoredConfig 不可变', () => {
      const c1 = settings.getStoredConfig();
      (c1 as JsonObject).llm = { targetSubagentType: 'hacked' } as JsonObject;
      const c2 = settings.getStoredConfig();
      expect(c2).not.toHaveProperty('llm');
    });
  });
});
