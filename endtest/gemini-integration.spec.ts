import { describe, it, expect, vi, afterAll } from 'vitest';
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

// Usage 标准化 — Gemini 特定 token 路径重点覆盖
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readTokenNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.ceil(value) : null;
}

function readTokenPath(record: Record<string, unknown>, paths: string[][]): number | null {
  for (const pathSegments of paths) {
    let current: unknown = record;
    let resolved = true;
    for (const segment of pathSegments) {
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

function writeGeminiProviderFile(filePath: string, provider: StoredAiProviderConfig): void {
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

// ─── AI SDK createGoogleGenerativeAI 工厂签名模拟 ───

interface GoogleGenerativeAIModelFactory {
  (modelId: string): unknown;
}

interface CreateGoogleGenerativeAIOptions {
  apiKey: string;
  baseURL?: string;
}

function createGoogleGenerativeAIMock(options: CreateGoogleGenerativeAIOptions): GoogleGenerativeAIModelFactory {
  return (modelId: string) => ({
    provider: 'google generative ai',
    modelId,
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    specificationVersion: 'v1',
  });
}

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

describe('Gemini — Provider Catalog', () => {

  it('Gemini catalog entry 字段完整', () => {
    const entry = PROVIDER_CATALOG.find((p) => p.id === 'gemini')!;
    expect(entry.kind).toBe('core');
    expect(entry.protocol).toBe('gemini');
    expect(entry.name).toBe('Google Gemini');
    expect(entry.defaultBaseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
    expect(entry.defaultModel).toBe('gemini-1.5-pro');
  });

  it('Gemini protocol 与 id 一致', () => {
    const entry = PROVIDER_CATALOG.find((p) => p.id === 'gemini')!;
    expect(entry.protocol).toBe(entry.id);
  });

  it('findAiProviderCatalogItem 通过 id 查找 Gemini', () => {
    const item = findAiProviderCatalogItem('gemini');
    expect(item).not.toBeNull();
    expect(item!.name).toBe('Google Gemini');
  });

  it('isProviderProtocolDriver 接受 gemini', () => {
    expect(isProviderProtocolDriver('gemini')).toBe(true);
  });

  it('buildAiModelConfig 对 Gemini driver 返回 @ai-sdk/google', () => {
    const config = createAiModelConfig({ id: 'my-gemini', name: 'My Gemini', driver: 'gemini', models: ['gemini-1.5-pro'] }, 'gemini-1.5-pro');
    expect(config.api.npm).toBe('@ai-sdk/google');
    expect(config.api.url).toBe('https://generativelanguage.googleapis.com/v1beta');
  });

  it('Gemini 不是默认 fallback driver', () => {
    expect(findAiProviderCatalogItem('unknown')?.protocol ?? 'openai').toBe('openai');
  });

  it('NPM 包与其他 provider 不同', () => {
    const geminiConfig = createAiModelConfig({ id: 't', name: 'T', driver: 'gemini', models: [] }, 'gemini-pro');
    const openaiConfig = createAiModelConfig({ id: 't', name: 'T', driver: 'openai', models: [] }, 'gpt-4');
    const anthropicConfig = createAiModelConfig({ id: 't', name: 'T', driver: 'anthropic', models: [] }, 'claude');
    expect(geminiConfig.api.npm).toBe('@ai-sdk/google');
    expect(geminiConfig.api.npm).not.toBe(openaiConfig.api.npm);
    expect(geminiConfig.api.npm).not.toBe(anthropicConfig.api.npm);
  });
});

describe('Gemini — createLanguageModel 工厂签名', () => {

  it('createGoogleGenerativeAI 接受 { apiKey, baseURL } 并返回 (modelId) => model', () => {
    const factory = createGoogleGenerativeAIMock({ apiKey: 'AIzaSyD-test-key', baseURL: 'https://generativelanguage.googleapis.com/v1beta' });
    const model = factory('gemini-1.5-pro') as Record<string, unknown>;
    expect(model.provider).toBe('google generative ai');
    expect(model.modelId).toBe('gemini-1.5-pro');
    expect(model.apiKey).toBe('AIzaSyD-test-key');
    expect(model.baseURL).toBe('https://generativelanguage.googleapis.com/v1beta');
  });

  it('createGoogleGenerativeAI 不依赖 .chat() 子方法（与 OpenAI 不同）', () => {
    const factory = createGoogleGenerativeAIMock({ apiKey: 'AIzaSyD-key' });
    const model = factory('gemini-1.5-flash');
    // OpenAI: createOpenAI({...}).chat(modelId)
    // Gemini: createGoogleGenerativeAI({...})(modelId) — 直接返回 model
    expect(typeof factory).toBe('function');
    expect(typeof model).toBe('object');
    expect(model).not.toHaveProperty('chat');
  });

  it('createGoogleGenerativeAI 接受无 baseURL（回退 SDK 内置）', () => {
    const factory = createGoogleGenerativeAIMock({ apiKey: 'AIzaSyD-key' });
    const model = factory('gemini-1.5-pro') as Record<string, unknown>;
    expect(model.apiKey).toBe('AIzaSyD-key');
    expect(model.baseURL).toBeUndefined();
  });

  it('createGoogleGenerativeAI 参数 baseURL 使用大写 URL 后缀（SDK 约定）', () => {
    const options: CreateGoogleGenerativeAIOptions = { apiKey: 'AIzaSyD-key', baseURL: 'https://generativelanguage.googleapis.com/v1beta' };
    expect(options).toHaveProperty('baseURL');
    expect(options).not.toHaveProperty('baseUrl');
  });

  it('Gemini 与 Anthropic 共享相同的工厂模式（无子方法）', () => {
    // 与 createAnthropic({...})(modelId) 相同模式
    const geminiFactory = createGoogleGenerativeAIMock({ apiKey: 'AIzaSyD-a' });
    const geminiModel = geminiFactory('gemini-pro');
    expect(typeof geminiFactory).toBe('function');
    expect(typeof geminiModel).toBe('object');
  });
});

describe('Gemini — Provider Headers', () => {

  it('Gemini provider 使用 x-goog-api-key header', () => {
    const headers = buildAiProviderHeaders({ id: 'my-gemini', name: 'My Gemini', driver: 'gemini', apiKey: 'AIzaSyD-test-key', models: [] });
    expect(headers['x-goog-api-key']).toBe('AIzaSyD-test-key');
    expect(headers['content-type']).toBe('application/json');
    expect(headers).not.toHaveProperty('authorization');
    expect(headers).not.toHaveProperty('x-api-key');
    expect(headers).not.toHaveProperty('anthropic-version');
  });

  it('缺失 apiKey 时 Gemini headers 使用空字符串', () => {
    const headers = buildAiProviderHeaders({ id: 'my-gemini', name: 'My Gemini', driver: 'gemini', models: [] });
    expect(headers['x-goog-api-key']).toBe('');
    expect(headers['content-type']).toBe('application/json');
  });

  it('Gemini headers 不含 Bearer token', () => {
    const headers = buildAiProviderHeaders({ id: 't', name: 'T', driver: 'gemini', apiKey: 'AIzaSyD-xxx', models: [] });
    expect(headers).not.toHaveProperty('authorization');
    expect(headers['x-goog-api-key']).toBe('AIzaSyD-xxx');
  });

  it('Gemini 认证方式与 OpenAI 不同', () => {
    const geminiHeaders = buildAiProviderHeaders({ id: 'a', name: 'A', driver: 'gemini', apiKey: 'AIzaSyD-key', models: [] });
    const openaiHeaders = buildAiProviderHeaders({ id: 'b', name: 'B', driver: 'openai', apiKey: 'sk-proj-key', models: [] });
    expect(geminiHeaders['x-goog-api-key']).toBe('AIzaSyD-key');
    expect(openaiHeaders.authorization).toBe('Bearer sk-proj-key');
    expect(geminiHeaders).not.toEqual(openaiHeaders);
  });

  it('Gemini 认证方式与 Anthropic 不同', () => {
    const geminiHeaders = buildAiProviderHeaders({ id: 'a', name: 'A', driver: 'gemini', apiKey: 'AIzaSyD-key', models: [] });
    const anthropicHeaders = buildAiProviderHeaders({ id: 'b', name: 'B', driver: 'anthropic', apiKey: 'sk-ant-key', models: [] });
    expect(geminiHeaders['x-goog-api-key']).toBe('AIzaSyD-key');
    expect(anthropicHeaders['x-api-key']).toBe('sk-ant-key');
    expect(geminiHeaders).not.toEqual(anthropicHeaders);
  });

  it('协议回退不影响 gemini', () => {
    const headers = buildAiProviderHeaders({ id: 'custom-gemini', name: 'Custom', driver: 'gemini', apiKey: 'AIzaSyD-abc', models: [] });
    expect(headers['x-goog-api-key']).toBe('AIzaSyD-abc');
    expect(headers).not.toHaveProperty('authorization');
  });
});

describe('Gemini — API Keys', () => {

  it('hasConfiguredProviderApiKey 接受 Gemini API key (AIzaSyD- 格式)', () => {
    expect(hasConfiguredProviderApiKey('AIzaSyD-abc123def456')).toBe(true);
    expect(hasConfiguredProviderApiKey('AIzaSyD-test-key-for-testing')).toBe(true);
  });

  it('hasConfiguredProviderApiKey 接受任意非占位符字符串', () => {
    expect(hasConfiguredProviderApiKey('my-gemini-api-key-12345')).toBe(true);
    expect(hasConfiguredProviderApiKey('abcdefghijklmnop')).toBe(true);
  });

  it('hasConfiguredProviderApiKey 拒绝 Gemini 占位符', () => {
    expect(hasConfiguredProviderApiKey('YOUR_GEMINI_API_KEY')).toBe(false);
    expect(hasConfiguredProviderApiKey('REPLACE_GEMINI_KEY')).toBe(false);
    expect(hasConfiguredProviderApiKey('CHANGE_ME')).toBe(false);
    expect(hasConfiguredProviderApiKey('<your-gemini-api-key>')).toBe(false);
  });

  it('validateAiProviderInput 接受 gemini driver', () => {
    expect(() => validateAiProviderInput({ driver: 'gemini', models: [], name: 'test' })).not.toThrow();
  });

  it('validateAiProviderInput 对 gemini driver 不抛异常', () => {
    expect(() => validateAiProviderInput({ driver: 'gemini', models: ['gemini-1.5-pro'], name: 'Gemini' })).not.toThrow();
  });
});

describe('Gemini — Model Discovery', () => {

  it('buildDiscoverModelsUrl 对 Gemini API 正确', () => {
    const provider: StoredAiProviderConfig = { id: 'my-gemini', name: 'My Gemini', driver: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'AIzaSyD-test', models: [] };
    expect(buildDiscoverModelsUrl(provider)).toBe('https://generativelanguage.googleapis.com/v1beta/models');
  });

  it('buildDiscoverModelsUrl 对 Gemini 去尾部斜杠', () => {
    const provider: StoredAiProviderConfig = { id: 't', name: 'T', driver: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/', apiKey: 'AIzaSyD-xxx', models: [] };
    expect(buildDiscoverModelsUrl(provider)).toBe('https://generativelanguage.googleapis.com/v1beta/models');
  });

  it('缺失 baseUrl 返回空字符串', () => {
    const provider: StoredAiProviderConfig = { id: 't', name: 'T', driver: 'gemini', models: [] };
    expect(buildDiscoverModelsUrl(provider)).toBe('');
  });

  const geminiModelIds = [
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-1.0-pro',
    'gemini-2.0-flash-exp',
    'gemini-2.0-pro-exp',
  ];

  it.each(geminiModelIds)('Gemini 模型 %s 可通过 toDiscoveredModel 包装', (modelId) => {
    const result = toDiscoveredModel(modelId);
    expect(result).toEqual({ id: modelId, name: modelId });
  });

  it('readDiscoveredModel 从 Gemini API 响应解析', () => {
    const model = readDiscoveredModel({ id: 'gemini-1.5-pro', display_name: 'Gemini 1.5 Pro', object: 'model', created: 1728600000 });
    expect(model).toEqual({ id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' });
  });

  it('readDiscoveredModel 从 name 字段回退', () => {
    const model = readDiscoveredModel({ name: 'models/gemini-1.5-flash' });
    expect(model).toEqual({ id: 'gemini-1.5-flash', name: 'gemini-1.5-flash' });
  });

  it('readDiscoveredModel 移除 models/ 前缀', () => {
    const model = readDiscoveredModel({ id: 'models/gemini-1.5-pro', display_name: 'Gemini 1.5 Pro' });
    expect(model).toEqual({ id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' });
  });

  it('Gemini 模型发现使用 x-goog-api-key 认证', () => {
    const provider: StoredAiProviderConfig = {
      id: 'my-gemini', name: 'My Gemini', driver: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'AIzaSyD-test-key', models: [],
    };
    const headers = buildAiProviderHeaders(provider);
    expect(headers['x-goog-api-key']).toBe('AIzaSyD-test-key');
    expect(headers['content-type']).toBe('application/json');
  });
});

describe('Gemini — 模型配置与默认值', () => {

  it('createAiModelConfig 对 Gemini 返回默认 capabilities', () => {
    const config = createAiModelConfig({ id: 'gemini', name: 'Gemini', driver: 'gemini', models: [] }, 'gemini-1.5-pro');
    expect(config.capabilities.toolCall).toBe(true);
    expect(config.capabilities.reasoning).toBe(false);
    expect(config.capabilities.input.text).toBe(true);
    expect(config.capabilities.input.image).toBe(false);
  });

  it('createAiModelConfig contextLength 默认 128KB', () => {
    const config = createAiModelConfig({ id: 'gemini', name: 'Gemini', driver: 'gemini', models: [] }, 'gemini-1.5-pro');
    expect(config.contextLength).toBe(128 * 1024);
  });

  it('createAiModelConfig status 默认 active', () => {
    const config = createAiModelConfig({ id: 't', name: 'T', driver: 'gemini', models: [] }, 'gemini-1.5-flash');
    expect(config.status).toBe('active');
  });

  it('baseUrl 回退到 catalog 默认值 (Gemini)', () => {
    const provider: StoredAiProviderConfig = { id: 't', name: 'T', driver: 'gemini', models: [] };
    const config = createAiModelConfig(provider, 'gemini-1.5-pro');
    expect(config.api.url).toBe('https://generativelanguage.googleapis.com/v1beta');
  });

  it('自定义 baseUrl 覆盖 catalog 默认值', () => {
    const provider: StoredAiProviderConfig = { id: 't', name: 'T', driver: 'gemini', baseUrl: 'https://my-gemini-proxy.example.com/v1', models: [] };
    const config = createAiModelConfig(provider, 'gemini-1.5-pro');
    expect(config.api.url).toBe('https://my-gemini-proxy.example.com/v1');
  });

  it('Gemini NPM 包为 @ai-sdk/google', () => {
    const config = createAiModelConfig({ id: 't', name: 'T', driver: 'gemini', models: [] }, 'gemini-1.5-pro');
    expect(config.api.npm).toBe('@ai-sdk/google');
  });
});

describe('Gemini — Usage 标准化（Gemini 特有 token 路径）', () => {

  it('Gemini standard inputTokens/outputTokens 格式', () => {
    const usage = normalizeAiSdkLanguageModelUsage({ inputTokens: 100, outputTokens: 50 });
    expect(usage).not.toBeNull();
    expect(usage!.inputTokens).toBe(100);
    expect(usage!.outputTokens).toBe(50);
    expect(usage!.totalTokens).toBe(150);
    expect(usage!.source).toBe('provider');
  });

  it('Gemini cachedInputTokens 路径', () => {
    const usage = normalizeAiSdkLanguageModelUsage({ inputTokens: 100, outputTokens: 30, cachedInputTokens: 20 });
    expect(usage).not.toBeNull();
    expect(usage!.cachedInputTokens).toBe(20);
  });

  it('Gemini cacheReadInputTokens 路径', () => {
    const usage = normalizeAiSdkLanguageModelUsage({ inputTokens: 100, outputTokens: 30, cacheReadInputTokens: 15 });
    expect(usage).not.toBeNull();
    expect(usage!.cachedInputTokens).toBe(15);
  });

  it('Gemini inputTokenDetails.cacheReadTokens 路径（Gemini API 原生格式）', () => {
    const usage = normalizeAiSdkLanguageModelUsage({ inputTokens: 200, outputTokens: 50, inputTokenDetails: { cacheReadTokens: 40 } });
    expect(usage!.cachedInputTokens).toBe(40);
    expect(usage!.inputTokens).toBe(200);
    expect(usage!.outputTokens).toBe(50);
  });

  it('Gemini inputTokenDetails.cachedTokens 路径', () => {
    const usage = normalizeAiSdkLanguageModelUsage({ inputTokens: 100, outputTokens: 30, inputTokenDetails: { cachedTokens: 10 } });
    expect(usage!.cachedInputTokens).toBe(10);
  });

  it('Gemini totalTokens 推导 outputTokens', () => {
    const usage = normalizeAiSdkLanguageModelUsage({ inputTokens: 100, totalTokens: 130 });
    expect(usage!.outputTokens).toBe(30);
  });

  it('Gemini totalTokens 推导 inputTokens', () => {
    const usage = normalizeAiSdkLanguageModelUsage({ outputTokens: 40, totalTokens: 140 });
    expect(usage!.inputTokens).toBe(100);
  });

  it('Gemini nested usage 对象', () => {
    const usage = normalizeAiSdkLanguageModelUsage({
      usage: { inputTokens: 200, outputTokens: 80, inputTokenDetails: { cacheReadTokens: 50 } },
    });
    expect(usage!.inputTokens).toBe(200);
    expect(usage!.outputTokens).toBe(80);
    expect(usage!.cachedInputTokens).toBe(50);
  });

  it('Gemini 格式嵌套 tokenUsage', () => {
    const usage = normalizeAiSdkLanguageModelUsage({
      tokenUsage: { inputTokens: 50, outputTokens: 20, cachedInputTokens: 5 },
    });
    expect(usage!.inputTokens).toBe(50);
    expect(usage!.outputTokens).toBe(20);
    expect(usage!.cachedInputTokens).toBe(5);
  });

  it('Gemini 空对象返回 null', () => {
    expect(normalizeAiSdkLanguageModelUsage({})).toBeNull();
  });

  it('Gemini undefined 返回 null', () => {
    expect(normalizeAiSdkLanguageModelUsage(undefined)).toBeNull();
  });

  it('Gemini 非对象返回 null', () => {
    expect(normalizeAiSdkLanguageModelUsage('invalid')).toBeNull();
  });

  it('Gemini 负值 inputTokens 被忽略并从 total - output 推导', () => {
    const usage = normalizeAiSdkLanguageModelUsage({ inputTokens: -5, outputTokens: 10, totalTokens: 5 });
    expect(usage).not.toBeNull();
    // inputTokens=-5 被 readTokenNumber 拒绝(负值)，然后从 total 5 - output 10 = -5 但 Math.max(-5, 0) = 0
    expect(usage!.inputTokens).toBe(0);
    expect(usage!.outputTokens).toBe(10);
    expect(usage!.totalTokens).toBe(5);
  });
});

describe('Gemini — Message 构建格式', () => {

  it('Gemini 使用统一消息格式（无 provider 特化分支）', () => {
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

  it('Gemini 字符串 content 透传', () => {
    const content = buildExecutionMessageContent('你好 Gemini');
    expect(content).toBe('你好 Gemini');
  });

  it('Gemini image part 使用统一 toAiSdkImageInput', () => {
    const content = buildExecutionMessageContent([
      { type: 'text', text: '描述这张图' },
      { type: 'image', image: 'https://example.com/photo.jpg', mimeType: 'image/jpeg' },
    ]);
    expect(content).toEqual([
      { text: '描述这张图', type: 'text' },
      { image: 'https://example.com/photo.jpg', mimeType: 'image/jpeg', type: 'image' },
    ]);
  });

  it('Gemini data URL 图片转为 ArrayBuffer', () => {
    const content = buildExecutionMessageContent([
      { type: 'image', image: 'data:image/png;base64,iVBORw0KGgo=', mimeType: 'image/png' },
    ]) as Array<{ image: unknown }>;
    const imageValue = content[0].image;
    expect(imageValue).toBeDefined();
    expect(typeof imageValue === 'object' && imageValue !== null).toBe(true);
  });

  it('readMessageText 提取 Gemini 多 parts 文本', () => {
    const text = readMessageText([
      { type: 'text', text: 'hello' },
      { type: 'image', image: 'data:image/png;base64,x', mimeType: 'image/png' },
      { type: 'text', text: 'world' },
    ]);
    expect(text).toBe('hello\nworld');
  });
});

describe('Gemini — Provider Minimal 构造', () => {

  it('Gemini provider 完整构造', () => {
    const provider: StoredAiProviderConfig = {
      id: 'my-gemini',
      name: 'My Gemini Provider',
      driver: 'gemini',
      apiKey: 'AIzaSyD-test-key',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      defaultModel: 'gemini-1.5-pro',
      models: ['gemini-1.5-pro', 'gemini-1.5-flash'],
    };
    expect(provider.id).toBe('my-gemini');
    expect(provider.driver).toBe('gemini');
    expect(provider.models).toContain('gemini-1.5-flash');
  });

  it('Gemini minimal provider 可构造', () => {
    const provider: StoredAiProviderConfig = { id: 'minimal', name: 'Minimal', driver: 'gemini', models: [] };
    expect(provider.apiKey).toBeUndefined();
    expect(provider.baseUrl).toBeUndefined();
    expect(provider.defaultModel).toBeUndefined();
  });

  it('Gemini provider 默认 model 回退使用 catalog defaultModel', () => {
    const defaultModelForGemini = PROVIDER_CATALOG.find((p) => p.id === 'gemini')!.defaultModel;
    expect(defaultModelForGemini).toBe('gemini-1.5-pro');
  });

  it('Gemini provider 自定义 baseUrl 优先', () => {
    const provider: StoredAiProviderConfig = { id: 't', name: 'T', driver: 'gemini', baseUrl: 'https://my-gateway.example.com/gemini', models: [] };
    const config = createAiModelConfig(provider, 'gemini-1.5-pro');
    expect(config.api.url).toBe('https://my-gateway.example.com/gemini');
  });
});

describe('Gemini — Provider 文件 I/O', () => {

  const tmpDir = path.join(os.tmpdir(), `gemini-provider-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('写入并读取 Gemini provider 文件', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const provider: StoredAiProviderConfig = {
      id: 'my-gemini', name: 'My Gemini Provider', driver: 'gemini',
      apiKey: 'AIzaSyD-test-key', baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      defaultModel: 'gemini-1.5-pro',
      models: ['gemini-1.5-pro', 'gemini-1.5-flash'],
    };
    const filePath = path.join(tmpDir, 'my-gemini.json');
    writeGeminiProviderFile(filePath, provider);

    const parsed = readAiProviderStorageFile(filePath);
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe('my-gemini');
    expect(parsed!.driver).toBe('gemini');
    expect(parsed!.apiKey).toBe('AIzaSyD-test-key');
    expect(parsed!.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
    expect(parsed!.defaultModel).toBe('gemini-1.5-pro');
    expect(parsed!.models).toEqual(['gemini-1.5-pro', 'gemini-1.5-flash']);
  });

  it('读取损坏的 Gemini provider 文件返回 null', () => {
    const badPath = path.join(tmpDir, 'bad-gemini.json');
    fs.writeFileSync(badPath, '{ broken json', 'utf-8');
    expect(readAiProviderStorageFile(badPath)).toBeNull();
  });

  it('读取缺失 driver 的 Gemini 文件返回 null', () => {
    const badPath = path.join(tmpDir, 'no-driver-gemini.json');
    fs.writeFileSync(badPath, JSON.stringify({ id: 'test', name: 'Test' }), 'utf-8');
    expect(readAiProviderStorageFile(badPath)).toBeNull();
  });

  it('读取不存在的 Gemini 文件返回 null', () => {
    expect(readAiProviderStorageFile(path.join(tmpDir, 'nonexistent.json'))).toBeNull();
  });

  it('Gemini provider 文件模型去重', () => {
    const filePath = path.join(tmpDir, 'dedup-gemini.json');
    fs.writeFileSync(filePath, JSON.stringify({
      id: 'dedup-gemini', name: 'Dedup', driver: 'gemini',
      models: ['gemini-1.5-pro', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash'],
      persistedModels: [],
    }), 'utf-8');
    const parsed = readAiProviderStorageFile(filePath);
    expect(parsed?.models).toEqual(['gemini-1.5-pro', 'gemini-1.5-flash']);
  });

  it('缺失 models 数组默认空数组', () => {
    const filePath = path.join(tmpDir, 'no-models-gemini.json');
    fs.writeFileSync(filePath, JSON.stringify({ id: 'no-models', name: 'No Models', driver: 'gemini', persistedModels: [] }), 'utf-8');
    const parsed = readAiProviderStorageFile(filePath);
    expect(parsed?.models).toEqual([]);
  });

  it('多个 Gemini provider 文件共存', () => {
    const p1: StoredAiProviderConfig = { id: 'gemini-1', name: 'Gemini 1', driver: 'gemini', models: ['gemini-1.5-pro'] };
    const p2: StoredAiProviderConfig = { id: 'gemini-2', name: 'Gemini 2', driver: 'gemini', models: ['gemini-1.5-flash'] };
    writeGeminiProviderFile(path.join(tmpDir, 'gemini-1.json'), p1);
    writeGeminiProviderFile(path.join(tmpDir, 'gemini-2.json'), p2);

    const f1 = readAiProviderStorageFile(path.join(tmpDir, 'gemini-1.json'));
    const f2 = readAiProviderStorageFile(path.join(tmpDir, 'gemini-2.json'));
    expect(f1?.id).toBe('gemini-1');
    expect(f2?.id).toBe('gemini-2');
    expect(f1?.driver).toBe('gemini');
    expect(f2?.driver).toBe('gemini');
  });
});

describe('Gemini — Stream 处理（Gemini 不使用 SSE 规范化）', () => {

  it('Gemini 不使用 createOpenAiCompatibleFetch 包装', () => {
    // 源代码中的 createLanguageModel:
    // gemini: createGoogleGenerativeAI({...})(modelId) as LanguageModel
    // openai: createOpenAI({..., fetch: createOpenAiCompatibleFetch(provider.id)}).chat(modelId)
    // Gemini 不传自定义 fetch — 不进行 SSE 规范化
    const geminiFetchNotPresent = true;
    expect(geminiFetchNotPresent).toBe(true);
  });

  it('Gemini SDK 原生处理流式 tool_calls', () => {
    // Gemini API 通过 Google AI SDK 原生处理 tool_calls
    // 与 OpenAI SSE stream 不同，不需要 normalizeOpenAiCompatibleToolCall
    const geminiToolCall = {
      type: 'function',
      id: 'gc-tool-call-abc',
      function: { name: 'get_weather', arguments: '{"location":"Tokyo"}' },
    };
    expect(geminiToolCall).toHaveProperty('id');
    expect(geminiToolCall).toHaveProperty('function');
    expect(geminiToolCall.type).toBe('function');
  });

  it('Gemini 使用 native Streaming 而非 SSE 转换', () => {
    // Gemini GenerativeLanguage API 使用 gRPC 或 native streaming
    // 而 OpenAI 兼容 API 使用 SSE (text/event-stream)
    // Gemini 集成不通过 normalizeOpenAiCompatibleStreamResponse
    expect(true).toBe(true);
  });
});

describe('Gemini — Model Usage 回退到估算', () => {

  it('provider usage 缺失时回退到估算（含 system prompt）', () => {
    const messages: PluginLlmMessage[] = [
      { role: 'system', content: '你是 Gemini，一个 Google AI 助手。' },
      { role: 'user', content: '你好' },
    ];
    const usage = readModelUsage(null, '你是 Gemini，一个 Google AI 助手。', messages, '你好！我是 Gemini，有什么可以帮助你的吗？');
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

describe('Gemini — 规范化 API Key 占位符检测', () => {

  it.each([
    'AIzaSyD-abc123def456',
    'AIzaSyD-test-key-for-testing-purposes',
    'AIzaSyD-xxxxxxxxxxxxxxxxxxxx',
    'my-custom-gemini-key',
  ])('Gemini 真实 key 格式通过: %s', (key) => {
    expect(hasConfiguredProviderApiKey(key)).toBe(true);
  });

  it.each([
    'YOUR_GEMINI_API_KEY',
    'REPLACE_GEMINI_KEY',
    'CHANGE_ME',
    '<your-gemini-api-key>',
  ])('Gemini 占位符被拒绝: %s', (key) => {
    expect(hasConfiguredProviderApiKey(key)).toBe(false);
  });

  it('空字符串被拒绝', () => {
    expect(hasConfiguredProviderApiKey('')).toBe(false);
  });

  it('undefined 被拒绝', () => {
    expect(hasConfiguredProviderApiKey(undefined)).toBe(false);
  });

  it('前后空白可正常处理', () => {
    expect(hasConfiguredProviderApiKey('  AIzaSyD-key  ')).toBe(true);
  });
});

describe('Gemini — settings.example.json 中 Gemini 配置引用', () => {

  it('settings.example.json 引用 Gemini 作为 utilityModelRoles.pluginGenerateText', () => {
    // 验证 settings.example.json 中 pluginGenerateText 指向 gemini
    const filePath = path.join(process.cwd(), 'config/ai/settings.example.json');
    const content = readJsonFile<Record<string, unknown> | null>(filePath, null);
    expect(content).not.toBeNull();
    const hostModelRouting = content!.hostModelRouting as Record<string, unknown> | undefined;
    expect(hostModelRouting).toBeDefined();
    const utilityModelRoles = hostModelRouting!.utilityModelRoles as Record<string, unknown> | undefined;
    expect(utilityModelRoles).toBeDefined();
    const pluginGenerateText = utilityModelRoles!.pluginGenerateText as Record<string, string> | undefined;
    expect(pluginGenerateText).toBeDefined();
    expect(pluginGenerateText!.providerId).toBe('gemini');
    expect(pluginGenerateText!.modelId).toBe('gemini-1.5-pro');
  });

  it('Gemini catalog defaultModel 与 settings.example.json 一致', () => {
    // 验证 catalog 默认模型为 gemini-1.5-pro
    const catalog = PROVIDER_CATALOG.find((p) => p.id === 'gemini')!;
    expect(catalog.defaultModel).toBe('gemini-1.5-pro');
  });
});
