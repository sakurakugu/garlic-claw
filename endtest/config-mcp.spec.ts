import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── 类型定义（从 @garlic-claw/shared 对齐） ───

type McpEnvValueSource = 'env-ref' | 'literal' | 'stored-secret';

interface EventLogSettings {
  maxFileSizeMb: number;
}

interface McpServerEnvEntry {
  key: string;
  source: McpEnvValueSource;
  value: string;
  hasStoredValue?: boolean;
}

interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  envEntries?: McpServerEnvEntry[];
  eventLog: EventLogSettings;
}

// ─── 内联纯函数（对齐 mcp-server-store.service.ts） ───

function normalizeEventLogSettings(settings?: EventLogSettings | null): EventLogSettings {
  return !settings || typeof settings.maxFileSizeMb !== 'number' || Number.isNaN(settings.maxFileSizeMb)
    ? { maxFileSizeMb: 1 }
    : { maxFileSizeMb: Math.max(0, settings.maxFileSizeMb) };
}

function isEnvReference(value: string): boolean {
  return value.startsWith('${') && value.endsWith('}');
}

function normalizeEnvMap(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env)
      .map(([key, value]) => [key.trim(), value.trim()] as const)
      .filter(([key, value]) => key.length > 0 && value.length > 0),
  );
}

function normalizeIncomingEnvEntries(
  envEntries: McpServerEnvEntry[] | undefined,
  env: Record<string, string>,
): McpServerEnvEntry[] {
  if (!Array.isArray(envEntries) || envEntries.length === 0) {
    return Object.entries(normalizeEnvMap(env)).map(([key, value]) => ({
      key,
      source: isEnvReference(value) ? 'env-ref' as const : 'literal' as const,
      value,
    }));
  }
  return envEntries
    .map((entry) => ({
      key: entry.key.trim(),
      source: entry.source,
      value: entry.value.trim(),
      ...(entry.hasStoredValue ? { hasStoredValue: true } : {}),
    }))
    .filter((entry) => entry.key.length > 0);
}

function mergeEnvEntries(
  configEnv: Record<string, string>,
  secretEnv: Record<string, string>,
  exposeStoredSecretValue: boolean,
): McpServerEnvEntry[] {
  const entriesByKey = new Map<string, McpServerEnvEntry>();
  for (const [key, value] of Object.entries(configEnv)) {
    entriesByKey.set(key, {
      key,
      source: isEnvReference(value) ? 'env-ref' : 'literal',
      value,
    });
  }
  for (const [key, value] of Object.entries(secretEnv)) {
    entriesByKey.set(key, {
      key,
      source: 'stored-secret',
      value: exposeStoredSecretValue ? value : '',
      hasStoredValue: true,
    });
  }
  return [...entriesByKey.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function toStoredServerRecord(raw: Record<string, unknown>, fallbackName: string): McpServerConfig | null {
  const name = typeof raw.name === 'string' && raw.name.trim().length > 0
    ? raw.name.trim()
    : fallbackName;
  const command = typeof raw.command === 'string' ? raw.command.trim() : '';
  if (!name || !command || !Array.isArray(raw.args)) {
    return null;
  }

  const envObj = typeof raw.env === 'object' && raw.env !== null ? raw.env as Record<string, string> : {};
  return {
    name,
    command,
    args: raw.args.filter((value): value is string => typeof value === 'string'),
    env: Object.fromEntries(
      Object.entries(envObj).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    ),
    eventLog: normalizeEventLogSettings(raw.eventLog as EventLogSettings | undefined),
  };
}

function readVisibleEnv(
  env: Record<string, string>,
  envEntries: McpServerEnvEntry[] | undefined,
  fallbackEnv: Record<string, string>,
): Record<string, string> {
  const envFromField = normalizeEnvMap(env);
  const normalizedEntries = normalizeIncomingEnvEntries(envEntries, env);
  const visibleEntries = normalizedEntries
    .filter((entry) => entry.source !== 'stored-secret')
    .map((entry) => [entry.key, entry.value] as const);
  if (
    Array.isArray(envEntries)
    && envEntries.length > 0
    && visibleEntries.length === 0
    && Object.keys(envFromField).length === 0
  ) {
    return { ...fallbackEnv };
  }
  return {
    ...envFromField,
    ...Object.fromEntries(visibleEntries),
  };
}

// ─── 文件助手 ───

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T : fallback;
  } catch {
    return fallback;
  }
}

