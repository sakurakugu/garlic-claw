import { describe, it, expect } from 'vitest'
import type {
  PluginRuntimeKind, PluginPermission, PluginHookName, PluginHookFilterDescriptor,
  PluginHookMessageFilter, PluginRegexFilterDescriptor, PluginMessageKind,
  PluginCommandDescriptor, PluginCommandKind, PluginInvocationSource, PluginActionName,
  PluginParamSchema, PluginRemoteEnvironment, PluginAuthMode, PluginCapabilityProfile,
  PluginRemoteAuthDescriptor, PluginRemoteDescriptor,
  PluginHookDescriptor, PluginConfigNodeType, PluginConfigNodeSchema,
  PluginConfigSchema, PluginConfigSnapshot, PluginCallContext,
  PluginLlmPreferenceMode, PluginLlmPreference, PluginScopeSettings,
  WsMessage, AuthPayload, RemotePluginConnectionInfo, PluginRemoteAccessConfig,
  PluginCapability,
  PluginManifest, RegisterPayload, ExecutePayload, ExecuteErrorPayload,
  HookInvokePayload, HookResultPayload, PluginBuiltinRole, PluginGovernanceInfo,
  PluginCommandInfo, PluginCommandConflictEntry, PluginCommandConflict,
  PluginCommandOverview, PluginInfo, PluginStatus,
  PluginLifecycleHookInfo, PluginLoadedHookPayload, PluginUnloadedHookPayload, PluginErrorHookPayload,
  PluginHostMethod, HostCallPayload, HostResultPayload,
  PluginCronSource, PluginCronDescriptor, PluginCronJobSummary, PluginCronTickPayload,
  PluginRouteMethod, PluginRouteDescriptor, PluginRouteRequest, PluginRouteResponse,
  RouteInvokePayload, RouteResultPayload,
  PluginHealthStatus, PluginEventLevel, EventLogSettings, PluginHealthSnapshot,
  EventLogRecord, EventLogQuery, EventLogListResult, PluginStorageEntry,
  PluginScopedStateScope, PluginSelfInfo, PluginActionResult,
  PluginPersonaSummary, PluginPersonaDetail, PluginPersonaCurrentInfo,
  PluginPersonaUpsertInput, PluginPersonaUpdateInput, PluginPersonaDeleteResult,
  PluginKbEntrySummary, PluginKbEntryDetail,
  PluginSubagentTypeSummary, PluginSubagentHandle, PluginSubagentWaitResult,
  PluginSubagentSummary, PluginSubagentDetail, PluginSubagentOverview,
  PluginToolTextOutput, PluginToolJsonOutput, PluginToolOutput,
  PluginRuntimeCommandParams, PluginRuntimeCommandResult, PluginRuntimeCommandStreamStats,
  PluginRuntimeReadParams, PluginRuntimeReadResult, PluginRuntimeGlobParams, PluginRuntimeGlobResult,
  PluginRuntimeGrepParams, PluginRuntimeWriteParams, PluginRuntimeWriteResult,
  PluginRuntimeEditParams, PluginRuntimeEditResult, PluginRuntimeBackendResult,
  PluginRuntimeSearchSkippedReason, PluginRuntimeFileDiffSummary,
  PluginRuntimeDiagnosticEntry, PluginRuntimeDiagnosticSeverityCounts,
  PluginRuntimePostWriteResult, PluginRuntimePostWriteSummary,
  McpEnvValueSource, McpServerEnvEntry, McpServerConfig, McpConfigSnapshot, McpServerDeleteResult,
  ToolSourceKind, ToolHealthStatus, ToolSourceInfo, ToolInfo, ToolSourceActionResult, ToolOverview,
  SkillSourceKind, SkillLoadPolicy, SkillGovernanceInfo, SkillAssetKind, SkillAssetSummary,
  SkillSummary, SkillDetail, SkillLoadResult,
} from '@garlic-claw/shared'

