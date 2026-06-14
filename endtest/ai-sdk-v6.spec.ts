import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';

// ── Provider Catalog ──────────────────────────────────────────

const PROVIDER_CATALOG = [
  { id: 'openai', kind: 'core', protocol: 'openai', name: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  { id: 'anthropic', kind: 'core', protocol: 'anthropic', name: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-3-5-sonnet-20241022' },
  { id: 'gemini', kind: 'core', protocol: 'gemini', name: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-1.5-pro' },
] as const;

const PROVIDER_PROTOCOL_DRIVERS = ['openai', 'anthropic', 'gemini'] as const;
type ProviderProtocolDriver = typeof PROVIDER_PROTOCOL_DRIVERS[number];
const PROVIDER_PROTOCOL_DRIVER_SET = new Set<string>(PROVIDER_PROTOCOL_DRIVERS);

// ── Inline helpers from ai-management-model-config.ts ─────────

function isProviderProtocolDriver(driver: string): driver is ProviderProtocolDriver {
  return PROVIDER_PROTOCOL_DRIVER_SET.has(driver);
}

function findAiProviderCatalogItem(driver: string) {
  return PROVIDER_CATALOG.find((item) => item.id === driver) ?? null;
}

function createAiModelConfig(provider: { id: string; driver: string; baseUrl?: string }, modelId: string) {
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

function buildAiProviderHeaders(provider: { driver: string; apiKey?: string }) {
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

const PROVIDER_API_KEY_PLACEHOLDER_PATTERNS = [/^YOUR_/iu, /^REPLACE_/iu, /^CHANGE_ME\b/iu, /^<.+>$/u];

function hasConfiguredProviderApiKey(apiKey: string | undefined): boolean {
  const normalizedApiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  return normalizedApiKey.length > 0 && !PROVIDER_API_KEY_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalizedApiKey));
}

function buildAiModelKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

// ── Inline helpers from ai-model-execution.service.ts ─────────

type PluginLlmMessage = { role: string; content: string | Array<{ type: string; text?: string; image?: string; mimeType?: string }> };

function buildExecutionMessages(messages: PluginLlmMessage[]): unknown[] {
  return messages.map((message) => ({ content: buildExecutionMessageContent(message.content), role: message.role }));
}

function buildExecutionMessageContent(content: PluginLlmMessage['content']): unknown {
  return typeof content === 'string' ? content : content.map((part) =>
    part.type === 'text'
      ? { text: part.text, type: 'text' }
      : { image: toAiSdkImageInput(part.image!), ...(part.mimeType ? { mimeType: part.mimeType } : {}), type: 'image' }
  );
}

function toAiSdkImageInput(image: string): string | ArrayBuffer {
  if (!image.startsWith('data:')) { return image; }
  const matched = /^data:([^;]+);base64,(.+)$/u.exec(image);
  if (!matched) { throw new Error('不支持的图片 data URL'); }
  const binary = Buffer.from(matched[2], 'base64');
  return binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
}

function estimateTokenCount(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}

function readMessageText(content: PluginLlmMessage['content']): string {
  return typeof content === 'string'
    ? content
    : content.filter((part): part is { text: string; type: 'text' } => part.type === 'text').map((part) => part.text).join('\n');
}

function readModelUsage(value: unknown, system: string, messages: PluginLlmMessage[], text: string) {
  const providerUsage = normalizeAiSdkLanguageModelUsage(value);
  if (providerUsage) { return providerUsage; }
  const inputTokens = estimateTokenCount([system, ...messages.map((message) => readMessageText(message.content))].join('\n'));
  const outputTokens = estimateTokenCount(text);
  return { inputTokens, outputTokens, source: 'estimated', totalTokens: inputTokens + outputTokens };
}

// ── Usage normalization ───────────────────────────────────────

function readTokenNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.ceil(value) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
      ['totalTokens'], ['total_tokens'], ['inputTokens'], ['input_tokens'],
      ['promptTokens'], ['prompt_tokens'], ['outputTokens'], ['output_tokens'],
      ['completionTokens'], ['completion_tokens'],
    ]) !== null) { return candidate; }
  }
  return null;
}

