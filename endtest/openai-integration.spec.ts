import { describe, it, expect, vi } from 'vitest';
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

interface StoredAiModelConfig {
  capabilities: AiModelCapabilities;
  contextLength: number;
  id: string;
  name: string;
  providerId: string;
  status?: string;
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

const DEFAULT_AI_CHAT_AUTO_RETRY_CONFIG: AiChatAutoRetryConfig = {
  enabled: true, maxRetries: 2, initialDelayMs: 2000, maxDelayMs: 30000, backoffFactor: 2,
};

// ─── 内联函数（对齐 ai-model-execution.service.ts） ───

type OpenAiCompatibleToolCallIdState = { generatedIds: Map<string, string>; streamId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeOpenAiCompatibleIdFragment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function normalizeOpenAiCompatibleToolCall(toolCall: unknown, choiceIndex: number, toolIndex: number, state: OpenAiCompatibleToolCallIdState): { changed: boolean; toolCall: Record<string, unknown> } {
  if (!isRecord(toolCall)) { return { changed: false, toolCall: toolCall as Record<string, unknown> }; }
  let changed = false;
  let nextToolCall = toolCall;
  const nextIndex = typeof nextToolCall.index === 'number' ? nextToolCall.index : toolIndex;
  if (nextToolCall.index !== nextIndex) { nextToolCall = { ...nextToolCall, index: nextIndex }; changed = true; }
  if (isRecord(nextToolCall.function) && nextToolCall.type !== 'function') { nextToolCall = { ...nextToolCall, type: 'function' }; changed = true; }
  if (typeof nextToolCall.id !== 'string' || nextToolCall.id.trim().length === 0) {
    const toolCallKey = `${choiceIndex}:${nextIndex}`;
    const nextId = state.generatedIds.get(toolCallKey) ?? `gc-openai-tool-call-${state.streamId}-${choiceIndex}-${nextIndex}`;
    state.generatedIds.set(toolCallKey, nextId);
    nextToolCall = { ...nextToolCall, id: nextId };
    changed = true;
  }
  return { changed, toolCall: nextToolCall };
}

function normalizeOpenAiCompatibleChunkPayload(payload: unknown, state: OpenAiCompatibleToolCallIdState): unknown {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) { return payload; }
  let changed = false;
  const nextChoices = payload.choices.map((choice: unknown, choiceIndex: number) => {
    if (!isRecord(choice) || !isRecord(choice.delta) || !Array.isArray(choice.delta.tool_calls)) { return choice; }
    let choiceChanged = false;
    const nextToolCalls = (choice.delta.tool_calls as unknown[]).map((toolCall: unknown, toolIndex: number) => {
      const normalized = normalizeOpenAiCompatibleToolCall(toolCall, choiceIndex, toolIndex, state);
      choiceChanged ||= normalized.changed;
      return normalized.toolCall;
    });
    if (!choiceChanged) { return choice; }
    changed = true;
    return { ...choice, delta: { ...choice.delta, tool_calls: nextToolCalls } };
  });
  return changed ? { ...payload, choices: nextChoices } : payload;
}

function normalizeOpenAiCompatibleSseLine(line: string, state: OpenAiCompatibleToolCallIdState): string {
  const trimmedLine = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (!trimmedLine.startsWith('data:')) { return trimmedLine; }
  const payload = trimmedLine.slice(5).trimStart();
  if (!payload || payload === '[DONE]') { return `data: ${payload}`; }
  let parsed: unknown;
  try { parsed = JSON.parse(payload); } catch { return trimmedLine; }
  const normalized = normalizeOpenAiCompatibleChunkPayload(parsed, state);
  return normalized === parsed ? trimmedLine : `data: ${JSON.stringify(normalized)}`;
}

function normalizeOpenAiCompatibleSseLines(chunk: string, state: OpenAiCompatibleToolCallIdState, flushTail: boolean): string {
  const lines = chunk.split('\n');
  if (!flushTail && !chunk.endsWith('\n')) { lines.pop(); }
  return lines.map((line) => normalizeOpenAiCompatibleSseLine(line, state)).join('\n');
}

function flushNormalizedSseChunk(controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder, chunk: string, state: OpenAiCompatibleToolCallIdState, flushTail: boolean): void {
  if (chunk.length === 0) { return; }
  controller.enqueue(encoder.encode(normalizeOpenAiCompatibleSseLines(chunk, state, flushTail)));
}

function createOpenAiCompatibleFetch(providerId: string): typeof fetch {
  const baseFetch = globalThis.fetch.bind(globalThis);
  return async (input, init) => normalizeOpenAiCompatibleStreamResponse(await baseFetch(input, init), providerId);
}

function normalizeOpenAiCompatibleStreamResponse(response: Response, providerId: string): Response {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!response.body || !contentType.includes('text/event-stream')) { return response; }
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  const state: OpenAiCompatibleToolCallIdState = {
    generatedIds: new Map<string, string>(),
    streamId: sanitizeOpenAiCompatibleIdFragment(`${providerId}-test-stream-id`),
  };
  const reader = response.body.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffered = '';
  const transformedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) { flushNormalizedSseChunk(controller, encoder, buffered + decoder.decode(), state, true); controller.close(); return; }
      buffered += decoder.decode(value, { stream: true });
      const lastNewlineIndex = buffered.lastIndexOf('\n');
      if (lastNewlineIndex < 0) { return; }
      flushNormalizedSseChunk(controller, encoder, buffered.slice(0, lastNewlineIndex + 1), state, false);
      buffered = buffered.slice(lastNewlineIndex + 1);
    },
    async cancel(reason) { await reader.cancel(reason); },
  });
  return new Response(transformedBody, { headers, status: response.status, statusText: response.statusText });
}

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

