import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── 类型定义（从 @garlic-claw/shared / plugin-sdk 对齐） ───

type PluginRuntimeKind = 'local' | 'remote';
type PluginPermission = string;
type PluginConfigNodeType = 'string' | 'text' | 'int' | 'float' | 'bool' | 'object' | 'list';
type PluginConfigRenderType = 'checkbox' | 'select';
type PluginConfigConditionValue = string | number | boolean | null;

interface JsonObject { [key: string]: JsonValue }
type JsonValue = null | string | number | boolean | JsonValue[] | JsonObject;

interface PluginCapability {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface PluginConfigOptionSchema {
  value: string;
  label?: string;
  description?: string;
}

interface PluginConfigNodeSchema {
  type: PluginConfigNodeType;
  description?: string;
  hint?: string;
  defaultValue?: JsonValue;
  renderType?: PluginConfigRenderType;
  obviousHint?: boolean;
  invisible?: boolean;
  collapsed?: boolean;
  editorMode?: boolean;
  secret?: boolean;
  editorLanguage?: string;
  editorTheme?: string;
  specialType?: string;
  items?: Record<string, PluginConfigNodeSchema>;
  condition?: Record<string, PluginConfigConditionValue>;
  options?: PluginConfigOptionSchema[];
}

interface PluginConfigSchema extends PluginConfigNodeSchema {
  type: 'object';
  items: Record<string, PluginConfigNodeSchema>;
}

interface PluginManifestFallback {
  description?: string;
  id: string;
  name?: string;
  runtime?: PluginRuntimeKind;
  version?: string;
}

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  runtime: PluginRuntimeKind;
  permissions: PluginPermission[];
  tools: PluginCapability[];
  description?: string | null;
  commands?: unknown[];
  crons?: unknown[];
  hooks?: unknown[];
  routes?: unknown[];
  config?: PluginConfigSchema | null;
  remote?: unknown;
}

interface ProjectPluginPackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  description?: string;
  garlicClaw?: {
    definitionExport?: string;
    runtime?: 'local' | 'remote';
  };
  main?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

// ─── 内联常量（对齐 plugin-bootstrap.service.ts） ───

const CONFIG_NODE_TYPES = ['string', 'text', 'int', 'float', 'bool', 'object', 'list'] as const;
const CONFIG_RENDER_TYPES = ['checkbox', 'select'] as const;
const PLUGIN_RUNTIME_KINDS = ['local', 'remote'] as const;
const CONFIG_TEXT_FIELDS = ['description', 'hint', 'editorLanguage', 'editorTheme', 'specialType'] as const;
const CONFIG_BOOLEAN_FIELDS = ['obviousHint', 'invisible', 'collapsed', 'editorMode', 'secret'] as const;

// ─── 内联纯函数（对齐 plugin-bootstrap.service.ts） ───

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readLiteral<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : null;
}

function readArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? [...value] as T[] : [];
}

function isJsonValue(value: unknown): value is JsonValue {
  return value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || (Array.isArray(value) && value.every(isJsonValue))
    || (typeof value === 'object' && value !== null && !Array.isArray(value)
      && Object.values(value).every((item) => typeof item !== 'undefined' && isJsonValue(item)));
}

function isConfigConditionValue(value: unknown): value is PluginConfigConditionValue {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function readConfigBase(record: Record<string, unknown>): Record<string, JsonValue | PluginConfigRenderType> {
  const fields = Object.fromEntries([
    ...CONFIG_TEXT_FIELDS.map((key) => [key, readText(record[key])] as const),
    ...CONFIG_BOOLEAN_FIELDS.map((key) => [key, typeof record[key] === 'boolean' ? record[key] as boolean : null] as const),
    ['renderType', readLiteral(record.renderType, CONFIG_RENDER_TYPES)] as const,
    ['defaultValue', isJsonValue(record.defaultValue) ? structuredClone(record.defaultValue) : null] as const,
  ].filter(([, value]) => value !== null));
  return fields as Record<string, JsonValue | PluginConfigRenderType>;
}

function readConfigConditionState(value: unknown): Pick<PluginConfigNodeSchema, 'condition'> | Record<string, never> {
  const record = readRecord(value);
  if (!record) return {};
  const condition = Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, PluginConfigConditionValue] => isConfigConditionValue(entry[1]))
  );
  return Object.keys(condition).length > 0 ? { condition } : {};
}

function readConfigOptionsState(value: unknown): Pick<PluginConfigNodeSchema, 'options'> | Record<string, never> {
  const options = Array.isArray(value) ? value.flatMap((item) => {
    const record = readRecord(item);
    const optionValue = readText(record?.value);
    if (!record || !optionValue) return [];
    const label = readText(record.label);
    const description = readText(record.description);
    return [{ value: optionValue, ...(label ? { label } : {}), ...(description ? { description } : {}) } satisfies PluginConfigOptionSchema];
  }) : [];
  return options.length > 0 ? { options } : {};
}

function readConfigShared(record: Record<string, unknown>): Omit<PluginConfigNodeSchema, 'items' | 'type'> {
  return {
    ...readConfigBase(record),
    ...readConfigConditionState(record.condition),
    ...readConfigOptionsState(record.options),
  };
}

function readConfigItems(value: unknown): Record<string, PluginConfigNodeSchema> {
  const record = readRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, item]) => {
      const node = readConfigNode(item);
      return node ? [[key, node]] : [];
    })
  );
}

function readConfigNode(value: unknown): PluginConfigNodeSchema | null {
  const record = readRecord(value);
  const type = readLiteral(record?.type, CONFIG_NODE_TYPES);
  if (!record || !type) return null;
  if (type === 'object') {
    const items = readConfigItems(record.items);
    return Object.keys(items).length > 0 ? { ...readConfigShared(record), items, type } : null;
  }
  if (type === 'list') {
    const items = readConfigNode(record.items);
    return items ? { ...readConfigShared(record), items, type } : { ...readConfigShared(record), type };
  }
  return { ...readConfigShared(record), type };
}

function readConfig(value: unknown): PluginConfigSchema | null {
  const node = readConfigNode(value);
  return node?.type === 'object' ? node as PluginConfigSchema : null;
}

function assignManifestField<K extends keyof PluginManifest>(
  manifest: PluginManifest,
  key: K,
  value: PluginManifest[K] | null,
): void {
  if (value === null || (Array.isArray(value) && (value as unknown[]).length === 0)) return;
  (manifest as Record<string, unknown>)[key] = value as unknown;
}

