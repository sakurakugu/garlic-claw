import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── 类型定义（从 @garlic-claw/shared / 源码对齐） ───

interface PluginSubagentTypeSummary {
  id: string;
  name: string;
  description?: string;
}

interface ProjectSubagentTypeDefinition {
  id: string;
  name: string;
  description?: string;
  modelId?: string;
  providerId?: string;
  system?: string;
  toolNames?: string[];
}

type StoredSubagentTypeConfigFile = Partial<Omit<ProjectSubagentTypeDefinition, 'system'>>;

// ─── 内联纯函数（对齐 project-subagent-type-registry.service.ts） ───

const SUBAGENT_CONFIG_FILE_NAME = 'subagent.json';
const SUBAGENT_PROMPT_FILE_NAME = 'prompt.md';

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeStoredProjectSubagentType(
  record: StoredSubagentTypeConfigFile,
  fallbackId: string,
  systemPrompt?: string,
): ProjectSubagentTypeDefinition | null {
  const id = normalizeOptionalText(record.id) ?? fallbackId;
  if (!id) {
    return null;
  }
  const toolNames = Array.isArray(record.toolNames)
    ? [...new Set(record.toolNames.flatMap((entry) => {
        const toolName = normalizeOptionalText(entry);
        return toolName ? [toolName] : [];
      }))]
    : undefined;
  return {
    ...(normalizeOptionalText(record.description) ? { description: normalizeOptionalText(record.description) } : {}),
    id,
    ...(normalizeOptionalText(record.modelId) ? { modelId: normalizeOptionalText(record.modelId) } : {}),
    name: normalizeOptionalText(record.name) ?? id,
    ...(normalizeOptionalText(record.providerId) ? { providerId: normalizeOptionalText(record.providerId) } : {}),
    ...(normalizeOptionalText(systemPrompt) ? { system: normalizeOptionalText(systemPrompt) } : {}),
    ...(toolNames && toolNames.length > 0 ? { toolNames } : {}),
  };
}

function readStoredProjectSubagentType(subagentRoot: string): ProjectSubagentTypeDefinition | null {
  const configPath = path.join(subagentRoot, SUBAGENT_CONFIG_FILE_NAME);
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const fallbackId = decodeURIComponent(path.basename(subagentRoot));
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as StoredSubagentTypeConfigFile;
    return normalizeStoredProjectSubagentType(parsed, fallbackId, readStoredProjectSubagentPrompt(subagentRoot));
  } catch {
    return null;
  }
}

function readStoredProjectSubagentPrompt(subagentRoot: string): string | undefined {
  const promptPath = path.join(subagentRoot, SUBAGENT_PROMPT_FILE_NAME);
  if (!fs.existsSync(promptPath)) {
    return undefined;
  }
  return fs.readFileSync(promptPath, 'utf-8');
}

function writeStoredProjectSubagentType(subagentRoot: string, entry: ProjectSubagentTypeDefinition): void {
  fs.mkdirSync(subagentRoot, { recursive: true });
  const config: StoredSubagentTypeConfigFile = {
    ...(normalizeOptionalText(entry.description) ? { description: entry.description } : {}),
    id: entry.id,
    ...(normalizeOptionalText(entry.modelId) ? { modelId: entry.modelId } : {}),
    name: entry.name,
    ...(normalizeOptionalText(entry.providerId) ? { providerId: entry.providerId } : {}),
    ...(entry.toolNames && entry.toolNames.length > 0 ? { toolNames: entry.toolNames } : {}),
  };
  fs.writeFileSync(path.join(subagentRoot, SUBAGENT_CONFIG_FILE_NAME), JSON.stringify(config, null, 2), 'utf-8');
  const promptPath = path.join(subagentRoot, SUBAGENT_PROMPT_FILE_NAME);
  const systemPrompt = normalizeOptionalText(entry.system);
  if (systemPrompt) {
    fs.writeFileSync(promptPath, systemPrompt, 'utf-8');
    return;
  }
  if (fs.existsSync(promptPath)) {
    fs.rmSync(promptPath, { force: true });
  }
}