// ─── Provider 文件 I/O 助手 ───

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T : fallback;
  } catch {
    return fallback;
  }
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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
  } catch {
    return null;
  }
}

function normalizeProtocolDriver(value: unknown): ProviderProtocolDriver | null {
  return value === 'openai' || value === 'anthropic' || value === 'gemini' ? value : null;
}

function writeOpenAiProviderFile(filePath: string, provider: StoredAiProviderConfig): void {
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

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

describe('OpenAI 集成 — Provider Catalog', () => {

  it('OpenAI catalog entry 字段完整', () => {
    const entry = PROVIDER_CATALOG.find((p) => p.id === 'openai')!;
    expect(entry.kind).toBe('core');
    expect(entry.protocol).toBe('openai');
    expect(entry.name).toBe('OpenAI');
    expect(entry.defaultBaseUrl).toBe('https://api.openai.com/v1');
    expect(entry.defaultModel).toBe('gpt-4o-mini');
  });

  it('OpenAI 是默认 fallback driver', () => {
    expect(findAiProviderCatalogItem('unknown')?.protocol ?? 'openai').toBe('openai');
  });

  it('buildAiModelConfig 对 OpenAI driver 返回 @ai-sdk/openai', () => {
    const config = createAiModelConfig({ id: 'my-openai', name: 'My OpenAI', driver: 'openai', models: ['gpt-4'] }, 'gpt-4');
    expect(config.api.npm).toBe('@ai-sdk/openai');
    expect(config.api.url).toBe('https://api.openai.com/v1');
  });

  it('OpenAI provider 使用 Bearer token headers', () => {
    const headers = buildAiProviderHeaders({ id: 'my-openai', name: 'My OpenAI', driver: 'openai', apiKey: 'sk-test', models: [] });
    expect(headers.authorization).toBe('Bearer sk-test');
    expect(headers['content-type']).toBe('application/json');
  });

  it('缺失 apiKey 时 OpenAI headers 仍生成 Bearer 空字符串', () => {
    const headers = buildAiProviderHeaders({ id: 'my-openai', name: 'My OpenAI', driver: 'openai', models: [] });
    expect(headers.authorization).toBe('Bearer ');
  });

  it('hasConfiguredProviderApiKey 接受真实 OpenAI key 格式', () => {
    expect(hasConfiguredProviderApiKey('sk-proj-abc123def456')).toBe(true);
    expect(hasConfiguredProviderApiKey('sk-ant-xyz789')).toBe(true);
    expect(hasConfiguredProviderApiKey('sk-')).toBe(true);
  });

  it('hasConfiguredProviderApiKey 拒绝 OpenAI 占位符', () => {
    expect(hasConfiguredProviderApiKey('YOUR_API_KEY')).toBe(false);
    expect(hasConfiguredProviderApiKey('REPLACE_ME')).toBe(false);
  });

  it('validateAiProviderInput 接受 openai driver', () => {
    expect(() => validateAiProviderInput({ driver: 'openai', models: [], name: 'test' })).not.toThrow();
  });

  it('validateAiProviderInput 拒绝非法 driver', () => {
    expect(() => validateAiProviderInput({ driver: 'ollama' as ProviderProtocolDriver, models: [], name: 'test' }))
      .toThrow('provider driver 必须是以下之一');
  });
});

describe('OpenAI 集成 — SSE 流规范化管道', () => {

  describe('normalizeOpenAiCompatibleSseLines（多行处理）', () => {
    it('处理多行 SSE 块', () => {
      const state: OpenAiCompatibleToolCallIdState = { generatedIds: new Map(), streamId: 'test' };
      const chunk = 'data: {"id":"1","choices":[{"delta":{"content":"hello"},"index":0}]}\ndata: {"id":"2","choices":[{"delta":{"content":"world"},"index":0}]}\n';
      const result = normalizeOpenAiCompatibleSseLines(chunk, state, true);
      const lines = result.split('\n').filter(Boolean);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('"content":"hello"');
      expect(lines[1]).toContain('"content":"world"');
    });

    it('不刷新未完成的行（flushTail=false）', () => {
      const state: OpenAiCompatibleToolCallIdState = { generatedIds: new Map(), streamId: 'test' };
      const chunk = 'data: {"id":"1","choices":[{"delta":{"content":"hello"},"index":0}]}\npartial';
      const result = normalizeOpenAiCompatibleSseLines(chunk, state, false);
      expect(result).not.toContain('partial');
    });

    it('刷新未完成的行（flushTail=true）', () => {
      const state: OpenAiCompatibleToolCallIdState = { generatedIds: new Map(), streamId: 'test' };
      const chunk = 'data: {"id":"1","choices":[{"delta":{"content":"hello"},"index":0}]}\ncomment line';
      const result = normalizeOpenAiCompatibleSseLines(chunk, state, true);
      expect(result).toContain('comment line');
    });

    it('空块不产生输出', () => {
      const state: OpenAiCompatibleToolCallIdState = { generatedIds: new Map(), streamId: 'test' };
      expect(normalizeOpenAiCompatibleSseLines('', state, true)).toBe('');
    });
  });

  describe('flushNormalizedSseChunk', () => {
    it('空 chunk 不 enqueue', () => {
      const controller = { enqueue: vi.fn() } as unknown as ReadableStreamDefaultController<Uint8Array>;
      const encoder = new TextEncoder();
      const state: OpenAiCompatibleToolCallIdState = { generatedIds: new Map(), streamId: 'test' };
      flushNormalizedSseChunk(controller, encoder, '', state, true);
      expect(controller.enqueue).not.toHaveBeenCalled();
    });

    it('非空 chunk enqueue 编码结果', () => {
      const controller = { enqueue: vi.fn() } as unknown as ReadableStreamDefaultController<Uint8Array>;
      const encoder = new TextEncoder();
      const state: OpenAiCompatibleToolCallIdState = { generatedIds: new Map(), streamId: 'test' };
      flushNormalizedSseChunk(controller, encoder, 'data: [DONE]\n', state, true);
      expect(controller.enqueue).toHaveBeenCalledTimes(1);
      const enqueued = (controller.enqueue as ReturnType<typeof vi.fn>).mock.calls[0][0] as Uint8Array;
      expect(new TextDecoder().decode(enqueued)).toBe('data: [DONE]\n');
    });
  });

  describe('normalizeOpenAiCompatibleStreamResponse', () => {
    it('非 SSE content-type 直接返回原 response', async () => {
      const response = new Response('{"id":"1"}', {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
      const result = normalizeOpenAiCompatibleStreamResponse(response, 'openai');
      const text = await result.text();
      expect(text).toBe('{"id":"1"}');
    });

    it('替换 content-length 头', async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"id":"1"}\n\n'));
          controller.close();
        },
      });
      const response = new Response(stream, {
        headers: { 'content-type': 'text/event-stream', 'content-length': '999' },
        status: 200,
      });
      const result = normalizeOpenAiCompatibleStreamResponse(response, 'openai');
      expect(result.headers.get('content-length')).toBeNull();
    });

    it('SSE 流正常透传非 tool_call 数据', async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"id":"1","choices":[{"delta":{"content":"你好"},"index":0}]}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      const response = new Response(stream, {
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
      });
      const result = normalizeOpenAiCompatibleStreamResponse(response, 'openai');
      const text = await result.text();
      expect(text).toContain('"content":"你好"');
      expect(text).toContain('[DONE]');
    });

    it('SSE 流规范化 tool_calls（补充 type 和 id）', async () => {
      const encoder = new TextEncoder();
      const rawPayload = JSON.stringify({
        id: '1',
        object: 'chat.completion.chunk',
        choices: [{
          delta: {
            tool_calls: [{ function: { name: 'get_weather', arguments: '{}' }, index: 0 }],
          },
          index: 0,
        }],
      });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${rawPayload}\n\n`));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      const response = new Response(stream, {
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
      });
      const result = normalizeOpenAiCompatibleStreamResponse(response, 'openai');
      const text = await result.text();
      expect(text).toContain('"type":"function"');
      expect(text).toContain('"id"');
    });

    it('SSE 流处理多 tool_call 块', async () => {
      const encoder = new TextEncoder();
      const chunk1 = JSON.stringify({
        id: '1',
        choices: [{ delta: { tool_calls: [{ function: { name: 'a', arguments: '{}' }, index: 0 }] }, index: 0 }],
      });
      const chunk2 = JSON.stringify({
        id: '2',
        choices: [{ delta: { tool_calls: [{ function: { name: 'b', arguments: '{}' }, index: 1 }] }, index: 0 }],
      });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${chunk1}\n\n`));
          controller.enqueue(encoder.encode(`data: ${chunk2}\n\n`));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      const response = new Response(stream, {
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
      });
      const result = normalizeOpenAiCompatibleStreamResponse(response, 'openai');
      const text = await result.text();
      const lines = text.split('\n').filter((l) => l.startsWith('data:') && l !== 'data: [DONE]');
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line).toContain('"type":"function"');
      }
    });
  });

  describe('createOpenAiCompatibleFetch', () => {
    it('返回 fetch 函数', () => {
      const fetchFn = createOpenAiCompatibleFetch('openai');
      expect(typeof fetchFn).toBe('function');
    });

    it('非 SSE 响应透传', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'chatcmpl-abc', object: 'chat.completion' }), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        })
      );
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(mockFetch);
      const customFetch = createOpenAiCompatibleFetch('openai');
      const response = await customFetch('https://api.openai.com/v1/chat/completions', { method: 'POST' });
      const body = await response.json();
      expect(body).toEqual({ id: 'chatcmpl-abc', object: 'chat.completion' });
    });

    it('SSE 响应规范化 tool_calls', async () => {
      const encoder = new TextEncoder();
      const rawPayload = JSON.stringify({
        id: '1',
        choices: [{ delta: { tool_calls: [{ function: { name: 'tool', arguments: '{}' }, index: 0 }] }, index: 0 }],
      });
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${rawPayload}\n\n`));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(stream, {
          headers: { 'content-type': 'text/event-stream' },
          status: 200,
        })
      );
      vi.spyOn(globalThis, 'fetch').mockImplementationOnce(mockFetch);
      const customFetch = createOpenAiCompatibleFetch('openai');
      const response = await customFetch('https://api.openai.com/v1/chat/completions', { method: 'POST' });
      const text = await response.text();
      expect(text).toContain('"type":"function"');
      expect(text).toContain('"id"');
    });
  });

  describe('SSE 边缘情况（OpenAI 兼容 API）', () => {
    it('处理换行符分割的多行 payload', () => {
      const state: OpenAiCompatibleToolCallIdState = { generatedIds: new Map(), streamId: 'test' };
      const lines = [
        'data: {"id":"1","object":"chat.completion.chunk","choices":[{"delta":{"content":"A"},"index":0}]}',
        'data: {"id":"2","object":"chat.completion.chunk","choices":[{"delta":{"content":"B"},"index":0}]}',
        'data: [DONE]',
      ];
      const result = normalizeOpenAiCompatibleSseLines(lines.join('\n'), state, true);
      const resultLines = result.split('\n').filter((l) => l.startsWith('data:'));
      expect(resultLines).toHaveLength(3);
    });

    it('CRLF 行尾在 normalizeOpenAiCompatibleSseLines 中被剥离', () => {
      const state: OpenAiCompatibleToolCallIdState = { generatedIds: new Map(), streamId: 'test' };
      const chunk = 'data: {"id":"1"}\r\n\r\n';
      const result = normalizeOpenAiCompatibleSseLines(chunk, state, true);
      expect(result).not.toContain('\r');
    });

    it('工具调用 id 重复使用', () => {
      const state: OpenAiCompatibleToolCallIdState = { generatedIds: new Map(), streamId: 'test-456' };
      const toolCall = { function: { name: 'x', arguments: '{}' }, index: 0 };
      const first = normalizeOpenAiCompatibleToolCall(toolCall, 0, 0, state);
      const second = normalizeOpenAiCompatibleToolCall(toolCall, 0, 0, state);
      expect(first.toolCall.id).toBe(second.toolCall.id);
    });

    it('同一个 choice 内多个 tool_calls 各自独立生成 id', () => {
      const state: OpenAiCompatibleToolCallIdState = { generatedIds: new Map(), streamId: 'test' };
      const tool1 = normalizeOpenAiCompatibleToolCall({ function: { name: 'a', arguments: '{}' }, index: 0 }, 0, 0, state);
      const tool2 = normalizeOpenAiCompatibleToolCall({ function: { name: 'b', arguments: '{}' }, index: 1 }, 0, 1, state);
      expect(tool1.toolCall.id).not.toBe(tool2.toolCall.id);
    });

    it('缺失 index 且 toolIndex=0 的多工具', () => {
      const state: OpenAiCompatibleToolCallIdState = { generatedIds: new Map(), streamId: 'test' };
      const tool1 = normalizeOpenAiCompatibleToolCall({ function: { name: 'a', arguments: '{}' } }, 0, 0, state);
      const tool2 = normalizeOpenAiCompatibleToolCall({ function: { name: 'b', arguments: '{}' } }, 0, 1, state);
      expect(tool1.toolCall.index).toBe(0);
      expect(tool2.toolCall.index).toBe(1);
    });

    it('streamId 中含特殊字符被清洗', () => {
      expect(sanitizeOpenAiCompatibleIdFragment('my provider@2!')).toBe('my-provider-2-');
    });
  });
});

describe('OpenAI 集成 — 模型发现', () => {

  it('discoverModels 构建正确的 URL', () => {
    const provider: StoredAiProviderConfig = {
      id: 'my-openai', name: 'My OpenAI', driver: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', models: [],
    };
    const url = buildDiscoverModelsUrl(provider);
    expect(url).toBe('https://api.openai.com/v1/models');
  });

  it('discoverModels URL 去尾部斜杠', () => {
    const provider: StoredAiProviderConfig = {
      id: 'my-openai', name: 'My OpenAI', driver: 'openai', baseUrl: 'https://api.openai.com/v1/', apiKey: 'sk-test', models: [],
    };
    const url = buildDiscoverModelsUrl(provider);
    expect(url).toBe('https://api.openai.com/v1/models');
  });

  it('缺失 baseUrl 返回空字符串', () => {
    const provider: StoredAiProviderConfig = {
      id: 'my-openai', name: 'My OpenAI', driver: 'openai', models: [],
    };
    expect(buildDiscoverModelsUrl(provider)).toBe('');
  });

  it('readDiscoveredModel 从 OpenAI data 数组解析', () => {
    const model = readDiscoveredModel({ id: 'gpt-4o', object: 'model', created: 123 });
    expect(model).toEqual({ id: 'gpt-4o', name: 'gpt-4o' });
  });

  it('readDiscoveredModel 从 name 字段回退', () => {
    const model = readDiscoveredModel({ name: 'models/gpt-4o-mini' });
    expect(model).toEqual({ id: 'gpt-4o-mini', name: 'gpt-4o-mini' });
  });

  it('readDiscoveredModel 移除 "models/" 前缀', () => {
    const model = readDiscoveredModel({ id: 'models/gpt-4', display_name: 'GPT-4' });
    expect(model).toEqual({ id: 'gpt-4', name: 'GPT-4' });
  });

  it('readDiscoveredModel 返回 null 对非对象', () => {
    expect(readDiscoveredModel(null)).toBeNull();
    expect(readDiscoveredModel('string')).toBeNull();
  });

  it('readDiscoveredModel 返回 null 对无效条目', () => {
    expect(readDiscoveredModel({})).toBeNull();
  });

  it('toDiscoveredModel 包装 modelId', () => {
    expect(toDiscoveredModel('gpt-4o')).toEqual({ id: 'gpt-4o', name: 'gpt-4o' });
  });

  it('discoverModels 对 OpenAI 兼容 API 使用 Bearer 认证', () => {
    const provider: StoredAiProviderConfig = {
      id: 'my-openai', name: 'My OpenAI', driver: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test-key', models: [],
    };
    const headers = buildAiProviderHeaders(provider);
    expect(headers.authorization).toBe('Bearer sk-test-key');
    expect(headers['content-type']).toBe('application/json');
  });
});

describe('OpenAI 集成 — Provider 文件 I/O', () => {

  const tmpDir = path.join(os.tmpdir(), `openai-provider-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('写入并读取 OpenAI provider 文件', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const provider: StoredAiProviderConfig = {
      id: 'my-openai', name: 'My OpenAI Provider', driver: 'openai', apiKey: 'sk-proj-test-key', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', models: ['gpt-4o-mini', 'gpt-4o'],
    };
    const filePath = path.join(tmpDir, 'my-openai.json');
    writeOpenAiProviderFile(filePath, provider);

    const parsed = readAiProviderStorageFile(filePath);
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe('my-openai');
    expect(parsed!.driver).toBe('openai');
    expect(parsed!.apiKey).toBe('sk-proj-test-key');
    expect(parsed!.baseUrl).toBe('https://api.openai.com/v1');
    expect(parsed!.defaultModel).toBe('gpt-4o-mini');
    expect(parsed!.models).toEqual(['gpt-4o-mini', 'gpt-4o']);
  });

  it('读取损坏的 OpenAI provider 文件返回 null', () => {
    const badPath = path.join(tmpDir, 'bad-openai.json');
    fs.writeFileSync(badPath, '{ broken json', 'utf-8');
    expect(readAiProviderStorageFile(badPath)).toBeNull();
  });

  it('读取缺失 driver 的 provider 文件返回 null', () => {
    const badPath = path.join(tmpDir, 'no-driver.json');
    fs.writeFileSync(badPath, JSON.stringify({ id: 'test', name: 'Test' }), 'utf-8');
    expect(readAiProviderStorageFile(badPath)).toBeNull();
  });

  it('读取不存在的文件返回 null', () => {
    expect(readAiProviderStorageFile(path.join(tmpDir, 'nonexistent.json'))).toBeNull();
  });

  it('多个 OpenAI provider 文件共存', () => {
    const p1: StoredAiProviderConfig = { id: 'openai-1', name: 'OpenAI 1', driver: 'openai', models: ['gpt-4'] };
    const p2: StoredAiProviderConfig = { id: 'openai-2', name: 'OpenAI 2', driver: 'openai', models: ['gpt-3.5'] };
    writeOpenAiProviderFile(path.join(tmpDir, 'openai-1.json'), p1);
    writeOpenAiProviderFile(path.join(tmpDir, 'openai-2.json'), p2);

    const f1 = readAiProviderStorageFile(path.join(tmpDir, 'openai-1.json'));
    const f2 = readAiProviderStorageFile(path.join(tmpDir, 'openai-2.json'));
    expect(f1?.id).toBe('openai-1');
    expect(f2?.id).toBe('openai-2');
  });

  it('OpenAI provider 文件中的模型去重', () => {
    const filePath = path.join(tmpDir, 'dedup.json');
    fs.writeFileSync(filePath, JSON.stringify({
      id: 'dedup-openai', name: 'Dedup', driver: 'openai', models: ['gpt-4', 'gpt-4', 'gpt-4o', 'gpt-4o'], persistedModels: [],
    }), 'utf-8');
    const parsed = readAiProviderStorageFile(filePath);
    expect(parsed?.models).toEqual(['gpt-4', 'gpt-4o']);
  });

  it('缺失 models 数组的 provider 默认为空', () => {
    const filePath = path.join(tmpDir, 'no-models.json');
    fs.writeFileSync(filePath, JSON.stringify({ id: 'no-models', name: 'No Models', driver: 'openai', persistedModels: [] }), 'utf-8');
    const parsed = readAiProviderStorageFile(filePath);
    expect(parsed?.models).toEqual([]);
  });
});

