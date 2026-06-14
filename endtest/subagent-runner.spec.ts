import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── 类型定义 ───

interface JsonObject {
  [key: string]: JsonValue;
}
type JsonValue = JsonObject | JsonValue[] | string | number | boolean | null;

interface ChatMessagePart {
  type: string;
  text?: string;
  [key: string]: JsonValue;
}

interface PluginLlmMessage {
  role: string;
  content: string | ChatMessagePart[];
}

interface PluginSubagentSpawnParams {
  name?: string;
  description?: string;
  subagentType?: string;
  providerId?: string;
  modelId?: string;
  system?: string;
  toolNames?: string[];
  variant?: string;
  providerOptions?: JsonObject;
  headers?: Record<string, string>;
  maxOutputTokens?: number;
  maxConversationSubagents?: number;
  messages: PluginLlmMessage[];
}

interface PluginSubagentRequest {
  name?: string;
  description?: string;
  subagentType?: string;
  providerId?: string;
  modelId?: string;
  system?: string;
  toolNames?: string[];
  variant?: string;
  providerOptions?: JsonObject;
  headers?: Record<string, string>;
  maxOutputTokens?: number;
  messages: PluginLlmMessage[];
}

interface PluginSubagentExecutionResult {
  finishReason?: string | null;
  message: { content: string; role: string };
  modelId: string;
  providerId: string;
  text: string;
  toolCalls: { toolCallId: string; toolName: string; input: JsonValue }[];
  toolResults: { toolCallId: string; toolName: string; output: JsonValue }[];
}

interface SubagentBeforeRunHookResult {
  action: 'pass' | 'short-circuit' | 'mutate';
  text?: string;
  finishReason?: string;
  modelId?: string;
  providerId?: string;
  system?: string | null;
  messages?: PluginLlmMessage[];
  toolNames?: string[] | null;
  variant?: string | null;
  providerOptions?: JsonObject | null;
  headers?: Record<string, string> | null;
  maxOutputTokens?: number;
  toolCalls?: { toolCallId: string; toolName: string; input: JsonValue }[];
  toolResults?: { toolCallId: string; toolName: string; output: JsonValue }[];
}

interface ConversationSubagentState {
  activeAssistantMessageId?: string;
  closedAt?: string;
  description?: string | null;
  error?: string;
  finishedAt?: string | null;
  modelId?: string;
  pluginDisplayName?: string;
  pluginId: string;
  providerId?: string;
  requestPreview?: string;
  requestedAt?: string;
  resultPreview?: string | null;
  runtimeKind: string;
  startedAt?: string | null;
  status: string;
  subagentType?: string;
  subagentTypeName?: string;
  system?: string;
  toolNames?: string[];
  variant?: string;
  name?: string;
}

interface RuntimeConversationRecord {
  id: string;
  kind?: string;
  parentId?: string;
  title?: string;
  userId?: string;
  updatedAt?: string;
  activePersonaId?: string;
  subagent?: ConversationSubagentState;
  messages: {
    id?: string;
    role: string;
    content?: string;
    status?: string;
    model?: string;
    provider?: string;
    parts?: ChatMessagePart[];
    toolCalls?: unknown;
    toolResults?: unknown;
    finishReason?: unknown;
    createdAt?: string;
    updatedAt?: string;
  }[];
}

interface PluginCallContext {
  conversationId: string;
  source: string;
  userId?: string;
  activePersonaId?: string;
  activeModelId?: string;
  activeProviderId?: string;
}

interface PluginSubagentHandle {
  conversationId: string;
  name?: string;
  status: string;
  title: string;
}

interface PluginSubagentSummary {
  closedAt?: string;
  conversationId: string;
  description?: string | null;
  error?: string;
  finishedAt?: string | null;
  messageCount: number;
  modelId?: string;
  parentConversationId?: string;
  pluginDisplayName?: string;
  pluginId: string;
  providerId?: string;
  requestPreview?: string;
  resultPreview?: string;
  requestedAt?: string;
  runtimeKind: string;
  startedAt?: string | null;
  status: string;
  subagentType?: string;
  subagentTypeName?: string;
  title?: string;
  updatedAt?: string;
  userId?: string;
}

interface PluginSubagentDetail {
  context: PluginCallContext;
  request: {
    name?: string;
    description?: string;
    subagentType?: string;
    providerId?: string;
    modelId?: string;
    system?: string;
    messages?: PluginLlmMessage[];
    toolNames?: string[];
    variant?: string;
    providerOptions?: JsonObject;
    headers?: Record<string, string>;
    maxOutputTokens?: number;
  };
  result: PluginSubagentExecutionResult | null;
}

interface PluginSubagentWaitResult {
  conversationId: string;
  name?: string;
  status: string;
  title: string;
  error?: string;
  result?: string;
}

interface PluginSubagentWaitParams {
  conversationId: string;
  timeoutMs?: number | null;
}

interface PluginSubagentCloseParams {
  conversationId: string;
}

interface PluginSubagentSendInputParams {
  conversationId: string;
  messages: PluginLlmMessage[];
  name?: string | null;
  description?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  system?: string | null;
  toolNames?: string[] | null;
  variant?: string | null;
  providerOptions?: JsonObject | null;
  headers?: Record<string, string> | null;
  maxOutputTokens?: number | null;
}

interface PluginSubagentConfig {
  maxConversationSubagents?: number;
  targetSubagentType?: string;
  targetProviderId?: string;
  targetModelId?: string;
  allowedToolNames?: string[];
}

// ─── 内联纯函数 ───

// ===================== From subagent-settings.service.ts =====================

const MAX_CONFIG_INTEGER = 1_000_000;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function writeOptionalText(target: JsonObject, key: string, value: unknown): void {
  if (typeof value !== 'string') {
    return;
  }
  const normalized = value.trim();
  if (normalized) {
    target[key] = normalized;
  }
}

function readPositiveInteger(value: unknown, fieldName: string): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value <= 0) {
    throw new Error(`${fieldName} 必须是大于 0 的整数`);
  }
  return Math.min(value, MAX_CONFIG_INTEGER);
}

function sanitizeSubagentLlmConfig(values: JsonObject): JsonObject | null {
  const next: JsonObject = {};
  writeOptionalText(next, 'targetSubagentType', values.targetSubagentType);
  writeOptionalText(next, 'targetProviderId', values.targetProviderId);
  writeOptionalText(next, 'targetModelId', values.targetModelId);
  return Object.keys(next).length > 0 ? next : null;
}

function sanitizeSubagentSessionConfig(values: JsonObject): JsonObject | null {
  const next: JsonObject = {};
  if (values.maxConversationSubagents !== undefined) {
    next.maxConversationSubagents = readPositiveInteger(
      values.maxConversationSubagents,
      'subagent.session.maxConversationSubagents',
    );
  }
  return Object.keys(next).length > 0 ? next : null;
}

function sanitizeSubagentToolConfig(values: JsonObject): JsonObject | null {
  const allowedToolNames = Array.isArray(values.allowedToolNames)
    ? values.allowedToolNames
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
    : [];
  return allowedToolNames.length > 0
    ? { allowedToolNames }
    : null;
}

function sanitizeSubagentConfig(values: JsonObject): JsonObject {
  const next: JsonObject = {};
  const llm = isJsonObject(values.llm) ? sanitizeSubagentLlmConfig(values.llm) : null;
  const session = isJsonObject(values.session) ? sanitizeSubagentSessionConfig(values.session) : null;
  const tools = isJsonObject(values.tools) ? sanitizeSubagentToolConfig(values.tools) : null;
  if (llm) next.llm = llm;
  if (session) next.session = session;
  if (tools) next.tools = tools;
  return next;
}