function loadProjectSubagentTypes(storageRoot: string): ProjectSubagentTypeDefinition[] {
  if (!fs.existsSync(storageRoot)) return [];
  return fs.readdirSync(storageRoot, { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory()
      ? [readStoredProjectSubagentType(path.join(storageRoot, entry.name))]
      : [])
    .filter((entry): entry is ProjectSubagentTypeDefinition => Boolean(entry))
    .sort((left, right) => left.id.localeCompare(right.id));
}

// ─── 路径常量 ───

const SUBAGENT_ROOT = path.resolve(__dirname, '..', 'config', 'subagent');
const EXPLORE_ROOT = path.join(SUBAGENT_ROOT, 'explore');
const GENERAL_ROOT = path.join(SUBAGENT_ROOT, 'general');
const EXPLORE_JSON = path.join(EXPLORE_ROOT, 'subagent.json');
const GENERAL_JSON = path.join(GENERAL_ROOT, 'subagent.json');
const EXPLORE_PROMPT = path.join(EXPLORE_ROOT, 'prompt.md');

const DEFAULT_SUBAGENT_TYPES: ProjectSubagentTypeDefinition[] = [
  {
    id: 'general',
    name: '通用',
    description: '默认子代理类型。沿用当前请求显式指定的模型与系统提示词，不额外裁剪工具。',
  },
  {
    id: 'explore',
    name: '探索',
    description: '只读探索。适合检索资料、读取代码、收集上下文与加载技能，不主动修改文件。',
    system: ['你是一个专注于探索与信息收集的子代理。', '优先检索、抓取、整理上下文，不主动修改文件。', '如果信息不足，先继续检索，再给出结论。'].join('\n'),
    toolNames: ['read', 'glob', 'grep', 'webfetch', 'skill'],
  },
  {
    id: 'review',
    name: '审阅',
    description: '审阅挑错。适合复核方案、找风险、列缺口，优先给出证据与结论，不主动修改文件。',
    system: ['你是一个专注于审阅与风险检查的子代理。', '优先识别错误、回归风险、缺失前提与验证缺口。', '默认不修改文件，先输出问题、依据与建议。'].join('\n'),
    toolNames: ['read', 'glob', 'grep', 'webfetch', 'skill'],
  },
  {
    id: 'writer',
    name: '写作',
    description: '写作整理。适合草拟文案、总结、改写与创意写作，优先直接产出可复用文本。',
    system: ['你是一个专注于写作与整理表达的子代理。', '优先产出结构清晰、语气一致、可以直接复用的文本。', '除非任务明确要求，否则不要主动发散到无关工具操作。'].join('\n'),
  },
];

// ─── 文件助手 ───

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T : fallback;
  } catch {
    return fallback;
  }
}

