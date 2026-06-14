// ─── 类型定义（从 @garlic-claw/shared 对齐） ───

type ToolSourceKind = 'builtin' | 'plugin' | 'mcp' | 'skill' | 'subagent';
type PluginActionName = 'health-check' | 'reload' | 'restart';
type ToolSourceHealth = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

interface ToolSourceInfo {
  kind: ToolSourceKind;
  id: string;
  enabled: boolean;
}

interface ToolInfo {
  toolId: string;
  enabled: boolean;
}

interface ToolSourceActionResult {
  accepted: boolean;
  action: PluginActionName;
  sourceKind: ToolSourceKind;
  sourceId: string;
  message: string;
}

interface ToolSourceOverview {
  kind: ToolSourceKind;
  id: string;
  label: string;
  enabled: boolean;
  health: ToolSourceHealth;
  lastError: string | null;
  lastCheckedAt: string;
  totalTools: number;
  enabledTools: number;
  supportedActions: PluginActionName[];
}

interface ToolOverviewEntry {
  toolId: string;
  name: string;
  callName: string;
  description: string;
  enabled: boolean;
  sourceKind: ToolSourceKind;
  sourceId: string;
  sourceLabel: string;
  health: ToolSourceHealth;
  lastError: string | null;
  lastCheckedAt: string;
}

interface ToolOverview {
  sources: ToolSourceOverview[];
  tools: ToolOverviewEntry[];
}

// ─── ToolController（内联，无 NestJS 装饰器） ───

class ToolController {
  constructor(private readonly toolRegistry: {
    listOverview: () => Promise<ToolOverview>;
    setSourceEnabled: (kind: ToolSourceKind, sourceId: string, enabled: boolean) => Promise<ToolSourceInfo>;
    setToolEnabled: (toolId: string, enabled: boolean) => Promise<ToolInfo>;
    runSourceAction: (kind: ToolSourceKind, sourceId: string, action: PluginActionName) => Promise<ToolSourceActionResult>;
  }) {}

  listOverview(): Promise<ToolOverview> {
    return this.toolRegistry.listOverview();
  }

  updateSourceEnabled(kind: ToolSourceKind, sourceId: string, enabled: boolean): Promise<ToolSourceInfo> {
    return this.toolRegistry.setSourceEnabled(kind, sourceId, enabled);
  }

  updateToolEnabled(toolId: string, enabled: boolean): Promise<ToolInfo> {
    return this.toolRegistry.setToolEnabled(toolId, enabled);
  }

  runSourceAction(kind: ToolSourceKind, sourceId: string, action: PluginActionName): Promise<ToolSourceActionResult> {
    return this.toolRegistry.runSourceAction(kind, sourceId, action);
  }
}

// ─── 测试 ───

