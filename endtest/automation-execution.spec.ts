import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── 类型定义（对齐 @garlic-claw/shared + 源码） ───

type ToolSourceKind = 'internal' | 'plugin' | 'mcp' | 'skill';
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

interface AutomationActionTargetRef {
  type: 'conversation';
  id: string;
  conversationMode?: 'existing' | 'cron_child';
  maxHistoryConversations?: number;
}

interface TriggerConfig {
  type: 'cron' | 'event' | 'manual';
  cron?: string;
  event?: string;
}

interface ActionConfig {
  type: 'device_command' | 'ai_message';
  sourceKind?: ToolSourceKind;
  sourceId?: string;
  plugin?: string;
  capability?: string;
  params?: JsonObject;
  message?: string;
  target?: AutomationActionTargetRef;
}

interface AutomationLogInfo {
  id: string;
  status: string;
  result: string | null;
  createdAt: string;
}

interface AutomationInfo {
  id: string;
  name: string;
  trigger: TriggerConfig;
  actions: ActionConfig[];
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  logs?: AutomationLogInfo[];
}

interface AutomationRunContext {
  automationId: string;
  conversationId?: string;
  source: 'automation';
  userId: string;
}

interface PersistedAutomationRecord {
  actions: ActionConfig[];
  cronRunConversationIds?: string[];
  createdAt: string;
  enabled: boolean;
  id: string;
  lastRunAt: string | null;
  logs: AutomationLogInfo[];
  name: string;
  trigger: TriggerConfig;
  updatedAt: string;
  userId: string;
}

interface RuntimeAutomationRecord extends PersistedAutomationRecord {
  executionConversationId?: string;
}

interface AutomationRunPlan {
  actions: ActionConfig[];
  automation: AutomationInfo;
  context: AutomationRunContext;
}

interface AutomationPersistenceFile {
  automations: Record<string, RuntimeAutomationRecord[]>;
  sequence: number;
}

// ─── 错误类（对齐 NestJS BadRequestException / NotFoundException 语义） ───

class AutomationError extends Error {
  constructor(message: string) { super(message); this.name = 'AutomationError'; }
}

// ─── 辅助函数（对齐 host-input.codec.ts） ───

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function asJsonValue<T>(value: T): JsonValue {
  return cloneJsonValue(value) as unknown as JsonValue;
}

function readJsonObject(value: unknown): JsonObject | null {
  return isJsonObject(value) ? cloneJsonValue(value) : null;
}

function isJsonArray(value: unknown): value is JsonValue[] {
  return Array.isArray(value) && value.every((entry) => isJsonValue(entry));
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every((entry) => isJsonValue(entry));
}

function isJsonValue(value: unknown): value is JsonValue {
  return value === null || typeof value === 'boolean' || typeof value === 'number'
    || typeof value === 'string' || isJsonArray(value) || isJsonObject(value);
}

function readOptionalString(params: JsonObject, key: string): string | null {
  const value = params[key];
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : null;
}

function readPositiveInteger(params: JsonObject, key: string): number | null {
  const value = params[key];
  if (value === undefined) { return null; }
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new AutomationError(`${key} 必须是正整数`);
  }
  return value;
}

function readRequiredString(params: JsonObject, key: string): string {
  const value = readOptionalString(params, key);
  if (value) { return value; }
  throw new AutomationError(`${key} 不能为空`);
}

// ─── 内联纯函数（对齐 automation.service.ts） ───

function readUserAutomations(
  automations: Map<string, RuntimeAutomationRecord[]>,
  userId: string,
): RuntimeAutomationRecord[] {
  return automations.get(userId) ?? [];
}

function readAllAutomations(
  automations: Map<string, RuntimeAutomationRecord[]>,
): RuntimeAutomationRecord[] {
  return [...automations.values()].flat();
}

function readEventAutomations(
  records: RuntimeAutomationRecord[],
  event: string,
): RuntimeAutomationRecord[] {
  return records.filter(
    (record) => record.enabled && record.trigger.type === 'event' && record.trigger.event === event,
  );
}

function readAutomationToolSourceKind(value: unknown): ToolSourceKind | null {
  return value === 'internal' || value === 'plugin' || value === 'mcp' || value === 'skill'
    ? value
    : null;
}

function readAutomationRunStatus(result: JsonValue): string {
  return typeof result === 'object' && result !== null
    && typeof (result as { status?: unknown }).status === 'string'
    ? (result as { status: string }).status
    : 'success';
}

function readAutomationConversationMode(
  target: JsonObject | null,
  index: number,
): 'cron_child' | 'existing' | null {
  if (!target || target.conversationMode === undefined) {
    return null;
  }
  if (target.conversationMode === 'existing' || target.conversationMode === 'cron_child') {
    return target.conversationMode;
  }
  throw new AutomationError(`actions[${index}].target.conversationMode 不合法`);
}

function readAutomationTrigger(params: JsonObject): TriggerConfig {
  const trigger = readJsonObject(params.trigger);
  if (!trigger) { throw new AutomationError('trigger 不能为空'); }
  if (trigger.type !== 'cron' && trigger.type !== 'event' && trigger.type !== 'manual') {
    throw new AutomationError('trigger.type 不合法');
  }
  return {
    type: trigger.type,
    ...(typeof trigger.cron === 'string' ? { cron: trigger.cron } : {}),
    ...(typeof trigger.event === 'string' ? { event: trigger.event } : {}),
  };
}