describe('Plugin core types', () => {
  it('PluginRuntimeKind is local or remote', () => {
    const kinds: PluginRuntimeKind[] = ['local', 'remote']
    expect(kinds).toContain('local')
  })

  it('PluginPermission has all expected entries', () => {
    const perms: PluginPermission[] = [
      'automation:read', 'automation:write', 'conversation:read', 'conversation:write',
      'llm:generate', 'memory:read', 'storage:read', 'storage:write',
      'subagent:run', 'runtime:command',
    ]
    perms.forEach(p => expect(typeof p).toBe('string'))
  })

  it('PluginCallContext has optional metadata', () => {
    const ctx: PluginCallContext = { source: 'chat-tool' }
    expect(ctx.source).toBe('chat-tool')
    expect(ctx.userId).toBeUndefined()
  })

  it('PluginCallContext - all invocation sources', () => {
    const sources: PluginInvocationSource[] = ['chat-tool', 'chat-hook', 'cron', 'automation', 'http-route', 'subagent', 'plugin']
    const ctx: PluginCallContext = { source: 'subagent', conversationId: 'c1', userId: 'u1' }
    expect(sources).toContain(ctx.source)
    expect(ctx.conversationId).toBe('c1')
  })

  it('PluginParamSchema supports all types', () => {
    const schemas: PluginParamSchema[] = [
      { type: 'string' }, { type: 'number', description: 'count' }, { type: 'boolean', required: true },
      { type: 'object' }, { type: 'array' },
    ]
    expect(schemas.find(s => s.type === 'boolean')?.required).toBe(true)
  })

  it('PluginHookDescriptor has optional filter', () => {
    const hk: PluginHookDescriptor = { name: 'message:received', filter: { message: { commands: ['/help'] } } }
    expect(hk.filter?.message?.commands).toContain('/help')
  })

  it('PluginConfigNodeSchema discriminated union', () => {
    const str: PluginConfigNodeSchema = { type: 'string', description: 'name' }
    const num: PluginConfigNodeSchema = { type: 'int', defaultValue: 42 }
    const bool: PluginConfigNodeSchema = { type: 'bool' }
    const list: PluginConfigNodeSchema = { type: 'list', items: { type: 'string' } }
    const obj: PluginConfigNodeSchema = { type: 'object', items: { key: { type: 'bool' } } }
    expect(str.type).toBe('string')
    expect(num.defaultValue).toBe(42)
    expect(list.items).toBeDefined()
    expect(obj.items.key.type).toBe('bool')
  })

  it('PluginConfigSchema is a PluginConfigObjectSchema', () => {
    const schema: PluginConfigSchema = { type: 'object', items: { name: { type: 'string' } } }
    expect(schema.type).toBe('object')
  })

  it('WsMessage is generic over payload', () => {
    const msg: WsMessage<string> = { type: 'plugin', action: 'execute', payload: 'data', requestId: 'r1' }
    expect(msg.requestId).toBe('r1')
  })

  it('PluginManifest has all required fields', () => {
    const m: PluginManifest = {
      id: 'p1', name: 'Plugin', version: '1.0', runtime: 'local',
      permissions: ['conversation:read'], tools: [{ name: 'tool', description: 'desc', parameters: {} }],
    }
    expect(m.name).toBe('Plugin')
    expect(m.permissions).toContain('conversation:read')
  })

  it('PluginCapability has name, description, parameters', () => {
    const cap: PluginCapability = { name: 'read_file', description: 'Read a file', parameters: { path: { type: 'string', required: true } } }
    expect(cap.parameters.path.type).toBe('string')
  })

  it('PluginBuiltinRole accepts three roles', () => {
    const roles: PluginBuiltinRole[] = ['user-facing', 'system-optional', 'system-required']
    expect(roles).toContain('system-required')
  })

  it('PluginInfo has health, eventLog, and optional remote', () => {
    const info: PluginInfo = {
      id: 'p1', name: 'P', status: 'online', connected: true, defaultEnabled: true,
      manifest: { id: 'p1', name: 'P', version: '1.0', runtime: 'local', permissions: [], tools: [] },
      eventLog: { maxFileSizeMb: 10 },
      lastSeenAt: null, createdAt: '', updatedAt: '',
    }
    expect(info.status).toBe('online')
    expect(info.eventLog.maxFileSizeMb).toBe(10)
  })
})

describe('Plugin lifecycle types', () => {
  it('PluginLoadedHookPayload includes plugin and loadedAt', () => {
    const p: PluginLifecycleHookInfo = { id: 'p1', runtimeKind: 'local', remote: null, manifest: null }
    const h: PluginLoadedHookPayload = { context: { source: 'chat-hook' }, plugin: p, loadedAt: '2024-01-01T00:00:00Z' }
    expect(h.plugin.id).toBe('p1')
    expect(h.loadedAt).toBeTruthy()
  })

  it('PluginErrorHookPayload has error metadata', () => {
    const p: PluginLifecycleHookInfo = { id: 'p1', runtimeKind: 'remote', remote: { remoteEnvironment: 'api', auth: { mode: 'optional' }, capabilityProfile: 'hybrid' }, manifest: null }
    const h: PluginErrorHookPayload = { context: { source: 'plugin' }, plugin: p, error: { type: 'timeout', message: 'conn failed', metadata: { retry: true } }, occurredAt: '2024-01-01T00:00:00Z' }
    expect(h.error.type).toBe('timeout')
    expect(h.error.metadata?.retry).toBe(true)
  })
})

