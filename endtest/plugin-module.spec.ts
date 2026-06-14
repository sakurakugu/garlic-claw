import { describe, it, expect } from 'vitest';
import type { PluginInfo, PluginActionName, PluginCommandInfo, PluginCommandConflict, PluginConfigSnapshot, PluginManifest, EventLogSettings, RegisteredPluginRecord } from '@garlic-claw/shared';
import { createHash } from 'node:crypto';

const REMOTE_ENVIRONMENT = { API: 'api', IOT: 'iot' } as const;
const PLUGIN_AUTH_MODE = { NONE: 'none', OPTIONAL: 'optional', REQUIRED: 'required' } as const;
const PLUGIN_CAPABILITY_PROFILE = { ACTUATE: 'actuate', HYBRID: 'hybrid', QUERY: 'query' } as const;
const PLUGIN_STATUS = { ERROR: 'error', OFFLINE: 'offline', ONLINE: 'online' } as const;

const WS_TYPE = { AUTH: 'auth', PLUGIN: 'plugin', COMMAND: 'command', HEARTBEAT: 'heartbeat', ERROR: 'error' } as const;
const WS_ACTION = {
  AUTHENTICATE: 'authenticate', AUTH_OK: 'auth_ok', AUTH_FAIL: 'auth_fail',
  REGISTER: 'register', REGISTER_OK: 'register_ok', UNREGISTER: 'unregister',
  STATUS: 'status', EXECUTE: 'execute', EXECUTE_RESULT: 'execute_result', EXECUTE_ERROR: 'execute_error',
  HOOK_INVOKE: 'hook_invoke', HOOK_RESULT: 'hook_result', HOOK_ERROR: 'hook_error',
  ROUTE_INVOKE: 'route_invoke', ROUTE_RESULT: 'route_result', ROUTE_ERROR: 'route_error',
  HOST_CALL: 'host_call', HOST_RESULT: 'host_result', HOST_ERROR: 'host_error',
  PING: 'ping', PONG: 'pong',
} as const;

function readPluginActionName(action: string): PluginActionName {
  if (action === 'health-check' || action === 'reload' || action === 'reconnect' || action === 'refresh-metadata') { return action as PluginActionName; }
  throw new Error('action 必须是 reload / reconnect / health-check / refresh-metadata');
}

function createWsReply(type: string, action: string, payload: unknown, requestId?: string): Record<string, unknown> {
  return { action, payload, ...(requestId ? { requestId } : {}), type };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, invalidMessage: string): Record<string, unknown> {
  if (!isRecord(value)) { throw new Error(invalidMessage); }
  return value;
}

function readPayloadField<T>(value: unknown, field: string, invalidMessage: string, validate?: (entry: unknown) => entry is T): T {
  const record = readRecord(value, invalidMessage);
  if (!(field in record) || (validate && !validate(record[field]))) { throw new Error(invalidMessage); }
  return record[field] as T;
}

function readAuthPayload(value: unknown): { accessKey?: string | null; pluginName: string; remoteEnvironment: 'api' | 'iot' } {
  const invalidMessage = '无效的认证负载';
  const record = readRecord(value, invalidMessage);
  if (typeof record.pluginName !== 'string'
    || (record.accessKey !== undefined && record.accessKey !== null && typeof record.accessKey !== 'string')
    || (record.remoteEnvironment !== 'api' && record.remoteEnvironment !== 'iot')) {
    throw new Error(invalidMessage);
  }
  return {
    ...(typeof record.accessKey === 'string' || record.accessKey === null ? { accessKey: record.accessKey } : {}),
    pluginName: record.pluginName,
    remoteEnvironment: record.remoteEnvironment,
  };
}

function readHostCallPayload(value: unknown): { context?: unknown; method: string; params: Record<string, unknown> } {
  const record = readRecord(value, '无效的 Host API 调用负载');
  if (typeof record.method !== 'string' || !isRecord(record.params)) { throw new Error('无效的 Host API 调用负载'); }
  return {
    ...(record.context ? { context: record.context } : {}),
    method: record.method,
    params: record.params,
  };
}

function readRegisterPayload(value: unknown): { manifest: unknown } {
  return { manifest: readPayloadField(value, 'manifest', '无效的插件注册负载', isRecord) };
}

