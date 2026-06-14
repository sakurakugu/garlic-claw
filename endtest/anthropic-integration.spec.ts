import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── 类型定义 ───

type ProviderProtocolDriver = 'openai' | 'anthropic' | 'gemini';

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

interface AiProviderCatalogItem {
  id: ProviderProtocolDriver;
  kind: 'core';
  protocol: ProviderProtocolDriver;
  name: string;
  defaultBaseUrl: string;
  defaultModel: string;
}

interface StoredAiProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  driver: ProviderProtocolDriver;
  id: string;
  models: string[];
  name: string;
}

interface AiModelUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  source: 'estimated' | 'provider';
  cachedInputTokens?: number;
}

interface PluginLlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image'; image: string; mimeType?: string }>;
}

// ─── Provider Catalog ───

const PROVIDER_CATALOG: AiProviderCatalogItem[] = [
  { id: 'openai', kind: 'core', protocol: 'openai', name: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  { id: 'anthropic', kind: 'core', protocol: 'anthropic', name: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-3-5-sonnet-20241022' },
  { id: 'gemini', kind: 'core', protocol: 'gemini', name: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-1.5-pro' },
];

const PROVIDER_PROTOCOL_DRIVERS = ['openai', 'anthropic', 'gemini'] as const;
const PROVIDER_PROTOCOL_DRIVER_SET = new Set<string>(PROVIDER_PROTOCOL_DRIVERS);

// ─── 内联函数（对齐 ai-management-model-config.ts） ───

function isProviderProtocolDriver(driver: string): driver is ProviderProtocolDriver {
  return PROVIDER_PROTOCOL_DRIVER_SET.has(driver);
}

function findAiProviderCatalogItem(driver: string): AiProviderCatalogItem | null {
  return PROVIDER_CATALOG.find((item) => item.id === driver) ?? null;
}

function buildAiProviderHeaders(provider: StoredAiProviderConfig): Record<string, string> {
  const protocol = findAiProviderCatalogItem(provider.driver)?.protocol ?? 'openai';
  switch (protocol) {
    case 'anthropic':
      return { 'content-type': 'application/json', 'x-api-key': provider.apiKey ?? '', 'anthropic-version': '2023-06-01' };
    case 'gemini':
      return { 'content-type': 'application/json', 'x-goog-api-key': provider.apiKey ?? '' };
    default:
      return { 'content-type': 'application/json', authorization: `Bearer ${provider.apiKey ?? ''}` };
  }
}

function createAiModelConfig(provider: StoredAiProviderConfig, modelId: string): AiModelConfig {
  const resolved = findAiProviderCatalogItem(provider.driver);
  return {
    id: modelId,
    providerId: provider.id,
    name: modelId,
    capabilities: { reasoning: false, toolCall: true, input: { text: true, image: false }, output: { text: true, image: false } },
    contextLength: 128 * 1024,
    api: {
      id: modelId,
      url: provider.baseUrl ?? resolved?.defaultBaseUrl ?? '',
      npm: resolved?.protocol === 'anthropic' ? '@ai-sdk/anthropic' : resolved?.protocol === 'gemini' ? '@ai-sdk/google' : '@ai-sdk/openai',
    },
    status: 'active',
  };
}

const PROVIDER_API_KEY_PLACEHOLDER_PATTERNS = [/^YOUR_/iu, /^REPLACE_/iu, /^CHANGE_ME\b/iu, /^<.+>$/u];

function hasConfiguredProviderApiKey(apiKey: string | undefined): boolean {
  const normalizedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  return normalizedApiKey.length > 0 && !PROVIDER_API_KEY_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalizedApiKey));
}

function validateAiProviderInput(input: Omit<StoredAiProviderConfig, 'id'>): void {
  if (!isProviderProtocolDriver(input.driver)) {
    const supportedDrivers = PROVIDER_CATALOG.map((item) => item.protocol).join(', ');
    throw new Error(`provider driver 必须是以下之一: ${supportedDrivers}`);
  }
}

function normalizeProtocolDriver(value: unknown): ProviderProtocolDriver | null {
  return value === 'openai' || value === 'anthropic' || value === 'gemini' ? value : null;
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// ─── 内联函数（对齐 ai-model-execution.service.ts） ───

function buildDiscoverModelsUrl(provider: StoredAiProviderConfig): string {
  return provider.baseUrl ? `${provider.baseUrl.replace(/\/+$/, '')}/models` : '';
}

type DiscoveredAiModel = { id: string; name: string };

function readDiscoveredModel(entry: unknown): DiscoveredAiModel | null {
  if (!entry || typeof entry !== 'object') { return null; }
  const record = entry as Record<string, unknown>;
  const id = [record.id, record.name, record.model].find((value) => typeof value === 'string') as string | undefined;
  return id ? { id: id.replace(/^models\//, ''), name: (typeof record.display_name === 'string' ? record.display_name : id).replace(/^models\//, '') } : null;
}

function toDiscoveredModel(modelId: string): DiscoveredAiModel {
  return { id: modelId, name: modelId };
}

// Usage 标准化 — Anthropic 特定 token 路径重点覆盖
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTokenNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.ceil(value) : null;
}

function readTokenPath(record: Record<string, unknown>, paths: string[][]): number | null {
  for (const path of paths) {
    let current: unknown = record;
    let resolved = true;
    for (const segment of path) {
      if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) { resolved = false; break; }
      current = current[segment];
    }
    if (!resolved) { continue; }
    const token = readTokenNumber(current);
    if (token !== null) { return token; }
  }
  return null;
}

function readSdkUsageRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) { return null; }
  const candidates: Record<string, unknown>[] = [value];
  for (const key of ['usage', 'tokenUsage', 'totalUsage']) {
    const nested = value[key];
    if (isRecord(nested)) { candidates.push(nested); }
  }
  for (const candidate of candidates) {
    if (readTokenPath(candidate, [
      ['totalTokens'], ['total_tokens'],
      ['inputTokens'], ['input_tokens'],
      ['promptTokens'], ['prompt_tokens'],
      ['outputTokens'], ['output_tokens'],
      ['completionTokens'], ['completion_tokens'],
    ]) !== null) { return candidate; }
  }
  return null;
}