function readAutomationAction(value: JsonValue, index: number): ActionConfig {
  const action = readJsonObject(value);
  if (!action) { throw new AutomationError(`actions[${index}] 必须是对象`); }
  if (action.type !== 'device_command' && action.type !== 'ai_message') {
    throw new AutomationError(`actions[${index}].type 不合法`);
  }
  if (action.type === 'device_command') {
    const params = action.params === undefined ? undefined : readJsonObject(action.params);
    const capability = typeof action.capability === 'string' && action.capability.trim().length > 0
      ? action.capability : null;
    const plugin = typeof action.plugin === 'string' && action.plugin.trim().length > 0
      ? action.plugin : null;
    const sourceId = typeof action.sourceId === 'string' && action.sourceId.trim().length > 0
      ? action.sourceId.trim() : null;
    const sourceKind = readAutomationToolSourceKind(action.sourceKind);
    if (action.params !== undefined && !params) {
      throw new AutomationError(`actions[${index}].params 必须是对象`);
    }
    if (!capability || (!plugin && !(sourceKind && sourceId))) {
      throw new AutomationError(`actions[${index}].type 缺少必填字段`);
    }
    return {
      capability,
      ...(params ? { params } : {}),
      ...(plugin ? { plugin } : {}),
      ...(sourceId ? { sourceId } : {}),
      ...(sourceKind ? { sourceKind } : {}),
      type: action.type,
    };
  }
  const target = action.target ? readJsonObject(action.target) : null;
  if (action.target && (!target || target.type !== 'conversation' || typeof target.id !== 'string')) {
    throw new AutomationError(`actions[${index}].target 不合法`);
  }
  const conversationMode = readAutomationConversationMode(target, index);
  const maxHistoryConversations = target ? readPositiveInteger(target, 'maxHistoryConversations') : null;
  return {
    ...(typeof action.message === 'string' ? { message: action.message } : {}),
    ...(target && typeof target.id === 'string' ? {
      target: {
        id: target.id,
        ...(conversationMode ? { conversationMode } : {}),
        ...(maxHistoryConversations ? { maxHistoryConversations } : {}),
        type: 'conversation' as const,
      },
    } : {}),
    type: action.type,
  };
}

function readAutomationActions(params: JsonObject): ActionConfig[] {
  if (!Array.isArray(params.actions)) { throw new AutomationError('actions 必须是数组'); }
  return params.actions.map((entry: unknown, index: number) => readAutomationAction(entry as JsonValue, index));
}

function createAutomationRecord(
  userId: string,
  params: JsonObject,
  sequence: number,
): RuntimeAutomationRecord {
  const now = new Date().toISOString();
  return {
    actions: readAutomationActions(params),
    createdAt: now,
    cronRunConversationIds: [],
    enabled: true,
    id: `automation-${sequence}`,
    lastRunAt: null,
    logs: [],
    name: readRequiredString(params, 'name'),
    trigger: readAutomationTrigger(params),
    updatedAt: now,
    userId,
  };
}

function createAutomationLog(
  automation: PersistedAutomationRecord,
  createdAt: string,
  result: JsonValue,
): AutomationLogInfo {
  return {
    id: `automation-log-${automation.id}-${automation.logs.length + 1}`,
    status: readAutomationRunStatus(result),
    result: JSON.stringify(result),
    createdAt,
  };
}

function serializeAutomationRecord(automation: RuntimeAutomationRecord): JsonValue {
  const {
    cronRunConversationIds: _cronRunConversationIds,
    executionConversationId: _executionConversationId,
    userId: _userId,
    ...rest
  } = automation;
  return asJsonValue(rest);
}

function readIntervalCronDelay(expr: string): number | null {
  const match = expr.trim().match(/^(\d+)\s*(s|m|h)$/i);
  if (!match) { return null; }
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === 's') { return value * 1000; }
  const unitMs = unit === 'm' ? 60 * 1000 : unit === 'h' ? 60 * 60 * 1000 : null;
  return unitMs ? value * unitMs : null;
}

const DEFAULT_CRON_HISTORY_CONVERSATIONS = 10;

function readCronChildConversationTarget(
  actions: ActionConfig[],
): { maxHistoryConversations: number; parentConversationId: string } | null {
  for (const action of actions) {
    const target = action.target as (AutomationActionTargetRef & { conversationMode?: 'existing' | 'cron_child' }) | undefined;
    if (action.type !== 'ai_message' || target?.type !== 'conversation'
      || target.conversationMode !== 'cron_child') {
      continue;
    }
    return {
      maxHistoryConversations: target.maxHistoryConversations ?? DEFAULT_CRON_HISTORY_CONVERSATIONS,
      parentConversationId: target.id,
    };
  }
  return null;
}

function rewriteCronChildConversationAction(
  action: ActionConfig,
  conversationId: string,
): ActionConfig {
  const target = action.target as (AutomationActionTargetRef & { conversationMode?: 'existing' | 'cron_child' }) | undefined;
  if (action.type !== 'ai_message' || target?.type !== 'conversation'
    || target.conversationMode !== 'cron_child') {
    return cloneJsonValue(action);
  }
  return {
    ...cloneJsonValue(action),
    target: {
      id: conversationId,
      type: 'conversation',
    },
  };
}

function createAutomationRunConversationTitle(automationName: string, startedAt: string): string {
  return `${automationName} · ${startedAt.slice(0, 16).replace('T', ' ')}`;
}

function readAutomationState(
  storagePath: string,
  SINGLE_USER_ID: string,
): { automations: Map<string, RuntimeAutomationRecord[]>; migrated: boolean; sequence: number } {
  try {
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
    if (!fs.existsSync(storagePath)) {
      return { automations: new Map<string, RuntimeAutomationRecord[]>(), migrated: false, sequence: 0 };
    }
    const parsed = JSON.parse(fs.readFileSync(storagePath, 'utf-8')) as Partial<AutomationPersistenceFile>;
    const persistedAutomations = parsed.automations ?? {};
    const currentRecords = cloneJsonValue(persistedAutomations[SINGLE_USER_ID] ?? [])
      .filter((record: RuntimeAutomationRecord) => record.userId === SINGLE_USER_ID);
    const persistedCurrent = persistedAutomations[SINGLE_USER_ID] ?? [];
    return {
      automations: new Map(currentRecords.length > 0 ? [[SINGLE_USER_ID, currentRecords]] : []),
      migrated: Object.keys(persistedAutomations).length > (currentRecords.length > 0 ? 1 : 0)
        || currentRecords.length !== persistedCurrent.length,
      sequence: typeof parsed.sequence === 'number' ? parsed.sequence : 0,
    };
  } catch {
    return { automations: new Map<string, RuntimeAutomationRecord[]>(), migrated: false, sequence: 0 };
  }
}