describe('Plugin host types', () => {
  it('PluginHostMethod is a large string union', () => {
    const methods: PluginHostMethod[] = ['llm.generate', 'conversation.get', 'message.send', 'subagent.spawn', 'runtime.fs.read']
    methods.forEach(m => expect(typeof m).toBe('string'))
  })

  it('HostCallPayload has method and params', () => {
    const h: HostCallPayload = { method: 'llm.generate', params: { providerId: 'o', modelId: 'gpt-4' } }
    expect(h.method).toBe('llm.generate')
    expect(h.params.providerId).toBe('o')
  })
})

describe('Plugin cron types', () => {
  it('PluginCronDescriptor has required name and cron', () => {
    const c: PluginCronDescriptor = { name: 'daily', cron: '0 0 * * *' }
    expect(c.cron).toBe('0 0 * * *')
  })

  it('PluginCronJobSummary has source discriminator', () => {
    const j: PluginCronJobSummary = { id: '1', pluginId: 'p1', name: 'daily', cron: '0 0 * * *', source: 'manifest', enabled: true, lastRunAt: null, lastError: null, lastErrorAt: null, createdAt: '', updatedAt: '' }
    expect(j.source).toBe('manifest')
  })
})

describe('Plugin route types', () => {
  it('PluginRouteDescriptor has path and methods', () => {
    const r: PluginRouteDescriptor = { path: '/api/hello', methods: ['GET', 'POST'] }
    expect(r.methods).toContain('GET')
  })

  it('PluginRouteResponse has status and body', () => {
    const r: PluginRouteResponse = { status: 200, body: { ok: true } }
    expect(r.status).toBe(200)
  })
})

describe('Plugin records types', () => {
  it('PluginHealthStatus accepts all states', () => {
    const states: PluginHealthStatus[] = ['unknown', 'healthy', 'degraded', 'error', 'offline']
    expect(states).toContain('degraded')
  })

  it('PluginHealthSnapshot has failure counters', () => {
    const h: PluginHealthSnapshot = { status: 'healthy', failureCount: 0, consecutiveFailures: 0, lastError: null, lastErrorAt: null, lastSuccessAt: null, lastCheckedAt: null }
    expect(h.failureCount).toBe(0)
  })

  it('EventLogRecord has type, level, message', () => {
    const r: EventLogRecord = { id: '1', type: 'error', level: 'error', message: 'fail', metadata: null, createdAt: '' }
    expect(r.level).toBe('error')
  })

  it('PluginSelfInfo aggregates plugin identity', () => {
    const s: PluginSelfInfo = { id: 'p1', name: 'P', runtimeKind: 'local', permissions: ['storage:read'] }
    expect(s.id).toBe('p1')
  })

  it('PluginPersonaSummary has required identity fields', () => {
    const p: PluginPersonaSummary = { id: 'pe1', name: 'Assistant', avatar: null, isDefault: false, createdAt: '', updatedAt: '' }
    expect(p.name).toBe('Assistant')
  })

  it('PluginPersonaDetail extends summary with prompt', () => {
    const p: PluginPersonaDetail = { id: 'pe1', name: 'A', avatar: null, isDefault: false, createdAt: '', updatedAt: '', prompt: 'You are...', beginDialogs: [], toolNames: null, customErrorMessage: null }
    expect(p.prompt).toContain('You are')
  })
})

describe('Plugin subagent types', () => {
  it('PluginSubagentSummary has runtimeKind and status', () => {
    const s: PluginSubagentSummary = { conversationId: 'c1', title: 'sub', messageCount: 5, updatedAt: '', pluginId: 'p1', runtimeKind: 'local', status: 'running', requestPreview: '...', requestedAt: '', startedAt: null, finishedAt: null, closedAt: null }
    expect(s.status).toBe('running')
  })

  it('PluginSubagentDetail adds request and context', () => {
    const d: PluginSubagentDetail = { conversationId: 'c1', title: 'sub', messageCount: 0, updatedAt: '', pluginId: 'p1', runtimeKind: 'local', status: 'completed', requestPreview: '', resultPreview: 'done', requestedAt: '', startedAt: null, finishedAt: null, closedAt: null, request: { messages: [{ role: 'user', content: 'hi' }] }, context: { source: 'plugin' } }
    expect(d.resultPreview).toBe('done')
    expect(d.request.messages[0].content).toBe('hi')
  })
})

describe('Plugin tool output types', () => {
  it('PluginToolOutput discriminated by kind', () => {
    const text: PluginToolOutput = { kind: 'tool:text', value: 'result' }
    const json: PluginToolOutput = { kind: 'tool:json', value: { ok: true } }
    expect(text.kind).toBe('tool:text')
    expect(json.kind).toBe('tool:json')
  })
})