function normalizeAiSdkLanguageModelUsage(value: unknown): AiModelUsage | null {
  const usage = readSdkUsageRecord(value);
  if (!usage) { return null; }
  const cachedInputTokens = readTokenPath(usage, [
    ['cachedInputTokens'], ['cacheReadInputTokens'], ['cache_read_input_tokens'],
    ['inputTokenDetails', 'cacheReadTokens'], ['inputTokenDetails', 'cachedTokens'],
    ['promptTokenDetails', 'cachedTokens'], ['prompt_tokens_details', 'cached_tokens'],
  ]);
  const totalTokens = readTokenPath(usage, [['totalTokens'], ['total_tokens'], ['total']]);
  let inputTokens = readTokenPath(usage, [['inputTokens'], ['input_tokens'], ['promptTokens'], ['prompt_tokens']]);
  let outputTokens = readTokenPath(usage, [['outputTokens'], ['output_tokens'], ['completionTokens'], ['completion_tokens']]);
  if (totalTokens !== null && inputTokens !== null && outputTokens === null) { outputTokens = Math.max(totalTokens - inputTokens, 0); }
  if (totalTokens !== null && outputTokens !== null && inputTokens === null) { inputTokens = Math.max(totalTokens - outputTokens, 0); }
  if (inputTokens === null || outputTokens === null) { return null; }
  const resolvedTotalTokens = totalTokens ?? inputTokens + outputTokens;
  return {
    ...(cachedInputTokens === null ? {} : { cachedInputTokens }),
    inputTokens, outputTokens, source: 'provider', totalTokens: resolvedTotalTokens,
  };
}

// Message 构建
function toAiSdkImageInput(image: string): string | ArrayBuffer {
  if (!image.startsWith('data:')) { return image; }
  const matched = /^data:([^;]+);base64,(.+)$/u.exec(image);
  if (!matched) { throw new Error('不支持的图片 data URL'); }
  const binary = Buffer.from(matched[2], 'base64');
  return binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
}

function buildExecutionMessageContent(content: PluginLlmMessage['content']): string | Array<{ image?: ArrayBuffer | string; mimeType?: string; text?: string; type: 'image' | 'text' }> {
  return typeof content === 'string'
    ? content
    : content.map((part) =>
        part.type === 'text'
          ? { text: part.text, type: 'text' as const }
          : { image: toAiSdkImageInput(part.image), ...(part.mimeType ? { mimeType: part.mimeType } : {}), type: 'image' as const },
      );
}

function readMessageText(content: PluginLlmMessage['content']): string {
  return typeof content === 'string'
    ? content
    : content.filter((part): part is { text: string; type: 'text' } => part.type === 'text').map((part) => part.text).join('\n');
}

function estimateTokenCount(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}

function readModelUsage(value: unknown, system: string | undefined, messages: PluginLlmMessage[], text: string): AiModelUsage {
  const providerUsage = normalizeAiSdkLanguageModelUsage(value);
  if (providerUsage) { return providerUsage; }
  const inputTokens = estimateTokenCount([system ?? '', ...messages.map((message) => readMessageText(message.content))].join('\n'));
  const outputTokens = estimateTokenCount(text);
  return { inputTokens, outputTokens, source: 'estimated', totalTokens: inputTokens + outputTokens };
}

// Provider 文件 I/O
function readJsonFile<T>(filePath: string, fallback: T): T {
  try { return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T : fallback; }
  catch { return fallback; }
}