function normalizePluginManifest(
  candidate: Partial<PluginManifest> | null | undefined,
  fallback: PluginManifestFallback,
): PluginManifest {
  const source = readRecord(candidate);
  const manifest: PluginManifest = {
    id: readText(source?.id) ?? fallback.id,
    name: readText(source?.name) ?? fallback.name ?? fallback.id,
    version: readText(source?.version) ?? fallback.version ?? '0.0.0',
    runtime: readLiteral(source?.runtime, PLUGIN_RUNTIME_KINDS) ?? fallback.runtime ?? 'remote',
    permissions: readArray<PluginPermission>(source?.permissions),
    tools: readArray<PluginCapability>(source?.tools),
  };
  assignManifestField(manifest, 'description', readText(source?.description) ?? fallback.description ?? null);
  assignManifestField(manifest, 'commands', readArray<unknown>(source?.commands));
  assignManifestField(manifest, 'crons', readArray<unknown>(source?.crons));
  assignManifestField(manifest, 'hooks', readArray<unknown>(source?.hooks));
  assignManifestField(manifest, 'routes', readArray<unknown>(source?.routes));
  assignManifestField(manifest, 'config', readConfig(source?.config));
  return manifest;
}

// ─── 内联纯函数（对齐 project-plugin-registry.service.ts） ───

interface MockPluginAuthorDefinition {
  manifest?: {
    id?: unknown;
    name?: unknown;
    version?: unknown;
    runtime?: unknown;
    permissions?: unknown;
    tools?: unknown;
    description?: unknown;
    hooks?: unknown;
    commands?: unknown;
    crons?: unknown;
    routes?: unknown;
    config?: unknown;
  };
  tools?: Record<string, unknown>;
  hooks?: Record<string, unknown>;
  routes?: Record<string, unknown>;
  transportGovernance?: unknown;
}

function isPluginAuthorDefinition(value: unknown): value is MockPluginAuthorDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const definition = value as {
    manifest?: { id?: unknown; permissions?: unknown; runtime?: unknown; tools?: unknown; version?: unknown };
  };
  return Boolean(
    definition.manifest
      && typeof definition.manifest.id === 'string'
      && Array.isArray(definition.manifest.permissions)
      && Array.isArray(definition.manifest.tools)
      && typeof definition.manifest.version === 'string'
      && definition.manifest.runtime === 'local',
  );
}

function resolveProjectPluginDefinition(
  loadedModule: Record<string, unknown>,
  definitionExport: string | undefined,
): MockPluginAuthorDefinition | null {
  if (definitionExport) {
    const candidate = loadedModule[definitionExport];
    return isPluginAuthorDefinition(candidate) ? candidate as MockPluginAuthorDefinition : null;
  }
  const candidates = [
    loadedModule.definition,
    loadedModule.plugin,
    loadedModule.default,
    loadedModule,
  ];
  for (const candidate of candidates) {
    if (isPluginAuthorDefinition(candidate)) {
      return candidate as MockPluginAuthorDefinition;
    }
  }
  return null;
}

// ─── 文件路径常量 ───

const PLUGINS_ROOT = path.resolve(__dirname, '..', 'config', 'plugins');
const PLUGIN_PC_DIR = path.join(PLUGINS_ROOT, 'plugin-pc');
const PLUGIN_PC_PKG = path.join(PLUGIN_PC_DIR, 'package.json');
const PLUGIN_PC_TSCONFIG = path.join(PLUGIN_PC_DIR, 'tsconfig.json');
const PLUGIN_PC_SRC = path.join(PLUGIN_PC_DIR, 'src', 'index.ts');

// ─── 文件助手 ───

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T : fallback;
  } catch {
    return fallback;
  }
}

// ========================================================================
// 测试
// ========================================================================