describe('Plugin runtime tools types', () => {
  it('PluginRuntimeCommandParams has command and description', () => {
    const p: PluginRuntimeCommandParams = { command: 'ls', description: 'list files' }
    expect(p.command).toBe('ls')
  })

  it('PluginRuntimeCommandResult has exit code and streams', () => {
    const stats: PluginRuntimeCommandStreamStats = { bytes: 100, lines: 5 }
    const r: PluginRuntimeCommandResult = { backendKind: 'pwsh', cwd: '/', exitCode: 0, sessionId: 's1', stderr: '', stderrStats: stats, stdout: 'ok', stdoutStats: stats }
    expect(r.exitCode).toBe(0)
  })

  it('PluginRuntimeReadResult bundles readResult with freshness', () => {
    const fileResult: PluginRuntimeBackendResult = { type: 'file', path: '/a.txt', lines: ['hi'], totalLines: 1, totalBytes: 2, offset: 0, limit: 100, mimeType: 'text/plain', truncated: false, byteLimited: false }
    const r: PluginRuntimeReadResult = { freshnessReminders: [], loaded: ['/a.txt'], readResult: fileResult, reminderEntries: [] }
    expect(r.readResult.type).toBe('file')
  })

  it('PluginRuntimeWriteResult has status discriminator', () => {
    const diff: PluginRuntimeFileDiffSummary = { additions: 1, afterLineCount: 2, beforeLineCount: 1, deletions: 0, patch: '@@...' }
    const w: PluginRuntimeWriteResult = { created: true, diff, lineCount: 2, path: '/a.txt', postWrite: { diagnostics: [], formatting: null }, size: 10, status: 'created' }
    expect(w.status).toBe('created')
    expect(w.created).toBe(true)
  })

  it('PluginRuntimeEditResult has strategy field', () => {
    const diff: PluginRuntimeFileDiffSummary = { additions: 1, afterLineCount: 3, beforeLineCount: 2, deletions: 1, patch: '@@...' }
    const e: PluginRuntimeEditResult = { diff, occurrences: 1, path: '/a.txt', postWrite: { diagnostics: [], formatting: null }, strategy: 'exact' }
    expect(e.strategy).toBe('exact')
  })
})

describe('Tool types (from tool.ts)', () => {
  it('ToolSourceKind accepts all variants', () => {
    const kinds: ToolSourceKind[] = ['internal', 'plugin', 'mcp', 'skill']
    expect(kinds).toContain('mcp')
  })

  it('ToolSourceInfo aggregates source metadata', () => {
    const s: ToolSourceInfo = { kind: 'plugin', id: 'p1', label: 'P', enabled: true, totalTools: 3, enabledTools: 3, health: 'healthy' }
    expect(s.totalTools).toBe(3)
    expect(s.health).toBe('healthy')
  })

  it('McpEnvValueSource is a union of three values', () => {
    const sources: McpEnvValueSource[] = ['env-ref', 'literal', 'stored-secret']
    expect(sources).toContain('env-ref')
  })

  it('McpServerConfig has envEntries for structured env', () => {
    const cfg: McpServerConfig = { name: 'tavily', command: 'npx', args: ['tavily-mcp'], env: {}, envEntries: [{ key: 'API_KEY', source: 'literal', value: 'abc' }], eventLog: { maxFileSizeMb: 1 } }
    expect(cfg.envEntries![0].source).toBe('literal')
  })
})

describe('Skill types', () => {
  it('SkillSourceKind is currently just project', () => {
    const kinds: SkillSourceKind[] = ['project']
    expect(kinds).toContain('project')
  })

  it('SkillLoadPolicy accepts allow/ask/deny', () => {
    const policies: SkillLoadPolicy[] = ['allow', 'ask', 'deny']
    expect(policies).toContain('allow')
  })

  it('SkillSummary has governance info', () => {
    const s: SkillSummary = { id: 's1', name: 'Weather', description: 'Get weather', tags: ['weather'], sourceKind: 'project', entryPath: 'weather.md', promptPreview: '...', governance: { loadPolicy: 'ask', eventLog: { maxFileSizeMb: 5 } } }
    expect(s.governance.loadPolicy).toBe('ask')
  })

  it('SkillDetail extends summary with content and assets', () => {
    const s: SkillDetail = { id: 's1', name: 'W', description: 'desc', tags: [], sourceKind: 'project', entryPath: 'w.md', promptPreview: '...', governance: { loadPolicy: 'allow', eventLog: { maxFileSizeMb: 1 } }, content: '# Weather', assets: [{ path: 'ref.py', kind: 'script', textReadable: true, executable: false }] }
    expect(s.content).toBe('# Weather')
    expect(s.assets[0].kind).toBe('script')
  })
})