// ─── 内联纯函数（对齐 automation-execution.service.ts） ───

function readAutomationConversationId(actions: ActionConfig[]): string | null {
  for (const action of actions) {
    if (action.type === 'ai_message'
      && action.target?.type === 'conversation'
      && typeof action.target.id === 'string'
      && action.target.id.trim()) {
      return action.target.id;
    }
  }
  return null;
}

function toAutomationInfo(automation: RuntimeAutomationRecord): AutomationInfo {
  const { logs: _logs, userId: _userId, ...rest } = automation;
  return {
    ...rest,
    actions: automation.actions.map((action) => cloneJsonValue(action)),
    trigger: cloneJsonValue(automation.trigger),
  };
}

function createAutomationRunPlan(automation: RuntimeAutomationRecord): AutomationRunPlan {
  const conversationId = automation.executionConversationId
    ?? readAutomationConversationId(automation.actions);
  return {
    actions: automation.actions.map((action) => cloneJsonValue(action)),
    automation: toAutomationInfo(automation),
    context: {
      automationId: automation.id,
      ...(conversationId ? { conversationId } : {}),
      source: 'automation',
      userId: automation.userId,
    },
  };
}

function readAutomationMessageTarget(
  result: JsonValue,
  fallbackTarget: { id: string; type: 'conversation' },
): { id: string; label?: string; type: 'conversation' } {
  const target = (
    result as {
      target?: { id?: unknown; label?: unknown; type?: unknown };
      userMessage?: { target?: { id?: unknown; label?: unknown; type?: unknown } };
    }
  ).target
    ?? (
      result as {
        userMessage?: { target?: { id?: unknown; label?: unknown; type?: unknown } };
      }
    ).userMessage?.target;
  if (target && typeof target.id === 'string' && target.type === 'conversation') {
    return {
      id: target.id,
      ...(typeof target.label === 'string' ? { label: target.label } : {}),
      type: 'conversation',
    };
  }
  return { id: fallbackTarget.id, type: fallbackTarget.type };
}

// ─── 测试 ───

describe('automation / readUserAutomations', () => {
  it('返回用户自动化列表', () => {
    const map = new Map<string, RuntimeAutomationRecord[]>();
    const record = { id: 'a1', userId: 'u1' } as RuntimeAutomationRecord;
    const record2 = { id: 'a2', userId: 'u1' } as RuntimeAutomationRecord;
    map.set('u1', [record, record2]);
    expect(readUserAutomations(map, 'u1')).toEqual([record, record2]);
  });

  it('用户不存在时返回空数组', () => {
    const map = new Map<string, RuntimeAutomationRecord[]>();
    expect(readUserAutomations(map, 'u1')).toEqual([]);
  });

  it('空 Map 返回空数组', () => {
    expect(readUserAutomations(new Map(), 'u1')).toEqual([]);
  });
});