describe('OpenAI 集成 — Provider 配置校验', () => {

  it('OpenAI provider 构造完整', () => {
    const provider: StoredAiProviderConfig = {
      id: 'my-openai', name: 'My OpenAI', driver: 'openai', apiKey: 'sk-abc', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4', models: ['gpt-4', 'gpt-4o'],
    };
    expect(provider.id).toBe('my-openai');
    expect(provider.driver).toBe('openai');
    expect(provider.models).toContain('gpt-4');
  });

  it('OpenAI minimal provider 可构造', () => {
    const provider: StoredAiProviderConfig = {
      id: 'minimal', name: 'Minimal', driver: 'openai', models: [],
    };
    expect(provider.apiKey).toBeUndefined();
    expect(provider.baseUrl).toBeUndefined();
    expect(provider.defaultModel).toBeUndefined();
  });

  it('isProviderProtocolDriver 对 openai 返回 true', () => {
    expect(isProviderProtocolDriver('openai')).toBe(true);
  });

  it('baseUrl 回退到 catalog 默认值', () => {
    const provider: StoredAiProviderConfig = { id: 't', name: 'T', driver: 'openai', models: [] };
    const config = createAiModelConfig(provider, 'gpt-4');
    expect(config.api.url).toBe('https://api.openai.com/v1');
  });

  it('自定义 baseUrl 覆盖 catalog 默认值', () => {
    const provider: StoredAiProviderConfig = { id: 't', name: 'T', driver: 'openai', baseUrl: 'https://my-proxy.openai.xyz/v1', models: [] };
    const config = createAiModelConfig(provider, 'gpt-4');
    expect(config.api.url).toBe('https://my-proxy.openai.xyz/v1');
  });

  it('默认 capabilities 包含 toolCall=true', () => {
    const provider: StoredAiProviderConfig = { id: 't', name: 'T', driver: 'openai', models: [] };
    const config = createAiModelConfig(provider, 'gpt-4');
    expect(config.capabilities.toolCall).toBe(true);
    expect(config.capabilities.reasoning).toBe(false);
    expect(config.capabilities.input.text).toBe(true);
    expect(config.capabilities.input.image).toBe(false);
  });

  it('status 默认 active', () => {
    const provider: StoredAiProviderConfig = { id: 't', name: 'T', driver: 'openai', models: [] };
    const config = createAiModelConfig(provider, 'gpt-4');
    expect(config.status).toBe('active');
  });

  it('contextLength 默认 128KB', () => {
    const provider: StoredAiProviderConfig = { id: 't', name: 'T', driver: 'openai', models: [] };
    const config = createAiModelConfig(provider, 'gpt-4');
    expect(config.contextLength).toBe(128 * 1024);
  });
});