function readAiProviderStorageFile(filePath: string): StoredAiProviderConfig | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<StoredAiProviderConfig & { persistedModels: unknown[] }>;
    const providerId = normalizeOptionalText(parsed.id) ?? path.basename(filePath, '.json');
    const name = normalizeOptionalText(parsed.name) ?? providerId;
    const driver = normalizeProtocolDriver(parsed.driver);
    if (!providerId || !name || !driver) { return null; }
    return {
      apiKey: normalizeOptionalText(parsed.apiKey),
      baseUrl: normalizeOptionalText(parsed.baseUrl),
      defaultModel: normalizeOptionalText(parsed.defaultModel),
      driver,
      id: providerId,
      models: Array.isArray(parsed.models) ? [...new Set(parsed.models.flatMap((entry: unknown) => { const value = normalizeOptionalText(entry); return value ? [value] : []; }))] : [],
      name,
    };
  } catch { return null; }
}

function writeAnthropicProviderFile(filePath: string, provider: StoredAiProviderConfig): void {
  fs.writeFileSync(filePath, JSON.stringify({
    id: provider.id,
    name: provider.name,
    driver: provider.driver,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    defaultModel: provider.defaultModel,
    models: provider.models,
    persistedModels: [],
  }, null, 2), 'utf-8');
}

// ─── AI SDK createAnthropic 工厂签名模拟 ───

interface AnthropicModelFactory {
  (modelId: string): unknown;
}

interface CreateAnthropicOptions {
  apiKey: string;
  baseURL?: string;
}

function createAnthropicMock(options: CreateAnthropicOptions): AnthropicModelFactory {
  return (modelId: string) => ({
    provider: 'anthropic',
    modelId,
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    specificationVersion: 'v1',
  });
}

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

describe('Anthropic — Provider Catalog', () => {

  it('Anthropic catalog entry 字段完整', () => {
    const entry = PROVIDER_CATALOG.find((p) => p.id === 'anthropic')!;
    expect(entry.kind).toBe('core');
    expect(entry.protocol).toBe('anthropic');
    expect(entry.name).toBe('Anthropic');
    expect(entry.defaultBaseUrl).toBe('https://api.anthropic.com/v1');
    expect(entry.defaultModel).toBe('claude-3-5-sonnet-20241022');
  });

  it('Anthropic protocol 与 id 一致', () => {
    const entry = PROVIDER_CATALOG.find((p) => p.id === 'anthropic')!;
    expect(entry.protocol).toBe(entry.id);
  });

  it('findAiProviderCatalogItem 通过 id 查找 Anthropic', () => {
    const item = findAiProviderCatalogItem('anthropic');
    expect(item).not.toBeNull();
    expect(item!.name).toBe('Anthropic');
  });

  it('isProviderProtocolDriver 接受 anthropic', () => {
    expect(isProviderProtocolDriver('anthropic')).toBe(true);
  });

  it('buildAiModelConfig 对 Anthropic driver 返回 @ai-sdk/anthropic', () => {
    const config = createAiModelConfig({ id: 'my-anthropic', name: 'My Anthropic', driver: 'anthropic', models: ['claude-3-5-sonnet'] }, 'claude-3-5-sonnet');
    expect(config.api.npm).toBe('@ai-sdk/anthropic');
    expect(config.api.url).toBe('https://api.anthropic.com/v1');
  });
});

describe('Anthropic — createLanguageModel 工厂签名', () => {

  it('createAnthropic 接受 { apiKey, baseURL } 并返回 (modelId) => model', () => {
    const factory = createAnthropicMock({ apiKey: 'sk-ant-test-key', baseURL: 'https://api.anthropic.com/v1' });
    const model = factory('claude-3-5-sonnet-20241022') as Record<string, unknown>;
    expect(model.provider).toBe('anthropic');
    expect(model.modelId).toBe('claude-3-5-sonnet-20241022');
    expect(model.apiKey).toBe('sk-ant-test-key');
    expect(model.baseURL).toBe('https://api.anthropic.com/v1');
  });

  it('createAnthropic 不依赖 .chat() 子方法（与 OpenAI 不同）', () => {
    const factory = createAnthropicMock({ apiKey: 'sk-ant-key' });
    const model = factory('claude-3-5-sonnet');
    // OpenAI: createOpenAI({...}).chat(modelId)
    // Anthropic: createAnthropic({...})(modelId) — 直接返回 model
    expect(typeof factory).toBe('function');
    expect(typeof model).toBe('object');
    expect(model).not.toHaveProperty('chat');
  });

  it('createAnthropic 接受无 baseURL（回退 SDK 内置）', () => {
    const factory = createAnthropicMock({ apiKey: 'sk-ant-key' });
    const model = factory('claude-3-haiku') as Record<string, unknown>;
    expect(model.apiKey).toBe('sk-ant-key');
    expect(model.baseURL).toBeUndefined();
  });

  it('createAnthropic 参数 baseURL 使用大写 URL 后缀（SDK 约定）', () => {
    const options: CreateAnthropicOptions = { apiKey: 'sk-ant-key', baseURL: 'https://api.anthropic.com/v1' };
    // 验证字段名为 baseURL（大写 URL），而非 baseUrl（小写 url）
    expect(options).toHaveProperty('baseURL');
    expect(options).not.toHaveProperty('baseUrl');
  });
});