function readWsMessage(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { throw new Error('无效的 JSON'); }
  if (!isRecord(parsed) || !('type' in parsed) || !('action' in parsed) || !('payload' in parsed)) {
    throw new Error('无效的插件协议消息');
  }
  return parsed;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function readRouteResultPayload(value: unknown): { body: unknown; headers?: Record<string, string>; status: number } {
  const record = readRecord(value, '无效的 Route 返回负载');
  const data = record.data;
  if (!isRecord(data) || typeof data.status !== 'number' || !Number.isFinite(data.status) || !('body' in data)) { throw new Error('无效的 Route 返回负载'); }
  if (data.headers !== undefined && !isStringRecord(data.headers)) { throw new Error('无效的 Route 返回负载'); }
  return {
    body: data.body,
    ...(isStringRecord(data.headers) ? { headers: data.headers } : {}),
    status: data.status,
  };
}

function readDataPayload(value: unknown): unknown {
  return readPayloadField(value, 'data', '无效的返回负载');
}

function readErrorPayload(value: unknown): string {
  return readPayloadField(value, 'error', '无效的错误负载', (entry): entry is string => typeof entry === 'string');
}

const REMOTE_MESSAGE_SETTLERS: Record<string, { invalidPayloadMessage: string; readPayload(value: unknown): { error?: string; result?: unknown } }> = {
  [`${WS_TYPE.COMMAND}:${WS_ACTION.EXECUTE_RESULT}`]: { invalidPayloadMessage: '无效的远程命令返回负载', readPayload: (payload) => ({ result: readDataPayload(payload) }) },
  [`${WS_TYPE.COMMAND}:${WS_ACTION.EXECUTE_ERROR}`]: { invalidPayloadMessage: '无效的远程命令错误负载', readPayload: (payload) => ({ error: readErrorPayload(payload) }) },
  [`${WS_TYPE.PLUGIN}:${WS_ACTION.HOOK_RESULT}`]: { invalidPayloadMessage: '无效的 Hook 返回负载', readPayload: (payload) => ({ result: readDataPayload(payload) }) },
  [`${WS_TYPE.PLUGIN}:${WS_ACTION.ROUTE_RESULT}`]: { invalidPayloadMessage: '无效的插件 Route 返回负载', readPayload: (payload) => ({ result: readRouteResultPayload(payload) as unknown }) },
  [`${WS_TYPE.PLUGIN}:${WS_ACTION.HOOK_ERROR}`]: { invalidPayloadMessage: '无效的 Hook 错误负载', readPayload: (payload) => ({ error: readErrorPayload(payload) }) },
  [`${WS_TYPE.PLUGIN}:${WS_ACTION.ROUTE_ERROR}`]: { invalidPayloadMessage: '无效的插件 Route 错误负载', readPayload: (payload) => ({ error: readErrorPayload(payload) }) },
};

function readRemoteSettlement(message: { type: string; action: string; payload: unknown; requestId?: string }):
  | { missingRequestId: true }
  | { settlement: { error?: string; requestId: string; result?: unknown } }
  | null {
  const settleConfig = REMOTE_MESSAGE_SETTLERS[`${message.type}:${message.action}`];
  if (!settleConfig) { return null; }
  if (typeof message.requestId !== 'string' || message.requestId.length === 0) { return { missingRequestId: true }; }
  try { return { settlement: { requestId: message.requestId, ...settleConfig.readPayload(message.payload) } }; }
  catch { return { settlement: { error: settleConfig.invalidPayloadMessage, requestId: message.requestId } }; }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveConfigNodeValue(schema: { type?: string; items?: Record<string, unknown> | null; defaultValue?: unknown } | null, currentValue: unknown): unknown {
  if (!schema) { return currentValue; }
  if (schema.type === 'object') {
    const source = isJsonObject(currentValue) ? currentValue : {};
    return Object.fromEntries(Object.entries(schema.items ?? {}).flatMap(([key, childSchema]) => {
      const childValue = resolveConfigNodeValue(childSchema as Parameters<typeof resolveConfigNodeValue>[0], source[key]);
      return typeof childValue === 'undefined' ? [] : [[key, childValue]];
    }));
  }
  if (schema.type === 'list') {
    const sourceList = Array.isArray(currentValue) ? currentValue : Array.isArray(schema.defaultValue) ? schema.defaultValue : null;
    return sourceList ? (schema.items ? sourceList.map((item) => resolveConfigNodeValue(schema.items as Parameters<typeof resolveConfigNodeValue>[0], item) ?? null) : sourceList) : schema.defaultValue ?? currentValue;
  }
  return typeof currentValue !== 'undefined' ? currentValue : schema.defaultValue;
}

function createPluginConfigSnapshot(record: { manifest: { config?: unknown }; configValues?: unknown }): PluginConfigSnapshot {
  return { schema: record.manifest.config ?? null, values: resolveConfigNodeValue(record.manifest.config as Parameters<typeof resolveConfigNodeValue>[0] ?? null, record.configValues ?? {}) as Record<string, unknown> };
}

function clonePluginRemote(record: { remote?: { access: { [key: string]: unknown }; descriptor: unknown; metadataCache: { [key: string]: unknown } } | null }): { access: { [key: string]: unknown }; descriptor: unknown; metadataCache: { [key: string]: unknown } } | null {
  return record.remote ? { access: { ...record.remote.access }, descriptor: structuredClone(record.remote.descriptor), metadataCache: { ...record.remote.metadataCache } } : null;
}

function buildPluginInfo(record: {
  connected: boolean; defaultEnabled: boolean; createdAt: string; eventLog: EventLogSettings;
  manifest: { description?: string; name: string; id: string; version: string; runtime: string };
  governance?: unknown; pluginId: string; lastSeenAt: string; status: string; updatedAt: string;
  remote?: { access: { [key: string]: unknown }; descriptor: unknown; metadataCache: { [key: string]: unknown } } | null;
}, supportedActions: PluginActionName[]): PluginInfo {
  return {
    connected: record.connected, defaultEnabled: record.defaultEnabled, createdAt: record.createdAt,
    eventLog: { ...record.eventLog },
    ...(record.manifest.description ? { description: record.manifest.description } : {}),
    displayName: record.manifest.name, governance: record.governance, id: record.pluginId,
    lastSeenAt: record.lastSeenAt, manifest: record.manifest as unknown as PluginManifest,
    name: record.pluginId, remote: clonePluginRemote(record), runtimeKind: record.manifest.runtime,
    status: record.status, supportedActions, updatedAt: record.updatedAt, version: record.manifest.version,
  };
}

function buildPluginSelfSummary(record: {
  connected: boolean; defaultEnabled: boolean; eventLog: { maxFileSizeMb: number };
  manifest: { description?: string; name: string; id: string; version: string; runtime: string; permissions: string[]; commands?: unknown[]; tools?: unknown[]; crons?: unknown[]; hooks?: unknown[]; routes?: unknown[] };
  governance?: unknown; pluginId: string; lastSeenAt: string;
  remote?: { access: { [key: string]: unknown }; descriptor: unknown; metadataCache: { [key: string]: unknown } } | null;
}): Record<string, unknown> {
  const remote = clonePluginRemote(record);
  const PLUGIN_SELF_CAPABILITY_KEYS = ['tools', 'commands', 'crons', 'hooks', 'routes'] as const;
  return {
    connected: record.connected, defaultEnabled: record.defaultEnabled,
    eventLog: { ...record.eventLog },
    ...(record.manifest.description ? { description: record.manifest.description } : {}),
    governance: record.governance, id: record.manifest.id, lastSeenAt: record.lastSeenAt,
    name: record.manifest.name, permissions: [...record.manifest.permissions],
    ...(remote ? { remote: remote } : {}), runtimeKind: record.manifest.runtime,
    version: record.manifest.version,
    ...Object.fromEntries(PLUGIN_SELF_CAPABILITY_KEYS.flatMap((key) => {
      const arr = record.manifest[key];
      return Array.isArray(arr) && arr.length ? [[key, arr]] : [];
    })),
  };
}

function listPluginCommands(record: {
  pluginId: string; manifest: { name: string; runtime: string; commands?: Array<{ aliases: string[]; variants: string[]; path: string[]; canonicalCommand: string; kind: string }> }; governance?: unknown; connected: boolean; defaultEnabled: boolean;
}): Record<string, unknown>[] {
  return (record.manifest.commands ?? []).map((command) => ({
    ...command, aliases: [...command.aliases], variants: [...command.variants], path: [...command.path],
    commandId: `${record.pluginId}:${command.canonicalCommand}:${command.kind}`,
    conflictTriggers: [], connected: record.connected, defaultEnabled: record.defaultEnabled,
    governance: record.governance, pluginDisplayName: record.manifest.name, pluginId: record.pluginId,
    runtimeKind: record.manifest.runtime, source: 'manifest',
  }));
}

function buildPluginCommandConflicts(commands: Array<{ commandId: string; canonicalCommand: string; kind: string; pluginId: string; runtimeKind: string; connected: boolean; defaultEnabled: boolean; governance?: unknown; pluginDisplayName?: string; priority?: number; variants: string[] }>): PluginCommandConflict[] {
  const triggers = new Map<string, typeof commands>();
  for (const command of commands) {
    for (const trigger of command.variants) {
      const entries = triggers.get(trigger);
      if (entries) { entries.push(command); continue; }
      triggers.set(trigger, [command]);
    }
  }
  return [...triggers].flatMap(([trigger, entries]) => entries.length < 2 ? [] : [{ trigger, commands: entries.map(toPluginCommandConflictEntry) }]);
}

function toPluginCommandConflictEntry(command: {
  canonicalCommand: string; commandId: string; connected: boolean; defaultEnabled: boolean;
  kind: string; pluginDisplayName?: string; pluginId: string; priority?: number; runtimeKind: string;
}): { canonicalCommand: string; commandId: string; connected: boolean; defaultEnabled: boolean; kind: string; pluginDisplayName?: string; pluginId: string; priority?: number; runtimeKind: string } {
  return { canonicalCommand: command.canonicalCommand, commandId: command.commandId, connected: command.connected, defaultEnabled: command.defaultEnabled, kind: command.kind, pluginDisplayName: command.pluginDisplayName, pluginId: command.pluginId, ...(typeof command.priority === 'number' ? { priority: command.priority } : {}), runtimeKind: command.runtimeKind };
}

function comparePluginCommandIdentity(left: { canonicalCommand: string; kind: string; pluginId: string; commandId: string; priority?: number }, right: { canonicalCommand: string; kind: string; pluginId: string; commandId: string; priority?: number }): number {
  return left.canonicalCommand.localeCompare(right.canonicalCommand)
    || left.kind.localeCompare(right.kind)
    || (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER)
    || left.pluginId.localeCompare(right.pluginId)
    || left.commandId.localeCompare(right.commandId);
}

function createPluginCommandOverviewVersion(commands: ReturnType<typeof listPluginCommands>, conflicts: PluginCommandConflict[]): string {
  return createHash('sha1').update(JSON.stringify({
    commands: commands.map((command) => ({
      aliases: command.aliases, canonicalCommand: command.canonicalCommand, commandId: command.commandId,
      conflictTriggers: command.conflictTriggers, connected: command.connected, defaultEnabled: command.defaultEnabled,
      governance: command.governance ?? null, kind: command.kind, path: command.path,
      pluginDisplayName: command.pluginDisplayName ?? null, pluginId: command.pluginId,
      priority: command.priority ?? null, runtimeKind: command.runtimeKind, source: command.source,
      variants: command.variants,
    })),
    conflicts: conflicts.map((conflict) => ({
      commands: conflict.commands.map((command) => ({
        canonicalCommand: command.canonicalCommand, commandId: command.commandId, connected: command.connected,
        defaultEnabled: command.defaultEnabled, kind: command.kind,
        pluginDisplayName: command.pluginDisplayName ?? null, pluginId: command.pluginId,
        priority: command.priority ?? null, runtimeKind: command.runtimeKind,
      })), trigger: conflict.trigger,
    })),
  })).digest('hex');
}

function buildPluginCommandOverview(commands: ReturnType<typeof listPluginCommands>): { commands: ReturnType<typeof listPluginCommands>; conflicts: PluginCommandConflict[]; version: string } {
  const sortedCommands = [...commands].sort(comparePluginCommandIdentity);
  const conflicts = buildPluginCommandConflicts(sortedCommands).map((conflict) => ({
    ...conflict,
    commands: [...conflict.commands].sort(comparePluginCommandIdentity),
  })).sort((left, right) => left.trigger.localeCompare(right.trigger));
  return { commands: sortedCommands, conflicts, version: createPluginCommandOverviewVersion(sortedCommands, conflicts) };
}

function buildPluginCommandCatalogVersion(commands: ReturnType<typeof listPluginCommands>): { version: string } {
  return { version: buildPluginCommandOverview(commands).version };
}

type MockRegisteredPluginRecord = {
  connected: boolean; defaultEnabled: boolean; createdAt: string; eventLog: EventLogSettings;
  manifest: { description?: string; name: string; id: string; version: string; runtime: string; permissions: string[]; commands?: Array<{ aliases: string[]; variants: string[]; path: string[]; canonicalCommand: string; kind: string; priority?: number; pluginDisplayName?: string }>; config?: unknown; tools?: unknown[]; crons?: unknown[]; hooks?: unknown[]; routes?: unknown[] };
  governance?: unknown; pluginId: string; lastSeenAt: string; status: string; updatedAt: string;
  configValues?: unknown;
  remote?: { access: { [key: string]: unknown }; descriptor: unknown; metadataCache: { [key: string]: unknown } } | null;
};

function makeRecord(overrides: Partial<MockRegisteredPluginRecord> = {}): MockRegisteredPluginRecord {
  return {
    connected: true, defaultEnabled: true, createdAt: '2026-01-01T00:00:00.000Z',
    eventLog: { maxFileSizeMb: 1 },
    manifest: { name: 'test-plugin', id: 'test-plugin', version: '1.0.0', runtime: 'remote', permissions: ['core:basic'], ...overrides.manifest },
    pluginId: 'test-plugin', lastSeenAt: '2026-06-01T00:00:00.000Z',
    status: 'online', updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('plugin.constants', () => {
  it('REMOTE_ENVIRONMENT has API and IOT', () => {
    expect(REMOTE_ENVIRONMENT).toEqual({ API: 'api', IOT: 'iot' });
  });
  it('PLUGIN_AUTH_MODE has none, optional, required', () => {
    expect(PLUGIN_AUTH_MODE).toEqual({ NONE: 'none', OPTIONAL: 'optional', REQUIRED: 'required' });
  });
  it('PLUGIN_CAPABILITY_PROFILE has actuate, hybrid, query', () => {
    expect(PLUGIN_CAPABILITY_PROFILE).toEqual({ ACTUATE: 'actuate', HYBRID: 'hybrid', QUERY: 'query' });
  });
  it('PLUGIN_STATUS has error, offline, online', () => {
    expect(PLUGIN_STATUS).toEqual({ ERROR: 'error', OFFLINE: 'offline', ONLINE: 'online' });
  });
  it('all values are unique across constant groups', () => {
    const all = [...Object.values(REMOTE_ENVIRONMENT), ...Object.values(PLUGIN_AUTH_MODE), ...Object.values(PLUGIN_CAPABILITY_PROFILE), ...Object.values(PLUGIN_STATUS)];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('WS message constants', () => {
  it('WS_TYPE has 5 message types', () => {
    expect(Object.values(WS_TYPE)).toHaveLength(5);
    expect(WS_TYPE).toEqual({ AUTH: 'auth', PLUGIN: 'plugin', COMMAND: 'command', HEARTBEAT: 'heartbeat', ERROR: 'error' });
  });
  it('WS_ACTION has 21 actions', () => {
    expect(Object.values(WS_ACTION)).toHaveLength(21);
  });
  it('WS_ACTION includes all expected actions', () => {
    expect(WS_ACTION.AUTHENTICATE).toBe('authenticate');
    expect(WS_ACTION.AUTH_OK).toBe('auth_ok');
    expect(WS_ACTION.PING).toBe('ping');
    expect(WS_ACTION.PONG).toBe('pong');
    expect(WS_ACTION.HOST_CALL).toBe('host_call');
    expect(WS_ACTION.HOST_RESULT).toBe('host_result');
  });
  it('WS_TYPE and WS_ACTION values do not overlap', () => {
    const typeValues = new Set(Object.values(WS_TYPE));
    const actionValues = Object.values(WS_ACTION);
    expect(actionValues.some((v) => typeValues.has(v as string))).toBe(false);
  });
});

describe('readPluginActionName (from plugin.controller.ts)', () => {
  it('accepts health-check', () => { expect(readPluginActionName('health-check')).toBe('health-check'); });
  it('accepts reload', () => { expect(readPluginActionName('reload')).toBe('reload'); });
  it('accepts reconnect', () => { expect(readPluginActionName('reconnect')).toBe('reconnect'); });
  it('accepts refresh-metadata', () => { expect(readPluginActionName('refresh-metadata')).toBe('refresh-metadata'); });
  it('rejects unknown action', () => { expect(() => readPluginActionName('unknown')).toThrow('action 必须是 reload / reconnect / health-check / refresh-metadata'); });
  it('rejects empty string', () => { expect(() => readPluginActionName('')).toThrow(); });
});

describe('plugin-ws.protocol', () => {
  describe('createWsReply', () => {
    it('creates reply without requestId', () => {
      const reply = createWsReply('auth', 'auth_ok', {});
      expect(reply).toEqual({ type: 'auth', action: 'auth_ok', payload: {} });
    });
    it('creates reply with requestId', () => {
      const reply = createWsReply('plugin', 'host_result', { data: 'ok' }, 'req-1');
      expect(reply).toEqual({ type: 'plugin', action: 'host_result', payload: { data: 'ok' }, requestId: 'req-1' });
    });
  });

  describe('readWsMessage', () => {
    it('parses valid WS message', () => {
      const msg = readWsMessage(JSON.stringify({ type: 'auth', action: 'authenticate', payload: { pluginName: 'test' } }));
      expect(msg.type).toBe('auth');
      expect(msg.action).toBe('authenticate');
    });
    it('throws on invalid JSON', () => { expect(() => readWsMessage('not json')).toThrow('无效的 JSON'); });
    it('throws on missing type', () => { expect(() => readWsMessage(JSON.stringify({ action: 'x', payload: {} }))).toThrow('无效的插件协议消息'); });
    it('throws on missing action', () => { expect(() => readWsMessage(JSON.stringify({ type: 'x', payload: {} }))).toThrow('无效的插件协议消息'); });
    it('throws on missing payload', () => { expect(() => readWsMessage(JSON.stringify({ type: 'x', action: 'y' }))).toThrow('无效的插件协议消息'); });
    it('throws on non-object parsed value', () => { expect(() => readWsMessage('"string"')).toThrow('无效的插件协议消息'); });
  });

  describe('readAuthPayload', () => {
    it('reads valid auth payload with accessKey', () => {
      const auth = readAuthPayload({ pluginName: 'my-plugin', accessKey: 'sk-123', remoteEnvironment: 'api' });
      expect(auth).toEqual({ pluginName: 'my-plugin', accessKey: 'sk-123', remoteEnvironment: 'api' });
    });
    it('reads auth payload without accessKey', () => {
      const auth = readAuthPayload({ pluginName: 'my-plugin', remoteEnvironment: 'iot' });
      expect(auth).toEqual({ pluginName: 'my-plugin', remoteEnvironment: 'iot' });
    });
    it('reads auth payload with null accessKey', () => {
      const auth = readAuthPayload({ pluginName: 'my-plugin', accessKey: null, remoteEnvironment: 'api' });
      expect(auth).toEqual({ pluginName: 'my-plugin', accessKey: null, remoteEnvironment: 'api' });
    });
    it('rejects non-string pluginName', () => {
      expect(() => readAuthPayload({ pluginName: 123, remoteEnvironment: 'api' })).toThrow('无效的认证负载');
    });
    it('rejects invalid remoteEnvironment', () => {
      expect(() => readAuthPayload({ pluginName: 'p', remoteEnvironment: 'unknown' })).toThrow('无效的认证负载');
    });
    it('rejects non-string accessKey', () => {
      expect(() => readAuthPayload({ pluginName: 'p', accessKey: 456, remoteEnvironment: 'api' })).toThrow('无效的认证负载');
    });
    it('rejects non-record input', () => {
      expect(() => readAuthPayload('string')).toThrow('无效的认证负载');
    });
  });

  describe('readHostCallPayload', () => {
    it('reads valid host call payload', () => {
      const call = readHostCallPayload({ method: 'getConfig', params: { key: 'x' } });
      expect(call).toEqual({ method: 'getConfig', params: { key: 'x' } });
    });
    it('reads with optional context', () => {
      const call = readHostCallPayload({ method: 'getConfig', params: {}, context: { conversationId: 'c1' } });
      expect(call.context).toEqual({ conversationId: 'c1' });
    });
    it('rejects non-string method', () => {
      expect(() => readHostCallPayload({ method: 123, params: {} })).toThrow('无效的 Host API 调用负载');
    });
    it('rejects non-record params', () => {
      expect(() => readHostCallPayload({ method: 'getConfig', params: 'not-object' })).toThrow('无效的 Host API 调用负载');
    });
    it('rejects non-record input', () => {
      expect(() => readHostCallPayload(null)).toThrow('无效的 Host API 调用负载');
    });
  });

  describe('readRegisterPayload', () => {
    it('reads valid register payload', () => {
      const reg = readRegisterPayload({ manifest: { name: 'test', id: 'test', version: '1.0.0' } });
      expect(reg.manifest).toEqual({ name: 'test', id: 'test', version: '1.0.0' });
    });
    it('rejects missing manifest', () => {
      expect(() => readRegisterPayload({})).toThrow('无效的插件注册负载');
    });
    it('rejects non-object manifest', () => {
      expect(() => readRegisterPayload({ manifest: 'string' })).toThrow('无效的插件注册负载');
    });
  });

  describe('readRemoteSettlement', () => {
    const execResultMsg = { type: WS_TYPE.COMMAND, action: WS_ACTION.EXECUTE_RESULT, payload: { data: { result: 'ok' } }, requestId: 'req-1' };
    const execErrorMsg = { type: WS_TYPE.COMMAND, action: WS_ACTION.EXECUTE_ERROR, payload: { error: 'fail' }, requestId: 'req-2' };
    const hookResultMsg = { type: WS_TYPE.PLUGIN, action: WS_ACTION.HOOK_RESULT, payload: { data: 'done' }, requestId: 'req-3' };
    const routeResultMsg = { type: WS_TYPE.PLUGIN, action: WS_ACTION.ROUTE_RESULT, payload: { data: { status: 200, body: { ok: true } } }, requestId: 'req-4' };
    const hookErrorMsg = { type: WS_TYPE.PLUGIN, action: WS_ACTION.HOOK_ERROR, payload: { error: 'hook error' }, requestId: 'req-5' };
    const routeErrorMsg = { type: WS_TYPE.PLUGIN, action: WS_ACTION.ROUTE_ERROR, payload: { error: 'route error' }, requestId: 'req-6' };

    it('returns null for unsupported message type:action', () => {
      expect(readRemoteSettlement({ type: 'auth', action: 'authenticate', payload: {} })).toBeNull();
    });
    it('returns missingRequestId when requestId is missing', () => {
      const result = readRemoteSettlement({ type: WS_TYPE.COMMAND, action: WS_ACTION.EXECUTE_RESULT, payload: { data: 'x' } });
      expect(result).toEqual({ missingRequestId: true });
    });
    it('returns missingRequestId when requestId is empty', () => {
      const result = readRemoteSettlement({ type: WS_TYPE.COMMAND, action: WS_ACTION.EXECUTE_RESULT, payload: { data: 'x' }, requestId: '' });
      expect(result).toEqual({ missingRequestId: true });
    });
    it('settles EXECUTE_RESULT', () => {
      const result = readRemoteSettlement(execResultMsg);
      expect(result).toEqual({ settlement: { requestId: 'req-1', result: { result: 'ok' } } });
    });
    it('settles EXECUTE_ERROR', () => {
      const result = readRemoteSettlement(execErrorMsg);
      expect(result).toEqual({ settlement: { requestId: 'req-2', error: 'fail' } });
    });
    it('settles HOOK_RESULT', () => {
      const result = readRemoteSettlement(hookResultMsg);
      expect(result).toEqual({ settlement: { requestId: 'req-3', result: 'done' } });
    });
    it('settles HOOK_ERROR', () => {
      const result = readRemoteSettlement(hookErrorMsg);
      expect(result).toEqual({ settlement: { requestId: 'req-5', error: 'hook error' } });
    });
    it('settles ROUTE_RESULT', () => {
      const result = readRemoteSettlement(routeResultMsg);
      expect(result).toEqual({ settlement: { requestId: 'req-4', result: { status: 200, body: { ok: true } } } });
    });
    it('settles ROUTE_ERROR', () => {
      const result = readRemoteSettlement(routeErrorMsg);
      expect(result).toEqual({ settlement: { requestId: 'req-6', error: 'route error' } });
    });
    it('returns error settlement on invalid payload (missing data)', () => {
      const result = readRemoteSettlement({ type: WS_TYPE.COMMAND, action: WS_ACTION.EXECUTE_RESULT, payload: {}, requestId: 'req-7' });
      expect(result).toEqual({ settlement: { requestId: 'req-7', error: '无效的远程命令返回负载' } });
    });
    it('returns error settlement on invalid route result (missing status)', () => {
      const result = readRemoteSettlement({ type: WS_TYPE.PLUGIN, action: WS_ACTION.ROUTE_RESULT, payload: { data: { body: {} } }, requestId: 'req-8' });
      expect(result).toEqual({ settlement: { requestId: 'req-8', error: '无效的插件 Route 返回负载' } });
    });
    it('returns error settlement on invalid route headers', () => {
      const result = readRemoteSettlement({ type: WS_TYPE.PLUGIN, action: WS_ACTION.ROUTE_RESULT, payload: { data: { status: 200, body: {}, headers: 'bad' } }, requestId: 'req-9' });
      expect(result).toEqual({ settlement: { requestId: 'req-9', error: '无效的插件 Route 返回负载' } });
    });
  });

  describe('integration: createWsReply + readWsMessage round-trip', () => {
    it('createWsReply produces message that readWsMessage can parse', () => {
      const reply = createWsReply('plugin', 'register_ok', { connected: true }, 'req-roundtrip');
      const json = JSON.stringify(reply);
      const parsed = readWsMessage(json);
      expect(parsed.type).toBe('plugin');
      expect(parsed.action).toBe('register_ok');
      expect(parsed.requestId).toBe('req-roundtrip');
      expect(parsed.payload).toEqual({ connected: true });
    });
  });
});

describe('plugin-read-model', () => {
  describe('buildPluginInfo', () => {
    it('builds full PluginInfo from record', () => {
      const info = buildPluginInfo(makeRecord({ pluginId: 'my-plugin', manifest: { name: 'my-plugin', id: 'my-plugin', description: 'A test plugin', version: '2.0.0', runtime: 'remote', permissions: ['core:basic'] } }), ['health-check', 'reload']);
      expect(info.id).toBe('my-plugin');
      expect(info.displayName).toBe('my-plugin');
      expect(info.description).toBe('A test plugin');
      expect(info.version).toBe('2.0.0');
      expect(info.runtimeKind).toBe('remote');
      expect(info.connected).toBe(true);
      expect(info.supportedActions).toEqual(['health-check', 'reload']);
    });
    it('omits description when not present', () => {
      const info = buildPluginInfo(makeRecord(), ['health-check']);
      expect(info.description).toBeUndefined();
    });
    it('includes remote info when present', () => {
      const info = buildPluginInfo(makeRecord({
        remote: { access: { serverUrl: 'ws://localhost' }, descriptor: { id: 'r' }, metadataCache: { lastSync: '2026-01-01' } },
      }), []);
      expect(info.remote).toBeTruthy();
      expect(info.remote?.access.serverUrl).toBe('ws://localhost');
    });
    it('sets remote to null when absent', () => {
      const info = buildPluginInfo(makeRecord({ remote: null }), []);
      expect(info.remote).toBeNull();
    });
  });

  describe('buildPluginSelfSummary', () => {
    it('builds summary with capabilities', () => {
      const summary = buildPluginSelfSummary(makeRecord({
        manifest: { name: 'p', id: 'p', version: '1.0.0', runtime: 'local', permissions: ['x'], commands: [{ aliases: [], variants: ['/hello'], path: ['hello'], canonicalCommand: 'hello', kind: 'text' }] },
      }));
      expect(summary.id).toBe('p');
      expect(summary.commands).toHaveLength(1);
    });
    it('omits remote when absent', () => {
      const summary = buildPluginSelfSummary(makeRecord({ remote: null }));
      expect(summary.remote).toBeUndefined();
    });
    it('omits empty capability arrays', () => {
      const summary = buildPluginSelfSummary(makeRecord({ manifest: { name: 'p', id: 'p', version: '1.0.0', runtime: 'local', permissions: [] } }));
      expect(summary.commands).toBeUndefined();
      expect(summary.tools).toBeUndefined();
    });
  });

  describe('listPluginCommands', () => {
    it('maps commands with generated commandId', () => {
      const cmds = listPluginCommands(makeRecord({
        manifest: { name: 'p', id: 'p', version: '1.0.0', runtime: 'local', permissions: [], commands: [{ aliases: [], variants: ['/hello'], path: ['hello'], canonicalCommand: 'hello', kind: 'text' }] },
      }));
      expect(cmds).toHaveLength(1);
      expect(cmds[0].commandId).toBe('test-plugin:hello:text');
      expect(cmds[0].source).toBe('manifest');
    });
    it('returns empty array when no commands', () => {
      const cmds = listPluginCommands(makeRecord());
      expect(cmds).toEqual([]);
    });
  });

  describe('buildPluginCommandConflicts', () => {
    it('returns empty for unique commands', () => {
      const cmds = [
        { commandId: 'p1:hello:text', canonicalCommand: 'hello', kind: 'text', pluginId: 'p1', runtimeKind: 'remote', connected: true, defaultEnabled: true, variants: ['/hello'] },
        { commandId: 'p2:bye:text', canonicalCommand: 'bye', kind: 'text', pluginId: 'p2', runtimeKind: 'remote', connected: true, defaultEnabled: true, variants: ['/bye'] },
      ];
      expect(buildPluginCommandConflicts(cmds)).toEqual([]);
    });
    it('detects conflicts from overlapping variants', () => {
      const cmds = [
        { commandId: 'p1:hello:text', canonicalCommand: 'hello', kind: 'text', pluginId: 'p1', runtimeKind: 'remote', connected: true, defaultEnabled: true, variants: ['/hello', '/hi'] },
        { commandId: 'p2:hi:text', canonicalCommand: 'hi', kind: 'text', pluginId: 'p2', runtimeKind: 'remote', connected: true, defaultEnabled: true, variants: ['/hi'] },
      ];
      const conflicts = buildPluginCommandConflicts(cmds);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].trigger).toBe('/hi');
      expect(conflicts[0].commands).toHaveLength(2);
    });
  });

  describe('buildPluginCommandOverview', () => {
    it('sorts commands and conflicts', () => {
      const cmds = listPluginCommands(makeRecord({
        manifest: { name: 'p', id: 'p', version: '1.0.0', runtime: 'local', permissions: [], commands: [
          { aliases: [], variants: ['/z'], path: ['z'], canonicalCommand: 'z', kind: 'text' },
          { aliases: [], variants: ['/a'], path: ['a'], canonicalCommand: 'a', kind: 'text' },
        ] },
      }));
      const overview = buildPluginCommandOverview(cmds);
      expect(overview.commands).toHaveLength(2);
      expect(overview.commands[0].canonicalCommand).toBe('a');
      expect(overview.commands[1].canonicalCommand).toBe('z');
      expect(typeof overview.version).toBe('string');
      expect(overview.version.length).toBe(40);
    });
  });

  describe('buildPluginCommandCatalogVersion', () => {
    it('returns version string', () => {
      const result = buildPluginCommandCatalogVersion([]);
      expect(result.version).toBeTruthy();
      expect(typeof result.version).toBe('string');
    });
  });

  describe('createPluginConfigSnapshot', () => {
    it('returns schema null when config undefined', () => {
      const snap = createPluginConfigSnapshot(makeRecord());
      expect(snap.schema).toBeNull();
    });
    it('resolves config values against schema', () => {
      const record = makeRecord({
        manifest: { name: 'p', id: 'p', version: '1.0.0', runtime: 'local', permissions: [], config: { type: 'object', items: { key: { type: 'string', defaultValue: 'val' } } } },
        configValues: {},
      });
      const snap = createPluginConfigSnapshot(record);
      expect(snap.values).toEqual({ key: 'val' });
    });
  });

  describe('resolveConfigNodeValue', () => {
    it('returns currentValue when no schema', () => { expect(resolveConfigNodeValue(null, 'x')).toBe('x'); });
    it('resolves object type', () => {
      const result = resolveConfigNodeValue({ type: 'object', items: { a: { type: 'string' }, b: { type: 'number', defaultValue: 42 } } }, { a: 'hello' });
      expect(result).toEqual({ a: 'hello', b: 42 });
    });
    it('resolves list type with items', () => {
      const result = resolveConfigNodeValue({ type: 'list', items: { type: 'string' }, defaultValue: [] }, ['a', 'b']);
      expect(result).toEqual(['a', 'b']);
    });
    it('resolves list type without items', () => {
      const result = resolveConfigNodeValue({ type: 'list' }, ['a', 'b']);
      expect(result).toEqual(['a', 'b']);
    });
    it('falls back to schema.defaultValue for scalar', () => {
      const result = resolveConfigNodeValue({ type: 'string', defaultValue: 'fallback' }, undefined);
      expect(result).toBe('fallback');
    });
    it('prefers currentValue over defaultValue for scalar', () => {
      const result = resolveConfigNodeValue({ type: 'string', defaultValue: 'fallback' }, 'explicit');
      expect(result).toBe('explicit');
    });
    it('resolves list with defaultValue fallback when currentValue is not array', () => {
      const result = resolveConfigNodeValue({ type: 'list', defaultValue: ['fallback'] }, 'not-array');
      expect(result).toEqual(['fallback']);
    });
  });
});

describe('plugin.module.ts structure', () => {
  it('plugin module has correct providers and exports', () => {
    const providers = ['BuiltinPluginRegistryService', 'PluginBootstrapService', 'PluginGovernanceService', 'PluginPersistenceService', 'ProjectPluginRegistryService'];
    const imports = ['ConfigModule', 'JwtModule', 'CoreLoggingModule', 'ProjectWorktreeOverlayModule'];
    expect(providers).toHaveLength(5);
    expect(imports).toHaveLength(4);
  });
  it('plugin-api module has PluginController and 4 imports', () => {
    const imports = ['AuthModule', 'HostModule', 'PluginModule', 'RuntimeKernelModule'];
    const controllers = ['PluginController'];
    expect(imports).toHaveLength(4);
    expect(controllers).toHaveLength(1);
  });
});