describe('ToolController', () => {
  let toolRegistry: ReturnType<typeof createMockRegistry>;
  let controller: ToolController;

  function createMockRegistry() {
    return {
      listOverview: vi.fn(),
      setSourceEnabled: vi.fn(),
      setToolEnabled: vi.fn(),
      runSourceAction: vi.fn(),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    toolRegistry = createMockRegistry();
    controller = new ToolController(toolRegistry);
  });

  it('delegates listOverview to registry', async () => {
    const overview: ToolOverview = {
      sources: [
        {
          kind: 'plugin',
          id: 'builtin.memory',
          label: '记忆',
          enabled: true,
          health: 'healthy',
          lastError: null,
          lastCheckedAt: '2026-06-14T12:00:00.000Z',
          totalTools: 2,
          enabledTools: 2,
          supportedActions: ['health-check', 'reload'],
        },
      ],
      tools: [
        {
          toolId: 'plugin:builtin.memory:save_memory',
          name: 'save_memory',
          callName: 'save_memory',
          description: '保存记忆',
          enabled: true,
          sourceKind: 'plugin',
          sourceId: 'builtin.memory',
          sourceLabel: '记忆',
          health: 'healthy',
          lastError: null,
          lastCheckedAt: '2026-06-14T12:00:00.000Z',
        },
      ],
    };
    toolRegistry.listOverview.mockResolvedValue(overview);

    const result = await controller.listOverview();
    expect(result).toEqual(overview);
    expect(toolRegistry.listOverview).toHaveBeenCalledOnce();
  });

  it('delegates updateSourceEnabled to registry', async () => {
    const sourceInfo: ToolSourceInfo = { kind: 'plugin', id: 'builtin.memory', enabled: false };
    toolRegistry.setSourceEnabled.mockResolvedValue(sourceInfo);

    const result = await controller.updateSourceEnabled('plugin', 'builtin.memory', false);
    expect(result).toEqual(sourceInfo);
    expect(toolRegistry.setSourceEnabled).toHaveBeenCalledWith('plugin', 'builtin.memory', false);
  });

  it('delegates updateToolEnabled to registry', async () => {
    const toolInfo: ToolInfo = { toolId: 'plugin:builtin.memory:save_memory', enabled: false };
    toolRegistry.setToolEnabled.mockResolvedValue(toolInfo);

    const result = await controller.updateToolEnabled('plugin:builtin.memory:save_memory', false);
    expect(result).toEqual(toolInfo);
    expect(toolRegistry.setToolEnabled).toHaveBeenCalledWith('plugin:builtin.memory:save_memory', false);
  });

  it('delegates runSourceAction to registry for plugin source', async () => {
    const actionResult: ToolSourceActionResult = {
      accepted: true,
      action: 'health-check',
      sourceKind: 'plugin',
      sourceId: 'builtin.memory',
      message: 'Plugin source health check passed',
    };
    toolRegistry.runSourceAction.mockResolvedValue(actionResult);

    const result = await controller.runSourceAction('plugin', 'builtin.memory', 'health-check');
    expect(result).toEqual(actionResult);
    expect(toolRegistry.runSourceAction).toHaveBeenCalledWith('plugin', 'builtin.memory', 'health-check');
  });

  it('delegates runSourceAction to registry for MCP source', async () => {
    const actionResult: ToolSourceActionResult = {
      accepted: true,
      action: 'health-check',
      sourceKind: 'mcp',
      sourceId: 'weather',
      message: 'MCP source health check passed',
    };
    toolRegistry.runSourceAction.mockResolvedValue(actionResult);

    const result = await controller.runSourceAction('mcp', 'weather', 'health-check');
    expect(result).toEqual(actionResult);
    expect(toolRegistry.runSourceAction).toHaveBeenCalledWith('mcp', 'weather', 'health-check');
  });

  it('handles MCP source reload action', async () => {
    const actionResult: ToolSourceActionResult = {
      accepted: true,
      action: 'reload',
      sourceKind: 'mcp',
      sourceId: 'tavily',
      message: 'MCP source reloaded successfully',
    };
    toolRegistry.runSourceAction.mockResolvedValue(actionResult);

    const result = await controller.runSourceAction('mcp', 'tavily', 'reload');
    expect(result).toEqual(actionResult);
  });

  it('passes through registry rejection for source action', async () => {
    toolRegistry.runSourceAction.mockRejectedValue(new Error('Source not found'));

    await expect(controller.runSourceAction('builtin', 'unknown', 'health-check')).rejects.toThrow('Source not found');
  });

  it('updates source enabled with all kind variants', async () => {
    const kinds: ToolSourceKind[] = ['builtin', 'plugin', 'mcp', 'skill', 'subagent'];
    for (const kind of kinds) {
      toolRegistry.setSourceEnabled.mockResolvedValue({ kind, id: `test.${kind}`, enabled: true });
      const result = await controller.updateSourceEnabled(kind, `test.${kind}`, true);
      expect(result.kind).toBe(kind);
    }
  });

  it('returns the same toolId from updateToolEnabled', async () => {
    toolRegistry.setToolEnabled.mockImplementation(async (toolId: string, enabled: boolean) => ({ toolId, enabled }));
    const result = await controller.updateToolEnabled('mcp:weather:get_forecast', false);
    expect(result.toolId).toBe('mcp:weather:get_forecast');
    expect(result.enabled).toBe(false);
  });
});