function readStoredSubagentConfig(config: JsonObject): PluginSubagentConfig {
  const llm = isJsonObject(config.llm) ? config.llm : null;
  const session = isJsonObject(config.session) ? config.session : null;
  const tools = isJsonObject(config.tools) ? config.tools : null;
  const allowedToolNames = Array.isArray(tools?.allowedToolNames)
    ? tools.allowedToolNames.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  return {
    ...(typeof llm?.targetSubagentType === 'string' ? { targetSubagentType: llm.targetSubagentType } : {}),
    ...(typeof llm?.targetProviderId === 'string' ? { targetProviderId: llm.targetProviderId } : {}),
    ...(typeof llm?.targetModelId === 'string' ? { targetModelId: llm.targetModelId } : {}),
    ...(typeof session?.maxConversationSubagents === 'number' ? { maxConversationSubagents: session.maxConversationSubagents } : {}),
    ...(allowedToolNames.length > 0 ? { allowedToolNames } : {}),
  };
}

function loadSubagentConfig(configPath: string): JsonObject {
  try {
    if (!fs.existsSync(configPath)) {
      return {};
    }
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return sanitizeSubagentConfig(isJsonObject(parsed) ? parsed : {});
  } catch {
    return {};
  }
}

function persistSubagentConfig(configPath: string, values: JsonObject): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(values, null, 2), 'utf-8');
}

// ===================== From subagent-tool.service.ts =====================

const SUBAGENT_TOOL_NAMES = new Set(['spawn_subagent', 'wait_subagent', 'send_input_subagent', 'interrupt_subagent', 'close_subagent']);

function readRequiredText(value: unknown, toolName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${toolName} 缺少必填字符串参数`);
  }
  return value.trim();
}

function readOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

// ===================== From subagent-runner.service.ts =====================

function normalizeSubagentTypeId(subagentType: string): string {
  const normalized = subagentType.trim();
  return normalized === 'default' ? 'general' : normalized;
}

function readSubagentRequestPreview(request: { description?: string | null; messages: PluginLlmMessage[] }): string {
  const lastMessage = request.messages.at(-1);
  const content = lastMessage?.content;
  if (typeof content === 'string' && content.trim()) {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const text = content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join('\n')
      .trim();
    if (text) {
      return text;
    }
  }
  return request.description ?? 'structured subagent request';
}

function readSubagentConversationTitle(
  request: { name?: string; description?: string },
  subagentTypeName?: string,
): string {
  return request.name?.trim()
    || request.description?.trim()
    || subagentTypeName?.trim()
    || '子代理';
}

function createSubagentContext(conversation: RuntimeConversationRecord): PluginCallContext {
  return {
    ...(conversation.activePersonaId ? { activePersonaId: conversation.activePersonaId } : {}),
    ...(conversation.subagent?.modelId ? { activeModelId: conversation.subagent.modelId } : {}),
    ...(conversation.subagent?.providerId ? { activeProviderId: conversation.subagent.providerId } : {}),
    conversationId: conversation.id,
    source: 'http-route',
    userId: conversation.userId,
  };
}

function requireConversationSubagent(conversation: RuntimeConversationRecord): ConversationSubagentState {
  if (!conversation.subagent) {
    throw new Error(`Subagent conversation not found: ${conversation.id}`);
  }
  return conversation.subagent;
}

function readConversationActiveAssistantMessageId(conversation: RuntimeConversationRecord): string | null {
  if (typeof conversation.subagent?.activeAssistantMessageId === 'string' && conversation.subagent.activeAssistantMessageId.trim()) {
    return conversation.subagent.activeAssistantMessageId;
  }
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    if (message.role !== 'assistant') {
      continue;
    }
    if (message.status === 'pending' || message.status === 'streaming') {
      return typeof message.id === 'string' ? message.id : null;
    }
  }
  return null;
}

function readConversationExecutionResult(conversation: RuntimeConversationRecord): PluginSubagentExecutionResult | null {
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index];
    if (message.role !== 'assistant') {
      continue;
    }
    return {
      ...(message.finishReason !== undefined ? { finishReason: message.finishReason === null ? null : String(message.finishReason) } : {}),
      message: { content: typeof message.content === 'string' ? message.content : '', role: 'assistant' },
      modelId: typeof message.model === 'string' ? message.model : conversation.subagent?.modelId ?? 'unknown-model',
      providerId: typeof message.provider === 'string' ? message.provider : conversation.subagent?.providerId ?? 'unknown-provider',
      text: typeof message.content === 'string' ? message.content : '',
      toolCalls: readStoredToolCalls(message.toolCalls),
      toolResults: readStoredToolResults(message.toolResults),
    };
  }
  return null;
}

function readStoredToolCalls(value: unknown): { toolCallId: string; toolName: string; input: JsonValue }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
    const obj = entry as Record<string, unknown>;
    return typeof obj.toolCallId === 'string' && typeof obj.toolName === 'string'
      ? [{ input: asJsonValue(obj.input ?? null), toolCallId: obj.toolCallId, toolName: obj.toolName }]
      : [];
  });
}

function readStoredToolResults(value: unknown): { toolCallId: string; toolName: string; output: JsonValue }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return [];
    const obj = entry as Record<string, unknown>;
    return typeof obj.toolCallId === 'string' && typeof obj.toolName === 'string'
      ? [{ output: asJsonValue(obj.output ?? null), toolCallId: obj.toolCallId, toolName: obj.toolName }]
      : [];
  });
}

function asJsonValue(value: unknown): JsonValue {
  if (value === undefined) {
    return null;
  }
  if (isJsonObject(value as Record<string, unknown>)) {
    const result: JsonObject = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      result[key] = asJsonValue((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => asJsonValue(entry));
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }
  return null;
}

function normalizePluginMessageContent(content: string | ChatMessagePart[]): { content: string; parts: ChatMessagePart[] } {
  if (Array.isArray(content)) {
    return {
      content: content.filter((part): part is { type: 'text'; text: string } => part.type === 'text').map((part) => part.text).join('\n'),
      parts: structuredClone(content) as ChatMessagePart[],
    };
  }
  return {
    content,
    parts: content.trim() ? [{ text: content, type: 'text' }] : [],
  };
}

function readSubagentBeforeRunResponse(request: PluginSubagentRequest, response: SubagentBeforeRunHookResult): { shortCircuitResult: PluginSubagentExecutionResult } | { state: PluginSubagentRequest } {
  if (response.action === 'short-circuit') {
    return {
      shortCircuitResult: {
        ...(response.finishReason !== undefined ? { finishReason: response.finishReason } : {}),
        message: { content: response.text ?? '', role: 'assistant' },
        modelId: response.modelId ?? request.modelId ?? 'unknown-model',
        providerId: response.providerId ?? request.providerId ?? 'unknown-provider',
        text: response.text ?? '',
        toolCalls: response.toolCalls ?? [],
        toolResults: response.toolResults ?? [],
      },
    };
  }
  if (response.action === 'pass') {
    return { state: structuredClone(request) as PluginSubagentRequest };
  }
  return {
    state: {
      ...(structuredClone(request) as PluginSubagentRequest),
      ...(typeof response.providerId === 'string' ? { providerId: response.providerId } : {}),
      ...(typeof response.modelId === 'string' ? { modelId: response.modelId } : {}),
      ...('system' in response ? { system: response.system ?? undefined } : {}),
      ...(Array.isArray(response.messages) ? { messages: response.messages } : {}),
      ...('toolNames' in response ? { toolNames: response.toolNames ?? undefined } : {}),
      ...('variant' in response ? { variant: response.variant ?? undefined } : {}),
      ...('providerOptions' in response ? { providerOptions: response.providerOptions ?? undefined } : {}),
      ...('headers' in response ? { headers: response.headers ?? undefined } : {}),
      ...('maxOutputTokens' in response && typeof response.maxOutputTokens === 'number' ? { maxOutputTokens: response.maxOutputTokens } : {}),
    },
  };
}

function applySubagentAfterRunMutation(nextResult: PluginSubagentExecutionResult, mutation: { action: 'mutate'; text?: string; modelId?: string; providerId?: string; finishReason?: string | null; toolCalls?: { toolCallId: string; toolName: string; input: JsonValue }[]; toolResults?: { toolCallId: string; toolName: string; output: JsonValue }[] }): PluginSubagentExecutionResult {
  const text = typeof mutation.text === 'string' ? mutation.text : nextResult.text;
  return {
    ...(structuredClone(nextResult) as PluginSubagentExecutionResult),
    ...(typeof mutation.providerId === 'string' ? { providerId: mutation.providerId } : {}),
    ...(typeof mutation.modelId === 'string' ? { modelId: mutation.modelId } : {}),
    ...('finishReason' in mutation ? { finishReason: mutation.finishReason ?? undefined } : {}),
    ...(Array.isArray(mutation.toolCalls) ? { toolCalls: mutation.toolCalls } : {}),
    ...(Array.isArray(mutation.toolResults) ? { toolResults: mutation.toolResults } : {}),
    ...(typeof mutation.text === 'string' ? { message: { ...nextResult.message, content: text }, text } : {}),
  };
}

function normalizeResolvedSubagentExecution(
  value: { result: PluginSubagentExecutionResult; continuationState: { hasAssistantTextOutput: boolean; hasToolActivity: boolean } } | PluginSubagentExecutionResult,
): { result: PluginSubagentExecutionResult; continuationState: { hasAssistantTextOutput: boolean; hasToolActivity: boolean } } {
  if ('result' in value && 'continuationState' in value) {
    return value;
  }
  return {
    continuationState: {
      hasAssistantTextOutput: typeof value.text === 'string' && value.text.trim().length > 0,
      hasToolActivity: value.toolCalls.length > 0 || value.toolResults.length > 0,
    },
    result: value,
  };
}

function compactSubagentToolResultOutput(value: unknown): JsonValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return asJsonValue(value);
  }
  const record = value as Record<string, unknown>;
  if ((record.kind === 'tool:text' && typeof record.value === 'string') || record.kind === 'tool:json') {
    return asJsonValue({
      kind: record.kind,
      value: asJsonValue(record.value ?? null),
    });
  }
  return asJsonValue(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSubagentSpawnRequest(params: JsonObject): PluginSubagentSpawnParams {
  const providerOptions = isJsonObject(params.providerOptions) ? params.providerOptions : null;
  const headers = params.headers;
  const headerRecord: Record<string, string> | null = isJsonObject(headers as Record<string, unknown>)
    ? Object.fromEntries(
        Object.entries(headers as Record<string, unknown>)
          .filter(([_, v]) => typeof v === 'string')
      ) as Record<string, string>
    : null;
  return {
    ...(typeof params.name === 'string' && params.name.trim() ? { name: params.name.trim() } : {}),
    ...(typeof params.description === 'string' && params.description.trim() ? { description: params.description.trim() } : {}),
    ...(typeof params.subagentType === 'string' && params.subagentType.trim() ? { subagentType: params.subagentType.trim() } : {}),
    ...(typeof params.providerId === 'string' ? { providerId: params.providerId } : {}),
    ...(typeof params.modelId === 'string' ? { modelId: params.modelId } : {}),
    ...(typeof params.system === 'string' ? { system: params.system } : {}),
    ...(Array.isArray(params.toolNames) ? { toolNames: params.toolNames.filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0) } : {}),
    ...(typeof params.variant === 'string' ? { variant: params.variant } : {}),
    ...(providerOptions ? { providerOptions } : {}),
    ...(headerRecord && Object.keys(headerRecord).length > 0 ? { headers: headerRecord } : {}),
    ...(typeof params.maxOutputTokens === 'number' ? { maxOutputTokens: params.maxOutputTokens } : {}),
    ...(typeof params.maxConversationSubagents === 'number' ? { maxConversationSubagents: params.maxConversationSubagents } : {}),
    messages: (Array.isArray(params.messages) ? params.messages : []) as PluginLlmMessage[],
  };
}

function createStoredConversationMessage(message: PluginLlmMessage, timestamp: string, status: 'completed' | 'pending'): JsonObject {
  const normalizedContent = normalizePluginMessageContent(message.content);
  const id = `test-uuid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    content: normalizedContent.content,
    createdAt: timestamp,
    id,
    ...(normalizedContent.parts.length > 0 ? { parts: normalizedContent.parts } : {}),
    role: message.role,
    status,
    updatedAt: timestamp,
  };
}