function normalizeAiSdkLanguageModelUsage(value: unknown) {
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

// ── SSE Normalization ─────────────────────────────────────────

type OpenAiCompatibleToolCallIdState = { generatedIds: Map<string, string>; streamId: string };

function sanitizeOpenAiCompatibleIdFragment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function normalizeOpenAiCompatibleToolCall(toolCall: unknown, choiceIndex: number, toolIndex: number, state: OpenAiCompatibleToolCallIdState) {
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
    const nextToolCalls = choice.delta.tool_calls.map((toolCall: unknown, toolIndex: number) => {
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

// ── Tool repair helpers ───────────────────────────────────────

function readRepairToolErrorMessage(error: { message?: string } | null | undefined): string {
  return typeof error?.message === 'string' && error.message.trim().length > 0 ? error.message.trim() : '工具调用不合法';
}

function readRepairToolPhase(error: { name?: string } | null | undefined): 'resolve' | 'validate' {
  return error?.name === 'AI_NoSuchToolError' ? 'resolve' : 'validate';
}

// ── Stream collection ─────────────────────────────────────────

type AssistantCustomBlockEntry = { key: string; kind: string; value: string };

function applyAssistantCustomBlockUpdates(currentBlocks: AssistantCustomBlockEntry[], updates: AssistantCustomBlockEntry[]): AssistantCustomBlockEntry[] {
  if (updates.length === 0) { return currentBlocks; }
  const nextBlocks = [...currentBlocks];
  for (const update of updates) {
    const blockIndex = nextBlocks.findIndex((entry) => entry.key === update.key);
    if (blockIndex < 0) {
      nextBlocks.push(update);
    } else {
      nextBlocks[blockIndex] = update.kind !== 'text' ? update : { key: update.key, kind: 'text', value: `${nextBlocks[blockIndex].value}${update.value}` };
    }
  }
  return nextBlocks;
}

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

describe('Provider Catalog', () => {
  it('has exactly 3 core providers', () => {
    expect(PROVIDER_CATALOG).toHaveLength(3);
  });

  it('each provider has unique id', () => {
    const ids = PROVIDER_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each provider has required fields', () => {
    for (const provider of PROVIDER_CATALOG) {
      expect(provider).toHaveProperty('id');
      expect(provider).toHaveProperty('kind', 'core');
      expect(provider).toHaveProperty('protocol');
      expect(provider).toHaveProperty('name');
      expect(provider).toHaveProperty('defaultBaseUrl');
      expect(provider).toHaveProperty('defaultModel');
    }
  });

  it('openai matches expected structure', () => {
    const openai = PROVIDER_CATALOG.find((p) => p.id === 'openai')!;
    expect(openai.protocol).toBe('openai');
    expect(openai.defaultBaseUrl).toBe('https://api.openai.com/v1');
    expect(openai.defaultModel).toBe('gpt-4o-mini');
  });

  it('anthropic matches expected structure', () => {
    const anthropic = PROVIDER_CATALOG.find((p) => p.id === 'anthropic')!;
    expect(anthropic.protocol).toBe('anthropic');
    expect(anthropic.defaultBaseUrl).toBe('https://api.anthropic.com/v1');
    expect(anthropic.defaultModel).toBe('claude-3-5-sonnet-20241022');
  });

  it('gemini matches expected structure', () => {
    const gemini = PROVIDER_CATALOG.find((p) => p.id === 'gemini')!;
    expect(gemini.protocol).toBe('gemini');
    expect(gemini.defaultBaseUrl).toBe('https://generativelanguage.googleapis.com/v1beta');
    expect(gemini.defaultModel).toBe('gemini-1.5-pro');
  });
});

describe('isProviderProtocolDriver', () => {
  it('accepts openai', () => expect(isProviderProtocolDriver('openai')).toBe(true));
  it('accepts anthropic', () => expect(isProviderProtocolDriver('anthropic')).toBe(true));
  it('accepts gemini', () => expect(isProviderProtocolDriver('gemini')).toBe(true));
  it('rejects unknown driver', () => expect(isProviderProtocolDriver('ollama')).toBe(false));
  it('rejects empty string', () => expect(isProviderProtocolDriver('')).toBe(false));
  it('is case-sensitive', () => expect(isProviderProtocolDriver('OpenAI')).toBe(false));
});

describe('findAiProviderCatalogItem', () => {
  it('finds openai', () => {
    const item = findAiProviderCatalogItem('openai');
    expect(item).not.toBeNull();
    expect(item!.id).toBe('openai');
  });

  it('finds anthropic', () => {
    const item = findAiProviderCatalogItem('anthropic');
    expect(item).not.toBeNull();
    expect(item!.protocol).toBe('anthropic');
  });

  it('finds gemini', () => {
    const item = findAiProviderCatalogItem('gemini');
    expect(item).not.toBeNull();
    expect(item!.protocol).toBe('gemini');
  });

  it('returns null for unknown driver', () => {
    expect(findAiProviderCatalogItem('unknown')).toBeNull();
  });
});

describe('createAiModelConfig', () => {
  it('openai provider maps to @ai-sdk/openai', () => {
    const config = createAiModelConfig({ id: 'my-openai', driver: 'openai', baseUrl: 'https://api.openai.com/v1' }, 'gpt-4');
    expect(config.api.npm).toBe('@ai-sdk/openai');
    expect(config.api.url).toBe('https://api.openai.com/v1');
    expect(config.providerId).toBe('my-openai');
    expect(config.status).toBe('active');
  });

  it('anthropic provider maps to @ai-sdk/anthropic', () => {
    const config = createAiModelConfig({ id: 'my-anthropic', driver: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' }, 'claude-3-opus');
    expect(config.api.npm).toBe('@ai-sdk/anthropic');
  });

  it('gemini provider maps to @ai-sdk/google', () => {
    const config = createAiModelConfig({ id: 'my-gemini', driver: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' }, 'gemini-1.5-pro');
    expect(config.api.npm).toBe('@ai-sdk/google');
  });

  it('uses defaultBaseUrl when baseUrl is not provided', () => {
    const config = createAiModelConfig({ id: 'openai', driver: 'openai' }, 'gpt-4');
    expect(config.api.url).toBe('https://api.openai.com/v1');
  });

  it('provider driver without catalog match defaults to @ai-sdk/openai', () => {
    const config = createAiModelConfig({ id: 'custom', driver: 'custom' }, 'custom-model');
    expect(config.api.npm).toBe('@ai-sdk/openai');
  });

  it('sets default capabilities', () => {
    const config = createAiModelConfig({ id: 'openai', driver: 'openai' }, 'gpt-4');
    expect(config.capabilities).toEqual({
      reasoning: false, toolCall: true,
      input: { text: true, image: false },
      output: { text: true, image: false },
    });
  });

  it('sets default contextLength to 128KB', () => {
    const config = createAiModelConfig({ id: 'openai', driver: 'openai' }, 'gpt-4');
    expect(config.contextLength).toBe(128 * 1024);
  });
});

describe('buildAiProviderHeaders', () => {
  it('openai uses Bearer authorization', () => {
    const headers = buildAiProviderHeaders({ driver: 'openai', apiKey: 'sk-abc' });
    expect(headers.authorization).toBe('Bearer sk-abc');
    expect(headers['content-type']).toBe('application/json');
  });

  it('anthropic uses x-api-key', () => {
    const headers = buildAiProviderHeaders({ driver: 'anthropic', apiKey: 'sk-ant-abc' });
    expect(headers['x-api-key']).toBe('sk-ant-abc');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('gemini uses x-goog-api-key', () => {
    const headers = buildAiProviderHeaders({ driver: 'gemini', apiKey: 'AIza-abc' });
    expect(headers['x-goog-api-key']).toBe('AIza-abc');
  });

  it('handles missing apiKey gracefully', () => {
    const headers = buildAiProviderHeaders({ driver: 'openai' });
    expect(headers.authorization).toBe('Bearer ');
  });
});

describe('hasConfiguredProviderApiKey', () => {
  it('accepts a real-looking key', () => {
    expect(hasConfiguredProviderApiKey('sk-proj-abc123')).toBe(true);
  });

  it('rejects YOUR_ placeholder', () => {
    expect(hasConfiguredProviderApiKey('YOUR_API_KEY')).toBe(false);
  });

  it('rejects REPLACE_ placeholder', () => {
    expect(hasConfiguredProviderApiKey('REPLACE_ME')).toBe(false);
  });

  it('rejects CHANGE_ME placeholder', () => {
    expect(hasConfiguredProviderApiKey('CHANGE_ME')).toBe(false);
  });

  it('rejects angle bracket placeholder', () => {
    expect(hasConfiguredProviderApiKey('<your-api-key>')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(hasConfiguredProviderApiKey('')).toBe(false);
  });

  it('rejects undefined', () => {
    expect(hasConfiguredProviderApiKey(undefined)).toBe(false);
  });

  it('accepts key despite trailing whitespace after trim', () => {
    expect(hasConfiguredProviderApiKey('  sk-abc  ')).toBe(true);
  });
});

describe('buildAiModelKey', () => {
  it('formats as providerId:modelId', () => {
    expect(buildAiModelKey('openai', 'gpt-4')).toBe('openai:gpt-4');
  });
});

// ── AI SDK Execution — Usage Normalization ───────────────────

describe('normalizeAiSdkLanguageModelUsage', () => {
  it('parses standard usage format', () => {
    const result = normalizeAiSdkLanguageModelUsage({ inputTokens: 10, outputTokens: 20, totalTokens: 30 });
    expect(result).toEqual({ inputTokens: 10, outputTokens: 20, source: 'provider', totalTokens: 30 });
  });

  it('parses nested usage object', () => {
    const result = normalizeAiSdkLanguageModelUsage({ usage: { inputTokens: 5, outputTokens: 15, totalTokens: 20 } });
    expect(result).toEqual({ inputTokens: 5, outputTokens: 15, source: 'provider', totalTokens: 20 });
  });

  it('parses tokenUsage nest', () => {
    const result = normalizeAiSdkLanguageModelUsage({ tokenUsage: { inputTokens: 7, outputTokens: 13, totalTokens: 20 } });
    expect(result).toEqual({ inputTokens: 7, outputTokens: 13, source: 'provider', totalTokens: 20 });
  });

  it('parses totalUsage nest', () => {
    const result = normalizeAiSdkLanguageModelUsage({ totalUsage: { inputTokens: 3, outputTokens: 9, totalTokens: 12 } });
    expect(result).toEqual({ inputTokens: 3, outputTokens: 9, source: 'provider', totalTokens: 12 });
  });

  it('parses OpenAI-style snake_case', () => {
    const result = normalizeAiSdkLanguageModelUsage({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 });
    expect(result).toEqual({ inputTokens: 10, outputTokens: 20, source: 'provider', totalTokens: 30 });
  });

  it('parses Anthropic-style promptTokens/completionTokens', () => {
    const result = normalizeAiSdkLanguageModelUsage({ promptTokens: 15, completionTokens: 25, totalTokens: 40 });
    expect(result).toEqual({ inputTokens: 15, outputTokens: 25, source: 'provider', totalTokens: 40 });
  });

  it('parses Gemini-style with prompt_tokens_details', () => {
    const usage = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, prompt_tokens_details: { cached_tokens: 30 } };
    const result = normalizeAiSdkLanguageModelUsage(usage);
    expect(result).toEqual({ inputTokens: 100, outputTokens: 50, cachedInputTokens: 30, source: 'provider', totalTokens: 150 });
  });

  it('parses Anthropic-style cachedInputTokens', () => {
    const usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150, cachedInputTokens: 40 };
    const result = normalizeAiSdkLanguageModelUsage(usage);
    expect(result).toEqual({ inputTokens: 100, outputTokens: 50, cachedInputTokens: 40, source: 'provider', totalTokens: 150 });
  });

  it('parses cacheReadInputTokens variant', () => {
    const usage = { inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadInputTokens: 20 };
    const result = normalizeAiSdkLanguageModelUsage(usage);
    expect(result).toEqual({ inputTokens: 100, outputTokens: 50, cachedInputTokens: 20, source: 'provider', totalTokens: 150 });
  });

  it('derives outputTokens from total - input', () => {
    const result = normalizeAiSdkLanguageModelUsage({ inputTokens: 30, totalTokens: 100 });
    expect(result).toEqual({ inputTokens: 30, outputTokens: 70, source: 'provider', totalTokens: 100 });
  });

  it('derives inputTokens from total - output', () => {
    const result = normalizeAiSdkLanguageModelUsage({ outputTokens: 40, totalTokens: 100 });
    expect(result).toEqual({ inputTokens: 60, outputTokens: 40, source: 'provider', totalTokens: 100 });
  });

  it('returns null for empty object', () => {
    expect(normalizeAiSdkLanguageModelUsage({})).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(normalizeAiSdkLanguageModelUsage(undefined)).toBeNull();
  });

  it('returns null for non-object', () => {
    expect(normalizeAiSdkLanguageModelUsage('bad')).toBeNull();
  });

  it('returns null when both inputTokens and outputTokens missing', () => {
    expect(normalizeAiSdkLanguageModelUsage({ totalTokens: 50 })).toBeNull();
  });

  it('rounds floating token values up', () => {
    const result = normalizeAiSdkLanguageModelUsage({ inputTokens: 10.3, outputTokens: 20.7, totalTokens: 31 });
    expect(result!.inputTokens).toBe(11);
    expect(result!.outputTokens).toBe(21);
  });

  it('derives inputTokens when negative from total - output', () => {
    const result = normalizeAiSdkLanguageModelUsage({ inputTokens: -1, outputTokens: 20, totalTokens: 19 });
    expect(result).toEqual({ inputTokens: 0, outputTokens: 20, source: 'provider', totalTokens: 19 });
  });
});

describe('readSdkUsageRecord', () => {
  it('returns the record itself when it has token fields', () => {
    expect(readSdkUsageRecord({ inputTokens: 10, outputTokens: 20 })).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it('reads from nested usage key', () => {
    expect(readSdkUsageRecord({ usage: { inputTokens: 1, outputTokens: 2 } })).toEqual({ inputTokens: 1, outputTokens: 2 });
  });

  it('reads from nested tokenUsage key', () => {
    expect(readSdkUsageRecord({ tokenUsage: { inputTokens: 3, outputTokens: 4 } })).toEqual({ inputTokens: 3, outputTokens: 4 });
  });

  it('reads from nested totalUsage key', () => {
    expect(readSdkUsageRecord({ totalUsage: { inputTokens: 5, outputTokens: 6 } })).toEqual({ inputTokens: 5, outputTokens: 6 });
  });

  it('prefers the root record over nested', () => {
    const input = { inputTokens: 10, outputTokens: 20, usage: { inputTokens: 99, outputTokens: 99 } };
    const result = readSdkUsageRecord(input);
    expect(result!.inputTokens).toBe(10);
    expect(result!.outputTokens).toBe(20);
  });

  it('returns null for null', () => expect(readSdkUsageRecord(null)).toBeNull());
  it('returns null for array', () => expect(readSdkUsageRecord([])).toBeNull());
  it('returns null for string', () => expect(readSdkUsageRecord('abc')).toBeNull());
});

describe('readTokenPath', () => {
  it('reads a simple path', () => {
    expect(readTokenPath({ inputTokens: 42 }, [['inputTokens']])).toBe(42);
  });

  it('reads a nested path', () => {
    expect(readTokenPath({ details: { tokens: 7 } }, [['details', 'tokens']])).toBe(7);
  });

  it('tries multiple paths and returns the first match', () => {
    expect(readTokenPath({ output_tokens: 99 }, [['outputTokens'], ['output_tokens']])).toBe(99);
  });

  it('returns null when no path matches', () => {
    expect(readTokenPath({ foo: 'bar' }, [['inputTokens'], ['outputTokens']])).toBeNull();
  });

  it('returns null for non-numeric values', () => {
    expect(readTokenPath({ inputTokens: 'abc' }, [['inputTokens']])).toBeNull();
  });

  it('returns null for negative values', () => {
    expect(readTokenPath({ inputTokens: -5 }, [['inputTokens']])).toBeNull();
  });

  it('returns null for NaN values', () => {
    expect(readTokenPath({ inputTokens: NaN }, [['inputTokens']])).toBeNull();
  });

  it('returns null for Infinity', () => {
    expect(readTokenPath({ inputTokens: Infinity }, [['inputTokens']])).toBeNull();
  });
});

describe('estimateTokenCount', () => {
  it('estimates ~0.25 tokens per byte', () => {
    expect(estimateTokenCount('hello world')).toBe(3);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokenCount('')).toBe(0);
  });

  it('handles CJK characters (3 bytes each)', () => {
    expect(estimateTokenCount('你好世界')).toBe(3);
  });

  it('handles long texts proportionally', () => {
    const text = 'a'.repeat(400);
    expect(estimateTokenCount(text)).toBe(100);
  });
});

describe('readMessageText', () => {
  it('returns string content as-is', () => {
    expect(readMessageText('hello')).toBe('hello');
  });

  it('joins text parts with newline', () => {
    const content = [
      { type: 'text', text: 'Hello' },
      { type: 'text', text: 'World' },
    ];
    expect(readMessageText(content)).toBe('Hello\nWorld');
  });

  it('filters out non-text parts', () => {
    const content = [
      { type: 'text', text: 'Hello' },
      { type: 'image', image: 'data:image/png;base64,abc' },
      { type: 'text', text: 'World' },
    ];
    expect(readMessageText(content)).toBe('Hello\nWorld');
  });
});

describe('buildExecutionMessageContent', () => {
  it('passes string content through', () => {
    expect(buildExecutionMessageContent('hello')).toBe('hello');
  });

  it('converts text parts', () => {
    const result = buildExecutionMessageContent([{ type: 'text', text: 'hello' }]) as Array<unknown>;
    expect(result).toHaveLength(1);
    expect((result[0] as Record<string, unknown>).text).toBe('hello');
    expect((result[0] as Record<string, unknown>).type).toBe('text');
  });

  it('converts image parts with data URL', () => {
    const content = [{ type: 'image', image: 'data:image/png;base64,' + Buffer.from('fake').toString('base64'), mimeType: 'image/png' }];
    const result = buildExecutionMessageContent(content) as Array<unknown>;
    expect(result).toHaveLength(1);
    const part = result[0] as Record<string, unknown>;
    expect(part.type).toBe('image');
    expect(part.mimeType).toBe('image/png');
    expect(part.image).toBeTruthy();
  });

  it('converts image parts with URL', () => {
    const content = [{ type: 'image', image: 'https://example.com/image.png' }];
    const result = buildExecutionMessageContent(content) as Array<unknown>;
    const part = result[0] as Record<string, unknown>;
    expect(part.image).toBe('https://example.com/image.png');
  });
});

describe('toAiSdkImageInput', () => {
  it('passes URL through', () => {
    expect(toAiSdkImageInput('https://example.com/img.png')).toBe('https://example.com/img.png');
  });

  it('converts data URL to ArrayBuffer', () => {
    const base64 = Buffer.from('fake').toString('base64');
    const result = toAiSdkImageInput(`data:image/png;base64,${base64}`);
    expect(result).toBeTruthy();
    expect((result as ArrayBuffer).byteLength).toBe(4);
  });

  it('throws on malformed data URL', () => {
    expect(() => toAiSdkImageInput('data:invalid')).toThrow('不支持的图片 data URL');
  });
});

describe('buildExecutionMessages', () => {
  it('maps messages with string content', () => {
    const result = buildExecutionMessages([{ role: 'user', content: 'hello' }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: 'user', content: 'hello' });
  });

  it('maps messages with parts content', () => {
    const messages: PluginLlmMessage[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }],
      },
    ];
    const result = buildExecutionMessages(messages);
    expect(result).toHaveLength(1);
    const content = (result[0] as Record<string, unknown>).content as Array<unknown>;
    expect(content).toHaveLength(2);
  });

  it('preserves role values', () => {
    const result = buildExecutionMessages([
      { role: 'system', content: 'be helpful' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    expect(result.map((m) => (m as Record<string, unknown>).role)).toEqual(['system', 'user', 'assistant']);
  });
});

describe('readModelUsage', () => {
  const system = 'You are a helpful assistant.';
  const messages: PluginLlmMessage[] = [{ role: 'user', content: 'Hello' }];

  it('returns provider usage when available', () => {
    const result = readModelUsage({ inputTokens: 50, outputTokens: 100 }, system, messages, 'some response');
    expect(result.source).toBe('provider');
    expect(result.inputTokens).toBe(50);
    expect(result.outputTokens).toBe(100);
  });

  it('falls back to estimated usage', () => {
    const result = readModelUsage(null, system, messages, 'short');
    expect(result.source).toBe('estimated');
    expect(typeof result.inputTokens).toBe('number');
    expect(typeof result.outputTokens).toBe('number');
  });

  it('estimated usage includes system prompt in input tokens', () => {
    const resultLongSystem = readModelUsage(null, 'a'.repeat(400), messages, '');
    const resultShortSystem = readModelUsage(null, '', messages, '');
    expect(resultLongSystem.inputTokens).toBeGreaterThan(resultShortSystem.inputTokens!);
  });
});

describe('readRepairToolErrorMessage', () => {
  it('extracts message when present', () => {
    expect(readRepairToolErrorMessage({ message: 'Tool not found' })).toBe('Tool not found');
  });

  it('trims message', () => {
    expect(readRepairToolErrorMessage({ message: '  error  ' })).toBe('error');
  });

  it('uses default when message is empty', () => {
    expect(readRepairToolErrorMessage({ message: '' })).toBe('工具调用不合法');
  });

  it('uses default when error is null', () => {
    expect(readRepairToolErrorMessage(null)).toBe('工具调用不合法');
  });

  it('uses default when error is undefined', () => {
    expect(readRepairToolErrorMessage(undefined)).toBe('工具调用不合法');
  });
});

describe('readRepairToolPhase', () => {
  it('returns resolve for AI_NoSuchToolError', () => {
    expect(readRepairToolPhase({ name: 'AI_NoSuchToolError' })).toBe('resolve');
  });

  it('returns validate for other errors', () => {
    expect(readRepairToolPhase({ name: 'AI_ToolCallValidationError' })).toBe('validate');
  });

  it('returns validate when name is undefined', () => {
    expect(readRepairToolPhase({})).toBe('validate');
  });

  it('returns validate for null', () => {
    expect(readRepairToolPhase(null)).toBe('validate');
  });
});

describe('normalizeOpenAiCompatibleToolCall', () => {
  it('passes valid tool call through unchanged', () => {
    const state = { generatedIds: new Map<string, string>(), streamId: 'test-123' };
    const toolCall = { id: 'call_1', type: 'function', function: { name: 'test', arguments: '{}' }, index: 0 };
    const result = normalizeOpenAiCompatibleToolCall(toolCall, 0, 0, state);
    expect(result.changed).toBe(false);
    expect(result.toolCall).toBe(toolCall);
  });

  it('adds missing id', () => {
    const state = { generatedIds: new Map<string, string>(), streamId: 'test-123' };
    const toolCall = { type: 'function', function: { name: 'test', arguments: '{}' }, index: 0 };
    const result = normalizeOpenAiCompatibleToolCall(toolCall, 0, 0, state);
    expect(result.changed).toBe(true);
    expect(result.toolCall.id).toBe('gc-openai-tool-call-test-123-0-0');
  });

  it('adds missing type for function calls', () => {
    const state = { generatedIds: new Map<string, string>(), streamId: 'test-123' };
    const toolCall = { id: 'call_1', function: { name: 'test', arguments: '{}' }, index: 0 };
    const result = normalizeOpenAiCompatibleToolCall(toolCall, 0, 0, state);
    expect(result.changed).toBe(true);
    expect(result.toolCall.type).toBe('function');
  });

  it('normalizes index to toolIndex when missing', () => {
    const state = { generatedIds: new Map<string, string>(), streamId: 'test-123' };
    const toolCall = { id: 'call_1', type: 'function', function: { name: 'test', arguments: '{}' } };
    const result = normalizeOpenAiCompatibleToolCall(toolCall, 0, 5, state);
    expect(result.changed).toBe(true);
    expect(result.toolCall.index).toBe(5);
  });

  it('reuses cached IDs for duplicate tool calls', () => {
    const state = { generatedIds: new Map<string, string>(), streamId: 'test-123' };
    const toolCall = { type: 'function', function: { name: 'test', arguments: '{}' }, index: 0 };
    const first = normalizeOpenAiCompatibleToolCall(toolCall, 0, 0, state);
    const second = normalizeOpenAiCompatibleToolCall(toolCall, 0, 0, state);
    expect(first.toolCall.id).toBe(second.toolCall.id);
  });

  it('returns unchanged for non-record input', () => {
    const state = { generatedIds: new Map<string, string>(), streamId: 'test-123' };
    const result = normalizeOpenAiCompatibleToolCall('bad', 0, 0, state);
    expect(result.changed).toBe(false);
  });

  it('sanitizes provider id for stream id', () => {
    expect(sanitizeOpenAiCompatibleIdFragment('my provider@2')).toBe('my-provider-2');
  });
});

describe('normalizeOpenAiCompatibleChunkPayload', () => {
  it('passes non-stream payload through unchanged', () => {
    const state = { generatedIds: new Map<string, string>(), streamId: 'test' };
    const payload = { id: '1', object: 'chat.completion', choices: [{ delta: { content: 'hello' }, index: 0 }] };
    expect(normalizeOpenAiCompatibleChunkPayload(payload, state)).toBe(payload);
  });

  it('normalizes tool_calls in stream chunk', () => {
    const state = { generatedIds: new Map<string, string>(), streamId: 'test' };
    const payload = {
      id: '1',
      object: 'chat.completion.chunk',
      choices: [{ delta: { tool_calls: [{ function: { name: 'test', arguments: '{}' }, index: 0 }] }, index: 0 }],
    };
    const result = normalizeOpenAiCompatibleChunkPayload(payload, state) as Record<string, unknown>;
    const choice = (result.choices as Array<unknown>)[0] as Record<string, unknown>;
    const delta = choice.delta as Record<string, unknown>;
    const toolCall = (delta.tool_calls as Array<unknown>)[0] as Record<string, unknown>;
    expect(toolCall.type).toBe('function');
    expect(typeof toolCall.id).toBe('string');
  });

  it('returns unchanged for non-record payload', () => {
    const state = { generatedIds: new Map<string, string>(), streamId: 'test' };
    expect(normalizeOpenAiCompatibleChunkPayload('bad', state)).toBe('bad');
  });

  it('returns unchanged for record without choices', () => {
    const state = { generatedIds: new Map<string, string>(), streamId: 'test' };
    const payload = { id: '1', object: 'chat.completion' };
    expect(normalizeOpenAiCompatibleChunkPayload(payload, state)).toBe(payload);
  });
});

describe('normalizeOpenAiCompatibleSseLine', () => {
  it('passes non-data lines unchanged', () => {
    const state = { generatedIds: new Map<string, string>(), streamId: 'test' };
    expect(normalizeOpenAiCompatibleSseLine(': comment', state)).toBe(': comment');
  });

  it('passes [DONE] through', () => {
    const state = { generatedIds: new Map<string, string>(), streamId: 'test' };
    expect(normalizeOpenAiCompatibleSseLine('data: [DONE]', state)).toBe('data: [DONE]');
  });

  it('passes valid JSON without tool_calls through unchanged', () => {
    const state = { generatedIds: new Map<string, string>(), streamId: 'test' };
    const line = 'data: {"id":"1","choices":[{"delta":{"content":"hello"},"index":0}]}';
    expect(normalizeOpenAiCompatibleSseLine(line, state)).toBe(line);
  });

  it('normalizes tool_calls in SSE line', () => {
    const state = { generatedIds: new Map<string, string>(), streamId: 'test' };
    const line = 'data: {"id":"1","choices":[{"delta":{"tool_calls":[{"function":{"name":"test","arguments":"{}"},"index":0}]},"index":0}]}';
    const result = normalizeOpenAiCompatibleSseLine(line, state);
    expect(result).toContain('"type":"function"');
    expect(result).toContain('"id"');
  });

  it('handles invalid JSON gracefully', () => {
    const state = { generatedIds: new Map<string, string>(), streamId: 'test' };
    const line = 'data: {invalid json}';
    expect(normalizeOpenAiCompatibleSseLine(line, state)).toBe(line);
  });

  it('handles empty data payload', () => {
    const state = { generatedIds: new Map<string, string>(), streamId: 'test' };
    expect(normalizeOpenAiCompatibleSseLine('data:', state)).toBe('data: ');
  });

  it('handles CRLF line endings', () => {
    const state = { generatedIds: new Map<string, string>(), streamId: 'test' };
    const line = 'data: {"id":"1","choices":[{"delta":{"content":"hello"},"index":0}]}\r';
    const result = normalizeOpenAiCompatibleSseLine(line, state);
    expect(result.endsWith('\r')).toBe(false);
    expect(JSON.parse(result.slice(5))).toBeTruthy();
  });
});

describe('applyAssistantCustomBlockUpdates', () => {
  it('adds new block', () => {
    const result = applyAssistantCustomBlockUpdates([], [{ key: 'block1', kind: 'text', value: 'hello' }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ key: 'block1', kind: 'text', value: 'hello' });
  });

  it('appends text to existing block', () => {
    const blocks = [{ key: 'block1', kind: 'text', value: 'hello' }];
    const result = applyAssistantCustomBlockUpdates(blocks, [{ key: 'block1', kind: 'text', value: ' world' }]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('hello world');
  });

  it('replaces non-text block entirely', () => {
    const blocks = [{ key: 'block1', kind: 'text', value: 'hello' }];
    const result = applyAssistantCustomBlockUpdates(blocks, [{ key: 'block1', kind: 'json', value: '{"a":1}' }]);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('{"a":1}');
  });

  it('returns current blocks when updates are empty', () => {
    const blocks = [{ key: 'b1', kind: 'text', value: 'hi' }];
    const result = applyAssistantCustomBlockUpdates(blocks, []);
    expect(result).toHaveLength(1);
    expect(result).toBe(blocks);
  });
});