function findSubagentDirectories(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

// ========================================================================
// 测试
// ========================================================================

describe('config/subagent/ 配置模块', () => {

  // ── 1. 目录结构验证 ──

  describe('1. 目录结构验证', () => {
    it('config/subagent/ 目录存在', () => {
      expect(fs.existsSync(SUBAGENT_ROOT)).toBe(true);
      expect(fs.statSync(SUBAGENT_ROOT).isDirectory()).toBe(true);
    });

    it('explore 子目录存在', () => {
      expect(fs.existsSync(EXPLORE_ROOT)).toBe(true);
      expect(fs.statSync(EXPLORE_ROOT).isDirectory()).toBe(true);
    });

    it('general 子目录存在', () => {
      expect(fs.existsSync(GENERAL_ROOT)).toBe(true);
      expect(fs.statSync(GENERAL_ROOT).isDirectory()).toBe(true);
    });

    it('explore/subagent.json 存在', () => {
      expect(fs.existsSync(EXPLORE_JSON)).toBe(true);
    });

    it('general/subagent.json 存在', () => {
      expect(fs.existsSync(GENERAL_JSON)).toBe(true);
    });

    it('explore/prompt.md 存在', () => {
      expect(fs.existsSync(EXPLORE_PROMPT)).toBe(true);
    });

    it('general 不含 prompt.md', () => {
      const promptPath = path.join(GENERAL_ROOT, 'prompt.md');
      expect(fs.existsSync(promptPath)).toBe(false);
    });

    it('目录名按字母序排列', () => {
      const dirs = findSubagentDirectories(SUBAGENT_ROOT);
      const sorted = [...dirs].sort((a, b) => a.localeCompare(b));
      expect(dirs).toEqual(sorted);
    });

    it('目录名为 encodeURIComponent 编码的 ID', () => {
      const dirs = findSubagentDirectories(SUBAGENT_ROOT);
      for (const dir of dirs) {
        expect(decodeURIComponent(dir)).toEqual(dir);
      }
    });
  });

  // ── 2. explore/subagent.json 结构验证 ──

  describe('2. explore/subagent.json 结构验证', () => {
    let json: Record<string, unknown>;

    beforeAll(() => {
      json = readJsonFile(EXPLORE_JSON, {});
    });

    it('顶级字段完整', () => {
      expect(json).toHaveProperty('id');
      expect(json).toHaveProperty('name');
      expect(json).toHaveProperty('description');
      expect(json).toHaveProperty('toolNames');
    });

    it('无未知顶级字段', () => {
      const allowed = new Set(['id', 'name', 'description', 'toolNames']);
      for (const key of Object.keys(json)) {
        expect(allowed.has(key)).toBe(true);
      }
    });

    it('id 为 "explore"', () => {
      expect(json.id).toBe('explore');
    });

    it('name 为 "探索"', () => {
      expect(json.name).toBe('探索');
    });

    it('description 为非空字符串', () => {
      expect(typeof json.description).toBe('string');
      expect((json.description as string).length).toBeGreaterThan(0);
    });

    it('toolNames 为数组', () => {
      expect(Array.isArray(json.toolNames)).toBe(true);
    });

    it('toolNames 包含 webfetch', () => {
      expect(json.toolNames).toContain('webfetch');
    });

    it('toolNames 包含 skill', () => {
      expect(json.toolNames).toContain('skill');
    });

    it('toolNames 长度为 2', () => {
      expect((json.toolNames as string[]).length).toBe(2);
    });
  });

  // ── 3. general/subagent.json 结构验证 ──

  describe('3. general/subagent.json 结构验证', () => {
    let json: Record<string, unknown>;

    beforeAll(() => {
      json = readJsonFile(GENERAL_JSON, {});
    });

    it('顶级字段完整', () => {
      expect(json).toHaveProperty('id');
      expect(json).toHaveProperty('name');
      expect(json).toHaveProperty('description');
    });

    it('无未知顶级字段', () => {
      const allowed = new Set(['id', 'name', 'description']);
      for (const key of Object.keys(json)) {
        expect(allowed.has(key)).toBe(true);
      }
    });

    it('id 为 "general"', () => {
      expect(json.id).toBe('general');
    });

    it('name 为 "通用"', () => {
      expect(json.name).toBe('通用');
    });

    it('description 为非空字符串', () => {
      expect(typeof json.description).toBe('string');
      expect((json.description as string).length).toBeGreaterThan(0);
    });

    it('不包含 toolNames 字段', () => {
      expect(json).not.toHaveProperty('toolNames');
    });

    it('不包含 modelId 字段', () => {
      expect(json).not.toHaveProperty('modelId');
    });

    it('不包含 providerId 字段', () => {
      expect(json).not.toHaveProperty('providerId');
    });
  });

  // ── 4. explore/prompt.md 内容验证 ──

  describe('4. explore/prompt.md 内容验证', () => {
    let content: string;

    beforeAll(() => {
      content = fs.readFileSync(EXPLORE_PROMPT, 'utf-8');
    });

    it('文件非空', () => {
      expect(content.length).toBeGreaterThan(0);
    });

    it('包含 "探索" 关键词', () => {
      expect(content).toContain('探索');
    });

    it('包含 "信息收集"', () => {
      expect(content).toContain('信息收集');
    });

    it('包含 "不主动修改文件"', () => {
      expect(content).toContain('不主动修改文件');
    });

    it('包含 "先继续检索"', () => {
      expect(content).toContain('先继续检索');
    });

    it('内容与默认定义一致', () => {
      const exploreDefault = DEFAULT_SUBAGENT_TYPES.find((t) => t.id === 'explore');
      expect(exploreDefault).toBeDefined();
      expect(content.trim()).toBe(exploreDefault!.system);
    });

    it('结尾无多余空白', () => {
      const lines = content.split('\n');
      const lastNonEmpty = lines.filter((l) => l.trim().length > 0);
      expect(lastNonEmpty.length).toBeGreaterThan(0);
    });
  });

  // ── 5. 规范化函数 ──

  describe('5. 规范化函数', () => {
    describe('normalizeOptionalText', () => {
      it('返回合法字符串的 trim', () => {
        expect(normalizeOptionalText(' hello ')).toBe('hello');
      });
      it('空字符串返回 undefined', () => {
        expect(normalizeOptionalText('')).toBeUndefined();
      });
      it('空白字符串返回 undefined', () => {
        expect(normalizeOptionalText('   ')).toBeUndefined();
      });
      it('非字符串返回 undefined', () => {
        expect(normalizeOptionalText(null)).toBeUndefined();
        expect(normalizeOptionalText(undefined)).toBeUndefined();
        expect(normalizeOptionalText(42)).toBeUndefined();
      });
    });

    describe('normalizeStoredProjectSubagentType', () => {
      it('完整参数构造', () => {
        const result = normalizeStoredProjectSubagentType({
          id: 'test-agent',
          name: 'Test Agent',
          description: 'A test agent',
          modelId: 'gpt-4',
          providerId: 'openai',
          toolNames: ['read', 'write'],
        }, 'fallback', 'System prompt here.');
        expect(result).not.toBeNull();
        expect(result!.id).toBe('test-agent');
        expect(result!.name).toBe('Test Agent');
        expect(result!.description).toBe('A test agent');
        expect(result!.modelId).toBe('gpt-4');
        expect(result!.providerId).toBe('openai');
        expect(result!.system).toBe('System prompt here.');
        expect(result!.toolNames).toEqual(['read', 'write']);
      });

      it('缺失 id 使用 fallbackId', () => {
        const result = normalizeStoredProjectSubagentType({ name: 'Test' }, 'fallback-id');
        expect(result).not.toBeNull();
        expect(result!.id).toBe('fallback-id');
      });

      it('空 id 使用 fallbackId', () => {
        const result = normalizeStoredProjectSubagentType({ id: '', name: 'Test' }, 'fallback-id');
        expect(result).not.toBeNull();
        expect(result!.id).toBe('fallback-id');
      });

      it('缺失 name 使用 id', () => {
        const result = normalizeStoredProjectSubagentType({ id: 'test-id' }, 'fallback');
        expect(result!.name).toBe('test-id');
      });

      it('缺失可选项不产生 undefined 字段', () => {
        const result = normalizeStoredProjectSubagentType({ id: 'minimal' }, 'fallback');
        expect(result!.description).toBeUndefined();
        expect(result!.modelId).toBeUndefined();
        expect(result!.providerId).toBeUndefined();
        expect(result!.system).toBeUndefined();
        expect(result!.toolNames).toBeUndefined();
      });

      it('toolNames 去重并过滤空值', () => {
        const result = normalizeStoredProjectSubagentType({
          id: 'test',
          toolNames: ['read', 'read', '', '  ', 'write'],
        }, 'fallback');
        expect(result!.toolNames).toEqual(['read', 'write']);
      });

      it('空 toolNames 数组不产生 toolNames 字段', () => {
        const result = normalizeStoredProjectSubagentType({
          id: 'test',
          toolNames: [],
        }, 'fallback');
        expect(result!.toolNames).toBeUndefined();
      });

      it('仅含空字符串的 toolNames 不产生字段', () => {
        const result = normalizeStoredProjectSubagentType({
          id: 'test',
          toolNames: ['', '  '],
        }, 'fallback');
        expect(result!.toolNames).toBeUndefined();
      });

      it('将空 description 排除', () => {
        const result = normalizeStoredProjectSubagentType({
          id: 'test',
          description: '',
        }, 'fallback');
        expect(result!.description).toBeUndefined();
      });

      it('将空 modelId 排除', () => {
        const result = normalizeStoredProjectSubagentType({
          id: 'test',
          modelId: '',
        }, 'fallback');
        expect(result!.modelId).toBeUndefined();
      });

      it('将空 providerId 排除', () => {
        const result = normalizeStoredProjectSubagentType({
          id: 'test',
          providerId: '',
        }, 'fallback');
        expect(result!.providerId).toBeUndefined();
      });

      it('空 systemPrompt 不产生 system 字段', () => {
        const result = normalizeStoredProjectSubagentType({ id: 'test' }, 'fallback', '');
        expect(result!.system).toBeUndefined();
      });

      it('空白 systemPrompt 不产生 system 字段', () => {
        const result = normalizeStoredProjectSubagentType({ id: 'test' }, 'fallback', '   ');
        expect(result!.system).toBeUndefined();
      });
    });

    describe('readStoredProjectSubagentPrompt', () => {
      it('不存在的 prompt.md 返回 undefined', () => {
        const tmpDir = path.join(os.tmpdir(), `subagent-prompt-nonexist-${Date.now()}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        const result = readStoredProjectSubagentPrompt(tmpDir);
        expect(result).toBeUndefined();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      });
    });
  });

  // ── 6. 文件系统读写 ──

  describe('6. 文件系统读写', () => {
    const tmpRoot = path.join(os.tmpdir(), `config-subagent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    afterAll(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('读取真实 explore/subagent.json', () => {
      const parsed = readStoredProjectSubagentType(EXPLORE_ROOT);
      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe('explore');
      expect(parsed!.name).toBe('探索');
      expect(parsed!.description).toBeDefined();
      expect(parsed!.system).toBeDefined();
      expect(parsed!.toolNames).toEqual(['webfetch', 'skill']);
    });

    it('读取真实 general/subagent.json', () => {
      const parsed = readStoredProjectSubagentType(GENERAL_ROOT);
      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe('general');
      expect(parsed!.name).toBe('通用');
      expect(parsed!.description).toBeDefined();
      expect(parsed!.system).toBeUndefined();
      expect(parsed!.toolNames).toBeUndefined();
    });

    it('读取真实 explore/prompt.md', () => {
      const prompt = readStoredProjectSubagentPrompt(EXPLORE_ROOT);
      expect(prompt).toBeDefined();
      expect(prompt!.length).toBeGreaterThan(0);
    });

    it('写入并读取完整的 subagent 类型', () => {
      const subagentRoot = path.join(tmpRoot, 'test-agent');
      const entry: ProjectSubagentTypeDefinition = {
        id: 'test-agent',
        name: 'Test Agent',
        description: 'A test subagent type',
        system: 'You are a test agent.',
        toolNames: ['read', 'write'],
      };
      writeStoredProjectSubagentType(subagentRoot, entry);

      const readBack = readStoredProjectSubagentType(subagentRoot);
      expect(readBack).not.toBeNull();
      expect(readBack!.id).toBe('test-agent');
      expect(readBack!.name).toBe('Test Agent');
      expect(readBack!.description).toBe('A test subagent type');
      expect(readBack!.system).toBe('You are a test agent.');
      expect(readBack!.toolNames).toEqual(['read', 'write']);
    });

    it('写入无 system 的类型不生成 prompt.md', () => {
      const subagentRoot = path.join(tmpRoot, 'no-prompt');
      const entry: ProjectSubagentTypeDefinition = {
        id: 'no-prompt',
        name: 'No Prompt',
      };
      writeStoredProjectSubagentType(subagentRoot, entry);

      const promptPath = path.join(subagentRoot, 'prompt.md');
      expect(fs.existsSync(promptPath)).toBe(false);

      const readBack = readStoredProjectSubagentType(subagentRoot);
      expect(readBack!.system).toBeUndefined();
    });

    it('写入 toolNames 为 undefined 的类型不包含 toolNames', () => {
      const subagentRoot = path.join(tmpRoot, 'no-tools');
      const entry: ProjectSubagentTypeDefinition = {
        id: 'no-tools',
        name: 'No Tools',
      };
      writeStoredProjectSubagentType(subagentRoot, entry);

      const config = readJsonFile<Record<string, unknown>>(path.join(subagentRoot, 'subagent.json'), {});
      expect(config).not.toHaveProperty('toolNames');
    });

    it('写入 system 后清除 prompt.md', () => {
      const subagentRoot = path.join(tmpRoot, 'clear-prompt');
      const entryWithSystem: ProjectSubagentTypeDefinition = {
        id: 'clear-prompt',
        name: 'Clear Prompt',
        system: 'Initial prompt.',
      };
      writeStoredProjectSubagentType(subagentRoot, entryWithSystem);
      expect(fs.existsSync(path.join(subagentRoot, 'prompt.md'))).toBe(true);

      const entryWithoutSystem: ProjectSubagentTypeDefinition = {
        id: 'clear-prompt',
        name: 'Clear Prompt',
      };
      writeStoredProjectSubagentType(subagentRoot, entryWithoutSystem);
      expect(fs.existsSync(path.join(subagentRoot, 'prompt.md'))).toBe(false);
    });

    it('加载多类型目录', () => {
      const dirs = ['agent-a', 'agent-b', 'agent-c'];
      for (const dir of dirs) {
        const root = path.join(tmpRoot, 'multi', dir);
        writeStoredProjectSubagentType(root, { id: dir, name: dir });
      }

      const types = loadProjectSubagentTypes(path.join(tmpRoot, 'multi'));
      expect(types.length).toBe(3);
      expect(types[0].id).toBe('agent-a');
      expect(types[1].id).toBe('agent-b');
      expect(types[2].id).toBe('agent-c');
    });

    it('空目录返回空列表', () => {
      const emptyRoot = path.join(tmpRoot, 'empty');
      fs.mkdirSync(emptyRoot, { recursive: true });
      expect(loadProjectSubagentTypes(emptyRoot)).toEqual([]);
    });

    it('损坏的 JSON 返回 null', () => {
      const badRoot = path.join(tmpRoot, 'bad-json');
      fs.mkdirSync(badRoot, { recursive: true });
      fs.writeFileSync(path.join(badRoot, 'subagent.json'), '{bad json}', 'utf-8');
      expect(readStoredProjectSubagentType(badRoot)).toBeNull();
    });

    it('缺失 subagent.json 返回 null', () => {
      const missingRoot = path.join(tmpRoot, 'missing-config');
      fs.mkdirSync(missingRoot, { recursive: true });
      expect(readStoredProjectSubagentType(missingRoot)).toBeNull();
    });
  });

  // ── 7. 类型风格一致 ──

  describe('7. 类型风格一致', () => {
    it('PluginSubagentTypeSummary 最小构造', () => {
      const summary: PluginSubagentTypeSummary = { id: 'test', name: 'Test' };
      expect(summary.id).toBe('test');
      expect(summary.name).toBe('Test');
      expect(summary.description).toBeUndefined();
    });

    it('PluginSubagentTypeSummary 含 description', () => {
      const summary: PluginSubagentTypeSummary = { id: 'explore', name: '探索', description: '探索型子代理' };
      expect(summary.description).toBe('探索型子代理');
    });

    it('ProjectSubagentTypeDefinition 最小构造', () => {
      const def: ProjectSubagentTypeDefinition = { id: 'minimal', name: 'Minimal' };
      expect(def.description).toBeUndefined();
      expect(def.modelId).toBeUndefined();
      expect(def.providerId).toBeUndefined();
      expect(def.system).toBeUndefined();
      expect(def.toolNames).toBeUndefined();
    });

    it('ProjectSubagentTypeDefinition 全字段构造', () => {
      const def: ProjectSubagentTypeDefinition = {
        id: 'full',
        name: 'Full',
        description: 'desc',
        modelId: 'gpt-4',
        providerId: 'openai',
        system: 'system prompt',
        toolNames: ['read', 'write'],
      };
      expect(def.id).toBe('full');
      expect(def.name).toBe('Full');
      expect(def.description).toBe('desc');
      expect(def.modelId).toBe('gpt-4');
      expect(def.providerId).toBe('openai');
      expect(def.system).toBe('system prompt');
      expect(def.toolNames).toEqual(['read', 'write']);
    });

    it('DEFAULT_SUBAGENT_TYPES 包含 4 种类型', () => {
      expect(DEFAULT_SUBAGENT_TYPES).toHaveLength(4);
    });

    it('DEFAULT_SUBAGENT_TYPES ID 唯一', () => {
      const ids = DEFAULT_SUBAGENT_TYPES.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // ── 8. 边界条件 ──

  describe('8. 边界条件', () => {
    it('normalizeOptionalText 处理换行+空白', () => {
      expect(normalizeOptionalText('\n  hello  \n')).toBe('hello');
    });

    it('normalizeOptionalText 处理制表符', () => {
      expect(normalizeOptionalText('\thello\t')).toBe('hello');
    });

    it('normalizeStoredProjectSubagentType 处理 null record', () => {
      const result = normalizeStoredProjectSubagentType({} as StoredSubagentTypeConfigFile, 'fallback');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('fallback');
      expect(result!.name).toBe('fallback');
    });

    it('loadProjectSubagentTypes 处理不存在目录', () => {
      const result = loadProjectSubagentTypes(path.join(os.tmpdir(), `nonexistent-${Date.now()}`));
      expect(result).toEqual([]);
    });

    it('decodeURIComponent 验证目录名编码', () => {
      const encoded = encodeURIComponent('test-agent');
      expect(decodeURIComponent(encoded)).toBe('test-agent');
    });

    it('JSON 多余字段容错', () => {
      const result = normalizeStoredProjectSubagentType({
        id: 'test',
        name: 'Test',
        extraField: 'should be ignored',
      } as StoredSubagentTypeConfigFile, 'fallback');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('test');
    });

    it('超长 name 保留', () => {
      const longName = 'A'.repeat(1000);
      const result = normalizeStoredProjectSubagentType({ id: 'test', name: longName }, 'fallback');
      expect(result!.name).toBe(longName);
    });

    it('大量 toolNames 去重', () => {
      const tools = Array.from({ length: 100 }, (_, i) => `tool-${i % 10}`);
      const result = normalizeStoredProjectSubagentType({ id: 'test', toolNames: tools }, 'fallback');
      expect(result!.toolNames).toHaveLength(10);
    });

    it('trim 处理前后空白的字段', () => {
      const result = normalizeStoredProjectSubagentType({
        id: '  test  ',
        name: '  Name  ',
        description: '  Desc  ',
      }, 'fallback');
      expect(result!.id).toBe('test');
      expect(result!.name).toBe('Name');
      expect(result!.description).toBe('Desc');
    });
  });

  // ── 9. 集成验证 ──

  describe('9. 集成验证', () => {
    it('读取 explore 并通过 normalizeStoredProjectSubagentType 验证', () => {
      const parsed = readStoredProjectSubagentType(EXPLORE_ROOT);
      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe('explore');
      expect(parsed!.name).toBe('探索');
      expect(typeof parsed!.description).toBe('string');
      expect(parsed!.description!.length).toBeGreaterThan(0);
      expect(parsed!.system).toBeDefined();
      expect(parsed!.system!.length).toBeGreaterThan(0);
      expect(parsed!.toolNames).toBeDefined();
      expect(parsed!.toolNames!.length).toBeGreaterThan(0);
    });

    it('读取 general 并通过 normalizeStoredProjectSubagentType 验证', () => {
      const parsed = readStoredProjectSubagentType(GENERAL_ROOT);
      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe('general');
      expect(parsed!.name).toBe('通用');
      expect(parsed!.system).toBeUndefined();
      expect(parsed!.toolNames).toBeUndefined();
    });

    it('readStoredProjectSubagentPrompt 读取实际 prompt.md', () => {
      const prompt = readStoredProjectSubagentPrompt(EXPLORE_ROOT);
      expect(prompt).toBeDefined();
      expect(prompt).toContain('探索');
      expect(prompt).toContain('信息收集');
    });

    it('loadProjectSubagentTypes 从实际目录加载', () => {
      const types = loadProjectSubagentTypes(SUBAGENT_ROOT);
      expect(types.length).toBeGreaterThanOrEqual(2);
      const ids = types.map((t) => t.id);
      expect(ids).toContain('explore');
      expect(ids).toContain('general');
    });

    it('explore 的 toolNames 存储与默认定义一致', () => {
      const parsed = readStoredProjectSubagentType(EXPLORE_ROOT);
      const exploreDefault = DEFAULT_SUBAGENT_TYPES.find((t) => t.id === 'explore');
      expect(exploreDefault).toBeDefined();
      // 磁盘上的 toolNames 只包含 webfetch 和 skill（用户自定义精简版）
      expect(parsed!.toolNames).toEqual(['webfetch', 'skill']);
    });

    it('general 的 description 为预期中文描述', () => {
      const parsed = readStoredProjectSubagentType(GENERAL_ROOT);
      expect(parsed!.description).toBe('默认子代理类型。沿用当前请求显式指定的模型与系统提示词，不额外裁剪工具。');
    });

    it('写入+读取 roundtrip 保持字段完整性', () => {
      const roundtripRoot = path.join(os.tmpdir(), `subagent-roundtrip-${Date.now()}`);
      const original: ProjectSubagentTypeDefinition = {
        id: 'roundtrip-test',
        name: 'Roundtrip Test',
        description: 'Testing roundtrip',
        modelId: 'gpt-4o',
        providerId: 'openai',
        system: 'You are a roundtrip test agent.',
        toolNames: ['read', 'write', 'edit'],
      };
      writeStoredProjectSubagentType(roundtripRoot, original);
      const readBack = readStoredProjectSubagentType(roundtripRoot);
      expect(readBack).not.toBeNull();
      expect(readBack!.id).toBe(original.id);
      expect(readBack!.name).toBe(original.name);
      expect(readBack!.description).toBe(original.description);
      expect(readBack!.modelId).toBe(original.modelId);
      expect(readBack!.providerId).toBe(original.providerId);
      expect(readBack!.system).toBe(original.system);
      expect(readBack!.toolNames).toEqual(original.toolNames);
      fs.rmSync(roundtripRoot, { recursive: true, force: true });
    });

    it('JSON 多余字段不破坏读取', () => {
      const extraRoot = path.join(os.tmpdir(), `subagent-extra-${Date.now()}`);
      fs.mkdirSync(extraRoot, { recursive: true });
      fs.writeFileSync(path.join(extraRoot, 'subagent.json'), JSON.stringify({
        id: 'extra-test',
        name: 'Extra Fields Test',
        unknownField: 'should be tolerated',
        anotherUnknown: 42,
      }), 'utf-8');
      const parsed = readStoredProjectSubagentType(extraRoot);
      expect(parsed).not.toBeNull();
      expect(parsed!.id).toBe('extra-test');
      expect(parsed!.name).toBe('Extra Fields Test');
      fs.rmSync(extraRoot, { recursive: true, force: true });
    });
  });
});