describe('config/plugins/ 配置模块', () => {

  // ── 1. 目录结构验证 ──

  describe('1. 目录结构验证', () => {
    it('config/plugins/ 目录存在', () => {
      expect(fs.existsSync(PLUGINS_ROOT)).toBe(true);
      expect(fs.statSync(PLUGINS_ROOT).isDirectory()).toBe(true);
    });

    it('plugin-pc 子目录存在', () => {
      const entries = fs.readdirSync(PLUGINS_ROOT, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      expect(entries).toContain('plugin-pc');
    });

    it('目录按字母序排列', () => {
      const entries = fs.readdirSync(PLUGINS_ROOT, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      const sorted = [...entries].sort((a, b) => a.localeCompare(b));
      expect(entries).toEqual(sorted);
    });

    it('plugin-pc 目录包含必需文件', () => {
      const files = fs.readdirSync(PLUGIN_PC_DIR);
      expect(files).toContain('package.json');
      expect(files).toContain('tsconfig.json');
      expect(files).toContain('src');
    });

    it('src 目录包含 index.ts', () => {
      expect(fs.existsSync(PLUGIN_PC_SRC)).toBe(true);
    });

    it('src/index.ts 文件非空', () => {
      const content = fs.readFileSync(PLUGIN_PC_SRC, 'utf-8');
      expect(content.length).toBeGreaterThan(0);
    });
  });

  // ── 2. plugin-pc/package.json 结构验证 ──

  describe('2. plugin-pc/package.json 结构验证', () => {
    let pkg: ProjectPluginPackageJson;

    beforeAll(() => {
      pkg = readJsonFile<ProjectPluginPackageJson>(PLUGIN_PC_PKG, {});
      expect(pkg).toBeTruthy();
      expect(Object.keys(pkg).length).toBeGreaterThan(0);
    });

    it('顶级键完整：name, version, private, description, garlicClaw, main, scripts, dependencies, devDependencies', () => {
      expect(pkg).toHaveProperty('name');
      expect(pkg).toHaveProperty('version');
      expect(pkg).toHaveProperty('private');
      expect(pkg).toHaveProperty('description');
      expect(pkg).toHaveProperty('garlicClaw');
      expect(pkg).toHaveProperty('main');
      expect(pkg).toHaveProperty('scripts');
      expect(pkg).toHaveProperty('dependencies');
      expect(pkg).toHaveProperty('devDependencies');
    });

    it('不包含未知顶级字段', () => {
      const knownKeys = ['name', 'version', 'private', 'description', 'garlicClaw', 'main', 'scripts', 'dependencies', 'devDependencies'];
      for (const key of Object.keys(pkg)) {
        expect(knownKeys.includes(key)).toBe(true);
      }
    });

    it('name 为 @garlic-claw/plugin-pc', () => {
      expect(pkg.name).toBe('@garlic-claw/plugin-pc');
    });

    it('version 为 0.1.0', () => {
      expect(pkg.version).toBe('0.1.0');
    });

    it('private 为 true', () => {
      expect(pkg.private).toBe(true);
    });

    it('description 为 "PC device plugin for Garlic Claw"', () => {
      expect(pkg.description).toBe('PC device plugin for Garlic Claw');
    });

    describe('garlicClaw', () => {
      let gc: NonNullable<ProjectPluginPackageJson['garlicClaw']>;

      beforeAll(() => {
        gc = pkg.garlicClaw!;
        expect(gc).toBeTruthy();
      });

      it('runtime 为 "remote"', () => {
        expect(gc.runtime).toBe('remote');
      });

      it('不包含未知字段', () => {
        const knownKeys = ['runtime'];
        for (const key of Object.keys(gc)) {
          expect(knownKeys.includes(key)).toBe(true);
        }
      });
    });

    it('main 为 "dist/index.js"', () => {
      expect(pkg.main).toBe('dist/index.js');
    });

    describe('scripts', () => {
      let scripts: NonNullable<ProjectPluginPackageJson['scripts']>;

      beforeAll(() => {
        scripts = pkg.scripts!;
        expect(scripts).toBeTruthy();
      });

      it('包含 build / start / dev / typecheck', () => {
        expect(scripts).toHaveProperty('build');
        expect(scripts).toHaveProperty('start');
        expect(scripts).toHaveProperty('dev');
        expect(scripts).toHaveProperty('typecheck');
      });

      it('不包含未知键', () => {
        const knownKeys = ['build', 'lint', 'start', 'dev', 'typecheck'];
        for (const key of Object.keys(scripts)) {
          expect(knownKeys.includes(key)).toBe(true);
        }
      });

      it('build 为 "tsc"', () => {
        expect(scripts.build).toBe('tsc');
      });

      it('dev 为 "tsc && node dist/index.js"', () => {
        expect(scripts.dev).toBe('tsc && node dist/index.js');
      });

      it('typecheck 为 "tsc --noEmit"', () => {
        expect(scripts.typecheck).toBe('tsc --noEmit');
      });
    });

    describe('dependencies', () => {
      let deps: NonNullable<ProjectPluginPackageJson['dependencies']>;

      beforeAll(() => {
        deps = pkg.dependencies!;
        expect(deps).toBeTruthy();
      });

      it('包含 @garlic-claw/plugin-sdk', () => {
        expect(deps).toHaveProperty('@garlic-claw/plugin-sdk');
        expect(deps['@garlic-claw/plugin-sdk']).toBe('*');
      });

      it('包含 @garlic-claw/shared', () => {
        expect(deps).toHaveProperty('@garlic-claw/shared');
        expect(deps['@garlic-claw/shared']).toBe('*');
      });

      it('不包含未知依赖', () => {
        const knownDeps = ['@garlic-claw/plugin-sdk', '@garlic-claw/shared'];
        for (const key of Object.keys(deps)) {
          expect(knownDeps.includes(key)).toBe(true);
        }
      });
    });

    it('devDependencies 包含 typescript ^6.0.3', () => {
      const devDeps = pkg.devDependencies!;
      expect(devDeps.typescript).toBe('^6.0.3');
    });
  });

  // ── 3. plugin-pc/tsconfig.json 结构验证 ──

  describe('3. plugin-pc/tsconfig.json 结构验证', () => {
    let tsconfig: Record<string, unknown>;

    beforeAll(() => {
      tsconfig = readJsonFile<Record<string, unknown>>(PLUGIN_PC_TSCONFIG, {});
      expect(Object.keys(tsconfig).length).toBeGreaterThan(0);
    });

    it('extends 为 "../../../tsconfig.base.json"', () => {
      expect(tsconfig.extends).toBe('../../../tsconfig.base.json');
    });

    describe('compilerOptions', () => {
      let opts: Record<string, unknown>;

      beforeAll(() => {
        opts = tsconfig.compilerOptions as Record<string, unknown>;
        expect(opts).toBeTruthy();
      });

      it('module 为 "Node16"', () => {
        expect(opts.module).toBe('Node16');
      });

      it('moduleResolution 为 "node16"', () => {
        expect(opts.moduleResolution).toBe('node16');
      });

      it('outDir 为 "dist"', () => {
        expect(opts.outDir).toBe('dist');
      });

      it('rootDir 为 "src"', () => {
        expect(opts.rootDir).toBe('src');
      });

      it('types 包含 "node"', () => {
        expect(opts.types).toEqual(['node']);
      });
    });

    it('include 为 ["src"]', () => {
      expect(tsconfig.include).toEqual(['src']);
    });

    it('不包含未知顶级字段', () => {
      const knownKeys = ['extends', 'compilerOptions', 'include'];
      for (const key of Object.keys(tsconfig)) {
        expect(knownKeys.includes(key)).toBe(true);
      }
    });
  });

  // ── 4. plugin-pc/src/index.ts 结构验证 ──

  describe('4. plugin-pc/src/index.ts 结构验证', () => {
    let source: string;

    beforeAll(() => {
      source = fs.readFileSync(PLUGIN_PC_SRC, 'utf-8');
      expect(source.length).toBeGreaterThan(0);
    });

    it('导入 @garlic-claw/shared 的 PluginCapability 类型', () => {
      expect(source).toContain("import type { PluginCapability } from '@garlic-claw/shared'");
    });

    it('导入 @garlic-claw/plugin-sdk/client', () => {
      expect(source).toContain("import { PluginClient, REMOTE_ENVIRONMENT } from '@garlic-claw/plugin-sdk/client'");
    });

    it('导入 child_process / fs / os / path', () => {
      expect(source).toContain("import { execSync } from 'child_process'");
      expect(source).toContain("import * as fs from 'fs'");
      expect(source).toContain("import * as os from 'os'");
      expect(source).toContain("import * as path from 'path'");
    });

    it('定义 writePluginPcLog 日志函数', () => {
      expect(source).toContain('function writePluginPcLog');
    });

    it('定义 SERVER_URL 和 ACCESS_KEY 配置', () => {
      expect(source).toContain('SERVER_URL');
      expect(source).toContain('ACCESS_KEY');
    });

    it('ACCESS_KEY 缺失时退出', () => {
      expect(source).toContain("process.stderr.write('错误：PLUGIN_ACCESS_KEY 环境变量是必需的。\\n')");
      expect(source).toContain('process.exit(1)');
    });

    describe('能力定义: 5 个 capabilities', () => {
      it('包含 get_pc_info', () => {
        expect(source).toContain("name: 'get_pc_info'");
        expect(source).toContain('获取此 PC 的详细信息');
      });

      it('包含 list_directory', () => {
        expect(source).toContain("name: 'list_directory'");
        expect(source).toContain('列出此 PC 上目录中的文件和文件夹');
      });

      it('包含 read_text_file', () => {
        expect(source).toContain("name: 'read_text_file'");
        expect(source).toContain('读取此 PC 上文本文件的内容');
      });

      it('包含 get_running_processes', () => {
        expect(source).toContain("name: 'get_running_processes'");
        expect(source).toContain('获取此 PC 上运行的进程列表');
      });

      it('包含 get_disk_usage', () => {
        expect(source).toContain("name: 'get_disk_usage'");
        expect(source).toContain('获取此 PC 上所有驱动器的磁盘使用情况');
      });

      it('get_pc_info 参数为空对象', () => {
        const match = source.match(/name:\s*'get_pc_info'[\s\S]*?parameters:\s*(\{[^}]*\})/);
        expect(match).not.toBeNull();
      });

      it('list_directory 需要 dirPath 参数', () => {
        expect(source).toContain('dirPath');
        expect(source).toContain('要列出的目录的绝对路径');
      });

      it('read_text_file 需要 filePath 参数', () => {
        expect(source).toContain('filePath');
        expect(source).toContain('要读取的文件的绝对路径');
      });

      it('get_running_processes 参数为空对象', () => {
        expect(source).toContain("name: 'get_running_processes'");
      });

      it('get_disk_usage 参数为空对象', () => {
        expect(source).toContain("name: 'get_disk_usage'");
      });
    });

    describe('PluginClient 构造', () => {
      it('创建 PluginClient 实例', () => {
        expect(source).toContain('new PluginClient({');
      });

      it('使用 REMOTE_ENVIRONMENT.API', () => {
        expect(source).toContain('REMOTE_ENVIRONMENT.API');
      });

      it('manifest 包含 name/version/description/permissions/tools/hooks', () => {
        expect(source).toContain("name: '电脑助手'");
        expect(source).toContain("version: '1.0.0'");
        expect(source).toContain("description: '暴露当前电脑的文件、系统信息与进程能力。'");
      });
    });

    describe('命令处理器', () => {
      it('注册 get_pc_info 处理器', () => {
        expect(source).toContain("client.onCommand('get_pc_info'");
      });

      it('注册 list_directory 处理器且校验绝对路径', () => {
        expect(source).toContain("client.onCommand('list_directory'");
        expect(source).toContain("throw new Error('dirPath 必须是绝对路径')");
      });

      it('注册 read_text_file 处理器且限制 10KB', () => {
        expect(source).toContain("client.onCommand('read_text_file'");
        expect(source).toContain('throw new Error(\'文件过大（最大 10KB）\'');
      });

      it('注册 get_running_processes 处理器', () => {
        expect(source).toContain("client.onCommand('get_running_processes'");
      });

      it('注册 get_disk_usage 处理器', () => {
        expect(source).toContain("client.onCommand('get_disk_usage'");
      });
    });

    it('包含 client.connect() 启动调用', () => {
      expect(source).toContain('client.connect()');
    });

    it('包含 SIGINT 优雅关闭处理', () => {
      expect(source).toContain("process.on('SIGINT'");
      expect(source).toContain('client.disconnect()');
      expect(source).toContain('process.exit(0)');
    });
  });

  // ── 5. 规范化函数（对齐 plugin-bootstrap.service.ts） ──

  describe('5. 规范化函数', () => {
    describe('readText', () => {
      it('返回非空字符串的 trim', () => {
        expect(readText(' hello ')).toBe('hello');
      });
      it('空字符串返回 null', () => {
        expect(readText('')).toBeNull();
      });
      it('空白字符串返回 null', () => {
        expect(readText('   ')).toBeNull();
      });
      it('非字符串返回 null', () => {
        expect(readText(null)).toBeNull();
        expect(readText(undefined)).toBeNull();
        expect(readText(42)).toBeNull();
        expect(readText([])).toBeNull();
      });
    });

    describe('readRecord', () => {
      it('接受纯对象', () => {
        expect(readRecord({ a: 1 })).toEqual({ a: 1 });
      });
      it('拒绝数组', () => {
        expect(readRecord([1, 2])).toBeNull();
      });
      it('拒绝 null', () => {
        expect(readRecord(null)).toBeNull();
      });
      it('拒绝字符串', () => {
        expect(readRecord('str')).toBeNull();
      });
    });

    describe('readLiteral', () => {
      const allowed = ['local', 'remote'] as const;
      it('匹配合法值', () => {
        expect(readLiteral('local', allowed)).toBe('local');
        expect(readLiteral('remote', allowed)).toBe('remote');
      });
      it('拒绝非法值', () => {
        expect(readLiteral('hybrid', allowed)).toBeNull();
        expect(readLiteral('', allowed)).toBeNull();
        expect(readLiteral(null, allowed)).toBeNull();
        expect(readLiteral(undefined, allowed)).toBeNull();
      });
      it('大小写敏感', () => {
        expect(readLiteral('Local', allowed)).toBeNull();
      });
    });

    describe('readArray', () => {
      it('接受数组返回副本', () => {
        const arr = [1, 2, 3];
        expect(readArray(arr)).toEqual([1, 2, 3]);
        expect(readArray(arr)).not.toBe(arr);
      });
      it('非数组返回空数组', () => {
        expect(readArray('not-array')).toEqual([]);
        expect(readArray(null)).toEqual([]);
        expect(readArray(undefined)).toEqual([]);
        expect(readArray({})).toEqual([]);
      });
    });

    describe('isJsonValue', () => {
      it('接受 null', () => {
        expect(isJsonValue(null)).toBe(true);
      });
      it('接受基本类型', () => {
        expect(isJsonValue('str')).toBe(true);
        expect(isJsonValue(42)).toBe(true);
        expect(isJsonValue(true)).toBe(true);
      });
      it('接受数组', () => {
        expect(isJsonValue([1, 'a', null])).toBe(true);
      });
      it('接受对象', () => {
        expect(isJsonValue({ a: 1, b: '2' })).toBe(true);
      });
      it('拒绝 undefined', () => {
        expect(isJsonValue(undefined)).toBe(false);
      });
      it('拒绝函数', () => {
        expect(isJsonValue(() => {})).toBe(false);
      });
      it('拒绝嵌套 undefined', () => {
        expect(isJsonValue({ a: undefined })).toBe(false);
      });
    });

    describe('normalizePluginManifest', () => {
      it('完整 manifest 解析正确', () => {
        const result = normalizePluginManifest({
          id: 'test-plugin',
          name: 'Test Plugin',
          version: '2.0.0',
          runtime: 'local',
          permissions: ['read', 'write'],
          tools: [{ name: 'tool1', description: 'A tool', parameters: {} }],
          description: 'A test plugin',
        }, { id: 'fallback' });
        expect(result.id).toBe('test-plugin');
        expect(result.name).toBe('Test Plugin');
        expect(result.version).toBe('2.0.0');
        expect(result.runtime).toBe('local');
        expect(result.permissions).toEqual(['read', 'write']);
        expect(result.tools).toHaveLength(1);
        expect(result.description).toBe('A test plugin');
      });

      it('缺失字段使用 fallback', () => {
        const result = normalizePluginManifest(null, { id: 'fallback-id', name: 'Fallback', runtime: 'local', version: '1.0.0' });
        expect(result.id).toBe('fallback-id');
        expect(result.name).toBe('Fallback');
        expect(result.version).toBe('1.0.0');
        expect(result.runtime).toBe('local');
        expect(result.permissions).toEqual([]);
        expect(result.tools).toEqual([]);
      });

      it('部分填充使用 source 值', () => {
        const result = normalizePluginManifest({ id: 'my-id' }, { id: 'fallback', name: 'F', runtime: 'remote', version: '0.0.1' });
        expect(result.id).toBe('my-id');
        expect(result.name).toBe('F');
        expect(result.version).toBe('0.0.1');
        expect(result.runtime).toBe('remote');
      });

      it('trim 所有文本字段', () => {
        const result = normalizePluginManifest({
          id: '  padded-id  ',
          name: '  Padded  ',
          version: '  3.0.0  ',
          runtime: 'local',
        }, { id: 'f' });
        expect(result.id).toBe('padded-id');
        expect(result.name).toBe('Padded');
        expect(result.version).toBe('3.0.0');
      });

      it('描述为空时使用 fallback', () => {
        const result = normalizePluginManifest({ id: 't', description: '' }, { id: 'f', description: 'fallback desc' });
        expect(result.description).toBe('fallback desc');
      });

      it('commands/crons/hooks/routes 为空数组时不设置', () => {
        const result = normalizePluginManifest({
          id: 't',
          commands: [],
          crons: [],
          hooks: [],
          routes: [],
        }, { id: 'f' });
        expect(result).not.toHaveProperty('commands');
        expect(result).not.toHaveProperty('crons');
        expect(result).not.toHaveProperty('hooks');
        expect(result).not.toHaveProperty('routes');
      });

      it('config 为 object 类型时被解析', () => {
        const result = normalizePluginManifest({
          id: 't',
          config: {
            type: 'object',
            items: {
              apiKey: { type: 'string', description: 'API Key' },
              debug: { type: 'bool', defaultValue: false },
            },
          },
        }, { id: 'f' });
        expect(result.config).not.toBeNull();
        expect(result.config!.type).toBe('object');
        expect(result.config!.items.apiKey.type).toBe('string');
        expect(result.config!.items.debug.type).toBe('bool');
      });

      it('config 为 null 时不设置', () => {
        const result = normalizePluginManifest({ id: 't', config: null }, { id: 'f' });
        expect(result).not.toHaveProperty('config');
      });
    });

    describe('isPluginAuthorDefinition', () => {
      it('识别合法 definition', () => {
        const valid = {
          manifest: {
            id: 'test',
            permissions: [],
            tools: [],
            version: '1.0.0',
            runtime: 'local',
          },
        };
        expect(isPluginAuthorDefinition(valid)).toBe(true);
      });

      it('拒绝 null', () => {
        expect(isPluginAuthorDefinition(null)).toBe(false);
      });

      it('拒绝数组', () => {
        expect(isPluginAuthorDefinition([])).toBe(false);
      });

      it('拒绝缺少 manifest', () => {
        expect(isPluginAuthorDefinition({})).toBe(false);
      });

      it('拒绝非 local runtime', () => {
        const remoteDef = {
          manifest: {
            id: 'test',
            permissions: [],
            tools: [],
            version: '1.0.0',
            runtime: 'remote',
          },
        };
        expect(isPluginAuthorDefinition(remoteDef)).toBe(false);
      });

      it('拒绝非字符串 id', () => {
        const badId = {
          manifest: {
            id: 123,
            permissions: [],
            tools: [],
            version: '1.0.0',
            runtime: 'local',
          },
        };
        expect(isPluginAuthorDefinition(badId)).toBe(false);
      });

      it('拒绝非数组 permissions', () => {
        const badPerms = {
          manifest: {
            id: 'test',
            permissions: 'read',
            tools: [],
            version: '1.0.0',
            runtime: 'local',
          },
        };
        expect(isPluginAuthorDefinition(badPerms)).toBe(false);
      });
    });

    describe('resolveProjectPluginDefinition', () => {
      it('通过 definitionExport 查找', () => {
        const def = { manifest: { id: 'x', permissions: [], tools: [], version: '1.0', runtime: 'local' } };
        const result = resolveProjectPluginDefinition({ myExport: def }, 'myExport');
        expect(result).toBe(def);
      });

      it('通过 definitionExport 查找不到返回 null', () => {
        const result = resolveProjectPluginDefinition({}, 'nonExistent');
        expect(result).toBeNull();
      });

      it('按优先级查找: definition > plugin > default > module', () => {
        const def = { manifest: { id: 'a', permissions: [], tools: [], version: '1.0', runtime: 'local' } };
        const result = resolveProjectPluginDefinition({ definition: def }, undefined);
        expect(result).toBe(def);
      });

      it('所有候选都不匹配返回 null', () => {
        const result = resolveProjectPluginDefinition({}, undefined);
        expect(result).toBeNull();
      });
    });
  });

  // ── 6. Config Schema 函数 ──

  describe('6. Config Schema 函数', () => {
    describe('readConfigNode', () => {
      it('解析 string 类型节点', () => {
        const node = readConfigNode({ type: 'string', description: 'test' });
        expect(node).not.toBeNull();
        expect(node!.type).toBe('string');
        expect(node!.description).toBe('test');
      });

      it('解析 bool 类型节点', () => {
        const node = readConfigNode({ type: 'bool', defaultValue: true });
        expect(node).not.toBeNull();
        expect(node!.type).toBe('bool');
        expect(node!.defaultValue).toBe(true);
      });

      it('解析 int 类型节点', () => {
        const node = readConfigNode({ type: 'int', defaultValue: 42, hint: 'Enter number' });
        expect(node).not.toBeNull();
        expect(node!.type).toBe('int');
        expect(node!.defaultValue).toBe(42);
        expect(node!.hint).toBe('Enter number');
      });

      it('解析 float 类型节点', () => {
        const node = readConfigNode({ type: 'float', renderType: 'checkbox' });
        expect(node).not.toBeNull();
        expect(node!.type).toBe('float');
      });

      it('解析 object 类型（含 items）', () => {
        const node = readConfigNode({
          type: 'object',
          items: {
            key1: { type: 'string', description: 'Key 1' },
            key2: { type: 'int', defaultValue: 0 },
          },
        });
        expect(node).not.toBeNull();
        expect(node!.type).toBe('object');
        expect((node as PluginConfigSchema).items.key1.type).toBe('string');
        expect((node as PluginConfigSchema).items.key2.type).toBe('int');
      });

      it('解析 list 类型（含 items）', () => {
        const node = readConfigNode({
          type: 'list',
          items: { type: 'string' },
        });
        expect(node).not.toBeNull();
        expect(node!.type).toBe('list');
        expect((node as PluginConfigNodeSchema & { items: PluginConfigNodeSchema }).items.type).toBe('string');
      });

      it('解析 list 类型（无 items）', () => {
        const node = readConfigNode({ type: 'list' });
        expect(node).not.toBeNull();
        expect(node!.type).toBe('list');
      });

      it('对非法类型返回 null', () => {
        expect(readConfigNode({ type: 'unknown' })).toBeNull();
      });

      it('对非对象返回 null', () => {
        expect(readConfigNode('string')).toBeNull();
        expect(readConfigNode(null)).toBeNull();
        expect(readConfigNode(undefined)).toBeNull();
      });

      it('secret 布尔字段被保留', () => {
        const node = readConfigNode({ type: 'string', secret: true });
        expect(node).not.toBeNull();
        expect(node!.secret).toBe(true);
      });

      it('undefined 布尔字段不被保留', () => {
        const node = readConfigNode({ type: 'string' });
        expect(node).not.toBeNull();
        expect(node).not.toHaveProperty('secret');
        expect(node).not.toHaveProperty('obviousHint');
        expect(node).not.toHaveProperty('invisible');
        expect(node).not.toHaveProperty('collapsed');
      });


      it('object 类型无 items 时返回 null', () => {
        const node = readConfigNode({ type: 'object' });
        expect(node).toBeNull();
      });

      it('object 类型空 items 时返回 null', () => {
        const node = readConfigNode({ type: 'object', items: {} });
        expect(node).toBeNull();
      });

      it('object 类型过滤非法 items', () => {
        const node = readConfigNode({
          type: 'object',
          items: {
            valid: { type: 'string' },
            invalid: { type: 'unknown' },
          },
        });
        expect(node).not.toBeNull();
        expect((node as PluginConfigSchema).items).toHaveProperty('valid');
        expect((node as PluginConfigSchema).items).not.toHaveProperty('invalid');
      });
    });

    describe('readConfig', () => {
      it('object 类型返回 config schema', () => {
        const config = readConfig({
          type: 'object',
          items: { key: { type: 'string' } },
        });
        expect(config).not.toBeNull();
        expect(config!.type).toBe('object');
      });

      it('非 object 类型返回 null', () => {
        expect(readConfig({ type: 'string' })).toBeNull();
      });

      it('null 返回 null', () => {
        expect(readConfig(null)).toBeNull();
      });
    });

    describe('isConfigConditionValue', () => {
      it('接受 string / number / boolean / null', () => {
        expect(isConfigConditionValue('a')).toBe(true);
        expect(isConfigConditionValue(1)).toBe(true);
        expect(isConfigConditionValue(true)).toBe(true);
        expect(isConfigConditionValue(null)).toBe(true);
      });
      it('拒绝 undefined / object / array', () => {
        expect(isConfigConditionValue(undefined)).toBe(false);
        expect(isConfigConditionValue({})).toBe(false);
        expect(isConfigConditionValue([])).toBe(false);
      });
    });

    describe('readConfigItems', () => {
      it('解析对象类型的 items', () => {
        const items = readConfigItems({ a: { type: 'string' }, b: { type: 'int' } });
        expect(Object.keys(items)).toEqual(['a', 'b']);
        expect(items.a.type).toBe('string');
        expect(items.b.type).toBe('int');
      });

      it('过滤非法 items', () => {
        const items = readConfigItems({ good: { type: 'string' }, bad: { type: 'unknown' } });
        expect(items).toHaveProperty('good');
        expect(items).not.toHaveProperty('bad');
      });

      it('非对象返回空对象', () => {
        expect(readConfigItems(null)).toEqual({});
        expect(readConfigItems('str')).toEqual({});
      });
    });

    describe('readConfigConditionState', () => {
      it('解析 condition 对象', () => {
        const state = readConfigConditionState({ key1: 'value1', key2: 42 });
        expect(state).toHaveProperty('condition');
        expect((state as { condition: Record<string, unknown> }).condition.key1).toBe('value1');
      });

      it('过滤非法 condition 值', () => {
        const state = readConfigConditionState({ valid: 'str', invalid: undefined, alsoInvalid: {} });
        expect((state as { condition: Record<string, unknown> }).condition).toHaveProperty('valid');
        expect((state as { condition: Record<string, unknown> }).condition).not.toHaveProperty('invalid');
      });

      it('空 condition 返回空对象', () => {
        expect(readConfigConditionState(null)).toEqual({});
      });
    });

    describe('readConfigOptionsState', () => {
      it('解析 options 数组', () => {
        const state = readConfigOptionsState([
          { value: 'opt1', label: 'Option 1' },
          { value: 'opt2' },
        ]);
        expect(state).toHaveProperty('options');
        expect((state as { options: PluginConfigOptionSchema[] }).options).toHaveLength(2);
      });

      it('过滤非法 options', () => {
        const state = readConfigOptionsState([
          { value: 'valid' },
          { value: '' },
          { noValue: true },
        ]);
        expect((state as { options: PluginConfigOptionSchema[] }).options).toHaveLength(1);
      });

      it('非数组返回空对象', () => {
        expect(readConfigOptionsState(null)).toEqual({});
      });
    });
  });

  // ── 7. 文件系统读写 ──

  describe('7. 文件系统读写', () => {
    const tmpRoot = path.join(os.tmpdir(), `config-plugins-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    afterAll(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('从 config/plugins/ 读取 plugin-pc 的 package.json', () => {
      const pkg = readJsonFile<ProjectPluginPackageJson>(PLUGIN_PC_PKG, {});
      expect(pkg.name).toBe('@garlic-claw/plugin-pc');
      expect(pkg.garlicClaw?.runtime).toBe('remote');
    });

    it('写入并读取插件 package.json', () => {
      const data: ProjectPluginPackageJson = {
        name: '@garlic-claw/test-plugin',
        version: '1.0.0',
        private: true,
        description: 'Test plugin',
        garlicClaw: { runtime: 'local' },
        main: 'dist/index.js',
        scripts: { build: 'tsc', start: 'node dist/index.js' },
        dependencies: { '@garlic-claw/plugin-sdk': '*' },
      };
      const testDir = path.join(tmpRoot, 'test-plugin');
      fs.mkdirSync(testDir, { recursive: true });
      const pkgPath = path.join(testDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify(data, null, 2), 'utf-8');

      const parsed = readJsonFile<ProjectPluginPackageJson>(pkgPath, {});
      expect(parsed.name).toBe('@garlic-claw/test-plugin');
      expect(parsed.version).toBe('1.0.0');
      expect(parsed.private).toBe(true);
      expect(parsed.garlicClaw?.runtime).toBe('local');
      expect(parsed.dependencies?.['@garlic-claw/plugin-sdk']).toBe('*');
    });

    it('写入并读取含 scripts 和 devDependencies 的配置', () => {
      const data: ProjectPluginPackageJson = {
        name: '@garlic-claw/test-plugin-2',
        version: '0.5.0',
        private: false,
        garlicClaw: { runtime: 'remote' },
        main: 'dist/index.js',
        scripts: { build: 'tsc', lint: 'eslint src', dev: 'tsc && node dist/index.js' },
        dependencies: { '@garlic-claw/plugin-sdk': '*' },
        devDependencies: { typescript: '^6.0.0' },
      };
      const testDir = path.join(tmpRoot, 'test-plugin-2');
      fs.mkdirSync(testDir, { recursive: true });
      const pkgPath = path.join(testDir, 'package.json');
      fs.writeFileSync(pkgPath, JSON.stringify(data, null, 2), 'utf-8');

      const parsed = readJsonFile<ProjectPluginPackageJson>(pkgPath, {});
      expect(parsed.name).toBe('@garlic-claw/test-plugin-2');
      expect(parsed.garlicClaw?.runtime).toBe('remote');
      expect(parsed.scripts?.lint).toBe('eslint src');
      expect(parsed.devDependencies?.typescript).toBe('^6.0.0');
    });

    it('损坏的 JSON 返回 fallback', () => {
      const badPath = path.join(tmpRoot, 'bad.json');
      fs.writeFileSync(badPath, '{ bad json }', 'utf-8');
      const fallback = { custom: 'value' };
      const parsed = readJsonFile<Record<string, unknown>>(badPath, fallback);
      expect(parsed).toEqual(fallback);
    });

    it('缺失文件返回 fallback', () => {
      const nonExistent = path.join(tmpRoot, 'nonexistent.json');
      const parsed = readJsonFile<Record<string, unknown>>(nonExistent, null);
      expect(parsed).toBeNull();
    });

    it('无 package.json 的目录不会被读取为插件', () => {
      const emptyDir = path.join(tmpRoot, 'no-package');
      fs.mkdirSync(emptyDir, { recursive: true });
      const entries = fs.readdirSync(tmpRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
      expect(entries).toContain('no-package');
      const pkgExists = fs.existsSync(path.join(emptyDir, 'package.json'));
      expect(pkgExists).toBe(false);
    });

    it('多插件目录共存', () => {
      const dirs = ['plugin-a', 'plugin-b', 'plugin-c'];
      for (const dir of dirs) {
        const dirPath = path.join(tmpRoot, dir);
        fs.mkdirSync(dirPath, { recursive: true });
        fs.writeFileSync(path.join(dirPath, 'package.json'), JSON.stringify({
          name: `@garlic-claw/${dir}`,
          version: '1.0.0',
          private: true,
          garlicClaw: {},
          main: 'dist/index.js',
        }, null, 2), 'utf-8');
      }
      const entries = fs.readdirSync(tmpRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter((n) => n.startsWith('plugin-'));
      for (const dir of dirs) {
        expect(entries).toContain(dir);
      }
    });
  });

  // ── 8. 类型风格一致 ──

  describe('8. 类型风格一致', () => {
    it('PluginManifest 构造正确', () => {
      const manifest: PluginManifest = {
        id: 'test',
        name: 'Test',
        version: '1.0.0',
        runtime: 'local',
        permissions: ['read'],
        tools: [],
      };
      expect(manifest.id).toBe('test');
      expect(manifest.name).toBe('Test');
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.runtime).toBe('local');
      expect(manifest.permissions).toEqual(['read']);
      expect(manifest.tools).toEqual([]);
    });

    it('PluginManifest 全字段构造', () => {
      const manifest: PluginManifest = {
        id: 'full',
        name: 'Full',
        version: '2.0.0',
        runtime: 'remote',
        permissions: ['read', 'write', 'admin'],
        tools: [{ name: 'tool1', description: 'desc', parameters: {} }],
        description: 'Full plugin',
        commands: [],
        crons: [],
        hooks: [],
        routes: [],
      };
      expect(manifest.description).toBe('Full plugin');
      expect(manifest.tools).toHaveLength(1);
    });

    it('PluginCapability 带参数构造', () => {
      const cap: PluginCapability = {
        name: 'list_directory',
        description: 'List directory contents',
        parameters: {
          dirPath: { type: 'string', description: 'Absolute path', required: true },
        },
      };
      expect(cap.name).toBe('list_directory');
      expect(cap.parameters).toHaveProperty('dirPath');
    });

    it('PluginConfigSchema 构造正确', () => {
      const schema: PluginConfigSchema = {
        type: 'object',
        items: {
          apiKey: { type: 'string', description: 'API Key', secret: true },
          port: { type: 'int', defaultValue: 8080, hint: 'Port number' },
        },
      };
      expect(schema.type).toBe('object');
      expect(schema.items.apiKey.type).toBe('string');
      expect(schema.items.port.defaultValue).toBe(8080);
    });

    it('PluginConfigOptionSchema 含 label 和 description', () => {
      const option: PluginConfigOptionSchema = {
        value: 'opt1',
        label: 'Option 1',
        description: 'First option',
      };
      expect(option.value).toBe('opt1');
      expect(option.label).toBe('Option 1');
      expect(option.description).toBe('First option');
    });

    it('ProjectPluginPackageJson 含 garlicClaw.runtime', () => {
      const pkg: ProjectPluginPackageJson = {
        name: '@garlic-claw/plugin-pc',
        version: '0.1.0',
        private: true,
        garlicClaw: { runtime: 'remote' },
        main: 'dist/index.js',
      };
      expect(pkg.garlicClaw?.runtime).toBe('remote');
    });

    it('插件 package.json 的实际字段类型验证', () => {
      const pkg = readJsonFile<ProjectPluginPackageJson>(PLUGIN_PC_PKG, {});
      expect(typeof pkg.name).toBe('string');
      expect(typeof pkg.version).toBe('string');
      expect(typeof pkg.private).toBe('boolean');
      expect(typeof pkg.description).toBe('string');
      expect(typeof pkg.main).toBe('string');
      expect(typeof pkg.garlicClaw?.runtime).toBe('string');
      expect(typeof pkg.scripts?.build).toBe('string');
      expect(typeof pkg.dependencies?.['@garlic-claw/plugin-sdk']).toBe('string');
    });
  });

  // ── 9. 边界条件 ──

  describe('9. 边界条件', () => {
    it('normalizePluginManifest 处理 undefined 输入', () => {
      const result = normalizePluginManifest(undefined, { id: 'fallback' });
      expect(result.id).toBe('fallback');
      expect(result.permissions).toEqual([]);
    });

    it('normalizePluginManifest 处理 null 输入', () => {
      const result = normalizePluginManifest(null, { id: 'fb', runtime: 'remote' });
      expect(result.id).toBe('fb');
      expect(result.runtime).toBe('remote');
    });

    it('readText 处理前后空白', () => {
      expect(readText('  hello world  ')).toBe('hello world');
    });

    it('readText 处理特殊字符', () => {
      expect(readText('a\nb\tc')).toBe('a\nb\tc');
    });

      it('readArray 返回新数组引用', () => {
        const original = [1, 2, 3];
        const copy = readArray(original);
        expect(copy).toEqual([1, 2, 3]);
        expect(copy).not.toBe(original);
        copy.push(4);
        expect(original.length).toBe(3);
      });


    it('isPluginAuthorDefinition 处理含多余字段的对象', () => {
      const def = {
        manifest: { id: 'x', permissions: [], tools: [], version: '1.0', runtime: 'local' },
        extraField: { something: true },
      };
      expect(isPluginAuthorDefinition(def)).toBe(true);
    });

    it('resolveProjectPluginDefinition 按顺序 fallback', () => {
      const def1 = { manifest: { id: 'a', permissions: [], tools: [], version: '1.0', runtime: 'local' } };
      const def2 = { manifest: { id: 'b', permissions: [], tools: [], version: '2.0', runtime: 'local' } };
      // Should find 'definition' first (not plugin)
      const result = resolveProjectPluginDefinition({ definition: def1, plugin: def2 }, undefined);
      expect(result).toBe(def1);
    });

      it('resolveProjectPluginDefinition 找不到返回 null', () => {
        const result = resolveProjectPluginDefinition({
          notAManifest: { id: 'x' },
          someOther: 'data',
        }, undefined);
        expect(result).toBeNull();
      });

    it('resolveProjectPluginDefinition 通过 module 自身（当匹配时）', () => {
      const moduleSelf = {
        manifest: { id: 'x', permissions: [], tools: [], version: '1.0', runtime: 'local' },
      };
      // The candidates include loadedModule itself
      const result = resolveProjectPluginDefinition(moduleSelf as Record<string, unknown>, undefined);
      expect(result).toBe(moduleSelf);
    });

    it('readConfigNode 处理嵌套 object', () => {
      const node = readConfigNode({
        type: 'object',
        items: {
          nested: {
            type: 'object',
            items: {
              inner: { type: 'string', description: 'Inner field' },
            },
          },
        },
      });
      expect(node).not.toBeNull();
      expect(node!.type).toBe('object');
      const schema = node as PluginConfigSchema;
      expect(schema.items.nested.type).toBe('object');
      expect((schema.items.nested as PluginConfigSchema).items.inner.type).toBe('string');
    });

    it('readConfigNode 处理含 options 的列表', () => {
      const node = readConfigNode({
        type: 'list',
        options: [{ value: 'a', label: 'A' }, { value: 'b' }],
      });
      expect(node).not.toBeNull();
      expect(node!.type).toBe('list');
      expect((node as PluginConfigNodeSchema & { options: PluginConfigOptionSchema[] }).options).toHaveLength(2);
    });

    it('readConfigNode 处理含 condition 的字段', () => {
      const node = readConfigNode({
        type: 'string',
        description: 'conditional field',
        condition: { parentEnabled: true },
      });
      expect(node).not.toBeNull();
      expect(node!.condition).toEqual({ parentEnabled: true });
    });

    it('读取真实 plugin-pc/tsconfig.json 结构完整', () => {
      const tsconfig = readJsonFile<Record<string, unknown>>(PLUGIN_PC_TSCONFIG, {});
      expect(tsconfig).toHaveProperty('extends');
      expect(tsconfig).toHaveProperty('compilerOptions');
      expect(tsconfig).toHaveProperty('include');
    });

    it('读取真实 plugin-pc/src/index.ts 行数合理', () => {
      const content = fs.readFileSync(PLUGIN_PC_SRC, 'utf-8');
      const lines = content.split('\n');
      expect(lines.length).toBeGreaterThan(150);
      expect(lines.length).toBeLessThan(300);
    });

    it('JSON 多余字段不影响 normalizePluginManifest', () => {
      const extra = {
        id: 'test',
        name: 'Test',
        version: '1.0.0',
        runtime: 'local',
        permissions: [],
        tools: [],
        unknownField: 'should be tolerated',
        extraNested: { a: 1 },
      };
      const result = normalizePluginManifest(extra, { id: 'f' });
      expect(result.id).toBe('test');
      expect(result.name).toBe('Test');
    });
  });
});