describe('automation / readAllAutomations', () => {
  it('展平所有用户的自动化', () => {
    const map = new Map<string, RuntimeAutomationRecord[]>();
    map.set('u1', [{ id: 'a1' } as RuntimeAutomationRecord]);
    map.set('u2', [{ id: 'a2' }, { id: 'a3' }] as RuntimeAutomationRecord[]);
    const result = readAllAutomations(map);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('空 Map 返回空数组', () => {
    expect(readAllAutomations(new Map())).toEqual([]);
  });
});

describe('automation / readEventAutomations', () => {
  const makeRecord = (overrides: Partial<RuntimeAutomationRecord>): RuntimeAutomationRecord =>
    ({ id: 'a1', userId: 'u1', enabled: true, trigger: { type: 'event', event: 'test' }, actions: [], name: 'test', createdAt: '', updatedAt: '', lastRunAt: null, logs: [], ...overrides } as RuntimeAutomationRecord);

  it('匹配启用的事件自动化', () => {
    const records = [makeRecord({ id: 'a1' }), makeRecord({ id: 'a2', trigger: { type: 'manual' } })];
    const result = readEventAutomations(records, 'test');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
  });

  it('过滤已禁用的自动化', () => {
    const records = [makeRecord({ enabled: false })];
    expect(readEventAutomations(records, 'test')).toEqual([]);
  });

  it('过滤事件不匹配的自动化', () => {
    const records = [makeRecord({ trigger: { type: 'event', event: 'other' } })];
    expect(readEventAutomations(records, 'test')).toEqual([]);
  });

  it('过滤非 event 类型', () => {
    const records = [makeRecord({ trigger: { type: 'cron', cron: '* * * * *' } })];
    expect(readEventAutomations(records, 'test')).toEqual([]);
  });

  it('空数组返回空', () => {
    expect(readEventAutomations([], 'test')).toEqual([]);
  });
});

describe('automation / readAutomationToolSourceKind', () => {
  it('接受 internal', () => { expect(readAutomationToolSourceKind('internal')).toBe('internal'); });
  it('接受 plugin', () => { expect(readAutomationToolSourceKind('plugin')).toBe('plugin'); });
  it('接受 mcp', () => { expect(readAutomationToolSourceKind('mcp')).toBe('mcp'); });
  it('接受 skill', () => { expect(readAutomationToolSourceKind('skill')).toBe('skill'); });
  it('拒绝 undefined', () => { expect(readAutomationToolSourceKind(undefined)).toBeNull(); });
  it('拒绝 null', () => { expect(readAutomationToolSourceKind(null)).toBeNull(); });
  it('拒绝空字符串', () => { expect(readAutomationToolSourceKind('')).toBeNull(); });
  it('拒绝非法字符串', () => { expect(readAutomationToolSourceKind('invalid')).toBeNull(); });
  it('拒绝数字', () => { expect(readAutomationToolSourceKind(123)).toBeNull(); });
});

describe('automation / readAutomationRunStatus', () => {
  it('从对象提取 status', () => {
    expect(readAutomationRunStatus({ status: 'success' })).toBe('success');
  });

  it('status 不是字符串时回退', () => {
    expect(readAutomationRunStatus({ status: 123 })).toBe('success');
  });

  it('空对象回退', () => {
    expect(readAutomationRunStatus({})).toBe('success');
  });

  it('null 回退', () => {
    expect(readAutomationRunStatus(null)).toBe('success');
  });

  it('字符串值回退', () => {
    expect(readAutomationRunStatus('error')).toBe('success');
  });

  it('undefined 回退', () => {
    expect(readAutomationRunStatus(undefined)).toBe('success');
  });
});

describe('automation / readAutomationConversationMode', () => {
  it('返回 existing', () => {
    expect(readAutomationConversationMode({ type: 'conversation', id: 'c1', conversationMode: 'existing' }, 0)).toBe('existing');
  });

  it('返回 cron_child', () => {
    expect(readAutomationConversationMode({ type: 'conversation', id: 'c1', conversationMode: 'cron_child' }, 0)).toBe('cron_child');
  });

  it('undefined 时返回 null', () => {
    expect(readAutomationConversationMode({ type: 'conversation', id: 'c1', conversationMode: undefined }, 0)).toBeNull();
  });

  it('null target 返回 null', () => {
    expect(readAutomationConversationMode(null, 0)).toBeNull();
  });

  it('非法值抛异常', () => {
    expect(() => readAutomationConversationMode({ type: 'conversation', id: 'c1', conversationMode: 'invalid' }, 0))
      .toThrow('actions[0].target.conversationMode 不合法');
  });

  it('数字非法值抛异常', () => {
    expect(() => readAutomationConversationMode({ type: 'conversation', id: 'c1', conversationMode: 123 }, 0))
      .toThrow('actions[0].target.conversationMode 不合法');
  });
});

describe('automation / readAutomationTrigger', () => {
  it('解析 manual trigger', () => {
    expect(readAutomationTrigger({ trigger: { type: 'manual' } })).toEqual({ type: 'manual' });
  });

  it('解析 cron trigger', () => {
    expect(readAutomationTrigger({ trigger: { type: 'cron', cron: '0 * * * *' } }))
      .toEqual({ type: 'cron', cron: '0 * * * *' });
  });

  it('解析 event trigger', () => {
    expect(readAutomationTrigger({ trigger: { type: 'event', event: 'deploy' } }))
      .toEqual({ type: 'event', event: 'deploy' });
  });

  it('缺失 event 字段时不填充', () => {
    expect(readAutomationTrigger({ trigger: { type: 'event' } })).toEqual({ type: 'event' });
  });

  it('缺失 cron 字段时不填充', () => {
    expect(readAutomationTrigger({ trigger: { type: 'cron' } })).toEqual({ type: 'cron' });
  });

  it('空 trigger 抛异常', () => {
    expect(() => readAutomationTrigger({})).toThrow('trigger 不能为空');
  });

  it('null trigger 抛异常', () => {
    expect(() => readAutomationTrigger({ trigger: null })).toThrow('trigger 不能为空');
  });

  it('非法 type 抛异常', () => {
    expect(() => readAutomationTrigger({ trigger: { type: 'invalid' } })).toThrow('trigger.type 不合法');
  });

  it('数字 type 抛异常', () => {
    expect(() => readAutomationTrigger({ trigger: { type: 123 } })).toThrow('trigger.type 不合法');
  });
});

describe('automation / readAutomationAction', () => {
  it('解析 device_command 完整字段', () => {
    const result = readAutomationAction({
      type: 'device_command',
      capability: 'system_info',
      plugin: 'plugin-pc',
      sourceKind: 'plugin',
      sourceId: 'pc-1',
      params: { cmd: 'info' },
    }, 0);
    expect(result).toEqual({
      type: 'device_command',
      capability: 'system_info',
      plugin: 'plugin-pc',
      sourceKind: 'plugin',
      sourceId: 'pc-1',
      params: { cmd: 'info' },
    });
  });

  it('解析 device_command 最小字段（sourceKind+sourceId）', () => {
    const result = readAutomationAction({
      type: 'device_command',
      capability: 'system_info',
      sourceKind: 'internal',
      sourceId: 'builtin',
    }, 0);
    expect(result).toEqual({
      type: 'device_command',
      capability: 'system_info',
      sourceKind: 'internal',
      sourceId: 'builtin',
    });
  });

  it('device_command 缺少必填字段抛异常', () => {
    expect(() => readAutomationAction({ type: 'device_command', capability: 'sys' }, 0))
      .toThrow('actions[0].type 缺少必填字段');
  });

  it('device_command 空 capability 抛异常', () => {
    expect(() => readAutomationAction({
      type: 'device_command',
      capability: '',
      plugin: 'plugin-pc',
    }, 0)).toThrow('actions[0].type 缺少必填字段');
  });

  it('device_command params 非对象抛异常', () => {
    expect(() => readAutomationAction({
      type: 'device_command',
      capability: 'sys',
      plugin: 'plugin-pc',
      params: 'bad',
    }, 0)).toThrow('actions[0].params 必须是对象');
  });

  it('解析 ai_message 无 target', () => {
    const result = readAutomationAction({
      type: 'ai_message',
      message: 'hello',
    }, 0);
    expect(result).toEqual({ type: 'ai_message', message: 'hello' });
  });

  it('解析 ai_message 含 target', () => {
    const result = readAutomationAction({
      type: 'ai_message',
      message: 'hello',
      target: { type: 'conversation', id: 'c1' },
    }, 0);
    expect(result).toEqual({
      type: 'ai_message',
      message: 'hello',
      target: { type: 'conversation', id: 'c1' },
    });
  });

  it('解析 ai_message 含 conversationMode', () => {
    const result = readAutomationAction({
      type: 'ai_message',
      message: 'hello',
      target: { type: 'conversation', id: 'c1', conversationMode: 'existing' },
    }, 0);
    expect(result).toEqual({
      type: 'ai_message',
      message: 'hello',
      target: { type: 'conversation', id: 'c1', conversationMode: 'existing' },
    });
  });

  it('ai_message target 非法类型抛异常', () => {
    expect(() => readAutomationAction({
      type: 'ai_message',
      target: { type: 'user', id: 'u1' },
    }, 0)).toThrow('actions[0].target 不合法');
  });

  it('ai_message target 空 id 不抛异常（源码行为：空字符串会被保留且通过校验）', () => {
    const result = readAutomationAction({
      type: 'ai_message',
      target: { type: 'conversation', id: '' },
    }, 0);
    expect(result.target).toEqual({ type: 'conversation', id: '' });
  });

  it('非对象 action 抛异常', () => {
    expect(() => readAutomationAction('string', 0)).toThrow('actions[0] 必须是对象');
  });

  it('null action 抛异常', () => {
    expect(() => readAutomationAction(null, 0)).toThrow('actions[0] 必须是对象');
  });

  it('非法 type 抛异常', () => {
    expect(() => readAutomationAction({ type: 'unknown' }, 0)).toThrow('actions[0].type 不合法');
  });
});

describe('automation / readAutomationActions', () => {
  it('解析有效动作数组', () => {
    const result = readAutomationActions({
      actions: [
        { type: 'ai_message', message: 'hello' },
        { type: 'device_command', capability: 'sys', plugin: 'plugin-pc' },
      ],
    });
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('ai_message');
    expect(result[1].type).toBe('device_command');
  });

  it('非数组抛异常', () => {
    expect(() => readAutomationActions({ actions: 'bad' })).toThrow('actions 必须是数组');
  });

  it('空数组返回空', () => {
    expect(readAutomationActions({ actions: [] })).toEqual([]);
  });

  it('缺失 actions 抛异常', () => {
    expect(() => readAutomationActions({})).toThrow('actions 必须是数组');
  });
});

describe('automation / createAutomationRecord', () => {
  it('创建完整记录', () => {
    const record = createAutomationRecord('u1', {
      name: 'test-auto',
      trigger: { type: 'manual' },
      actions: [{ type: 'ai_message', message: 'hello' }],
    }, 1);
    expect(record.id).toBe('automation-1');
    expect(record.userId).toBe('u1');
    expect(record.name).toBe('test-auto');
    expect(record.enabled).toBe(true);
    expect(record.lastRunAt).toBeNull();
    expect(record.logs).toEqual([]);
    expect(record.cronRunConversationIds).toEqual([]);
    expect(record.actions).toHaveLength(1);
    expect(record.createdAt).toBeTruthy();
    expect(record.updatedAt).toBeTruthy();
  });

  it('创建第 100 个记录 ID 正确', () => {
    const record = createAutomationRecord('u1', {
      name: 'test',
      trigger: { type: 'manual' },
      actions: [{ type: 'ai_message', message: 'hi' }],
    }, 100);
    expect(record.id).toBe('automation-100');
  });

  it('缺失 name 抛异常', () => {
    expect(() => createAutomationRecord('u1', {
      trigger: { type: 'manual' },
      actions: [],
    }, 1)).toThrow('name 不能为空');
  });
});

describe('automation / createAutomationLog', () => {
  const makeAutomation = (overrides?: Partial<PersistedAutomationRecord>): PersistedAutomationRecord => ({
    id: 'auto-1', name: 'test', userId: 'u1', enabled: true,
    trigger: { type: 'manual' }, actions: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    lastRunAt: null, logs: [], cronRunConversationIds: [],
    ...overrides,
  });

  it('创建日志条目', () => {
    const auto = makeAutomation();
    const log = createAutomationLog(auto, '2024-06-01T12:00:00.000Z', { status: 'success' });
    expect(log.id).toBe('automation-log-auto-1-1');
    expect(log.status).toBe('success');
    expect(log.result).toBe('{"status":"success"}');
    expect(log.createdAt).toBe('2024-06-01T12:00:00.000Z');
  });

  it('日志序号递增', () => {
    const auto = makeAutomation({ logs: [{ id: 'l1', status: 'success', result: null, createdAt: '2024-01-01T00:00:00.000Z' }] });
    const log = createAutomationLog(auto, '2024-06-01T12:00:00.000Z', {});
    expect(log.id).toBe('automation-log-auto-1-2');
  });

  it('结果非标准 status 回退 success', () => {
    const auto = makeAutomation();
    const log = createAutomationLog(auto, '2024-06-01T12:00:00.000Z', {});
    expect(log.status).toBe('success');
  });
});

describe('automation / serializeAutomationRecord', () => {
  it('移除内部字段', () => {
    const record: RuntimeAutomationRecord = {
      id: 'auto-1', name: 'test', userId: 'u1', enabled: true,
      trigger: { type: 'manual' }, actions: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastRunAt: null, logs: [],
      cronRunConversationIds: ['c1', 'c2'],
      executionConversationId: 'c1',
    };
    const result = serializeAutomationRecord(record) as Record<string, unknown>;
    expect(result.id).toBe('auto-1');
    expect(result.userId).toBeUndefined();
    expect(result.cronRunConversationIds).toBeUndefined();
    expect(result.executionConversationId).toBeUndefined();
  });

  it('保留公开字段', () => {
    const record: RuntimeAutomationRecord = {
      id: 'auto-1', name: 'test', userId: 'u1', enabled: true,
      trigger: { type: 'manual' }, actions: [{ type: 'ai_message', message: 'hi' }],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastRunAt: null, logs: [],
    };
    const result = serializeAutomationRecord(record) as Record<string, unknown>;
    expect(result.id).toBe('auto-1');
    expect(result.name).toBe('test');
    expect(result.enabled).toBe(true);
    expect(result.trigger).toEqual({ type: 'manual' });
    expect(result.actions).toHaveLength(1);
  });
});

describe('automation / readIntervalCronDelay', () => {
  it('解析秒', () => {
    expect(readIntervalCronDelay('30s')).toBe(30000);
  });

  it('解析分钟', () => {
    expect(readIntervalCronDelay('5m')).toBe(300000);
  });

  it('解析小时', () => {
    expect(readIntervalCronDelay('2h')).toBe(7200000);
  });

  it('忽略大小写', () => {
    expect(readIntervalCronDelay('30S')).toBe(30000);
    expect(readIntervalCronDelay('5M')).toBe(300000);
    expect(readIntervalCronDelay('2H')).toBe(7200000);
  });

  it('允许空格', () => {
    expect(readIntervalCronDelay('30 s')).toBe(30000);
    expect(readIntervalCronDelay('5  m')).toBe(300000);
  });

  it('标准 cron 表达式返回 null', () => {
    expect(readIntervalCronDelay('* * * * *')).toBeNull();
  });

  it('非数字前缀返回 null', () => {
    expect(readIntervalCronDelay('abc')).toBeNull();
  });

  it('空字符串返回 null', () => {
    expect(readIntervalCronDelay('')).toBeNull();
  });

  it('未知单位返回 null', () => {
    expect(readIntervalCronDelay('10d')).toBeNull();
  });

  it('trim 前后空白', () => {
    expect(readIntervalCronDelay('  10m  ')).toBe(600000);
  });
});

describe('automation / readCronChildConversationTarget', () => {
  it('找到 cron_child 目标', () => {
    const actions: ActionConfig[] = [
      { type: 'ai_message', message: 'hi', target: { type: 'conversation', id: 'parent-1', conversationMode: 'cron_child' } },
    ];
    const result = readCronChildConversationTarget(actions);
    expect(result).toEqual({ maxHistoryConversations: 10, parentConversationId: 'parent-1' });
  });

  it('使用自定义 maxHistoryConversations', () => {
    const actions: ActionConfig[] = [
      { type: 'ai_message', message: 'hi', target: { type: 'conversation', id: 'parent-1', conversationMode: 'cron_child', maxHistoryConversations: 5 } },
    ];
    const result = readCronChildConversationTarget(actions);
    expect(result).toEqual({ maxHistoryConversations: 5, parentConversationId: 'parent-1' });
  });

  it('跳过非 ai_message 动作', () => {
    const actions: ActionConfig[] = [
      { type: 'device_command', capability: 'sys', plugin: 'plugin-pc' },
      { type: 'ai_message', message: 'hi', target: { type: 'conversation', id: 'parent-1', conversationMode: 'cron_child' } },
    ];
    const result = readCronChildConversationTarget(actions);
    expect(result).toEqual({ maxHistoryConversations: 10, parentConversationId: 'parent-1' });
  });

  it('无 cron_child 返回 null', () => {
    const actions: ActionConfig[] = [
      { type: 'ai_message', message: 'hi', target: { type: 'conversation', id: 'c1' } },
    ];
    expect(readCronChildConversationTarget(actions)).toBeNull();
  });

  it('空数组返回 null', () => {
    expect(readCronChildConversationTarget([])).toBeNull();
  });

  it('跳过 existing 模式', () => {
    const actions: ActionConfig[] = [
      { type: 'ai_message', message: 'hi', target: { type: 'conversation', id: 'c1', conversationMode: 'existing' } },
    ];
    expect(readCronChildConversationTarget(actions)).toBeNull();
  });
});

describe('automation / rewriteCronChildConversationAction', () => {
  it('重写 cron_child 动作的 target', () => {
    const action: ActionConfig = {
      type: 'ai_message',
      message: 'hello',
      target: { type: 'conversation', id: 'parent-1', conversationMode: 'cron_child' },
    };
    const result = rewriteCronChildConversationAction(action, 'child-1');
    expect(result.target).toEqual({ id: 'child-1', type: 'conversation' });
    expect(result.message).toBe('hello');
  });

  it('保留非 ai_message 动作不变', () => {
    const action: ActionConfig = {
      type: 'device_command',
      capability: 'sys',
      plugin: 'plugin-pc',
    };
    const result = rewriteCronChildConversationAction(action, 'child-1');
    expect(result).toEqual(action);
    expect(result).not.toBe(action);
  });

  it('保留非 cron_child 动作不变', () => {
    const action: ActionConfig = {
      type: 'ai_message',
      message: 'hi',
      target: { type: 'conversation', id: 'c1' },
    };
    const result = rewriteCronChildConversationAction(action, 'child-1');
    expect(result.target).toEqual({ type: 'conversation', id: 'c1' });
  });

  it('返回深拷贝副本', () => {
    const action: ActionConfig = {
      type: 'device_command',
      capability: 'sys',
      plugin: 'plugin-pc',
    };
    const result = rewriteCronChildConversationAction(action, 'child-1');
    expect(result).not.toBe(action);
  });
});

describe('automation / createAutomationRunConversationTitle', () => {
  it('生成标准标题', () => {
    expect(createAutomationRunConversationTitle('每日报告', '2024-06-01T08:30:00.000Z'))
      .toBe('每日报告 · 2024-06-01 08:30');
  });

  it('处理 T 替换', () => {
    expect(createAutomationRunConversationTitle('test', '2024-01-01T00:00:00.000Z'))
      .toBe('test · 2024-01-01 00:00');
  });

  it('含英文名称', () => {
    expect(createAutomationRunConversationTitle('Daily Report', '2024-06-15T14:30:00.000Z'))
      .toBe('Daily Report · 2024-06-15 14:30');
  });
});

describe('automation / readAutomationState', () => {
  const SINGLE_USER_ID = 'single-user';
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('不存在的文件返回空状态', () => {
    const state = readAutomationState(path.join(tmpDir, 'nonexistent.json'), SINGLE_USER_ID);
    expect(state.automations.size).toBe(0);
    expect(state.migrated).toBe(false);
    expect(state.sequence).toBe(0);
  });

  it('读取有效状态', () => {
    const filePath = path.join(tmpDir, 'state.json');
    const data: AutomationPersistenceFile = {
      automations: {
        [SINGLE_USER_ID]: [
          { id: 'auto-1', userId: SINGLE_USER_ID } as RuntimeAutomationRecord,
        ],
      },
      sequence: 5,
    };
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
    const state = readAutomationState(filePath, SINGLE_USER_ID);
    expect(state.automations.size).toBe(1);
    expect(state.automations.get(SINGLE_USER_ID)).toHaveLength(1);
    expect(state.sequence).toBe(5);
    expect(state.migrated).toBe(false);
  });

  it('过滤 userId 不匹配的记录', () => {
    const filePath = path.join(tmpDir, 'state.json');
    const data: AutomationPersistenceFile = {
      automations: {
        [SINGLE_USER_ID]: [
          { id: 'auto-1', userId: 'other-user' } as RuntimeAutomationRecord,
          { id: 'auto-2', userId: SINGLE_USER_ID } as RuntimeAutomationRecord,
        ],
      },
      sequence: 1,
    };
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
    const state = readAutomationState(filePath, SINGLE_USER_ID);
    expect(state.automations.get(SINGLE_USER_ID)).toHaveLength(1);
    expect(state.automations.get(SINGLE_USER_ID)![0].id).toBe('auto-2');
    expect(state.migrated).toBe(true);
  });

  it('损坏 JSON 返回空状态', () => {
    const filePath = path.join(tmpDir, 'state.json');
    fs.writeFileSync(filePath, 'not-json', 'utf-8');
    const state = readAutomationState(filePath, SINGLE_USER_ID);
    expect(state.automations.size).toBe(0);
    expect(state.sequence).toBe(0);
  });

  it('缺失 automations 字段容错', () => {
    const filePath = path.join(tmpDir, 'state.json');
    fs.writeFileSync(filePath, JSON.stringify({ sequence: 3 }), 'utf-8');
    const state = readAutomationState(filePath, SINGLE_USER_ID);
    expect(state.automations.size).toBe(0);
    expect(state.sequence).toBe(3);
  });

  it('非数字 sequence 回退 0', () => {
    const filePath = path.join(tmpDir, 'state.json');
    fs.writeFileSync(filePath, JSON.stringify({ automations: {}, sequence: 'abc' }), 'utf-8');
    const state = readAutomationState(filePath, SINGLE_USER_ID);
    expect(state.sequence).toBe(0);
  });
});

describe('automation-execution / readAutomationConversationId', () => {
  it('从 ai_message action 提取 conversation ID', () => {
    const actions: ActionConfig[] = [
      { type: 'ai_message', message: 'hi', target: { type: 'conversation', id: 'conv-1' } },
    ];
    expect(readAutomationConversationId(actions)).toBe('conv-1');
  });

  it('跳过 device_command', () => {
    const actions: ActionConfig[] = [
      { type: 'device_command', capability: 'sys', plugin: 'plugin-pc' },
      { type: 'ai_message', message: 'hi', target: { type: 'conversation', id: 'conv-2' } },
    ];
    expect(readAutomationConversationId(actions)).toBe('conv-2');
  });

  it('空 target ID 跳过', () => {
    const actions: ActionConfig[] = [
      { type: 'ai_message', message: 'hi', target: { type: 'conversation', id: '' } },
    ];
    expect(readAutomationConversationId(actions)).toBeNull();
  });

  it('空白 target ID 跳过', () => {
    const actions: ActionConfig[] = [
      { type: 'ai_message', message: 'hi', target: { type: 'conversation', id: '   ' } },
    ];
    expect(readAutomationConversationId(actions)).toBeNull();
  });

  it('无匹配返回 null', () => {
    const actions: ActionConfig[] = [
      { type: 'device_command', capability: 'sys', plugin: 'plugin-pc' },
    ];
    expect(readAutomationConversationId(actions)).toBeNull();
  });

  it('空数组返回 null', () => {
    expect(readAutomationConversationId([])).toBeNull();
  });
});

describe('automation-execution / toAutomationInfo', () => {
  it('移除 runtime 字段', () => {
    const record: RuntimeAutomationRecord = {
      id: 'auto-1', name: 'test', userId: 'u1', enabled: true,
      trigger: { type: 'manual' }, actions: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastRunAt: null, logs: [],
    };
    const info = toAutomationInfo(record);
    expect((info as Record<string, unknown>).userId).toBeUndefined();
    expect((info as Record<string, unknown>).logs).toBeUndefined();
    expect(info.id).toBe('auto-1');
    expect(info.name).toBe('test');
  });

  it('深拷贝 actions 和 trigger', () => {
    const record: RuntimeAutomationRecord = {
      id: 'auto-1', name: 'test', userId: 'u1', enabled: true,
      trigger: { type: 'cron', cron: '0 * * * *' },
      actions: [{ type: 'ai_message', message: 'hi' }],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastRunAt: null, logs: [],
    };
    const info = toAutomationInfo(record);
    expect(info.actions).not.toBe(record.actions);
    expect(info.trigger).not.toBe(record.trigger);
  });
});

describe('automation-execution / createAutomationRunPlan', () => {
  it('使用 executionConversationId', () => {
    const record: RuntimeAutomationRecord = {
      id: 'auto-1', name: 'test', userId: 'u1', enabled: true,
      trigger: { type: 'manual' },
      actions: [{ type: 'ai_message', message: 'hi' }],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastRunAt: null, logs: [],
      executionConversationId: 'exec-conv-1',
    };
    const plan = createAutomationRunPlan(record);
    expect(plan.context.conversationId).toBe('exec-conv-1');
  });

  it('executionConversationId 不存在时从 actions 读取', () => {
    const record: RuntimeAutomationRecord = {
      id: 'auto-1', name: 'test', userId: 'u1', enabled: true,
      trigger: { type: 'manual' },
      actions: [{ type: 'ai_message', message: 'hi', target: { type: 'conversation', id: 'conv-1' } }],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastRunAt: null, logs: [],
    };
    const plan = createAutomationRunPlan(record);
    expect(plan.context.conversationId).toBe('conv-1');
  });

  it('无 conversationId 时不包含该字段', () => {
    const record: RuntimeAutomationRecord = {
      id: 'auto-1', name: 'test', userId: 'u1', enabled: true,
      trigger: { type: 'manual' },
      actions: [{ type: 'device_command', capability: 'sys', plugin: 'plugin-pc' }],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastRunAt: null, logs: [],
    };
    const plan = createAutomationRunPlan(record);
    expect(plan.context.conversationId).toBeUndefined();
  });

  it('设置 context 字段', () => {
    const record: RuntimeAutomationRecord = {
      id: 'auto-1', name: 'test', userId: 'u1', enabled: true,
      trigger: { type: 'manual' }, actions: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastRunAt: null, logs: [],
    };
    const plan = createAutomationRunPlan(record);
    expect(plan.context.automationId).toBe('auto-1');
    expect(plan.context.source).toBe('automation');
    expect(plan.context.userId).toBe('u1');
  });

  it('深拷贝 actions', () => {
    const record: RuntimeAutomationRecord = {
      id: 'auto-1', name: 'test', userId: 'u1', enabled: true,
      trigger: { type: 'manual' },
      actions: [{ type: 'ai_message', message: 'hi' }],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      lastRunAt: null, logs: [],
    };
    const plan = createAutomationRunPlan(record);
    expect(plan.actions).not.toBe(record.actions);
  });
});

describe('automation-execution / readAutomationMessageTarget', () => {
  const fallback = { id: 'fallback-1', type: 'conversation' as const };

  it('从 result.target 读取', () => {
    const result = { target: { id: 'conv-1', type: 'conversation', label: 'test' } };
    expect(readAutomationMessageTarget(result, fallback))
      .toEqual({ id: 'conv-1', label: 'test', type: 'conversation' });
  });

  it('从 result.userMessage.target 读取', () => {
    const result = { userMessage: { target: { id: 'conv-2', type: 'conversation' } } };
    expect(readAutomationMessageTarget(result, fallback))
      .toEqual({ id: 'conv-2', type: 'conversation' });
  });

  it('result.target 优先于 userMessage.target', () => {
    const result = {
      target: { id: 'conv-1', type: 'conversation' },
      userMessage: { target: { id: 'conv-2', type: 'conversation' } },
    };
    expect(readAutomationMessageTarget(result, fallback))
      .toEqual({ id: 'conv-1', type: 'conversation' });
  });

  it('无效 target 回退到 fallback', () => {
    const result = { target: { id: null, type: 'conversation' } };
    expect(readAutomationMessageTarget(result, fallback))
      .toEqual({ id: 'fallback-1', type: 'conversation' });
  });

  it('非 conversation type 回退到 fallback', () => {
    const result = { target: { id: 'conv-1', type: 'user' } };
    expect(readAutomationMessageTarget(result, fallback))
      .toEqual({ id: 'fallback-1', type: 'conversation' });
  });

  it('无 target 回退到 fallback', () => {
    const result = {};
    expect(readAutomationMessageTarget(result, fallback))
      .toEqual({ id: 'fallback-1', type: 'conversation' });
  });

  it('保留 label 字段', () => {
    const result = { target: { id: 'conv-1', type: 'conversation', label: 'My Chat' } };
    expect(readAutomationMessageTarget(result, fallback).label).toBe('My Chat');
  });

  it('缺失 label 时不包含该字段', () => {
    const result = { target: { id: 'conv-1', type: 'conversation' } };
    expect(readAutomationMessageTarget(result, fallback).label).toBeUndefined();
  });
});

describe('automation / readAutomationState (file system integration)', () => {
  const SINGLE_USER_ID = 'single-user';
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-fs-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('读取空目录返回空状态', () => {
    const state = readAutomationState(path.join(tmpDir, 'data.json'), SINGLE_USER_ID);
    expect(state.automations.size).toBe(0);
    expect(state.migrated).toBe(false);
  });

  it('写入后完整 roundtrip', () => {
    const filePath = path.join(tmpDir, 'data.json');
    const automations: RuntimeAutomationRecord[] = [
      {
        id: 'auto-1', name: 'test', userId: SINGLE_USER_ID, enabled: true,
        trigger: { type: 'manual' }, actions: [{ type: 'ai_message', message: 'hi' }],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        lastRunAt: null, logs: [],
        cronRunConversationIds: [],
      },
    ];
    const data: AutomationPersistenceFile = {
      automations: { [SINGLE_USER_ID]: automations },
      sequence: 1,
    };
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
    const state = readAutomationState(filePath, SINGLE_USER_ID);
    expect(state.automations.get(SINGLE_USER_ID)).toHaveLength(1);
    expect(state.automations.get(SINGLE_USER_ID)![0].id).toBe('auto-1');
    expect(state.sequence).toBe(1);
  });

  it('多用户自动迁移标记', () => {
    const filePath = path.join(tmpDir, 'data.json');
    const data: AutomationPersistenceFile = {
      automations: {
        'user-a': [{ id: 'a1', userId: 'user-a' } as RuntimeAutomationRecord],
        [SINGLE_USER_ID]: [{ id: 'b1', userId: SINGLE_USER_ID } as RuntimeAutomationRecord],
      },
      sequence: 5,
    };
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
    const state = readAutomationState(filePath, SINGLE_USER_ID);
    expect(state.migrated).toBe(true);
    expect(state.automations.get(SINGLE_USER_ID)).toHaveLength(1);
  });

  it('损坏文件返回空状态', () => {
    const filePath = path.join(tmpDir, 'data.json');
    fs.writeFileSync(filePath, '{{{broken}}', 'utf-8');
    const state = readAutomationState(filePath, SINGLE_USER_ID);
    expect(state.automations.size).toBe(0);
    expect(state.sequence).toBe(0);
  });

  it('缺失 sequence 字段回退 0', () => {
    const filePath = path.join(tmpDir, 'data.json');
    fs.writeFileSync(filePath, JSON.stringify({ automations: {} }), 'utf-8');
    const state = readAutomationState(filePath, SINGLE_USER_ID);
    expect(state.sequence).toBe(0);
  });
});