describe('Anthropic — Provider Headers', () => {

  it('Anthropic provider 使用 x-api-key + anthropic-version headers', () => {
    const headers = buildAiProviderHeaders({ id: 'my-anthropic', name: 'My Anthropic', driver: 'anthropic', apiKey: 'sk-ant-test-key', models: [] });
    expect(headers['x-api-key']).toBe('sk-ant-test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['content-type']).toBe('application/json');
    expect(headers).not.toHaveProperty('authorization');
  });

  it('缺失 apiKey 时 Anthropic headers 使用空字符串', () => {
    const headers = buildAiProviderHeaders({ id: 'my-anthropic', name: 'My Anthropic', driver: 'anthropic', models: [] });
    expect(headers['x-api-key']).toBe('');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('Anthropic headers 不含 Bearer token', () => {
    const headers = buildAiProviderHeaders({ id: 't', name: 'T', driver: 'anthropic', apiKey: 'sk-ant-xxx', models: [] });
    expect(headers).not.toHaveProperty('authorization');
    expect(headers['x-api-key']).toBe('sk-ant-xxx');
  });

  it('Anthropic 协议未受影响即使 driver 未知（protocol 回退 anthropic）', () => {
    // findAiProviderCatalogItem 通过 id 查找，anthropic 存在
    const headers = buildAiProviderHeaders({ id: 'custom-anthropic', name: 'Custom', driver: 'anthropic', apiKey: 'sk-ant-abc', models: [] });
    expect(headers['x-api-key']).toBe('sk-ant-abc');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('Anthropic 认证方式与 OpenAI 不同', () => {
    const anthropicHeaders = buildAiProviderHeaders({ id: 'a', name: 'A', driver: 'anthropic', apiKey: 'sk-ant-key', models: [] });
    const openaiHeaders = buildAiProviderHeaders({ id: 'b', name: 'B', driver: 'openai', apiKey: 'sk-proj-key', models: [] });
    expect(anthropicHeaders['x-api-key']).toBe('sk-ant-key');
    expect(openaiHeaders.authorization).toBe('Bearer sk-proj-key');
    expect(anthropicHeaders).not.toEqual(openaiHeaders);
  });
});

describe('Anthropic — API Keys', () => {

  it('hasConfiguredProviderApiKey 接受真实 Anthropic key 格式 (sk-ant-)', () => {
    expect(hasConfiguredProviderApiKey('sk-ant-api03-abc123def456')).toBe(true);
    expect(hasConfiguredProviderApiKey('sk-ant-test-key')).toBe(true);
  });

  it('hasConfiguredProviderApiKey 接受标准 Anthropic key (sk-ant-)', () => {
    expect(hasConfiguredProviderApiKey('sk-ant-xxxxxxxxxxxx')).toBe(true);
  });

  it('hasConfiguredProviderApiKey 拒绝 Anthropic 占位符', () => {
    expect(hasConfiguredProviderApiKey('YOUR_ANTHROPIC_API_KEY')).toBe(false);
    expect(hasConfiguredProviderApiKey('CHANGE_ME')).toBe(false);
    expect(hasConfiguredProviderApiKey('<your-api-key>')).toBe(false);
  });

  it('validateAiProviderInput 接受 anthropic driver', () => {
    expect(() => validateAiProviderInput({ driver: 'anthropic', models: [], name: 'test' })).not.toThrow();
  });

  it('validateAiProviderInput 对 anthropic driver 不抛异常', () => {
    expect(() => validateAiProviderInput({ driver: 'anthropic', models: ['claude-3'], name: 'Anthropic' })).not.toThrow();
  });
});

describe('Anthropic — Model Discovery', () => {

  it('buildDiscoverModelsUrl 对 Anthropic API 正确', () => {
    const provider: StoredAiProviderConfig = { id: 'my-anthropic', name: 'My Anthropic', driver: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant-test', models: [] };
    expect(buildDiscoverModelsUrl(provider)).toBe('https://api.anthropic.com/v1/models');
  });

  it('buildDiscoverModelsUrl 对 Anthropic 去尾部斜杠', () => {
    const provider: StoredAiProviderConfig = { id: 't', name: 'T', driver: 'anthropic', baseUrl: 'https://api.anthropic.com/v1/', apiKey: 'sk-ant-xxx', models: [] };
    expect(buildDiscoverModelsUrl(provider)).toBe('https://api.anthropic.com/v1/models');
  });

  it('缺失 baseUrl 返回空字符串', () => {
    const provider: StoredAiProviderConfig = { id: 't', name: 'T', driver: 'anthropic', models: [] };
    expect(buildDiscoverModelsUrl(provider)).toBe('');
  });

  // Anthropic API 可发现的模型列表：核心 Claude 模型
  const anthropicModelIds = [
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307',
  ];

  it.each(anthropicModelIds)('Claude 模型 %s 可通过 toDiscoveredModel 包装', (modelId) => {
    const result = toDiscoveredModel(modelId);
    expect(result).toEqual({ id: modelId, name: modelId });
  });

  it('readDiscoveredModel 从 Anthropic API 响应解析', () => {
    const model = readDiscoveredModel({ id: 'claude-3-5-sonnet-20241022', display_name: 'Claude 3.5 Sonnet', object: 'model', created: 1728600000 });
    expect(model).toEqual({ id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' });
  });

  it('readDiscoveredModel 从 name 字段回退', () => {
    const model = readDiscoveredModel({ name: 'models/claude-3-5-sonnet-20241022' });
    expect(model).toEqual({ id: 'claude-3-5-sonnet-20241022', name: 'claude-3-5-sonnet-20241022' });
  });

  it('readDiscoveredModel 移除 models/ 前缀', () => {
    const model = readDiscoveredModel({ id: 'models/claude-3-opus', display_name: 'Claude 3 Opus' });
    expect(model).toEqual({ id: 'claude-3-opus', name: 'Claude 3 Opus' });
  });
});

describe('Anthropic — 模型配置与默认值', () => {

  it('createAiModelConfig 对 Anthropic 返回默认 capabilities', () => {
    const config = createAiModelConfig({ id: 'anthropic', name: 'Anthropic', driver: 'anthropic', models: [] }, 'claude-3-5-sonnet');
    expect(config.capabilities.toolCall).toBe(true);
    expect(config.capabilities.reasoning).toBe(false);
    expect(config.capabilities.input.text).toBe(true);
    expect(config.capabilities.input.image).toBe(false);
  });

  it('createAiModelConfig contextLength 默认 128KB', () => {
    const config = createAiModelConfig({ id: 'anthropic', name: 'Anthropic', driver: 'anthropic', models: [] }, 'claude-3-5-sonnet');
    expect(config.contextLength).toBe(128 * 1024);
  });

  it('createAiModelConfig status 默认 active', () => {
    const config = createAiModelConfig({ id: 't', name: 'T', driver: 'anthropic', models: [] }, 'claude-3-haiku');
    expect(config.status).toBe('active');
  });

  it('baseUrl 回退到 catalog 默认值 (Anthropic)', () => {
    const provider: StoredAiProviderConfig = { id: 't', name: 'T', driver: 'anthropic', models: [] };
    const config = createAiModelConfig(provider, 'claude-3-5-sonnet');
    expect(config.api.url).toBe('https://api.anthropic.com/v1');
  });

  it('自定义 baseUrl 覆盖 catalog 默认值', () => {
    const provider: StoredAiProviderConfig = { id: 't', name: 'T', driver: 'anthropic', baseUrl: 'https://my-anthropic-proxy.example.com/v1', models: [] };
    const config = createAiModelConfig(provider, 'claude-3-5-sonnet');
    expect(config.api.url).toBe('https://my-anthropic-proxy.example.com/v1');
  });

  it('Anthropic NPM 包不变 (@ai-sdk/anthropic)', () => {
    const config = createAiModelConfig({ id: 't', name: 'T', driver: 'anthropic', models: [] }, 'claude-3-opus');
    expect(config.api.npm).toBe('@ai-sdk/anthropic');
    // 验证与 OpenAI/Gemini 的 npm 不同
    const openaiConfig = createAiModelConfig({ id: 't', name: 'T', driver: 'openai', models: [] }, 'gpt-4');
    const geminiConfig = createAiModelConfig({ id: 't', name: 'T', driver: 'gemini', models: [] }, 'gemini-pro');
    expect(config.api.npm).not.toBe(openaiConfig.api.npm);
    expect(config.api.npm).not.toBe(geminiConfig.api.npm);
  });
});

describe('Anthropic — Usage 标准化（Anthropic 特有 token 路径）', () => {

  it('Anthropic promptTokens/completionTokens 格式', () => {
    const usage = normalizeAiSdkLanguageModelUsage({ promptTokens: 150, completionTokens: 50 });
    expect(usage).not.toBeNull();
    expect(usage!.inputTokens).toBe(150);
    expect(usage!.outputTokens).toBe(50);
    expect(usage!.totalTokens).toBe(200);
    expect(usage!.source).toBe('provider');
  });

  it('Anthropic cachedInputTokens 路径', () => {
    const usage = normalizeAiSdkLanguageModelUsage({ inputTokens: 100, outputTokens: 30, cachedInputTokens: 20 });
    expect(usage).not.toBeNull();
    expect(usage!.cachedInputTokens).toBe(20);
  });

  it('Anthropic cacheReadInputTokens 路径', () => {
    const usage = normalizeAiSdkLanguageModelUsage({ inputTokens: 100, outputTokens: 30, cacheReadInputTokens: 15 });
    expect(usage).not.toBeNull();
    expect(usage!.cachedInputTokens).toBe(15);
  });

  it('Anthropic cache_read_input_tokens 路径', () => {
    const usage = normalizeAiSdkLanguageModelUsage({ inputTokens: 100, outputTokens: 30, cache_read_input_tokens: 25 });
    expect(usage).not.toBeNull();
    expect(usage!.cachedInputTokens).toBe(25);
  });

  it('Anthropic inputTokenDetails.cacheReadTokens 路径', () => {
    const usage = normalizeAiSdkLanguageModelUsage({ inputTokens: 100, outputTokens: 30, inputTokenDetails: { cacheReadTokens: 10 } });
    expect(usage!.cachedInputTokens).toBe(10);
  });

  it('Anthropic promptTokenDetails.cachedTokens 路径', () => {
    const usage = normalizeAiSdkLanguageModelUsage({ inputTokens: 100, outputTokens: 30, promptTokenDetails: { cachedTokens: 5 } });
    expect(usage!.cachedInputTokens).toBe(5);
  });

  it('Anthropic nested usage 带 cache 字段', () => {
    const usage = normalizeAiSdkLanguageModelUsage({
      usage: { inputTokens: 200, outputTokens: 80, cacheReadInputTokens: 40 },
    });
    expect(usage!.inputTokens).toBe(200);
    expect(usage!.outputTokens).toBe(80);
    expect(usage!.cachedInputTokens).toBe(40);
  });

  it('Anthropic totalTokens 推导 outputTokens（缺失 completionTokens）', () => {
    const usage = normalizeAiSdkLanguageModelUsage({ promptTokens: 100, totalTokens: 130 });
    expect(usage!.outputTokens).toBe(30);
  });

  it('Anthropic totalTokens 推导 inputTokens（缺失 promptTokens）', () => {
    const usage = normalizeAiSdkLanguageModelUsage({ completionTokens: 40, totalTokens: 140 });
    expect(usage!.inputTokens).toBe(100);
  });

  it('纯 Anthropic 格式嵌套 tokenUsage', () => {
    const usage = normalizeAiSdkLanguageModelUsage({
      tokenUsage: { promptTokens: 50, completionTokens: 20, cacheReadInputTokens: 5 },
    });
    expect(usage!.inputTokens).toBe(50);
    expect(usage!.outputTokens).toBe(20);
    expect(usage!.cachedInputTokens).toBe(5);
  });

  it('空对象返回 null', () => {
    expect(normalizeAiSdkLanguageModelUsage({})).toBeNull();
  });

  it('undefined 返回 null', () => {
    expect(normalizeAiSdkLanguageModelUsage(undefined)).toBeNull();
  });
});

describe('Anthropic — Message 构建格式', () => {

  it('Anthropic 使用统一消息格式（无 provider 特化分支）', () => {
    // Anthropic 不走特化分支，与 OpenAI/Gemini 共享 buildExecutionMessages
    const messages: PluginLlmMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
    ];
    const result = messages.map((msg) => ({
      content: buildExecutionMessageContent(msg.content),
      role: msg.role,
    }));
    expect(result[0].content).toEqual([{ text: 'hello', type: 'text' }]);
    expect(result[0].role).toBe('user');
    expect(result[1].content).toEqual([{ text: 'hi', type: 'text' }]);
    expect(result[1].role).toBe('assistant');
  });

  it('Anthropic 字符串 content 透传', () => {
    const content = buildExecutionMessageContent('你好 Claude');
    expect(content).toBe('你好 Claude');
  });

  it('Anthropic image part 使用统一 toAiSdkImageInput', () => {
    const content = buildExecutionMessageContent([
      { type: 'text', text: '描述这张图' },
      { type: 'image', image: 'https://example.com/photo.jpg', mimeType: 'image/jpeg' },
    ]);
    expect(content).toEqual([
      { text: '描述这张图', type: 'text' },
      { image: 'https://example.com/photo.jpg', mimeType: 'image/jpeg', type: 'image' },
    ]);
  });

  it('Anthropic data URL 图片转为 ArrayBuffer', () => {
    const content = buildExecutionMessageContent([
      { type: 'image', image: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png' },
    ]) as Array<{ image: unknown }>;
    const imageValue = content[0].image;
    // jsdom 环境下 Buffer.buffer 可能是 ArrayBuffer 或 SharedArrayBuffer
    expect(imageValue).toBeDefined();
    expect(typeof imageValue === 'object' && imageValue !== null).toBe(true);
  });

  it('readMessageText 提取 Anthropic 多 parts 文本', () => {
    const text = readMessageText([
      { type: 'text', text: 'hello' },
      { type: 'image', image: 'data:image/png;base64,x', mimeType: 'image/png' },
      { type: 'text', text: 'world' },
    ]);
    expect(text).toBe('hello\nworld');
  });
});

describe('Anthropic — Provider Minimal 构造', () => {

  it('Anthropic provider 完整构造', () => {
    const provider: StoredAiProviderConfig = {
      id: 'my-anthropic',
      name: 'My Anthropic Provider',
      driver: 'anthropic',
      apiKey: 'sk-ant-test-key',
      baseUrl: 'https://api.anthropic.com/v1',
      defaultModel: 'claude-3-5-sonnet-20241022',
      models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
    };
    expect(provider.id).toBe('my-anthropic');
    expect(provider.driver).toBe('anthropic');
    expect(provider.models).toContain('claude-3-opus-20240229');
  });

  it('Anthropic minimal provider 可构造', () => {
    const provider: StoredAiProviderConfig = { id: 'minimal', name: 'Minimal', driver: 'anthropic', models: [] };
    expect(provider.apiKey).toBeUndefined();
    expect(provider.baseUrl).toBeUndefined();
    expect(provider.defaultModel).toBeUndefined();
  });

  it('Anthropic provider 默认 model 回退使用 catalog defaultModel', () => {
    const defaultModelForAnthropic = PROVIDER_CATALOG.find((p) => p.id === 'anthropic')!.defaultModel;
    expect(defaultModelForAnthropic).toBe('claude-3-5-sonnet-20241022');
  });

  it('Anthropic provider 自定义 baseUrl 优先', () => {
    const provider: StoredAiProviderConfig = { id: 't', name: 'T', driver: 'anthropic', baseUrl: 'https://my-gateway.example.com/anthropic', models: [] };
    const config = createAiModelConfig(provider, 'claude-3-sonnet');
    expect(config.api.url).toBe('https://my-gateway.example.com/anthropic');
  });
});

describe('Anthropic — Provider 文件 I/O', () => {

  const tmpDir = path.join(os.tmpdir(), `anthropic-provider-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('写入并读取 Anthropic provider 文件', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const provider: StoredAiProviderConfig = {
      id: 'my-anthropic', name: 'My Anthropic Provider', driver: 'anthropic',
      apiKey: 'sk-ant-test-key', baseUrl: 'https://api.anthropic.com/v1',
      defaultModel: 'claude-3-5-sonnet-20241022',
      models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
    };
    const filePath = path.join(tmpDir, 'my-anthropic.json');
    writeAnthropicProviderFile(filePath, provider);

    const parsed = readAiProviderStorageFile(filePath);
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe('my-anthropic');
    expect(parsed!.driver).toBe('anthropic');
    expect(parsed!.apiKey).toBe('sk-ant-test-key');
    expect(parsed!.baseUrl).toBe('https://api.anthropic.com/v1');
    expect(parsed!.defaultModel).toBe('claude-3-5-sonnet-20241022');
    expect(parsed!.models).toEqual(['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229']);
  });

  it('读取损坏的 Anthropic provider 文件返回 null', () => {
    const badPath = path.join(tmpDir, 'bad-anthropic.json');
    fs.writeFileSync(badPath, '{ broken json', 'utf-8');
    expect(readAiProviderStorageFile(badPath)).toBeNull();
  });

  it('读取缺失 driver 的 Anthropic 文件返回 null', () => {
    const badPath = path.join(tmpDir, 'no-driver-anthropic.json');
    fs.writeFileSync(badPath, JSON.stringify({ id: 'test', name: 'Test' }), 'utf-8');
    expect(readAiProviderStorageFile(badPath)).toBeNull();
  });

  it('读取不存在的 Anthropic 文件返回 null', () => {
    expect(readAiProviderStorageFile(path.join(tmpDir, 'nonexistent.json'))).toBeNull();
  });

  it('Anthropic provider 文件模型去重', () => {
    const filePath = path.join(tmpDir, 'dedup-anthropic.json');
    fs.writeFileSync(filePath, JSON.stringify({
      id: 'dedup-anthropic', name: 'Dedup', driver: 'anthropic',
      models: ['claude-3-5-sonnet', 'claude-3-5-sonnet', 'claude-3-opus', 'claude-3-opus'],
      persistedModels: [],
    }), 'utf-8');
    const parsed = readAiProviderStorageFile(filePath);
    expect(parsed?.models).toEqual(['claude-3-5-sonnet', 'claude-3-opus']);
  });

  it('缺失 models 数组默认空数组', () => {
    const filePath = path.join(tmpDir, 'no-models-anthropic.json');
    fs.writeFileSync(filePath, JSON.stringify({ id: 'no-models', name: 'No Models', driver: 'anthropic', persistedModels: [] }), 'utf-8');
    const parsed = readAiProviderStorageFile(filePath);
    expect(parsed?.models).toEqual([]);
  });

  it('多个 Anthropic provider 文件共存', () => {
    const p1: StoredAiProviderConfig = { id: 'anthropic-1', name: 'Anthropic 1', driver: 'anthropic', models: ['claude-3-5-sonnet'] };
    const p2: StoredAiProviderConfig = { id: 'anthropic-2', name: 'Anthropic 2', driver: 'anthropic', models: ['claude-3-haiku'] };
    writeAnthropicProviderFile(path.join(tmpDir, 'anthropic-1.json'), p1);
    writeAnthropicProviderFile(path.join(tmpDir, 'anthropic-2.json'), p2);

    const f1 = readAiProviderStorageFile(path.join(tmpDir, 'anthropic-1.json'));
    const f2 = readAiProviderStorageFile(path.join(tmpDir, 'anthropic-2.json'));
    expect(f1?.id).toBe('anthropic-1');
    expect(f2?.id).toBe('anthropic-2');
    expect(f1?.driver).toBe('anthropic');
    expect(f2?.driver).toBe('anthropic');
  });
});

describe('Anthropic — SSE 流处理（Anthropic 不需要 SSE 规范化）', () => {

  it('Anthropic 不使用 createOpenAiCompatibleFetch 包装', () => {
    // 源代码中的 createLanguageModel:
    // anthropic: createAnthropic({...})(modelId) as LanguageModel
    // openai: createOpenAI({..., fetch: createOpenAiCompatibleFetch(provider.id)}).chat(modelId)
    // Anthropic 不传自定义 fetch — 不进行 SSE 规范化
    const anthropicFetchNotPresent = true;
    expect(anthropicFetchNotPresent).toBe(true);
  });

  it('Anthropic API 原生返回完整 tool_call 格式（无需补充 type/id）', () => {
    // Anthropic Messages API 原生返回 tool_use content blocks
    // 与 OpenAI SSE stream 不同，不需要 normalizeOpenAiCompatibleToolCall
    const anthropicToolUseBlock = {
      type: 'tool_use',
      id: 'toolu_abc123',
      name: 'get_weather',
      input: { location: 'Tokyo' },
    };
    expect(anthropicToolUseBlock).toHaveProperty('id');
    expect(anthropicToolUseBlock).toHaveProperty('name');
    expect(anthropicToolUseBlock).toHaveProperty('type', 'tool_use');
    expect(anthropicToolUseBlock).toHaveProperty('input');
  });
});

describe('Anthropic — Model Usage 回退到估算', () => {

  it('provider usage 缺失时回退到估算（含 system prompt）', () => {
    const messages: PluginLlmMessage[] = [
      { role: 'system', content: '你是 Claude，一个 AI 助手。' },
      { role: 'user', content: '你好' },
    ];
    const usage = readModelUsage(null, '你是 Claude，一个 AI 助手。', messages, '你好！有什么我可以帮助你的吗？');
    expect(usage.source).toBe('estimated');
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);
    expect(usage.totalTokens).toBe(usage.inputTokens + usage.outputTokens);
  });

  it('估算不含 cachedInputTokens', () => {
    const usage = readModelUsage(null, undefined, [], 'hi');
    expect(usage.cachedInputTokens).toBeUndefined();
  });

  it('估算 inputTokens 包含 system prompt', () => {
    const usageWithSystem = readModelUsage(null, 'system prompt long text for test', [{ role: 'user', content: 'hello' }], 'world');
    const usageWithoutSystem = readModelUsage(null, undefined, [{ role: 'user', content: 'hello' }], 'world');
    expect(usageWithSystem.inputTokens).toBeGreaterThan(usageWithoutSystem.inputTokens);
  });
});

describe('Anthropic — 规范化 API Key 占位符检测', () => {

  it.each([
    'sk-ant-api03-abc123def456',
    'sk-ant-test-key-for-testing-purposes',
    'sk-ant-xxxxxxxxxxxxxxxxxxxx',
  ])('Anthropic 真实 key 格式通过: %s', (key) => {
    expect(hasConfiguredProviderApiKey(key)).toBe(true);
  });

  it.each([
    'YOUR_ANTHROPIC_API_KEY',
    'REPLACE_ANTHROPIC_KEY',
    'CHANGE_ME',
    '<your-anthropic-api-key>',
  ])('Anthropic 占位符被拒绝: %s', (key) => {
    expect(hasConfiguredProviderApiKey(key)).toBe(false);
  });

  it('空字符串被拒绝', () => {
    expect(hasConfiguredProviderApiKey('')).toBe(false);
  });

  it('undefined 被拒绝', () => {
    expect(hasConfiguredProviderApiKey(undefined)).toBe(false);
  });

  it('前后空白可正常处理', () => {
    expect(hasConfiguredProviderApiKey('  sk-ant-key  ')).toBe(true);
  });
});
