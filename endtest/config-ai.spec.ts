import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── 类型定义（从 @garlic-claw/shared 对齐） ───

type ProviderProtocolDriver = 'openai' | 'anthropic' | 'gemini';
type AiProviderCatalogDriver = 'openai' | 'anthropic' | 'gemini';
type AiProviderCatalogKind = 'core';
type AiUtilityModelRole = 'conversationTitle' | 'pluginGenerateText';

interface AiModelRouteTarget {
  providerId: string;
  modelId: string;
}

interface AiModalityCapabilities {
  text: boolean;
  image: boolean;
}

interface AiModelCapabilities {
  reasoning: boolean;
  toolCall: boolean;
  input: AiModalityCapabilities;
  output: AiModalityCapabilities;
}

interface AiModelApiConfig {
  id: string;
  url: string;
  npm: string;
}

interface AiModelConfig {
  id: string;
  providerId: string;
  name: string;
  capabilities: AiModelCapabilities;
  contextLength: number;
  api: AiModelApiConfig;
  status?: 'alpha' | 'beta' | 'active' | 'deprecated';
}

interface VisionFallbackConfig {
  enabled: boolean;
  providerId?: string;
  modelId?: string;
  prompt?: string;
  maxDescriptionLength?: number;
}

interface AiChatAutoRetryConfig {
  enabled: boolean;
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

interface AiUtilityModelRolesConfig {
  conversationTitle?: AiModelRouteTarget;
  pluginGenerateText?: AiModelRouteTarget;
}

interface AiHostModelRoutingConfig {
  fallbackChatModels: AiModelRouteTarget[];
  chatAutoRetry?: AiChatAutoRetryConfig;
  compressionModel?: AiModelRouteTarget;
  utilityModelRoles: AiUtilityModelRolesConfig;
}

interface AiProviderCatalogItem {
  id: AiProviderCatalogDriver;
  kind: AiProviderCatalogKind;
  protocol: ProviderProtocolDriver;
  name: string;
  defaultBaseUrl: string;
  defaultModel: string;
}

// ─── 内联纯函数（对齐 ai-settings.store.ts） ───

const DEFAULT_AI_CHAT_AUTO_RETRY_CONFIG: AiChatAutoRetryConfig = {
  enabled: true,
  maxRetries: 2,
  initialDelayMs: 2000,
  maxDelayMs: 30000,
  backoffFactor: 2,
};

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeProtocolDriver(value: unknown): ProviderProtocolDriver | null {
  return value === 'openai' || value === 'anthropic' || value === 'gemini' ? value : null;
}

function normalizeDefaultSelection(value: unknown): AiModelRouteTarget | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const providerId = normalizeOptionalText(record.providerId);
  const modelId = normalizeOptionalText(record.modelId);
  return providerId && modelId ? { providerId, modelId } : null;
}

function cloneRoutingConfig(config: AiHostModelRoutingConfig): AiHostModelRoutingConfig {
  return {
    fallbackChatModels: config.fallbackChatModels.map((e) => ({ ...e })),
    ...(config.chatAutoRetry ? { chatAutoRetry: { ...config.chatAutoRetry } } : {}),
    ...(config.compressionModel ? { compressionModel: { ...config.compressionModel } } : {}),
    utilityModelRoles: Object.fromEntries(
      Object.entries(config.utilityModelRoles).map(([role, target]) => [role, target ? { ...target } : target]),
    ) as AiHostModelRoutingConfig['utilityModelRoles'],
  };
}

function createEmptySettings() {
  return {
    defaultSelection: null as AiModelRouteTarget | null,
    hostModelRouting: {
      chatAutoRetry: { ...DEFAULT_AI_CHAT_AUTO_RETRY_CONFIG },
      fallbackChatModels: [] as AiModelRouteTarget[],
      utilityModelRoles: {} as AiUtilityModelRolesConfig,
    },
    models: [] as Array<{ id: string; providerId: string; name: string; capabilities: AiModelCapabilities; contextLength: number; status?: string }>,
    providers: [] as Array<{ id: string; name: string; driver: ProviderProtocolDriver; apiKey?: string; baseUrl?: string; defaultModel?: string; models: string[] }>,
    visionFallback: { enabled: false },
  };
}