// ========================================================================
// 测试
// ========================================================================

describe('子代理运行时系统', () => {

  // ── 1. subagent-settings 配置 sanitization ──

  describe('1. SubagentSettings 配置 sanitization', () => {
    describe('writeOptionalText', () => {
      it('写入合法字符串', () => {
        const target: JsonObject = {};
        writeOptionalText(target, 'name', 'hello');
        expect(target.name).toBe('hello');
      });

      it('trim 字符串', () => {
        const target: JsonObject = {};
        writeOptionalText(target, 'name', '  hello  ');
        expect(target.name).toBe('hello');
      });

      it('空字符串不写入', () => {
        const target: JsonObject = {};
        writeOptionalText(target, 'name', '');
        expect(target).not.toHaveProperty('name');
      });

      it('空白字符串不写入', () => {
        const target: JsonObject = {};
        writeOptionalText(target, 'name', '   ');
        expect(target).not.toHaveProperty('name');
      });

      it('非字符串不写入', () => {
        const target: JsonObject = {};
        writeOptionalText(target, 'name', 42);
        writeOptionalText(target, 'name', null);
        writeOptionalText(target, 'name', undefined);
        expect(target).not.toHaveProperty('name');
      });
    });

    describe('readPositiveInteger', () => {
      it('合法正数', () => {
        expect(readPositiveInteger(5, 'test')).toBe(5);
      });

      it('上限钳制', () => {
        expect(readPositiveInteger(MAX_CONFIG_INTEGER + 100, 'test')).toBe(MAX_CONFIG_INTEGER);
      });

      it('0 抛出错误', () => {
        expect(() => readPositiveInteger(0, 'test')).toThrow('test 必须是大于 0 的整数');
      });

      it('负数抛出错误', () => {
        expect(() => readPositiveInteger(-1, 'test')).toThrow('test 必须是大于 0 的整数');
      });

      it('非整数抛出错误', () => {
        expect(() => readPositiveInteger(3.14, 'test')).toThrow('test 必须是大于 0 的整数');
      });

      it('非数字抛出错误', () => {
        expect(() => readPositiveInteger('5', 'test')).toThrow('test 必须是大于 0 的整数');
        expect(() => readPositiveInteger(null, 'test')).toThrow('test 必须是大于 0 的整数');
      });
    });

    describe('sanitizeSubagentLlmConfig', () => {
      it('完整字段', () => {
        const result = sanitizeSubagentLlmConfig({ targetSubagentType: 'explore', targetProviderId: 'openai', targetModelId: 'gpt-4' });
        expect(result).toEqual({ targetSubagentType: 'explore', targetProviderId: 'openai', targetModelId: 'gpt-4' });
      });

      it('trim 字段值', () => {
        const result = sanitizeSubagentLlmConfig({ targetSubagentType: '  explore  ' });
        expect(result!.targetSubagentType).toBe('explore');
      });

      it('空对象返回 null', () => {
        expect(sanitizeSubagentLlmConfig({})).toBeNull();
      });

      it('空字符串字段不产生属性', () => {
        const result = sanitizeSubagentLlmConfig({ targetSubagentType: '' });
        expect(result).toBeNull();
      });
    });

    describe('sanitizeSubagentSessionConfig', () => {
      it('合法 maxConversationSubagents', () => {
        const result = sanitizeSubagentSessionConfig({ maxConversationSubagents: 10 });
        expect(result).toEqual({ maxConversationSubagents: 10 });
      });

      it('undefined 时返回 null', () => {
        expect(sanitizeSubagentSessionConfig({})).toBeNull();
      });

      it('边界值 1', () => {
        const result = sanitizeSubagentSessionConfig({ maxConversationSubagents: 1 });
        expect(result!.maxConversationSubagents).toBe(1);
      });
    });

    describe('sanitizeSubagentToolConfig', () => {
      it('过滤合法 toolNames', () => {
        const result = sanitizeSubagentToolConfig({ allowedToolNames: ['read', 'write', ''] });
        expect(result).toEqual({ allowedToolNames: ['read', 'write'] });
      });

      it('trim toolNames', () => {
        const result = sanitizeSubagentToolConfig({ allowedToolNames: ['  read  ', 'write  '] });
        expect(result!.allowedToolNames).toEqual(['read', 'write']);
      });

      it('过滤非字符串条目', () => {
        const result = sanitizeSubagentToolConfig({ allowedToolNames: ['read', null, 42, true] });
        expect(result!.allowedToolNames).toEqual(['read']);
      });

      it('空数组返回 null', () => {
        expect(sanitizeSubagentToolConfig({ allowedToolNames: [] })).toBeNull();
      });

      it('undefined 返回 null', () => {
        expect(sanitizeSubagentToolConfig({})).toBeNull();
      });
    });

    describe('sanitizeSubagentConfig', () => {
      it('完整配置', () => {
        const result = sanitizeSubagentConfig({
          llm: { targetSubagentType: 'explore' },
          session: { maxConversationSubagents: 5 },
          tools: { allowedToolNames: ['read', 'webfetch'] },
        });
        expect(result).toEqual({
          llm: { targetSubagentType: 'explore' },
          session: { maxConversationSubagents: 5 },
          tools: { allowedToolNames: ['read', 'webfetch'] },
        });
      });

      it('空配置返回空对象', () => {
        expect(sanitizeSubagentConfig({})).toEqual({});
      });

      it('过滤无效子节', () => {
        const result = sanitizeSubagentConfig({
          llm: { targetSubagentType: '' },
          session: {},
          tools: { allowedToolNames: [] },
        });
        expect(result).toEqual({});
      });

      it('只保留有内容的节', () => {
        const result = sanitizeSubagentConfig({
          llm: { targetSubagentType: 'general' },
          session: {},
        });
        expect(result).toEqual({ llm: { targetSubagentType: 'general' } });
      });
    });

    describe('readStoredSubagentConfig', () => {
      it('完整配置读取', () => {
        const config = {
          llm: { targetSubagentType: 'explore', targetProviderId: 'openai', targetModelId: 'gpt-4' },
          session: { maxConversationSubagents: 5 },
          tools: { allowedToolNames: ['read', 'write'] },
        };
        const result = readStoredSubagentConfig(config);
        expect(result).toEqual({
          targetSubagentType: 'explore',
          targetProviderId: 'openai',
          targetModelId: 'gpt-4',
          maxConversationSubagents: 5,
          allowedToolNames: ['read', 'write'],
        });
      });

      it('空配置返回无字段', () => {
        expect(readStoredSubagentConfig({})).toEqual({});
      });

      it('过滤空 toolNames', () => {
        const config = { tools: { allowedToolNames: ['', '  '] } };
        const result = readStoredSubagentConfig(config);
        expect(result).not.toHaveProperty('allowedToolNames');
      });
    });

    describe('文件系统读写', () => {
      const tmpRoot = path.join(os.tmpdir(), `subagent-settings-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

      afterAll(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      });

      it('缺失文件返回空对象', () => {
        const result = loadSubagentConfig(path.join(tmpRoot, 'nonexistent.json'));
        expect(result).toEqual({});
      });

      it('写入并读取配置', () => {
        const configPath = path.join(tmpRoot, 'settings.json');
        const values: JsonObject = {
          llm: { targetSubagentType: 'explore' },
          session: { maxConversationSubagents: 6 },
        };
        persistSubagentConfig(configPath, values);
        const loaded = loadSubagentConfig(configPath);
        expect(loaded).toEqual(values);
      });

      it('损坏 JSON 返回空对象', () => {
        const badPath = path.join(tmpRoot, 'bad.json');
        fs.writeFileSync(badPath, '{bad json}', 'utf-8');
        const result = loadSubagentConfig(badPath);
        expect(result).toEqual({});
      });

      it('非对象 JSON 返回空对象', () => {
        const arrPath = path.join(tmpRoot, 'arr.json');
        fs.writeFileSync(arrPath, '[]', 'utf-8');
        const result = loadSubagentConfig(arrPath);
        expect(result).toEqual({});
      });
    });
  });

  // ── 2. SubagentToolService 工具函数 ──

  describe('2. SubagentToolService 参数校验', () => {
    describe('SUBAGENT_TOOL_NAMES', () => {
      it('包含 5 个工具名', () => {
        expect(SUBAGENT_TOOL_NAMES.size).toBe(5);
      });

      it('包含所有必需的工具', () => {
        expect(SUBAGENT_TOOL_NAMES.has('spawn_subagent')).toBe(true);
        expect(SUBAGENT_TOOL_NAMES.has('wait_subagent')).toBe(true);
        expect(SUBAGENT_TOOL_NAMES.has('send_input_subagent')).toBe(true);
        expect(SUBAGENT_TOOL_NAMES.has('interrupt_subagent')).toBe(true);
        expect(SUBAGENT_TOOL_NAMES.has('close_subagent')).toBe(true);
      });
    });

    describe('readRequiredText', () => {
      it('返回合法字符串', () => {
        expect(readRequiredText('hello', 'test')).toBe('hello');
      });

      it('trim 返回值', () => {
        expect(readRequiredText('  hello  ', 'test')).toBe('hello');
      });

      it('空字符串抛出错误', () => {
        expect(() => readRequiredText('', 'test')).toThrow('test 缺少必填字符串参数');
      });

      it('空白字符串抛出错误', () => {
        expect(() => readRequiredText('   ', 'test')).toThrow('test 缺少必填字符串参数');
      });

      it('非字符串抛出错误', () => {
        expect(() => readRequiredText(null, 'test')).toThrow('test 缺少必填字符串参数');
        expect(() => readRequiredText(42, 'test')).toThrow('test 缺少必填字符串参数');
        expect(() => readRequiredText(undefined, 'test')).toThrow('test 缺少必填字符串参数');
      });

      it('错误消息包含工具名', () => {
        expect(() => readRequiredText('', 'spawn_subagent')).toThrow('spawn_subagent 缺少必填字符串参数');
      });
    });

    describe('readOptionalText', () => {
      it('返回合法字符串', () => {
        expect(readOptionalText('hello')).toBe('hello');
      });

      it('trim 返回值', () => {
        expect(readOptionalText('  hello  ')).toBe('hello');
      });

      it('空字符串返回 undefined', () => {
        expect(readOptionalText('')).toBeUndefined();
      });

      it('空白字符串返回 undefined', () => {
        expect(readOptionalText('   ')).toBeUndefined();
      });

      it('非字符串返回 undefined', () => {
        expect(readOptionalText(null)).toBeUndefined();
        expect(readOptionalText(undefined)).toBeUndefined();
        expect(readOptionalText(42)).toBeUndefined();
      });
    });

    describe('SUBAGENT_TOOL_NAMES 校验', () => {
      it('已知工具名通过', () => {
        const toolNames = ['spawn_subagent', 'wait_subagent', 'send_input_subagent', 'interrupt_subagent', 'close_subagent'];
        for (const name of toolNames) {
          expect(SUBAGENT_TOOL_NAMES.has(name)).toBe(true);
        }
      });

      it('未知工具名被拒绝', () => {
        expect(SUBAGENT_TOOL_NAMES.has('unknown_tool')).toBe(false);
        expect(SUBAGENT_TOOL_NAMES.has('spawn')).toBe(false);
      });
    });
  });

  // ── 3. subagent-runner 纯函数 ──

  describe('3. SubagentRunner 纯函数', () => {
    describe('normalizeSubagentTypeId', () => {
      it('"default" 映射为 "general"', () => {
        expect(normalizeSubagentTypeId('default')).toBe('general');
      });

      it('"general" 保持不变', () => {
        expect(normalizeSubagentTypeId('general')).toBe('general');
      });

      it('"explore" 保持不变', () => {
        expect(normalizeSubagentTypeId('explore')).toBe('explore');
      });

      it('trim 输入', () => {
        expect(normalizeSubagentTypeId('  default  ')).toBe('general');
      });

      it('大小写敏感', () => {
        expect(normalizeSubagentTypeId('Default')).toBe('Default');
      });
    });

    describe('readSubagentRequestPreview', () => {
      it('从最后一条消息提取文本', () => {
        const result = readSubagentRequestPreview({
          description: null,
          messages: [{ role: 'user', content: 'Hello world' }],
        });
        expect(result).toBe('Hello world');
      });

      it('从 parts 数组提取文本', () => {
        const result = readSubagentRequestPreview({
          description: 'desc',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello from parts' }] }],
        });
        expect(result).toBe('Hello from parts');
      });

      it('从 description 回退', () => {
        const result = readSubagentRequestPreview({
          description: 'fallback description',
          messages: [{ role: 'user', content: '' }],
        });
        expect(result).toBe('fallback description');
      });

      it('无 description 回退默认', () => {
        const result = readSubagentRequestPreview({
          description: null,
          messages: [{ role: 'user', content: '' }],
        });
        expect(result).toBe('structured subagent request');
      });

      it('从 description 回退（null description）', () => {
        const result = readSubagentRequestPreview({
          description: null,
          messages: [{ role: 'user', content: '   ' }],
        });
        expect(result).toBe('structured subagent request');
      });

      it('多 text parts 合并', () => {
        const result = readSubagentRequestPreview({
          description: null,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Part 1' },
              { type: 'text', text: 'Part 2' },
              { type: 'image', text: 'image-data' },
            ],
          }],
        });
        expect(result).toBe('Part 1\nPart 2');
      });
    });

    describe('readSubagentConversationTitle', () => {
      it('使用 name', () => {
        expect(readSubagentConversationTitle({ name: 'My Agent', description: 'desc' })).toBe('My Agent');
      });

      it('name 为空时用 description', () => {
        expect(readSubagentConversationTitle({ name: '', description: 'My Description' })).toBe('My Description');
      });

      it('name 和 description 为空时用 subagentTypeName', () => {
        expect(readSubagentConversationTitle({ name: '', description: '' }, '探索')).toBe('探索');
      });

      it('全部为空时用默认', () => {
        expect(readSubagentConversationTitle({})).toBe('子代理');
      });

      it('trim 值', () => {
        expect(readSubagentConversationTitle({ name: '  My Agent  ' })).toBe('My Agent');
      });
    });

    describe('createSubagentContext', () => {
      it('基础上下文', () => {
        const conversation: RuntimeConversationRecord = {
          id: 'conv-1',
          userId: 'user-1',
          messages: [],
        };
        const ctx = createSubagentContext(conversation);
        expect(ctx.conversationId).toBe('conv-1');
        expect(ctx.userId).toBe('user-1');
        expect(ctx.source).toBe('http-route');
      });

      it('含 activePersonaId', () => {
        const conversation: RuntimeConversationRecord = {
          id: 'conv-1',
          activePersonaId: 'persona-1',
          messages: [],
        };
        const ctx = createSubagentContext(conversation);
        expect(ctx.activePersonaId).toBe('persona-1');
      });

      it('含 subagent 模型/提供者', () => {
        const conversation: RuntimeConversationRecord = {
          id: 'conv-1',
          subagent: { pluginId: 'plugin-1', runtimeKind: 'local', modelId: 'gpt-4', providerId: 'openai', status: 'running' },
          messages: [],
        };
        const ctx = createSubagentContext(conversation);
        expect(ctx.activeModelId).toBe('gpt-4');
        expect(ctx.activeProviderId).toBe('openai');
      });
    });

    describe('requireConversationSubagent', () => {
      it('存在 subagent 返回', () => {
        const subagent: ConversationSubagentState = { pluginId: 'p1', runtimeKind: 'local', status: 'running' };
        const conv: RuntimeConversationRecord = { id: 'c1', subagent, messages: [] };
        expect(requireConversationSubagent(conv)).toBe(subagent);
      });

      it('缺少 subagent 抛出错误', () => {
        const conv: RuntimeConversationRecord = { id: 'c1', messages: [] };
        expect(() => requireConversationSubagent(conv)).toThrow('Subagent conversation not found: c1');
      });
    });

    describe('readConversationActiveAssistantMessageId', () => {
      it('从 subagent.activeAssistantMessageId 读取', () => {
        const conv: RuntimeConversationRecord = {
          id: 'c1',
          subagent: { pluginId: 'p1', runtimeKind: 'local', status: 'running', activeAssistantMessageId: 'msg-1' },
          messages: [],
        };
        expect(readConversationActiveAssistantMessageId(conv)).toBe('msg-1');
      });

      it('从 pending assistant 消息读取', () => {
        const conv: RuntimeConversationRecord = {
          id: 'c1',
          subagent: { pluginId: 'p1', runtimeKind: 'local', status: 'running' },
          messages: [
            { role: 'user', content: 'hi' },
            { id: 'msg-pending', role: 'assistant', status: 'pending' },
          ],
        };
        expect(readConversationActiveAssistantMessageId(conv)).toBe('msg-pending');
      });

      it('从 streaming assistant 消息读取', () => {
        const conv: RuntimeConversationRecord = {
          id: 'c1',
          subagent: { pluginId: 'p1', runtimeKind: 'local', status: 'running' },
          messages: [
            { id: 'msg-streaming', role: 'assistant', status: 'streaming' },
          ],
        };
        expect(readConversationActiveAssistantMessageId(conv)).toBe('msg-streaming');
      });

      it('无匹配返回 null', () => {
        const conv: RuntimeConversationRecord = {
          id: 'c1',
          subagent: { pluginId: 'p1', runtimeKind: 'local', status: 'completed' },
          messages: [
            { role: 'user', content: 'hi' },
            { id: 'msg-complete', role: 'assistant', status: 'completed' },
          ],
        };
        expect(readConversationActiveAssistantMessageId(conv)).toBeNull();
      });

      it('无 subagent 时回退查找', () => {
        const conv: RuntimeConversationRecord = {
          id: 'c1',
          messages: [
            { id: 'msg-1', role: 'assistant', status: 'streaming' },
          ],
        };
        expect(readConversationActiveAssistantMessageId(conv)).toBe('msg-1');
      });

      it('空 activeAssistantMessageId 回退查找', () => {
        const conv: RuntimeConversationRecord = {
          id: 'c1',
          subagent: { pluginId: 'p1', runtimeKind: 'local', status: 'running', activeAssistantMessageId: '' },
          messages: [
            { id: 'msg-1', role: 'assistant', status: 'pending' },
          ],
        };
        expect(readConversationActiveAssistantMessageId(conv)).toBe('msg-1');
      });
    });

    describe('readConversationExecutionResult', () => {
      it('从最新 assistant 消息读取', () => {
        const conv: RuntimeConversationRecord = {
          id: 'c1',
          subagent: { pluginId: 'p1', runtimeKind: 'local', status: 'completed', modelId: 'gpt-4', providerId: 'openai' },
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'Hello!', model: 'gpt-4', provider: 'openai', finishReason: 'stop' },
          ],
        };
        const result = readConversationExecutionResult(conv);
        expect(result).not.toBeNull();
        expect(result!.text).toBe('Hello!');
        expect(result!.modelId).toBe('gpt-4');
        expect(result!.providerId).toBe('openai');
        expect(result!.finishReason).toBe('stop');
      });

      it('忽略 user 消息', () => {
        const conv: RuntimeConversationRecord = {
          id: 'c1',
          subagent: { pluginId: 'p1', runtimeKind: 'local', status: 'completed' },
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'user', content: 'hello again' },
          ],
        };
        expect(readConversationExecutionResult(conv)).toBeNull();
      });

      it('从 subagent 回退 model/provider', () => {
        const conv: RuntimeConversationRecord = {
          id: 'c1',
          subagent: { pluginId: 'p1', runtimeKind: 'local', status: 'completed', modelId: 'gpt-4', providerId: 'openai' },
          messages: [
            { role: 'assistant', content: 'Hello!' },
          ],
        };
        const result = readConversationExecutionResult(conv);
        expect(result!.modelId).toBe('gpt-4');
        expect(result!.providerId).toBe('openai');
      });

      it('无 assistant 消息返回 null', () => {
        const conv: RuntimeConversationRecord = { id: 'c1', messages: [] };
        expect(readConversationExecutionResult(conv)).toBeNull();
      });

      it('提取 toolCalls 和 toolResults', () => {
        const conv: RuntimeConversationRecord = {
          id: 'c1',
          subagent: { pluginId: 'p1', runtimeKind: 'local', status: 'completed' },
          messages: [
            {
              role: 'assistant',
              content: 'Running tools',
              toolCalls: [{ toolCallId: 'tc-1', toolName: 'read', input: { path: '/tmp' } }],
              toolResults: [{ toolCallId: 'tc-1', toolName: 'read', output: { content: 'file content' } }],
            },
          ],
        };
        const result = readConversationExecutionResult(conv);
        expect(result!.toolCalls).toHaveLength(1);
        expect(result!.toolCalls[0].toolCallId).toBe('tc-1');
        expect(result!.toolResults).toHaveLength(1);
        expect(result!.toolResults[0].toolName).toBe('read');
      });

      it('null finishReason', () => {
        const conv: RuntimeConversationRecord = {
          id: 'c1',
          subagent: { pluginId: 'p1', runtimeKind: 'local', status: 'completed' },
          messages: [
            { role: 'assistant', content: 'Done', finishReason: null },
          ],
        };
        const result = readConversationExecutionResult(conv);
        expect(result!.finishReason).toBeNull();
      });
    });

    describe('readStoredToolCalls', () => {
      it('合法 toolCalls', () => {
        const result = readStoredToolCalls([
          { toolCallId: 'tc-1', toolName: 'read', input: { path: '/tmp' } },
        ]);
        expect(result).toHaveLength(1);
        expect(result[0].toolCallId).toBe('tc-1');
      });

      it('非数组返回空', () => {
        expect(readStoredToolCalls(null)).toEqual([]);
        expect(readStoredToolCalls(undefined)).toEqual([]);
        expect(readStoredToolCalls('bad')).toEqual([]);
      });

      it('过滤非法条目', () => {
        const result = readStoredToolCalls([
          { toolCallId: 'tc-1', toolName: 'read' },
          { toolName: 'write' },
          { toolCallId: 'tc-3' },
          null,
          'string',
        ]);
        expect(result).toHaveLength(1);
        expect(result[0].toolCallId).toBe('tc-1');
      });
    });

    describe('readStoredToolResults', () => {
      it('合法 toolResults', () => {
        const result = readStoredToolResults([
          { toolCallId: 'tc-1', toolName: 'read', output: { content: 'data' } },
        ]);
        expect(result).toHaveLength(1);
        expect(result[0].toolCallId).toBe('tc-1');
      });

      it('非数组返回空', () => {
        expect(readStoredToolResults(null)).toEqual([]);
      });

      it('过滤非法条目', () => {
        const result = readStoredToolResults([
          { toolCallId: 'tc-1', toolName: 'read' },
          { toolName: 'write' },
        ]);
        expect(result).toHaveLength(1);
      });
    });

    describe('normalizePluginMessageContent', () => {
      it('字符串 content', () => {
        const result = normalizePluginMessageContent('Hello');
        expect(result.content).toBe('Hello');
        expect(result.parts).toHaveLength(1);
        expect(result.parts[0].type).toBe('text');
      });

      it('空字符串 content', () => {
        const result = normalizePluginMessageContent('');
        expect(result.content).toBe('');
        expect(result.parts).toEqual([]);
      });

      it('parts 数组', () => {
        const parts: ChatMessagePart[] = [
          { type: 'text', text: 'Hello' },
          { type: 'image', text: 'base64data' },
        ];
        const result = normalizePluginMessageContent(parts);
        expect(result.content).toBe('Hello');
        expect(result.parts).toHaveLength(2);
      });

      it('空 parts 数组', () => {
        const result = normalizePluginMessageContent([]);
        expect(result.content).toBe('');
        expect(result.parts).toEqual([]);
      });

      it('非 text parts 不加入 content', () => {
        const parts: ChatMessagePart[] = [
          { type: 'image', text: 'imgdata' },
          { type: 'tool-result', text: 'result' },
        ];
        const result = normalizePluginMessageContent(parts);
        expect(result.content).toBe('');
        expect(result.parts).toHaveLength(2);
      });
    });

    describe('readSubagentBeforeRunResponse', () => {
      const baseRequest: PluginSubagentRequest = { messages: [{ role: 'user', content: 'test' }] };

      it('pass 返回克隆的 state', () => {
        const result = readSubagentBeforeRunResponse(baseRequest, { action: 'pass' });
        expect('state' in result).toBe(true);
        if ('state' in result) {
          expect(result.state.messages).toEqual(baseRequest.messages);
        }
      });

      it('short-circuit 返回短路结果', () => {
        const result = readSubagentBeforeRunResponse(baseRequest, {
          action: 'short-circuit',
          text: 'Short circuited',
          modelId: 'gpt-4',
          providerId: 'openai',
          finishReason: 'stop',
        });
        if ('shortCircuitResult' in result) {
          expect(result.shortCircuitResult.text).toBe('Short circuited');
          expect(result.shortCircuitResult.modelId).toBe('gpt-4');
        }
      });

      it('mutate 合并字段', () => {
        const result = readSubagentBeforeRunResponse(baseRequest, {
          action: 'mutate',
          providerId: 'anthropic',
          modelId: 'claude-3',
          system: 'New system prompt',
        });
        if ('state' in result) {
          expect(result.state.providerId).toBe('anthropic');
          expect(result.state.modelId).toBe('claude-3');
          expect(result.state.system).toBe('New system prompt');
        }
      });

      it('mutate 含 maxOutputTokens', () => {
        const result = readSubagentBeforeRunResponse(baseRequest, {
          action: 'mutate',
          maxOutputTokens: 4096,
        });
        if ('state' in result) {
          expect(result.state.maxOutputTokens).toBe(4096);
        }
      });

      it('mutate 含 toolNames/headers/providerOptions', () => {
        const result = readSubagentBeforeRunResponse(baseRequest, {
          action: 'mutate',
          toolNames: ['read', 'write'],
          headers: { 'x-custom': 'value' },
          providerOptions: { temperature: 0.7 },
        });
        if ('state' in result) {
          expect(result.state.toolNames).toEqual(['read', 'write']);
          expect(result.state.headers).toEqual({ 'x-custom': 'value' });
          expect(result.state.providerOptions).toEqual({ temperature: 0.7 });
        }
      });

      it('short-circuit 使用 request fallback modelId/providerId', () => {
        const request: PluginSubagentRequest = { messages: [], modelId: 'fallback-model', providerId: 'fallback-provider' };
        const result = readSubagentBeforeRunResponse(request, { action: 'short-circuit', text: 'done' });
        if ('shortCircuitResult' in result) {
          expect(result.shortCircuitResult.modelId).toBe('fallback-model');
          expect(result.shortCircuitResult.providerId).toBe('fallback-provider');
        }
      });
    });

    describe('applySubagentAfterRunMutation', () => {
      const baseResult: PluginSubagentExecutionResult = {
        message: { content: 'original', role: 'assistant' },
        modelId: 'gpt-4',
        providerId: 'openai',
        text: 'original',
        toolCalls: [],
        toolResults: [],
      };

      it('直接返回（无变化）', () => {
        const result = applySubagentAfterRunMutation(baseResult, { action: 'mutate' });
        expect(result.text).toBe('original');
      });

      it('替换文本', () => {
        const result = applySubagentAfterRunMutation(baseResult, { action: 'mutate', text: 'mutated text' });
        expect(result.text).toBe('mutated text');
        expect(result.message.content).toBe('mutated text');
      });

      it('替换 provider 和 model', () => {
        const result = applySubagentAfterRunMutation(baseResult, { action: 'mutate', providerId: 'anthropic', modelId: 'claude-3' });
        expect(result.providerId).toBe('anthropic');
        expect(result.modelId).toBe('claude-3');
      });

      it('追加 toolCalls 和 toolResults', () => {
        const result = applySubagentAfterRunMutation(baseResult, {
          action: 'mutate',
          toolCalls: [{ toolCallId: 'tc-1', toolName: 'read', input: null }],
          toolResults: [{ toolCallId: 'tc-1', toolName: 'read', output: null }],
        });
        expect(result.toolCalls).toHaveLength(1);
        expect(result.toolResults).toHaveLength(1);
      });

      it('修改 finishReason', () => {
        const result = applySubagentAfterRunMutation(baseResult, { action: 'mutate', finishReason: 'length' });
        expect(result.finishReason).toBe('length');
      });

      it('finishReason 为 null 时清除', () => {
        const result = applySubagentAfterRunMutation(
          { ...baseResult, finishReason: 'stop' },
          { action: 'mutate', finishReason: null },
        );
        expect(result.finishReason).toBeUndefined();
      });
    });

    describe('normalizeResolvedSubagentExecution', () => {
      it('已解析格式不变', () => {
        const input = {
          continuationState: { hasAssistantTextOutput: true, hasToolActivity: false },
          result: {
            message: { content: 'hello', role: 'assistant' as const },
            modelId: 'gpt-4',
            providerId: 'openai',
            text: 'hello',
            toolCalls: [],
            toolResults: [],
          },
        };
        const output = normalizeResolvedSubagentExecution(input);
        expect(output).toBe(input);
      });

      it('从原始 result 推导 continuationState', () => {
        const result: PluginSubagentExecutionResult = {
          message: { content: 'hello', role: 'assistant' },
          modelId: 'gpt-4',
          providerId: 'openai',
          text: 'hello',
          toolCalls: [],
          toolResults: [],
        };
        const output = normalizeResolvedSubagentExecution(result);
        expect(output.result).toBe(result);
        expect(output.continuationState.hasAssistantTextOutput).toBe(true);
        expect(output.continuationState.hasToolActivity).toBe(false);
      });

      it('空文本的 hasAssistantTextOutput 为 false', () => {
        const result: PluginSubagentExecutionResult = {
          message: { content: '', role: 'assistant' },
          modelId: 'gpt-4',
          providerId: 'openai',
          text: '',
          toolCalls: [],
          toolResults: [],
        };
        const output = normalizeResolvedSubagentExecution(result);
        expect(output.continuationState.hasAssistantTextOutput).toBe(false);
      });

      it('有 toolActivity', () => {
        const result: PluginSubagentExecutionResult = {
          message: { content: '', role: 'assistant' },
          modelId: 'gpt-4',
          providerId: 'openai',
          text: '',
          toolCalls: [{ toolCallId: 'tc-1', toolName: 'read', input: null }],
          toolResults: [],
        };
        const output = normalizeResolvedSubagentExecution(result);
        expect(output.continuationState.hasToolActivity).toBe(true);
      });
    });

    describe('compactSubagentToolResultOutput', () => {
      it('非对象透传', () => {
        expect(compactSubagentToolResultOutput('string')).toEqual('string');
        expect(compactSubagentToolResultOutput(42)).toEqual(42);
        expect(compactSubagentToolResultOutput(null)).toEqual(null);
        expect(compactSubagentToolResultOutput(undefined)).toEqual(null);
      });

      it('数组透传', () => {
        expect(compactSubagentToolResultOutput([1, 2, 3])).toEqual([1, 2, 3]);
      });

      it('tool:text 压缩', () => {
        const result = compactSubagentToolResultOutput({ kind: 'tool:text', value: 'output text' }) as JsonObject;
        expect(result.kind).toBe('tool:text');
        expect(result.value).toBe('output text');
      });

      it('tool:json 压缩', () => {
        const result = compactSubagentToolResultOutput({ kind: 'tool:json', value: { data: 42 } }) as JsonObject;
        expect(result.kind).toBe('tool:json');
      });

      it('普通对象透传', () => {
        const result = compactSubagentToolResultOutput({ key: 'value', nested: { a: 1 } });
        expect(result).toEqual({ key: 'value', nested: { a: 1 } });
      });

      it('tool:text 但 value 非字符串透传完整', () => {
        const result = compactSubagentToolResultOutput({ kind: 'tool:text', value: 42 }) as JsonObject;
        expect(result.kind).toBe('tool:text');
      });
    });

    describe('isRecord', () => {
      it('纯对象返回 true', () => {
        expect(isRecord({})).toBe(true);
        expect(isRecord({ a: 1 })).toBe(true);
      });

      it('非对象返回 false', () => {
        expect(isRecord(null)).toBe(false);
        expect(isRecord(undefined)).toBe(false);
        expect(isRecord('string')).toBe(false);
        expect(isRecord(42)).toBe(false);
        expect(isRecord([1, 2])).toBe(false);
      });
    });

    describe('readSubagentSpawnRequest', () => {
      it('完整参数解析', () => {
        const result = readSubagentSpawnRequest({
          name: 'My Agent',
          description: 'A test agent',
          subagentType: 'explore',
          providerId: 'openai',
          modelId: 'gpt-4',
          system: 'You are a test agent.',
          toolNames: ['read', 'write'],
          variant: 'full',
          providerOptions: { temperature: 0.7 },
          headers: { 'x-custom': 'value' },
          maxOutputTokens: 4096,
          maxConversationSubagents: 3,
          messages: [{ role: 'user', content: 'Hello' }],
        });
        expect(result.name).toBe('My Agent');
        expect(result.subagentType).toBe('explore');
        expect(result.messages).toHaveLength(1);
        expect(result.maxOutputTokens).toBe(4096);
      });

      it('trim 字符串字段', () => {
        const result = readSubagentSpawnRequest({
          name: '  My Agent  ',
          messages: [{ role: 'user', content: 'test' }],
        });
        expect(result.name).toBe('My Agent');
      });

      it('过滤空 toolNames', () => {
        const result = readSubagentSpawnRequest({
          toolNames: ['read', '', '  ', 'write'],
          messages: [{ role: 'user', content: 'test' }],
        });
        expect(result.toolNames).toEqual(['read', 'write']);
      });

      it('空字符串 name 不包含', () => {
        const result = readSubagentSpawnRequest({
          name: '',
          messages: [{ role: 'user', content: 'test' }],
        });
        expect(result).not.toHaveProperty('name');
      });

      it('空白字符串 subagentType 不包含', () => {
        const result = readSubagentSpawnRequest({
          subagentType: '   ',
          messages: [{ role: 'user', content: 'test' }],
        });
        expect(result).not.toHaveProperty('subagentType');
      });

      it('缺失 messages 为空数组', () => {
        const result = readSubagentSpawnRequest({});
        expect(result.messages).toEqual([]);
      });

      it('空 headers 不包含', () => {
        const result = readSubagentSpawnRequest({
          messages: [{ role: 'user', content: 'test' }],
          headers: {},
        });
        expect(result).not.toHaveProperty('headers');
      });
    });

    describe('createStoredConversationMessage', () => {
      it('字符串 content', () => {
        const ts = '2026-01-01T00:00:00.000Z';
        const result = createStoredConversationMessage({ role: 'user', content: 'Hello' }, ts, 'completed');
        expect(result.role).toBe('user');
        expect(result.content).toBe('Hello');
        expect(result.createdAt).toBe(ts);
        expect(result.status).toBe('completed');
        expect(result.parts).toBeDefined();
      });

      it('parts content', () => {
        const ts = '2026-01-01T00:00:00.000Z';
        const result = createStoredConversationMessage(
          { role: 'assistant', content: [{ type: 'text', text: 'Part A' }, { type: 'text', text: 'Part B' }] },
          ts,
          'pending',
        );
        expect(result.role).toBe('assistant');
        expect(result.status).toBe('pending');
        expect(result.parts).toHaveLength(2);
      });
    });
  });

  // ── 4. 类型兼容性 ──

  describe('4. 类型兼容性', () => {
    it('PluginSubagentConfig 最小构造', () => {
      const config: PluginSubagentConfig = {};
      expect(config.maxConversationSubagents).toBeUndefined();
    });

    it('PluginSubagentConfig 全字段', () => {
      const config: PluginSubagentConfig = {
        maxConversationSubagents: 6,
        targetSubagentType: 'general',
        targetProviderId: 'openai',
        targetModelId: 'gpt-4',
        allowedToolNames: ['read', 'write'],
      };
      expect(config.maxConversationSubagents).toBe(6);
      expect(config.allowedToolNames).toHaveLength(2);
    });

    it('PluginSubagentSpawnParams 最小构造', () => {
      const params: PluginSubagentSpawnParams = { messages: [] };
      expect(params.messages).toEqual([]);
    });

    it('PluginSubagentWaitParams 最小构造', () => {
      const params: PluginSubagentWaitParams = { conversationId: 'conv-1' };
      expect(params.conversationId).toBe('conv-1');
      expect(params.timeoutMs).toBeUndefined();
    });

    it('PluginSubagentCloseParams 构造', () => {
      const params: PluginSubagentCloseParams = { conversationId: 'conv-1' };
      expect(params.conversationId).toBe('conv-1');
    });

    it('PluginSubagentHandle 构造', () => {
      const handle: PluginSubagentHandle = { conversationId: 'conv-1', status: 'running', title: 'Task' };
      expect(handle.status).toBe('running');
    });
  });

  // ── 5. 边界条件和极端输入 ──

  describe('5. 边界条件', () => {
    it('readSubagentSpawnRequest 超大 toolNames 数组', () => {
      const tools = Array.from({ length: 1000 }, (_, i) => `tool-${i}`);
      const result = readSubagentSpawnRequest({
        toolNames: tools,
        messages: [{ role: 'user', content: 'test' }],
      });
      expect(result.toolNames).toHaveLength(1000);
    });

    it('readPositiveInteger 超上限边界', () => {
      expect(readPositiveInteger(MAX_CONFIG_INTEGER, 'test')).toBe(MAX_CONFIG_INTEGER);
    });

    it('readSubagentRequestPreview 空 messages 数组', () => {
      const result = readSubagentRequestPreview({
        description: null,
        messages: [],
      });
      expect(result).toBe('structured subagent request');
    });

    it('readSubagentRequestPreview 大文本', () => {
      const longText = 'A'.repeat(10000);
      const result = readSubagentRequestPreview({
        description: null,
        messages: [{ role: 'user', content: longText }],
      });
      expect(result).toHaveLength(10000);
    });

    it('readSubagentConversationTitle 全空白', () => {
      const result = readSubagentConversationTitle({ name: '   ', description: '   ' });
      expect(result).toBe('子代理');
    });

    it('sanitizeSubagentToolConfig 非数组', () => {
      expect(sanitizeSubagentToolConfig({ allowedToolNames: 'not-array' as unknown as string[] })).toBeNull();
      expect(sanitizeSubagentToolConfig({ allowedToolNames: null as unknown as string[] })).toBeNull();
    });

    it('createSubagentContext userId undefined', () => {
      const conv: RuntimeConversationRecord = { id: 'c1', messages: [] };
      const ctx = createSubagentContext(conv);
      expect(ctx.userId).toBeUndefined();
    });

    it('readStoredToolCalls 大量非法条目', () => {
      const result = readStoredToolCalls(
        Array.from({ length: 100 }, () => ({ toolCallId: 'id', toolName: 'tool' })),
      );
      expect(result).toHaveLength(100);
    });

    it('readConversationExecutionResult 空 messages', () => {
      const conv: RuntimeConversationRecord = {
        id: 'c1',
        subagent: { pluginId: 'p1', runtimeKind: 'local', status: 'completed' },
        messages: [],
      };
      expect(readConversationExecutionResult(conv)).toBeNull();
    });

    it('normalizePluginMessageContent 长 content', () => {
      const long = 'B'.repeat(5000);
      const result = normalizePluginMessageContent(long);
      expect(result.content).toHaveLength(5000);
      expect(result.parts).toHaveLength(1);
    });
  });
});