const TAVILY_PATH = path.resolve(__dirname, '..', 'config', 'mcp', 'servers', 'tavily-mcp.json');

// ========================================================================
// 测试
// ========================================================================

describe('config/mcp/ 配置模块', () => {

  // ── 1. tavily-mcp.json 结构验证 ──

  describe('1. tavily-mcp.json 结构验证', () => {
    let tavily: Record<string, unknown>;

    beforeAll(() => {
      tavily = readJsonFile<Record<string, unknown>>(TAVILY_PATH, {});
      expect(Object.keys(tavily).length).toBeGreaterThan(0);
    });

    it('顶级键完整：name, command, args, env, eventLog', () => {
      expect(tavily).toHaveProperty('name');
      expect(tavily).toHaveProperty('command');
      expect(tavily).toHaveProperty('args');
      expect(tavily).toHaveProperty('env');
      expect(tavily).toHaveProperty('eventLog');
    });

    it('name 为 "tavily-mcp"', () => {
      expect(tavily.name).toBe('tavily-mcp');
    });

    it('command 为 "npx"', () => {
      expect(tavily.command).toBe('npx');
    });

    describe('args', () => {
      it('包含 -y 和 tavily-mcp@latest', () => {
        const args = tavily.args as string[];
        expect(args).toContain('-y');
        expect(args).toContain('tavily-mcp@latest');
      });

      it('args 为字符串数组', () => {
        const args = tavily.args as unknown[];
        expect(Array.isArray(args)).toBe(true);
        for (const arg of args) {
          expect(typeof arg).toBe('string');
        }
      });
    });

    describe('env', () => {
      let env: Record<string, unknown>;

      beforeAll(() => {
        env = tavily.env as Record<string, unknown>;
        expect(env).toBeTruthy();
      });

      it('包含 DEFAULT_PARAMETERS 键', () => {
        expect(env).toHaveProperty('DEFAULT_PARAMETERS');
      });

      it('DEFAULT_PARAMETERS 为 JSON 字符串', () => {
        expect(typeof env.DEFAULT_PARAMETERS).toBe('string');
        const parsed = JSON.parse(env.DEFAULT_PARAMETERS as string);
        expect(parsed).toHaveProperty('include_images');
        expect(parsed).toHaveProperty('max_results');
        expect(parsed).toHaveProperty('search_depth');
      });

      it('DEFAULT_PARAMETERS 包含 include_images: true, max_results: 15, search_depth: "advanced"', () => {
        const parsed = JSON.parse(env.DEFAULT_PARAMETERS as string);
        expect(parsed.include_images).toBe(true);
        expect(parsed.max_results).toBe(15);
        expect(parsed.search_depth).toBe('advanced');
      });

      it('不包含未知顶级键', () => {
        const knownKeys = ['DEFAULT_PARAMETERS'];
        for (const key of Object.keys(env)) {
          expect(knownKeys.includes(key)).toBe(true);
        }
      });
    });

    describe('eventLog', () => {
      let eventLog: Record<string, unknown>;

      beforeAll(() => {
        eventLog = tavily.eventLog as Record<string, unknown>;
        expect(eventLog).toBeTruthy();
      });

      it('包含 maxFileSizeMb', () => {
        expect(eventLog).toHaveProperty('maxFileSizeMb');
      });

      it('maxFileSizeMb 为 1', () => {
        expect(eventLog.maxFileSizeMb).toBe(1);
      });

      it('不包含未知字段', () => {
        const knownKeys = ['maxFileSizeMb'];
        for (const key of Object.keys(eventLog)) {
          expect(knownKeys.includes(key)).toBe(true);
        }
      });
    });

    it('toStoredServerRecord 能正确解析 tavily-mcp.json', () => {
      const result = toStoredServerRecord(tavily as Record<string, unknown>, 'fallback');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('tavily-mcp');
      expect(result!.command).toBe('npx');
      expect(result!.args).toEqual(['-y', 'tavily-mcp@latest']);
      expect(result!.env).toEqual({
        DEFAULT_PARAMETERS: '{"include_images": true, "max_results": 15, "search_depth": "advanced"}',
      });
      expect(result!.eventLog).toEqual({ maxFileSizeMb: 1 });
    });
  });

  // ── 2. 环境变量引用检测 ──

  describe('2. isEnvReference 环境变量引用检测', () => {
    it('匹配标准 ${VAR} 格式', () => {
      expect(isEnvReference('${TAVILY_API_KEY}')).toBe(true);
      expect(isEnvReference('${PATH}')).toBe(true);
      expect(isEnvReference('${HOME}')).toBe(true);
    });

    it('拒绝非引用字符串', () => {
      expect(isEnvReference('TAVILY_API_KEY')).toBe(false);
      expect(isEnvReference('${TAVILY_API_KEY')).toBe(false);
      expect(isEnvReference('TAVILY_API_KEY}')).toBe(false);
      expect(isEnvReference('')).toBe(false);
      expect(isEnvReference('${}')).toBe(true);
    });

    it('容许带内部空格的模式（源码仅检查首尾）', () => {
      expect(isEnvReference('${ VAR}')).toBe(true);
      expect(isEnvReference('${VAR }')).toBe(true);
      expect(isEnvReference('$ {VAR}')).toBe(false);
    });
  });

  // ── 3. normalizeEnvMap 环境映射规范化 ──

  describe('3. normalizeEnvMap 环境映射规范化', () => {
    it('trim key 和 value', () => {
      expect(normalizeEnvMap({ ' KEY ': ' VALUE ' })).toEqual({ KEY: 'VALUE' });
    });

    it('过滤空 key', () => {
      expect(normalizeEnvMap({ '': 'value', 'key': 'v' })).toEqual({ key: 'v' });
    });

    it('过滤空 value', () => {
      expect(normalizeEnvMap({ 'key': '', ' ' : 'value' })).toEqual({});
    });

    it('空对象返回空对象', () => {
      expect(normalizeEnvMap({})).toEqual({});
    });
  });

  // ── 4. normalizeIncomingEnvEntries ──

  describe('4. normalizeIncomingEnvEntries', () => {
    it('envEntries 未定义时从 env 推断 source', () => {
      const result = normalizeIncomingEnvEntries(undefined, { API_KEY: '${KEY}', DEBUG: 'true' });
      expect(result).toContainEqual({ key: 'API_KEY', source: 'env-ref', value: '${KEY}' });
      expect(result).toContainEqual({ key: 'DEBUG', source: 'literal', value: 'true' });
    });

    it('envEntries 空数组时从 env 推断', () => {
      const result = normalizeIncomingEnvEntries([], { FOO: 'bar' });
      expect(result).toEqual([{ key: 'FOO', source: 'literal', value: 'bar' }]);
    });

    it('使用 envEntries 时 trim 字段值', () => {
      const result = normalizeIncomingEnvEntries(
        [{ key: ' KEY ', source: 'env-ref', value: ' ${VAL} ' }],
        {},
      );
      expect(result).toEqual([{ key: 'KEY', source: 'env-ref', value: '${VAL}' }]);
    });

    it('过滤空 key 条目', () => {
      const result = normalizeIncomingEnvEntries(
        [
          { key: '', source: 'literal', value: 'v1' },
          { key: 'valid', source: 'literal', value: 'v2' },
        ],
        {},
      );
      expect(result).toEqual([{ key: 'valid', source: 'literal', value: 'v2' }]);
    });

    it('保留 hasStoredValue', () => {
      const result = normalizeIncomingEnvEntries(
        [{ key: 'SECRET', source: 'stored-secret', value: '', hasStoredValue: true }],
        {},
      );
      expect(result).toEqual([{ key: 'SECRET', source: 'stored-secret', value: '', hasStoredValue: true }]);
    });

    it('不保留未设置的 hasStoredValue', () => {
      const result = normalizeIncomingEnvEntries(
        [{ key: 'K', source: 'env-ref', value: '${V}' }],
        {},
      );
      expect(result[0]).not.toHaveProperty('hasStoredValue');
    });
  });

  // ── 5. mergeEnvEntries ──

  describe('5. mergeEnvEntries', () => {
    it('configEnv 普通值标记为 literal', () => {
      const result = mergeEnvEntries({ KEY: 'value' }, {}, false);
      expect(result).toContainEqual({ key: 'KEY', source: 'literal', value: 'value' });
    });

    it('configEnv 引用值标记为 env-ref', () => {
      const result = mergeEnvEntries({ KEY: '${VAR}' }, {}, false);
      expect(result).toContainEqual({ key: 'KEY', source: 'env-ref', value: '${VAR}' });
    });

    it('secretEnv 覆盖 configEnv 同一 key', () => {
      const result = mergeEnvEntries({ KEY: 'visible' }, { KEY: 'secret' }, false);
      expect(result).toContainEqual({ key: 'KEY', source: 'stored-secret', value: '', hasStoredValue: true });
    });

    it('exposeStoredSecretValue 为 true 时暴露 secret 值', () => {
      const result = mergeEnvEntries({}, { KEY: 'secret-value' }, true);
      expect(result).toContainEqual({ key: 'KEY', source: 'stored-secret', value: 'secret-value', hasStoredValue: true });
    });

    it('结果按 key 排序', () => {
      const result = mergeEnvEntries({ B: '2', A: '1' }, { C: '3' }, false);
      expect(result.map((e) => e.key)).toEqual(['A', 'B', 'C']);
    });
  });

  // ── 6. toStoredServerRecord 服务端记录解析 ──

  describe('6. toStoredServerRecord 服务端记录解析', () => {
    it('解析合法输入', () => {
      const result = toStoredServerRecord({
        name: 'test-server',
        command: 'node',
        args: ['server.js'],
        env: { KEY: 'value' },
        eventLog: { maxFileSizeMb: 2 },
      }, 'fallback');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('test-server');
      expect(result!.command).toBe('node');
      expect(result!.args).toEqual(['server.js']);
      expect(result!.env).toEqual({ KEY: 'value' });
      expect(result!.eventLog).toEqual({ maxFileSizeMb: 2 });
    });

    it('缺失 name 时使用 fallbackName', () => {
      const result = toStoredServerRecord({
        command: 'node',
        args: ['server.js'],
      }, 'fallback-name');
      expect(result!.name).toBe('fallback-name');
    });

    it('空 name 时使用 fallbackName', () => {
      const result = toStoredServerRecord({
        name: '',
        command: 'node',
        args: ['server.js'],
      }, 'fallback');
      expect(result!.name).toBe('fallback');
    });

    it('空白 name 时使用 fallbackName', () => {
      const result = toStoredServerRecord({
        name: '  ',
        command: 'node',
        args: ['server.js'],
      }, 'fallback');
      expect(result!.name).toBe('fallback');
    });

    it('缺失 command 返回 null', () => {
      const result = toStoredServerRecord({
        name: 'test',
        args: ['server.js'],
      }, 'fallback');
      expect(result).toBeNull();
    });

    it('空 command 返回 null', () => {
      const result = toStoredServerRecord({
        name: 'test',
        command: '',
        args: ['server.js'],
      }, 'fallback');
      expect(result).toBeNull();
    });

    it('缺失 args 返回 null', () => {
      const result = toStoredServerRecord({
        name: 'test',
        command: 'node',
      }, 'fallback');
      expect(result).toBeNull();
    });

    it('非数组 args 返回 null', () => {
      const result = toStoredServerRecord({
        name: 'test',
        command: 'node',
        args: 'server.js',
      }, 'fallback');
      expect(result).toBeNull();
    });

    it('过滤 args 中的非字符串值', () => {
      const result = toStoredServerRecord({
        name: 'test',
        command: 'node',
        args: ['valid', 123, null, true],
      }, 'fallback');
      expect(result!.args).toEqual(['valid']);
    });

    it('env 为非对象时降级为空对象', () => {
      const result = toStoredServerRecord({
        name: 'test',
        command: 'node',
        args: ['s.js'],
        env: 'bad',
      }, 'fallback');
      expect(result!.env).toEqual({});
    });

    it('env 为 null 时降级为空对象', () => {
      const result = toStoredServerRecord({
        name: 'test',
        command: 'node',
        args: ['s.js'],
        env: null,
      }, 'fallback');
      expect(result!.env).toEqual({});
    });

    it('env 过滤非字符串 value', () => {
      const result = toStoredServerRecord({
        name: 'test',
        command: 'node',
        args: ['s.js'],
        env: { STR: 'ok', NUM: 123, NULL: null },
      }, 'fallback');
      expect(result!.env).toEqual({ STR: 'ok' });
    });

    it('缺失 eventLog 使用默认值 { maxFileSizeMb: 1 }', () => {
      const result = toStoredServerRecord({
        name: 'test',
        command: 'node',
        args: ['s.js'],
      }, 'fallback');
      expect(result!.eventLog).toEqual({ maxFileSizeMb: 1 });
    });

    it('NaN maxFileSizeMb 使用默认值', () => {
      const result = toStoredServerRecord({
        name: 'test',
        command: 'node',
        args: ['s.js'],
        eventLog: { maxFileSizeMb: NaN },
      }, 'fallback');
      expect(result!.eventLog).toEqual({ maxFileSizeMb: 1 });
    });

    it('负数 maxFileSizeMb 钳制为 0', () => {
      const result = toStoredServerRecord({
        name: 'test',
        command: 'node',
        args: ['s.js'],
        eventLog: { maxFileSizeMb: -5 },
      }, 'fallback');
      expect(result!.eventLog).toEqual({ maxFileSizeMb: 0 });
    });

    it('trim name 和 command', () => {
      const result = toStoredServerRecord({
        name: '  padded-name  ',
        command: '  node  ',
        args: ['s.js'],
      }, 'fallback');
      expect(result!.name).toBe('padded-name');
      expect(result!.command).toBe('node');
    });
  });

  // ── 7. readVisibleEnv ──

  describe('7. readVisibleEnv', () => {
    it('envEntries 未定义时从 env 字段读取', () => {
      const result = readVisibleEnv({ KEY: 'value' }, undefined, {});
      expect(result).toEqual({ KEY: 'value' });
    });

    it('过滤 stored-secret 条目', () => {
      const result = readVisibleEnv(
        {},
        [{ key: 'VISIBLE', source: 'literal', value: 'ok' }, { key: 'SECRET', source: 'stored-secret', value: '' }],
        {},
      );
      expect(result).toEqual({ VISIBLE: 'ok' });
      expect(result).not.toHaveProperty('SECRET');
    });

    it('envEntries 全为 secret 时回退到 fallbackEnv', () => {
      const result = readVisibleEnv(
        {},
        [{ key: 'SECRET', source: 'stored-secret', value: '' }],
        { FALLBACK: 'val' },
      );
      expect(result).toEqual({ FALLBACK: 'val' });
    });

    it('env 字段和 visible envEntries 合并', () => {
      const result = readVisibleEnv(
        { FROM_ENV: 'e1' },
        [{ key: 'FROM_ENTRY', source: 'literal', value: 'e2' }],
        {},
      );
      expect(result).toEqual({ FROM_ENV: 'e1', FROM_ENTRY: 'e2' });
    });

    it('envEntries 覆盖 env 字段同名 key', () => {
      const result = readVisibleEnv(
        { KEY: 'from-env' },
        [{ key: 'KEY', source: 'literal', value: 'from-entry' }],
        {},
      );
      expect(result).toEqual({ KEY: 'from-entry' });
    });
  });

  // ── 8. normalizeEventLogSettings ──

  describe('8. normalizeEventLogSettings', () => {
    it('undefined 返回默认值', () => {
      expect(normalizeEventLogSettings(undefined)).toEqual({ maxFileSizeMb: 1 });
    });

    it('null 返回默认值', () => {
      expect(normalizeEventLogSettings(null)).toEqual({ maxFileSizeMb: 1 });
    });

    it('NaN maxFileSizeMb 返回默认值', () => {
      expect(normalizeEventLogSettings({ maxFileSizeMb: NaN })).toEqual({ maxFileSizeMb: 1 });
    });

    it('负数 maxFileSizeMb 钳制为 0', () => {
      expect(normalizeEventLogSettings({ maxFileSizeMb: -1 })).toEqual({ maxFileSizeMb: 0 });
    });

    it('0 值保留', () => {
      expect(normalizeEventLogSettings({ maxFileSizeMb: 0 })).toEqual({ maxFileSizeMb: 0 });
    });

    it('合法值保留', () => {
      expect(normalizeEventLogSettings({ maxFileSizeMb: 5 })).toEqual({ maxFileSizeMb: 5 });
    });

    it('缺失 maxFileSizeMb 返回默认值', () => {
      expect(normalizeEventLogSettings({} as EventLogSettings)).toEqual({ maxFileSizeMb: 1 });
    });
  });

  // ── 9. 类型风格一致 ──

  describe('9. 类型风格一致', () => {
    it('McpServerConfig 构造正确', () => {
      const config: McpServerConfig = {
        name: 'server',
        command: 'cmd',
        args: [],
        env: { KEY: 'val' },
        eventLog: { maxFileSizeMb: 1 },
      };
      expect(config.name).toBe('server');
      expect(config.command).toBe('cmd');
      expect(config.args).toEqual([]);
      expect(config.env.KEY).toBe('val');
      expect(config.eventLog.maxFileSizeMb).toBe(1);
    });

    it('McpServerConfig 可选字段 envEntries 默认 undefined', () => {
      const config: McpServerConfig = {
        name: 'server',
        command: 'cmd',
        args: [],
        env: {},
        eventLog: { maxFileSizeMb: 1 },
      };
      expect(config.envEntries).toBeUndefined();
    });

    it('McpServerConfig 含 envEntries', () => {
      const config: McpServerConfig = {
        name: 'server',
        command: 'cmd',
        args: [],
        env: {},
        envEntries: [{ key: 'K', source: 'literal', value: 'v' }],
        eventLog: { maxFileSizeMb: 1 },
      };
      expect(config.envEntries!.length).toBe(1);
      expect(config.envEntries![0].key).toBe('K');
    });

    it('McpEnvValueSource 三种值合法', () => {
      const sources: McpEnvValueSource[] = ['env-ref', 'literal', 'stored-secret'];
      expect(sources).toHaveLength(3);
      for (const s of sources) {
        expect(['env-ref', 'literal', 'stored-secret']).toContain(s);
      }
    });

    it('McpServerEnvEntry 构造正确', () => {
      const entry: McpServerEnvEntry = {
        key: 'API_KEY',
        source: 'env-ref',
        value: '${API_KEY}',
      };
      expect(entry.key).toBe('API_KEY');
      expect(entry.source).toBe('env-ref');
      expect(entry.value).toBe('${API_KEY}');
      expect(entry.hasStoredValue).toBeUndefined();
    });

    it('McpServerEnvEntry 含 hasStoredValue', () => {
      const entry: McpServerEnvEntry = {
        key: 'SECRET',
        source: 'stored-secret',
        value: '',
        hasStoredValue: true,
      };
      expect(entry.hasStoredValue).toBe(true);
    });
  });

  // ── 10. 文件系统读写 ──

  describe('10. 文件系统读写', () => {
    const tmpRoot = path.join(os.tmpdir(), `config-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const serversDir = path.join(tmpRoot, 'servers');

    afterAll(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('空目录读取返回空列表', () => {
      fs.mkdirSync(serversDir, { recursive: true });
      const files = fs.readdirSync(serversDir).filter((f) => f.endsWith('.json'));
      expect(files.length).toBe(0);
    });

    it('写入并读取服务器配置', () => {
      const serverData = {
        name: 'test-server',
        command: 'node',
        args: ['index.js'],
        env: { NODE_ENV: 'production' },
        eventLog: { maxFileSizeMb: 5 },
      };
      const filePath = path.join(serversDir, 'test-server.json');
      fs.writeFileSync(filePath, JSON.stringify(serverData, null, 2), 'utf-8');

      const parsed = readJsonFile<Record<string, unknown>>(filePath, {});
      expect(parsed.name).toBe('test-server');
      expect(parsed.command).toBe('node');
      expect(Array.isArray(parsed.args)).toBe(true);
      expect((parsed.env as Record<string, unknown>).NODE_ENV).toBe('production');
      expect((parsed.eventLog as Record<string, unknown>).maxFileSizeMb).toBe(5);
    });

    it('写入并读取含 env-ref 的配置', () => {
      const serverData = {
        name: 'api-server',
        command: 'npx',
        args: ['-y', 'some-mcp'],
        env: { API_KEY: '${API_KEY}', DEBUG: 'true' },
        eventLog: { maxFileSizeMb: 1 },
      };
      const filePath = path.join(serversDir, 'api-server.json');
      fs.writeFileSync(filePath, JSON.stringify(serverData, null, 2), 'utf-8');

      const parsed = readJsonFile<Record<string, unknown>>(filePath, {});
      expect(parsed.name).toBe('api-server');
      expect(parsed.env).toBeDefined();
      expect((parsed.env as Record<string, string>).API_KEY).toBe('${API_KEY}');
      expect((parsed.env as Record<string, string>).DEBUG).toBe('true');
    });

    it('损坏的 JSON 返回 fallback', () => {
      fs.writeFileSync(path.join(serversDir, 'bad.json'), '{ bad json }', 'utf-8');
      const fallback = { custom: 'value' };
      const parsed = readJsonFile<Record<string, unknown>>(path.join(serversDir, 'bad.json'), fallback);
      expect(parsed).toEqual(fallback);
    });

    it('缺失文件返回 fallback', () => {
      const nonExistent = path.join(serversDir, 'nonexistent.json');
      const parsed = readJsonFile<Record<string, unknown>>(nonExistent, null);
      expect(parsed).toBeNull();
    });

    it('非 .json 文件不被加载', () => {
      const txtPath = path.join(serversDir, 'notes.txt');
      fs.writeFileSync(txtPath, 'not json', 'utf-8');
      const files = fs.readdirSync(serversDir).filter((f) => f.endsWith('.json'));
      expect(files).not.toContain('notes.txt');
    });
  });

  // ── 11. 边界条件 ──

  describe('11. 边界条件', () => {
    it('isEnvReference 空字符串返回 false', () => {
      expect(isEnvReference('')).toBe(false);
    });

    it('isEnvReference ${} 返回 true', () => {
      expect(isEnvReference('${}')).toBe(true);
    });

    it('isEnvReference 嵌套 ${} 返回 true', () => {
      expect(isEnvReference('${OUTER_${INNER}}')).toBe(true);
    });

    it('normalizeEnvMap 含空字符串键值对被过滤', () => {
      expect(normalizeEnvMap({ 'key': 'val', '': 'v', 'k': '', ' ': ' ' })).toEqual({ key: 'val' });
    });

    it('normalizeIncomingEnvEntries 混合 source 类型', () => {
      const result = normalizeIncomingEnvEntries(
        [
          { key: 'A', source: 'literal', value: 'a' },
          { key: 'B', source: 'env-ref', value: '${B}' },
          { key: 'C', source: 'stored-secret', value: '', hasStoredValue: true },
        ],
        {},
      );
      expect(result).toHaveLength(3);
      expect(result.find((e) => e.key === 'C')!.hasStoredValue).toBe(true);
    });

    it('toStoredServerRecord 含全部字段', () => {
      const result = toStoredServerRecord({
        name: 'full',
        command: 'cmd',
        args: ['a', 'b'],
        env: { K1: 'v1', K2: '${V2}' },
        eventLog: { maxFileSizeMb: 10 },
      }, 'fallback');
      expect(result!.name).toBe('full');
      expect(result!.command).toBe('cmd');
      expect(result!.args).toEqual(['a', 'b']);
      expect(result!.env).toEqual({ K1: 'v1', K2: '${V2}' });
      expect(result!.eventLog).toEqual({ maxFileSizeMb: 10 });
    });

    it('JSON 多余字段不影响解析', () => {
      const extra = {
        name: 'test',
        command: 'cmd',
        args: [],
        env: {},
        eventLog: { maxFileSizeMb: 1 },
        unknownField: 'should be tolerated',
        extraNested: { a: 1 },
      };
      expect(() => JSON.stringify(extra)).not.toThrow();
      const result = toStoredServerRecord(extra, 'fallback');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('test');
    });

    it('tavily-mcp.json 的 DEFAULT_PARAMETERS 是 env-ref 还是 literal', () => {
      const tavily = readJsonFile<Record<string, unknown>>(TAVILY_PATH, {});
      const env = tavily.env as Record<string, string>;
      for (const value of Object.values(env)) {
        expect(isEnvReference(value)).toBe(false);
      }
    });
  });
});