function isDefaultVisionFallback(config: VisionFallbackConfig): boolean {
  return config.enabled !== true
    && !normalizeOptionalText(config.providerId)
    && !normalizeOptionalText(config.modelId)
    && !normalizeOptionalText(config.prompt)
    && config.maxDescriptionLength === undefined;
}

function isEmptyRoutingConfig(config: AiHostModelRoutingConfig): boolean {
  return config.fallbackChatModels.length === 0
    && Object.keys(config.utilityModelRoles).length === 0
    && !config.compressionModel
    && (!config.chatAutoRetry
      || JSON.stringify(config.chatAutoRetry) === JSON.stringify(DEFAULT_AI_CHAT_AUTO_RETRY_CONFIG));
}

// ─── Provider Catalog ───

const PROVIDER_CATALOG: AiProviderCatalogItem[] = [
  { id: 'openai', kind: 'core', protocol: 'openai', name: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  { id: 'anthropic', kind: 'core', protocol: 'anthropic', name: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-3-5-sonnet-20241022' },
  { id: 'gemini', kind: 'core', protocol: 'gemini', name: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-1.5-pro' },
];

// ─── 文件助手 ───

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T : fallback;
  } catch {
    return fallback;
  }
}

const EXAMPLE_PATH = path.resolve(__dirname, '..', 'config', 'ai', 'settings.example.json');

// ========================================================================
// 测试
// ========================================================================

describe('config/ai/ 配置模块', () => {

  // ── 1. settings.example.json 结构验证 ──

  describe('1. settings.example.json 结构验证', () => {
    let example: Record<string, unknown>;

    beforeAll(() => {
      example = readJsonFile<Record<string, unknown>>(EXAMPLE_PATH, {});
      expect(Object.keys(example).length).toBeGreaterThan(0);
    });

    it('顶级键完整：defaultSelection, hostModelRouting, visionFallback', () => {
      expect(example).toHaveProperty('defaultSelection');
      expect(example).toHaveProperty('hostModelRouting');
      expect(example).toHaveProperty('visionFallback');
    });

    describe('defaultSelection', () => {
      it('包含 providerId 和 modelId', () => {
        const sel = example.defaultSelection as Record<string, unknown>;
        expect(sel).toBeTruthy();
        expect(typeof sel.providerId).toBe('string');
        expect(typeof sel.modelId).toBe('string');
      });

      it('默认值为 openai / gpt-4o-mini', () => {
        const sel = example.defaultSelection as Record<string, unknown>;
        expect(sel.providerId).toBe('openai');
        expect(sel.modelId).toBe('gpt-4o-mini');
      });
    });

    describe('hostModelRouting', () => {
      let routing: Record<string, unknown>;

      beforeAll(() => {
        routing = example.hostModelRouting as Record<string, unknown>;
        expect(routing).toBeTruthy();
      });

      it('fallbackChatModels 为空数组', () => {
        expect(Array.isArray(routing.fallbackChatModels)).toBe(true);
        expect((routing.fallbackChatModels as unknown[]).length).toBe(0);
      });

      describe('compressionModel', () => {
        it('存在且包含 providerId / modelId', () => {
          const cm = routing.compressionModel as Record<string, unknown>;
          expect(cm).toBeTruthy();
          expect(typeof cm.providerId).toBe('string');
          expect(typeof cm.modelId).toBe('string');
        });

        it('指向 openai / gpt-4o-mini', () => {
          const cm = routing.compressionModel as Record<string, unknown>;
          expect(cm.providerId).toBe('openai');
          expect(cm.modelId).toBe('gpt-4o-mini');
        });
      });

      describe('utilityModelRoles', () => {
        let roles: Record<string, unknown>;

        beforeAll(() => {
          roles = routing.utilityModelRoles as Record<string, unknown>;
          expect(roles).toBeTruthy();
        });

        it('包含 conversationTitle 角色', () => {
          expect(roles).toHaveProperty('conversationTitle');
          const ct = roles.conversationTitle as Record<string, unknown>;
          expect(ct.providerId).toBe('openai');
          expect(ct.modelId).toBe('gpt-4o-mini');
        });

        it('包含 pluginGenerateText 角色', () => {
          expect(roles).toHaveProperty('pluginGenerateText');
          const pg = roles.pluginGenerateText as Record<string, unknown>;
          expect(pg.providerId).toBe('gemini');
          expect(pg.modelId).toBe('gemini-1.5-pro');
        });

        it('不会包含未定义的 utility role', () => {
          const knownRoles = ['conversationTitle', 'pluginGenerateText'];
          for (const key of Object.keys(roles)) {
            expect(knownRoles.includes(key)).toBe(true);
          }
        });
      });

      it('hostModelRouting 不包含未知顶级字段', () => {
        const knownKeys = ['fallbackChatModels', 'compressionModel', 'utilityModelRoles', 'chatAutoRetry'];
        for (const key of Object.keys(routing)) {
          expect(knownKeys.includes(key)).toBe(true);
        }
      });
    });

    describe('visionFallback', () => {
      let vf: Record<string, unknown>;

      beforeAll(() => {
        vf = example.visionFallback as Record<string, unknown>;
        expect(vf).toBeTruthy();
      });

      it('enabled 为 false', () => {
        expect(vf.enabled).toBe(false);
      });

      it('providerId 和 modelId 为字符串', () => {
        expect(typeof vf.providerId).toBe('string');
        expect(typeof vf.modelId).toBe('string');
      });

      it('prompt 为非空中文文本', () => {
        expect(typeof vf.prompt).toBe('string');
        expect((vf.prompt as string).length).toBeGreaterThan(0);
      });

      it('maxDescriptionLength 为 400', () => {
        expect(vf.maxDescriptionLength).toBe(400);
      });
    });
  });

  // ── 2. Provider Catalog ──

  describe('2. Provider Catalog 验证', () => {
    it('包含 3 个核心 provider', () => {
      expect(PROVIDER_CATALOG.length).toBe(3);
    });

    it('所有 provider ID 无重复', () => {
      const ids = PROVIDER_CATALOG.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    describe('OpenAI', () => {
      const entry = PROVIDER_CATALOG.find((p) => p.id === 'openai')!;

      it('字段完整', () => {
        expect(entry.kind).toBe('core');
        expect(entry.protocol).toBe('openai');
        expect(entry.name).toBe('OpenAI');
        expect(entry.defaultBaseUrl).toBe('https://api.openai.com/v1');
        expect(entry.defaultModel).toBe('gpt-4o-mini');
      });

      it('protocol 与 id 一致', () => {
        expect(entry.protocol).toBe(entry.id);
      });
    });

    describe('Anthropic', () => {
      const entry = PROVIDER_CATALOG.find((p) => p.id === 'anthropic')!;

      it('字段完整', () => {
        expect(entry.kind).toBe('core');
        expect(entry.protocol).toBe('anthropic');
        expect(entry.name).toBe('Anthropic');
        expect(entry.defaultBaseUrl).toBe('https://api.anthropic.com/v1');
        expect(entry.defaultModel).toBe('claude-3-5-sonnet-20241022');
      });

      it('protocol 与 id 一致', () => {
        expect(entry.protocol).toBe(entry.id);
      });
    });

    describe('Google Gemini', () => {
      const entry = PROVIDER_CATALOG.find((p) => p.id === 'gemini')!;

      it('字段完整', () => {
        expect(entry.kind).toBe('core');
        expect(entry.protocol).toBe('gemini');
        expect(entry.name).toBe('Google Gemini');
        expect(entry.defaultBaseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
        expect(entry.defaultModel).toBe('gemini-1.5-pro');
      });

      it('protocol 与 id 一致', () => {
        expect(entry.protocol).toBe(entry.id);
      });
    });

    it('所有 driver 值都是合法的 ProviderProtocolDriver', () => {
      for (const p of PROVIDER_CATALOG) {
        expect(normalizeProtocolDriver(p.protocol)).not.toBeNull();
      }
    });

    it('所有 kind 值都是 core', () => {
      for (const p of PROVIDER_CATALOG) {
        expect(p.kind).toBe('core');
      }
    });
  });

  // ── 3. 配置字段校验函数 ──

  describe('3. 配置字段校验函数', () => {
    describe('normalizeProtocolDriver', () => {
      it('接受 "openai"', () => expect(normalizeProtocolDriver('openai')).toBe('openai'));
      it('接受 "anthropic"', () => expect(normalizeProtocolDriver('anthropic')).toBe('anthropic'));
      it('接受 "gemini"', () => expect(normalizeProtocolDriver('gemini')).toBe('gemini'));
      it('拒绝未知驱动', () => {
        expect(normalizeProtocolDriver('ollama')).toBeNull();
        expect(normalizeProtocolDriver('')).toBeNull();
        expect(normalizeProtocolDriver(null)).toBeNull();
        expect(normalizeProtocolDriver(undefined)).toBeNull();
        expect(normalizeProtocolDriver(123)).toBeNull();
      });
      it('大小写敏感', () => {
        expect(normalizeProtocolDriver('OpenAI')).toBeNull();
        expect(normalizeProtocolDriver('OPENAI')).toBeNull();
      });
    });

    describe('normalizeOptionalText', () => {
      it('返回非空字符串的 trim', () => {
        expect(normalizeOptionalText(' hello ')).toBe('hello');
      });
      it('空字符串返回 undefined', () => {
        expect(normalizeOptionalText('')).toBeUndefined();
      });
      it('空白字符串返回 undefined', () => {
        expect(normalizeOptionalText('   ')).toBeUndefined();
      });
      it('非字符串返回 undefined', () => {
        expect(normalizeOptionalText(undefined)).toBeUndefined();
        expect(normalizeOptionalText(null)).toBeUndefined();
        expect(normalizeOptionalText(42)).toBeUndefined();
      });
    });

    describe('normalizeDefaultSelection', () => {
      it('解析合法对象', () => {
        expect(normalizeDefaultSelection({ providerId: 'openai', modelId: 'gpt-4' }))
          .toEqual({ providerId: 'openai', modelId: 'gpt-4' });
      });
      it('trim 字段值', () => {
        expect(normalizeDefaultSelection({ providerId: '  openai  ', modelId: '  gpt-4  ' }))
          .toEqual({ providerId: 'openai', modelId: 'gpt-4' });
      });
      it('缺失 providerId 返回 null', () => {
        expect(normalizeDefaultSelection({ modelId: 'gpt-4' })).toBeNull();
      });
      it('空 providerId 返回 null', () => {
        expect(normalizeDefaultSelection({ providerId: '', modelId: 'gpt-4' })).toBeNull();
      });
      it('null 输入返回 null', () => {
        expect(normalizeDefaultSelection(null)).toBeNull();
      });
      it('非对象输入返回 null', () => {
        expect(normalizeDefaultSelection('string')).toBeNull();
      });
    });

    describe('createEmptySettings', () => {
      it('defaultSelection 为 null', () => {
        expect(createEmptySettings().defaultSelection).toBeNull();
      });
      it('hostModelRouting 含默认 chatAutoRetry', () => {
        const s = createEmptySettings();
        expect(s.hostModelRouting.chatAutoRetry).toEqual(DEFAULT_AI_CHAT_AUTO_RETRY_CONFIG);
      });
      it('hostModelRouting.fallbackChatModels 为空', () => {
        expect(createEmptySettings().hostModelRouting.fallbackChatModels).toEqual([]);
      });
      it('hostModelRouting.utilityModelRoles 为空', () => {
        expect(createEmptySettings().hostModelRouting.utilityModelRoles).toEqual({});
      });
      it('models 和 providers 为空数组', () => {
        const s = createEmptySettings();
        expect(s.models).toEqual([]);
        expect(s.providers).toEqual([]);
      });
      it('visionFallback 默认 disabled', () => {
        const s = createEmptySettings();
        expect(s.visionFallback.enabled).toBe(false);
        expect(s.visionFallback.providerId).toBeUndefined();
        expect(s.visionFallback.modelId).toBeUndefined();
      });
    });

    describe('isDefaultVisionFallback', () => {
      it('识别纯默认值', () => {
        expect(isDefaultVisionFallback({ enabled: false })).toBe(true);
      });
      it('enabled: true 时返回 false', () => {
        expect(isDefaultVisionFallback({ enabled: true })).toBe(false);
      });
      it('含 providerId 时返回 false', () => {
        expect(isDefaultVisionFallback({ enabled: false, providerId: 'openai' })).toBe(false);
      });
      it('含 modelId 时返回 false', () => {
        expect(isDefaultVisionFallback({ enabled: false, modelId: 'gpt-4' })).toBe(false);
      });
      it('含 maxDescriptionLength 时返回 false', () => {
        expect(isDefaultVisionFallback({ enabled: false, maxDescriptionLength: 400 })).toBe(false);
      });
    });

    describe('isEmptyRoutingConfig', () => {
      it('全空配置返回 true', () => {
        expect(isEmptyRoutingConfig({ fallbackChatModels: [], utilityModelRoles: {} })).toBe(true);
      });
      it('含 fallbackChatModels 返回 false', () => {
        expect(isEmptyRoutingConfig({
          fallbackChatModels: [{ providerId: 'a', modelId: 'b' }],
          utilityModelRoles: {},
        })).toBe(false);
      });
      it('含 utilityModelRoles 返回 false', () => {
        expect(isEmptyRoutingConfig({
          fallbackChatModels: [],
          utilityModelRoles: { conversationTitle: { providerId: 'a', modelId: 'b' } },
        })).toBe(false);
      });
      it('含 compressionModel 返回 false', () => {
        expect(isEmptyRoutingConfig({
          fallbackChatModels: [],
          utilityModelRoles: {},
          compressionModel: { providerId: 'a', modelId: 'b' },
        })).toBe(false);
      });
    });

    describe('cloneRoutingConfig', () => {
      it('深拷贝 fallbackChatModels', () => {
        const original: AiHostModelRoutingConfig = {
          fallbackChatModels: [{ providerId: 'a', modelId: 'b' }],
          utilityModelRoles: {},
        };
        const cloned = cloneRoutingConfig(original);
        cloned.fallbackChatModels[0].providerId = 'changed';
        expect(original.fallbackChatModels[0].providerId).toBe('a');
      });

      it('深拷贝 utilityModelRoles', () => {
        const original: AiHostModelRoutingConfig = {
          fallbackChatModels: [],
          utilityModelRoles: { conversationTitle: { providerId: 'a', modelId: 'b' } },
        };
        const cloned = cloneRoutingConfig(original);
        cloned.utilityModelRoles.conversationTitle!.providerId = 'changed';
        expect(original.utilityModelRoles.conversationTitle!.providerId).toBe('a');
      });

      it('保留 chatAutoRetry', () => {
        const original: AiHostModelRoutingConfig = {
          fallbackChatModels: [],
          utilityModelRoles: {},
          chatAutoRetry: { ...DEFAULT_AI_CHAT_AUTO_RETRY_CONFIG, maxRetries: 5 },
        };
        const cloned = cloneRoutingConfig(original);
        expect(cloned.chatAutoRetry?.maxRetries).toBe(5);
      });

      it('保留 compressionModel', () => {
        const original: AiHostModelRoutingConfig = {
          fallbackChatModels: [],
          utilityModelRoles: {},
          compressionModel: { providerId: 'x', modelId: 'y' },
        };
        const cloned = cloneRoutingConfig(original);
        expect(cloned.compressionModel).toEqual({ providerId: 'x', modelId: 'y' });
      });
    });
  });

  // ── 4. 文件系统读写 ──

  describe('4. 文件系统读写', () => {
    const tmpRoot = path.join(os.tmpdir(), `config-ai-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const settingsPath = path.join(tmpRoot);
    const providerDir = path.join(tmpRoot, 'providers');

    afterAll(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('从空目录读取返回默认值', () => {
      fs.mkdirSync(providerDir, { recursive: true });
      const settings = readJsonFile<Record<string, unknown>>(path.join(settingsPath, 'settings.json'), null);
      expect(settings).toBeNull();
    });

    it('写入并读取 settings.json', () => {
      const data = {
        defaultSelection: { providerId: 'openai', modelId: 'gpt-4o' },
        hostModelRouting: {
          fallbackChatModels: [{ providerId: 'anthropic', modelId: 'claude-3' }],
          utilityModelRoles: { conversationTitle: { providerId: 'openai', modelId: 'gpt-4o-mini' } },
        },
        visionFallback: { enabled: true, providerId: 'openai', modelId: 'gpt-4o', prompt: 'describe', maxDescriptionLength: 300 },
      };
      fs.writeFileSync(path.join(settingsPath, 'settings.json'), JSON.stringify(data, null, 2), 'utf-8');

      const parsed = readJsonFile<Record<string, unknown>>(path.join(settingsPath, 'settings.json'), {});
      expect(parsed).not.toBeNull();
      expect((parsed.defaultSelection as Record<string, unknown>).providerId).toBe('openai');
      expect((parsed.visionFallback as Record<string, unknown>).enabled).toBe(true);
    });

    it('写入并读取 provider 文件', () => {
      const provider: Record<string, unknown> = {
        id: 'test-provider',
        name: 'Test Provider',
        driver: 'openai',
        apiKey: 'sk-test-key',
        baseUrl: 'https://test.api.com/v1',
        defaultModel: 'test-model',
        models: ['test-model'],
        persistedModels: [],
      };
      fs.writeFileSync(path.join(providerDir, 'test-provider.json'), JSON.stringify(provider, null, 2), 'utf-8');

      const files = fs.readdirSync(providerDir).filter((f) => f.endsWith('.json'));
      expect(files).toContain('test-provider.json');

      const parsed = readJsonFile<Record<string, unknown>>(path.join(providerDir, 'test-provider.json'), {});
      expect(parsed.driver).toBe('openai');
      expect(parsed.apiKey).toBe('sk-test-key');
      expect(Array.isArray(parsed.models)).toBe(true);
    });

    it('损坏的 JSON 返回 fallback', () => {
      fs.writeFileSync(path.join(settingsPath, 'settings.json'), '{ bad json }', 'utf-8');
      const fallback = { custom: 'value' };
      const parsed = readJsonFile<Record<string, unknown>>(path.join(settingsPath, 'settings.json'), fallback);
      expect(parsed).toEqual(fallback);
    });

    it('缺失文件返回 fallback', () => {
      const nonExistent = path.join(tmpRoot, 'nonexistent.json');
      const parsed = readJsonFile<Record<string, unknown>>(nonExistent, null);
      expect(parsed).toBeNull();
    });

    it('同一 driver 可对应多个自定义 provider', () => {
      const providers = [
        { id: 'my-openai-1', name: 'My OpenAI 1', driver: 'openai', models: ['gpt-4'], persistedModels: [] },
        { id: 'my-openai-2', name: 'My OpenAI 2', driver: 'openai', models: ['gpt-3.5'], persistedModels: [] },
      ];
      for (const p of providers) {
        fs.writeFileSync(path.join(providerDir, `${p.id}.json`), JSON.stringify(p, null, 2), 'utf-8');
      }
      const files = fs.readdirSync(providerDir).filter((f) => f.endsWith('.json'));
      expect(files).toContain('my-openai-1.json');
      expect(files).toContain('my-openai-2.json');
    });

    it('空 provider 目录返回空列表', () => {
      const emptyDir = path.join(tmpRoot, 'empty-providers');
      fs.mkdirSync(emptyDir, { recursive: true });
      const files = fs.readdirSync(emptyDir).filter((f) => f.endsWith('.json'));
      expect(files.length).toBe(0);
    });
  });

  // ── 5. 类型风格一致 ──

  describe('5. 类型风格一致', () => {
    it('AiModelRouteTarget 构造正确', () => {
      const target: AiModelRouteTarget = { providerId: 'openai', modelId: 'gpt-4' };
      expect(target.providerId).toBe('openai');
      expect(target.modelId).toBe('gpt-4');
    });

    it('VisionFallbackConfig 可选字段默认 undefined', () => {
      const minimal: VisionFallbackConfig = { enabled: false };
      expect(minimal.providerId).toBeUndefined();
      expect(minimal.modelId).toBeUndefined();
      expect(minimal.prompt).toBeUndefined();
      expect(minimal.maxDescriptionLength).toBeUndefined();
    });

    it('VisionFallbackConfig 全字段构造', () => {
      const full: VisionFallbackConfig = {
        enabled: true,
        providerId: 'openai',
        modelId: 'gpt-4o',
        prompt: 'describe',
        maxDescriptionLength: 500,
      };
      expect(full.enabled).toBe(true);
      expect(full.maxDescriptionLength).toBe(500);
    });

    it('AiHostModelRoutingConfig 最小构造', () => {
      const config: AiHostModelRoutingConfig = {
        fallbackChatModels: [],
        utilityModelRoles: {},
      };
      expect(config.fallbackChatModels).toEqual([]);
      expect(config.chatAutoRetry).toBeUndefined();
      expect(config.compressionModel).toBeUndefined();
    });

    it('AiHostModelRoutingConfig 全字段构造', () => {
      const config: AiHostModelRoutingConfig = {
        fallbackChatModels: [{ providerId: 'a', modelId: 'b' }],
        chatAutoRetry: DEFAULT_AI_CHAT_AUTO_RETRY_CONFIG,
        compressionModel: { providerId: 'c', modelId: 'd' },
        utilityModelRoles: {
          conversationTitle: { providerId: 'e', modelId: 'f' },
          pluginGenerateText: { providerId: 'g', modelId: 'h' },
        },
      };
      expect(config.fallbackChatModels.length).toBe(1);
      expect(config.chatAutoRetry).toBeDefined();
      expect(config.compressionModel).toBeDefined();
      expect(config.utilityModelRoles.conversationTitle).toBeDefined();
      expect(config.utilityModelRoles.pluginGenerateText).toBeDefined();
    });

    it('Settings JSON 中的字段值类型正确', () => {
      const raw = readJsonFile<Record<string, unknown>>(EXAMPLE_PATH, {});
      expect(typeof (raw.visionFallback as Record<string, unknown>).maxDescriptionLength).toBe('number');
      expect(typeof (raw.defaultSelection as Record<string, unknown>).providerId).toBe('string');
      expect(Array.isArray((raw.hostModelRouting as Record<string, unknown>).fallbackChatModels)).toBe(true);
    });
  });

  // ── 6. 边界条件 ──

  describe('6. 边界条件', () => {
    it('normalizeDefaultSelection 处理空字符串键', () => {
      expect(normalizeDefaultSelection({ providerId: '', modelId: '' })).toBeNull();
      expect(normalizeDefaultSelection({ providerId: 'valid', modelId: '' })).toBeNull();
      expect(normalizeDefaultSelection({ providerId: '', modelId: 'valid' })).toBeNull();
    });

    it('normalizeProtocolDriver 大小写容错为 null', () => {
      expect(normalizeProtocolDriver('OpenAI')).toBeNull();
      expect(normalizeProtocolDriver('ANTHROPIC')).toBeNull();
    });

    it('cloneRoutingConfig 空数组克隆', () => {
      const empty: AiHostModelRoutingConfig = { fallbackChatModels: [], utilityModelRoles: {} };
      const cloned = cloneRoutingConfig(empty);
      expect(cloned.fallbackChatModels).toEqual([]);
      // 修改克隆不应影响源
      cloned.fallbackChatModels.push({ providerId: 'x', modelId: 'y' });
      expect(empty.fallbackChatModels.length).toBe(0);
    });

    it('JSON 中多余的字段不会破坏解析', () => {
      const extra = {
        defaultSelection: { providerId: 'openai', modelId: 'gpt-4' },
        hostModelRouting: { fallbackChatModels: [], utilityModelRoles: {} },
        visionFallback: { enabled: false },
        unknownField: 'should be tolerated',
        extraNested: { a: 1 },
      };
      expect(() => JSON.stringify(extra)).not.toThrow();
      expect(extra.defaultSelection.providerId).toBe('openai');
    });

    it('visionFallback maxDescriptionLength 为 0 表示不限制', () => {
      const vf: VisionFallbackConfig = { enabled: true, maxDescriptionLength: 0 };
      expect(vf.maxDescriptionLength).toBe(0);
      expect(isDefaultVisionFallback(vf)).toBe(false);
    });
  });
});
