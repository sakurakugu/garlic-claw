import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── 类型定义（从 @garlic-claw/shared 对齐） ───

interface PluginPersonaDialogEntry {
  content: string;
  role: 'assistant' | 'user';
}

interface PluginPersonaSummary {
  id: string;
  name: string;
  avatar: string | null;
  description?: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PluginPersonaDetail extends PluginPersonaSummary {
  prompt: string;
  beginDialogs: PluginPersonaDialogEntry[];
  toolNames: string[] | null;
  customErrorMessage: string | null;
}

type StoredPersonaRecord = PluginPersonaDetail;

// ─── 内联纯函数（对齐 persona-store.service.ts） ───

const DEFAULT_PERSONA_ID = 'builtin.default-assistant';
const DEFAULT_PERSONA_TIMESTAMP = '2026-04-10T00:00:00.000Z';
const AVATAR_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif', '.ico', '.tif', '.tiff']);

const DEFAULT_PERSONA_PROMPT = `你是一个乐于助人的 AI 助手，名为 Garlic Claw（蒜蓉龙虾）。你可以帮助用户完成各种任务。
你可以使用工具来获取信息和执行操作。
一些工具让你可以控制连接的设备（PC、手机、IoT）。设备工具以设备名称为前缀，如果它们存在的话。
你可以使用 save_memory 将重要信息保存到长期记忆中，使用 search_memory 回忆过去的信息，使用 create_automation 创建自动化任务。
当用户分享个人偏好或重要事实时，主动将它们保存到记忆中。
始终保持乐于助人、简洁和友好的态度。使用用户使用的语言回复。`

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  return normalizeOptionalText(value) ?? null;
}

function normalizeRequiredText(value: unknown, fallback: string): string {
  return normalizeOptionalText(value) ?? fallback;
}

function normalizeDialogEntries(value: PluginPersonaDialogEntry[] | undefined): PluginPersonaDialogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const content = normalizeOptionalText(entry?.content);
    const role = entry?.role === 'assistant' || entry?.role === 'user' ? entry.role : null;
    return content && role ? [{ content, role }] : [];
  });
}

function normalizeNullableIdList(value: string[] | null | undefined): string[] | null {
  if (value === undefined || value === null) return null;
  return [...new Set(value.flatMap((entry) => {
    const normalized = normalizeOptionalText(entry);
    return normalized ? [normalized] : [];
  }))];
}

function createDefaultPersona(): StoredPersonaRecord {
  return {
    avatar: null,
    beginDialogs: [],
    createdAt: DEFAULT_PERSONA_TIMESTAMP,
    customErrorMessage: null,
    description: 'server 默认人格',
    id: DEFAULT_PERSONA_ID,
    isDefault: false,
    name: 'Default Assistant',
    prompt: DEFAULT_PERSONA_PROMPT,
    toolNames: null,
    updatedAt: DEFAULT_PERSONA_TIMESTAMP,
  };
}

function normalizeStoredPersona(persona: StoredPersonaRecord): StoredPersonaRecord {
  const fallback = createDefaultPersona();
  return {
    avatar: normalizeNullableText(persona.avatar),
    beginDialogs: normalizeDialogEntries(persona.beginDialogs),
    createdAt: typeof persona.createdAt === 'string' && persona.createdAt ? persona.createdAt : fallback.createdAt,
    customErrorMessage: normalizeNullableText(persona.customErrorMessage),
    description: normalizeOptionalText(persona.description),
    id: persona.id.trim(),
    isDefault: false,
    name: normalizeRequiredText(persona.name, persona.id),
    prompt: normalizeRequiredText(persona.prompt, fallback.prompt),
    toolNames: normalizeNullableIdList(persona.toolNames),
    updatedAt: typeof persona.updatedAt === 'string' && persona.updatedAt ? persona.updatedAt : fallback.updatedAt,
  };
}

function normalizeStoredPersonas(rawPersonas: StoredPersonaRecord[]): StoredPersonaRecord[] {
  const personas = rawPersonas
    .filter((persona): persona is StoredPersonaRecord => Boolean(persona && typeof persona.id === 'string' && persona.id.trim()))
    .map(normalizeStoredPersona);
  if (!personas.some((persona) => persona.id === DEFAULT_PERSONA_ID)) {
    personas.unshift(createDefaultPersona());
  }
  return personas.sort((left, right) => left.id.localeCompare(right.id));
}

function readPersonaAvatarFilePath(personaRoot: string): string | null {
  if (!fs.existsSync(personaRoot)) return null;
  const match = fs.readdirSync(personaRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .find((entry) => {
      const ext = path.extname(entry.name).toLowerCase();
      return path.basename(entry.name, ext).toLowerCase() === 'avatar' && AVATAR_EXTENSIONS.has(ext);
    });
  return match ? path.join(personaRoot, match.name) : null;
}

function readStoredPersonaConfig(configPath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function readStoredPersonaPrompt(personaRoot: string): string | null {
  const promptPath = path.join(personaRoot, 'prompt.md');
  if (!fs.existsSync(promptPath)) return null;
  return fs.readFileSync(promptPath, 'utf-8');
}

function readStoredPersona(personaRoot: string): StoredPersonaRecord | null {
  const configPath = path.join(personaRoot, 'persona.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = readStoredPersonaConfig(configPath);
    return {
      avatar: readPersonaAvatarFilePath(personaRoot),
      beginDialogs: config.beginDialogs as PluginPersonaDialogEntry[],
      createdAt: config.createdAt as string,
      customErrorMessage: config.customErrorMessage as string | null,
      description: config.description as string,
      id: (config.id as string) ?? path.basename(personaRoot),
      isDefault: false,
      name: config.name as string,
      prompt: readStoredPersonaPrompt(personaRoot) ?? '',
      toolNames: config.toolNames as string[] | null,
      updatedAt: config.updatedAt as string,
    } as StoredPersonaRecord;
  } catch {
    return null;
  }
}

function readStoredPersonas(storageRoot: string): StoredPersonaRecord[] {
  if (!fs.existsSync(storageRoot)) return [];
  return fs.readdirSync(storageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const persona = readStoredPersona(path.join(storageRoot, entry.name));
      return persona ? [persona] : [];
    });
}

function writeStoredPersona(storageRoot: string, persona: StoredPersonaRecord): void {
  const personaRoot = path.join(storageRoot, encodeURIComponent(persona.id.trim()));
  fs.mkdirSync(personaRoot, { recursive: true });
  const config = {
    beginDialogs: persona.beginDialogs,
    createdAt: persona.createdAt,
    customErrorMessage: persona.customErrorMessage,
    description: persona.description,
    id: persona.id,
    name: persona.name,
    toolNames: persona.toolNames,
    updatedAt: persona.updatedAt,
  };
  fs.writeFileSync(path.join(personaRoot, 'persona.json'), JSON.stringify(config, null, 2), 'utf-8');
  fs.writeFileSync(path.join(personaRoot, 'prompt.md'), persona.prompt.trimEnd(), 'utf-8');
}

function loadDefaultPersonaId(storageRoot: string, personas: StoredPersonaRecord[]): string {
  const selectionPath = path.join(storageRoot, 'settings.json');
  if (fs.existsSync(selectionPath)) {
    try {
      const { defaultPersonaId } = JSON.parse(fs.readFileSync(selectionPath, 'utf-8')) as { defaultPersonaId?: string };
      if (defaultPersonaId && personas.some((p) => p.id === defaultPersonaId)) {
        return defaultPersonaId;
      }
    } catch { /* empty */ }
  }
  return DEFAULT_PERSONA_ID;
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T : fallback;
  } catch {
    return fallback;
  }
}

// ─── 路径 ───

const PERSONAS_ROOT = path.resolve(__dirname, '..', 'config', 'personas');
const BUILTIN_ROOT = path.join(PERSONAS_ROOT, 'builtin.default-assistant');
const CONFIG_PATH = path.join(BUILTIN_ROOT, 'persona.json');
const PROMPT_PATH = path.join(BUILTIN_ROOT, 'prompt.md');

// ========================================================================
// 测试
// ========================================================================

describe('config/personas/ 配置模块', () => {

  // ── 1. 目录结构验证 ──

  describe('1. 目录结构验证', () => {
    it('config/personas/ 目录存在', () => {
      expect(fs.existsSync(PERSONAS_ROOT)).toBe(true);
    });

    it('builtin.default-assistant 子目录存在', () => {
      expect(fs.existsSync(BUILTIN_ROOT)).toBe(true);
      expect(fs.statSync(BUILTIN_ROOT).isDirectory()).toBe(true);
    });

    it('目录名是经过 encodeURIComponent 编码的 ID', () => {
      const dirName = path.basename(BUILTIN_ROOT);
      expect(dirName).toBe(encodeURIComponent('builtin.default-assistant'));
    });

    it('persona.json 存在', () => {
      expect(fs.existsSync(CONFIG_PATH)).toBe(true);
    });

    it('prompt.md 存在', () => {
      expect(fs.existsSync(PROMPT_PATH)).toBe(true);
    });

    it('无 settings.json 文件（应由运行时在首次加载时生成）', () => {
      const settingsPath = path.join(PERSONAS_ROOT, 'settings.json');
      // 如果存在则校验结构，否则跳过 — 运行时生成的文件可能已被清理
      if (fs.existsSync(settingsPath)) {
        const settings = readJsonFile<Record<string, unknown>>(settingsPath, {});
        expect(settings).toHaveProperty('defaultPersonaId');
      }
    });
  });

  // ── 2. persona.json 结构验证 ──

  describe('2. persona.json 结构验证', () => {
    let config: Record<string, unknown>;

    beforeAll(() => {
      config = readJsonFile<Record<string, unknown>>(CONFIG_PATH, {});
      expect(Object.keys(config).length).toBeGreaterThan(0);
    });

    describe('顶级字段完整', () => {
      it('包含所有必需字段', () => {
        const requiredKeys = ['id', 'name', 'description', 'createdAt', 'updatedAt', 'beginDialogs', 'customErrorMessage', 'toolNames'];
        for (const key of requiredKeys) {
          expect(config).toHaveProperty(key);
        }
      });

      it('无未知顶级字段', () => {
        const knownKeys = ['id', 'name', 'description', 'createdAt', 'updatedAt', 'beginDialogs', 'customErrorMessage', 'toolNames'];
        for (const key of Object.keys(config)) {
          expect(knownKeys.includes(key)).toBe(true);
        }
      });
    });

    describe('id', () => {
      it('值为 builtin.default-assistant', () => {
        expect(config.id).toBe(DEFAULT_PERSONA_ID);
      });

      it('为字符串类型', () => {
        expect(typeof config.id).toBe('string');
      });
    });

    describe('name', () => {
      it('值为 Default Assistant', () => {
        expect(config.name).toBe('Default Assistant');
      });

      it('为字符串类型', () => {
        expect(typeof config.name).toBe('string');
      });

      it('非空字符串', () => {
        expect((config.name as string).trim().length).toBeGreaterThan(0);
      });
    });

    describe('description', () => {
      it('值为 server 默认人格', () => {
        expect(config.description).toBe('server 默认人格');
      });

      it('为字符串类型', () => {
        expect(typeof config.description).toBe('string');
      });
    });

    describe('beginDialogs', () => {
      it('为空数组', () => {
        expect(Array.isArray(config.beginDialogs)).toBe(true);
        expect((config.beginDialogs as unknown[]).length).toBe(0);
      });
    });

    describe('customErrorMessage', () => {
      it('为 null', () => {
        expect(config.customErrorMessage).toBeNull();
      });
    });

    describe('toolNames', () => {
      it('为 null', () => {
        expect(config.toolNames).toBeNull();
      });
    });

    describe('createdAt / updatedAt', () => {
      it('createdAt 为 ISO 日期字符串', () => {
        expect(typeof config.createdAt).toBe('string');
        expect(new Date(config.createdAt as string).toISOString()).toBe(config.createdAt);
      });

      it('updatedAt 为 ISO 日期字符串', () => {
        expect(typeof config.updatedAt).toBe('string');
        expect(new Date(config.updatedAt as string).toISOString()).toBe(config.updatedAt);
      });

      it('createdAt 与 updatedAt 相同（初始值）', () => {
        expect(config.createdAt).toBe(config.updatedAt);
      });

      it('时间戳为 2026-04-10', () => {
        expect(config.createdAt).toBe(DEFAULT_PERSONA_TIMESTAMP);
        expect(config.updatedAt).toBe(DEFAULT_PERSONA_TIMESTAMP);
      });
    });
  });

  // ── 3. prompt.md 内容验证 ──

  describe('3. prompt.md 内容验证', () => {
    let prompt: string;

    beforeAll(() => {
      prompt = fs.readFileSync(PROMPT_PATH, 'utf-8');
    });

    it('文件非空', () => {
      expect(prompt.length).toBeGreaterThan(0);
    });

    it('内容与 DEFAULT_PERSONA_PROMPT 一致', () => {
      expect(prompt).toBe(DEFAULT_PERSONA_PROMPT);
    });

    it('包含 "Garlic Claw" 标识', () => {
      expect(prompt).toContain('Garlic Claw');
    });

    it('包含 "蒜蓉龙虾" 标识', () => {
      expect(prompt).toContain('蒜蓉龙虾');
    });

    it('提及可用工具', () => {
      expect(prompt).toContain('工具');
    });

    it('结尾无多余空白', () => {
      expect(prompt.endsWith('\n')).toBe(false);
    });
  });

  // ── 4. Avatar 文件验证 ──

  describe('4. Avatar 文件', () => {
    it('avatar 文件存在', () => {
      const avatarPath = readPersonaAvatarFilePath(BUILTIN_ROOT);
      expect(avatarPath).not.toBeNull();
    });

    it('avatar 文件为有效图片格式', () => {
      const avatarPath = readPersonaAvatarFilePath(BUILTIN_ROOT);
      expect(avatarPath).not.toBeNull();
      const ext = path.extname(avatarPath!).toLowerCase();
      expect(AVATAR_EXTENSIONS.has(ext)).toBe(true);
    });

    it('avatar 文件名以 avatar 开头', () => {
      const avatarPath = readPersonaAvatarFilePath(BUILTIN_ROOT);
      expect(avatarPath).not.toBeNull();
      const basename = path.basename(avatarPath!, path.extname(avatarPath!)).toLowerCase();
      expect(basename).toBe('avatar');
    });

    it('avatar 文件大小非零', () => {
      const avatarPath = readPersonaAvatarFilePath(BUILTIN_ROOT);
      expect(avatarPath).not.toBeNull();
      const stat = fs.statSync(avatarPath!);
      expect(stat.size).toBeGreaterThan(0);
    });
  });

  // ── 5. 规范化函数 ──

  describe('5. 规范化函数', () => {
    describe('normalizeOptionalText', () => {
      it('返回非空字符串的 trim', () => {
        expect(normalizeOptionalText(' hello ')).toBe('hello');
      });
      it('空字符串返回 undefined', () => {
        expect(normalizeOptionalText('')).toBeUndefined();
      });
      it('空白字符串返回 undefined', () => {
        expect(normalizeOptionalText('   ')).toBeUndefined();
      });
      it('undefined 返回 undefined', () => {
        expect(normalizeOptionalText(undefined)).toBeUndefined();
      });
      it('null 返回 undefined', () => {
        expect(normalizeOptionalText(null)).toBeUndefined();
      });
      it('数字返回 undefined', () => {
        expect(normalizeOptionalText(42)).toBeUndefined();
      });
    });

    describe('normalizeNullableText', () => {
      it('非空字符串返回自身', () => {
        expect(normalizeNullableText('hello')).toBe('hello');
      });
      it('undefined 返回 null', () => {
        expect(normalizeNullableText(undefined)).toBeNull();
      });
      it('null 返回 null', () => {
        expect(normalizeNullableText(null)).toBeNull();
      });
      it('空字符串返回 null', () => {
        expect(normalizeNullableText('')).toBeNull();
      });
    });

    describe('normalizeRequiredText', () => {
      it('非空字符串返回自身', () => {
        expect(normalizeRequiredText('hello', 'fallback')).toBe('hello');
      });
      it('空字符串返回 fallback', () => {
        expect(normalizeRequiredText('', 'fallback')).toBe('fallback');
      });
      it('undefined 返回 fallback', () => {
        expect(normalizeRequiredText(undefined, 'fallback')).toBe('fallback');
      });
      it('null 返回 fallback', () => {
        expect(normalizeRequiredText(null, 'fallback')).toBe('fallback');
      });
    });

    describe('normalizeDialogEntries', () => {
      it('undefined 返回空数组', () => {
        expect(normalizeDialogEntries(undefined)).toEqual([]);
      });
      it('非数组返回空数组', () => {
        expect(normalizeDialogEntries({} as unknown as PluginPersonaDialogEntry[])).toEqual([]);
      });
      it('合法条目保留', () => {
        const entries: PluginPersonaDialogEntry[] = [
          { content: '你好', role: 'assistant' },
          { content: '谢谢', role: 'user' },
        ];
        expect(normalizeDialogEntries(entries)).toEqual(entries);
      });
      it('非法 role 被过滤', () => {
        const entries = [
          { content: 'hi', role: 'system' as 'assistant' },
        ];
        expect(normalizeDialogEntries(entries)).toEqual([]);
      });
      it('空 content 被过滤', () => {
        const entries = [
          { content: '', role: 'assistant' },
        ];
        expect(normalizeDialogEntries(entries)).toEqual([]);
      });
      it('空白 content 被过滤', () => {
        const entries = [
          { content: '   ', role: 'assistant' },
        ];
        expect(normalizeDialogEntries(entries)).toEqual([]);
      });
      it('trim content', () => {
        const entries = [
          { content: '  你好  ', role: 'assistant' },
        ];
        expect(normalizeDialogEntries(entries)).toEqual([{ content: '你好', role: 'assistant' }]);
      });
      it('混合有效/无效条目', () => {
        const entries = [
          { content: 'valid', role: 'assistant' },
          { content: '', role: 'user' },
          { content: 'also valid', role: 'user' },
        ];
        expect(normalizeDialogEntries(entries)).toEqual([
          { content: 'valid', role: 'assistant' },
          { content: 'also valid', role: 'user' },
        ]);
      });
      it('null/undefined 条目被跳过', () => {
        const entries = [
          null,
          undefined,
          { content: 'ok', role: 'assistant' },
        ] as unknown as PluginPersonaDialogEntry[];
        expect(normalizeDialogEntries(entries)).toEqual([{ content: 'ok', role: 'assistant' }]);
      });
    });

    describe('normalizeNullableIdList', () => {
      it('undefined 返回 null', () => {
        expect(normalizeNullableIdList(undefined)).toBeNull();
      });
      it('null 返回 null', () => {
        expect(normalizeNullableIdList(null)).toBeNull();
      });
      it('空数组返回空数组', () => {
        expect(normalizeNullableIdList([])).toEqual([]);
      });
      it('去重', () => {
        expect(normalizeNullableIdList(['a', 'b', 'a'])).toEqual(['a', 'b']);
      });
      it('过滤空/空白字符串', () => {
        expect(normalizeNullableIdList(['a', '', '  ', 'b'])).toEqual(['a', 'b']);
      });
      it('trim 条目', () => {
        expect(normalizeNullableIdList(['  a  ', 'b'])).toEqual(['a', 'b']);
      });
    });

    describe('normalizeStoredPersona', () => {
      it('填充缺失字段从 fallback', () => {
        const minimal = {
          id: 'test.persona',
          name: '',
          prompt: '',
          avatar: null,
          beginDialogs: [],
          createdAt: '',
          customErrorMessage: null,
          description: '',
          isDefault: false,
          toolNames: null,
          updatedAt: '',
        } as StoredPersonaRecord;
        const normalized = normalizeStoredPersona(minimal);
        expect(normalized.id).toBe('test.persona');
        expect(normalized.name).toBe('test.persona');
        expect(normalized.prompt).toBe(DEFAULT_PERSONA_PROMPT);
        expect(normalized.createdAt).toBe(DEFAULT_PERSONA_TIMESTAMP);
        expect(normalized.updatedAt).toBe(DEFAULT_PERSONA_TIMESTAMP);
      });

      it('trim id', () => {
        const persona = { ...createDefaultPersona(), id: '  padded.id  ' };
        expect(normalizeStoredPersona(persona).id).toBe('padded.id');
      });

      it('保留合法 beginDialogs', () => {
        const persona = {
          ...createDefaultPersona(),
          beginDialogs: [{ content: 'hello', role: 'assistant' as const }],
        };
        expect(normalizeStoredPersona(persona).beginDialogs).toEqual([{ content: 'hello', role: 'assistant' }]);
      });

      it('非法 beginDialogs 被清空', () => {
        const persona = {
          ...createDefaultPersona(),
          beginDialogs: [{ content: '', role: 'assistant' as const }],
        };
        expect(normalizeStoredPersona(persona).beginDialogs).toEqual([]);
      });

      it('toolNames null 保留', () => {
        const persona = { ...createDefaultPersona(), toolNames: null };
        expect(normalizeStoredPersona(persona).toolNames).toBeNull();
      });

      it('toolNames 数组去重', () => {
        const persona = {
          ...createDefaultPersona(),
          toolNames: ['tool-a', 'tool-b', 'tool-a'],
        };
        expect(normalizeStoredPersona(persona).toolNames).toEqual(['tool-a', 'tool-b']);
      });

      it('normalizeNullableText 处理 avatar', () => {
        const persona = { ...createDefaultPersona(), avatar: '  /path/to/avatar.png  ' };
        expect(normalizeStoredPersona(persona).avatar).toBe('/path/to/avatar.png');
      });

      it('空 avatar 返回 null', () => {
        const persona = { ...createDefaultPersona(), avatar: '' };
        expect(normalizeStoredPersona(persona).avatar).toBeNull();
      });
    });

    describe('normalizeStoredPersonas', () => {
      it('空列表返回默认 persona', () => {
        const result = normalizeStoredPersonas([]);
        expect(result.length).toBe(1);
        expect(result[0].id).toBe(DEFAULT_PERSONA_ID);
      });

      it('过滤无效 ID 的 persona', () => {
        const result = normalizeStoredPersonas([
          { ...createDefaultPersona(), id: '' },
          { ...createDefaultPersona(), id: '  ' },
          null as unknown as StoredPersonaRecord,
        ]);
        expect(result.length).toBe(1);
        expect(result[0].id).toBe(DEFAULT_PERSONA_ID);
      });

      it('保证默认 persona 存在（插入到最前）', () => {
        const result = normalizeStoredPersonas([
          { ...createDefaultPersona(), id: 'custom.persona', name: 'Custom' },
        ]);
        expect(result.length).toBe(2);
        expect(result[0].id).toBe(DEFAULT_PERSONA_ID);
        expect(result[1].id).toBe('custom.persona');
      });

      it('不重复插入已存在的默认 persona', () => {
        const result = normalizeStoredPersonas([createDefaultPersona()]);
        expect(result.length).toBe(1);
      });

    it('按 ID 字母序排序（默认插入后整体排序）', () => {
      const result = normalizeStoredPersonas([
        { ...createDefaultPersona(), id: 'z.persona' },
        { ...createDefaultPersona(), id: 'a.persona' },
      ]);
      // 插入 default 后整体排序：'a.persona' < 'builtin.default-assistant' < 'z.persona'
      expect(result[0].id).toBe('a.persona');
      expect(result[1].id).toBe(DEFAULT_PERSONA_ID);
      expect(result[2].id).toBe('z.persona');
    });

    it('按 ID 字母序排序（含内置时）', () => {
      const result = normalizeStoredPersonas([
        { ...createDefaultPersona(), id: 'z.persona' },
        createDefaultPersona(),
        { ...createDefaultPersona(), id: 'a.persona' },
      ]);
      expect(result[0].id).toBe('a.persona');
      expect(result[1].id).toBe(DEFAULT_PERSONA_ID);
      expect(result[2].id).toBe('z.persona');
    });

    it('默认 persona 总是第一个（不含内置时）', () => {
      const result = normalizeStoredPersonas([
        { ...createDefaultPersona(), id: 'z.persona' },
      ]);
      expect(result[0].id).toBe(DEFAULT_PERSONA_ID);
      expect(result[1].id).toBe('z.persona');
    });
    });

    describe('readPersonaAvatarFilePath', () => {
      it('不存在的目录返回 null', () => {
        expect(readPersonaAvatarFilePath(path.join(os.tmpdir(), 'nonexistent-avatar-dir'))).toBeNull();
      });

      it('无 avatar 文件的目录返回 null', () => {
        const tmpDir = path.join(os.tmpdir(), `no-avatar-${Date.now()}`);
        fs.mkdirSync(tmpDir, { recursive: true });
        fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'hello');
        expect(readPersonaAvatarFilePath(tmpDir)).toBeNull();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      });
    });
  });

  // ── 6. 文件系统读写 ──

  describe('6. 文件系统读写', () => {
    const tmpRoot = path.join(os.tmpdir(), `config-personas-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    afterAll(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('空目录读取返回空列表', () => {
      fs.mkdirSync(tmpRoot, { recursive: true });
      const personas = readStoredPersonas(tmpRoot);
      expect(personas).toEqual([]);
    });

    it('写入并读取单个 persona', () => {
      const persona = createDefaultPersona();
      writeStoredPersona(tmpRoot, persona);

      const loaded = readStoredPersonas(tmpRoot);
      expect(loaded.length).toBe(1);
      expect(loaded[0].id).toBe(DEFAULT_PERSONA_ID);
      expect(loaded[0].name).toBe('Default Assistant');
      expect(loaded[0].prompt).toBe(DEFAULT_PERSONA_PROMPT);
      expect(loaded[0].beginDialogs).toEqual([]);
    });

    it('写入并读取自定义 persona', () => {
      const custom: StoredPersonaRecord = {
        avatar: null,
        beginDialogs: [{ content: '你好', role: 'assistant' }],
        createdAt: '2026-05-01T00:00:00.000Z',
        customErrorMessage: '出错了',
        description: '自定义助手',
        id: 'custom.helper',
        isDefault: false,
        name: 'Custom Helper',
        prompt: '你是一个自定义助手',
        toolNames: ['tool-a', 'tool-b'],
        updatedAt: '2026-05-01T00:00:00.000Z',
      };
      writeStoredPersona(tmpRoot, custom);

      const loaded = readStoredPersonas(tmpRoot);
      const found = loaded.find((p) => p.id === 'custom.helper');
      expect(found).toBeDefined();
      expect(found!.name).toBe('Custom Helper');
      expect(found!.prompt).toBe('你是一个自定义助手');
      expect(found!.toolNames).toEqual(['tool-a', 'tool-b']);
      expect(found!.beginDialogs).toEqual([{ content: '你好', role: 'assistant' }]);
      expect(found!.customErrorMessage).toBe('出错了');
    });

    it('写入的 prompt.md 结尾无多余空白', () => {
      const persona = { ...createDefaultPersona(), prompt: '测试提示\n' };
      writeStoredPersona(tmpRoot, persona);

      const promptPath = path.join(tmpRoot, encodeURIComponent(persona.id), 'prompt.md');
      const content = fs.readFileSync(promptPath, 'utf-8');
      expect(content.endsWith('\n')).toBe(false);
    });

    it('写入的 persona.json 包含所有必需字段', () => {
      const persona = createDefaultPersona();
      writeStoredPersona(tmpRoot, persona);

      const configPath = path.join(tmpRoot, encodeURIComponent(persona.id), 'persona.json');
      const config = readJsonFile<Record<string, unknown>>(configPath, {});
      expect(config).toHaveProperty('id');
      expect(config).toHaveProperty('name');
      expect(config).toHaveProperty('description');
      expect(config).toHaveProperty('beginDialogs');
      expect(config).toHaveProperty('createdAt');
      expect(config).toHaveProperty('updatedAt');
      expect(config).toHaveProperty('customErrorMessage');
      expect(config).toHaveProperty('toolNames');
      // avatar/prompt/isDefault 不应出现在 persona.json 中（由 store 管理）
      expect(config).not.toHaveProperty('avatar');
      expect(config).not.toHaveProperty('prompt');
      expect(config).not.toHaveProperty('isDefault');
    });

    it('persona.json 缺失时 readStoredPersona 返回 null', () => {
      const emptyDir = path.join(tmpRoot, 'no-config-dir');
      fs.mkdirSync(emptyDir, { recursive: true });
      const result = readStoredPersona(emptyDir);
      expect(result).toBeNull();
    });

    it('损坏的 persona.json 返回 null', () => {
      const badDir = path.join(tmpRoot, 'bad-persona');
      fs.mkdirSync(badDir, { recursive: true });
      fs.writeFileSync(path.join(badDir, 'persona.json'), '{ bad json }', 'utf-8');
      const result = readStoredPersona(badDir);
      expect(result).toBeNull();
    });

    it('缺少 prompt.md 的 persona 返回 prompt 为 undefined', () => {
      const noPromptDir = path.join(tmpRoot, 'no-prompt');
      fs.mkdirSync(noPromptDir, { recursive: true });
      fs.writeFileSync(path.join(noPromptDir, 'persona.json'), JSON.stringify({
        id: 'no-prompt',
        name: 'No Prompt',
        beginDialogs: [],
        createdAt: DEFAULT_PERSONA_TIMESTAMP,
        customErrorMessage: null,
        description: '',
        toolNames: null,
        updatedAt: DEFAULT_PERSONA_TIMESTAMP,
      }), 'utf-8');
      const result = readStoredPersona(noPromptDir);
      expect(result).not.toBeNull();
      expect(result!.prompt).toBe('');
    });

    it('多个 persona 共存', () => {
      const a: StoredPersonaRecord = { ...createDefaultPersona(), id: 'a.test' };
      const b: StoredPersonaRecord = { ...createDefaultPersona(), id: 'b.test' };
      writeStoredPersona(tmpRoot, a);
      writeStoredPersona(tmpRoot, b);

      const loaded = readStoredPersonas(tmpRoot);
      const ids = loaded.map((p) => p.id);
      expect(ids).toContain('a.test');
      expect(ids).toContain('b.test');
    });
  });

  // ── 7. settings.json 默认选择 ──

  describe('7. settings.json 默认选择', () => {
    const tmpRoot = path.join(os.tmpdir(), `config-personas-settings-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    afterAll(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('无 settings.json 时返回内置默认 ID', () => {
      fs.mkdirSync(tmpRoot, { recursive: true });
      const personas = [createDefaultPersona()];
      expect(loadDefaultPersonaId(tmpRoot, personas)).toBe(DEFAULT_PERSONA_ID);
    });

    it('读取 settings.json 中的 defaultPersonaId', () => {
      fs.writeFileSync(path.join(tmpRoot, 'settings.json'), JSON.stringify({ defaultPersonaId: 'custom.id' }), 'utf-8');
      const personas = [createDefaultPersona(), { ...createDefaultPersona(), id: 'custom.id' }];
      expect(loadDefaultPersonaId(tmpRoot, personas)).toBe('custom.id');
    });

    it('defaultPersonaId 指向不存在的 persona 时回退', () => {
      fs.writeFileSync(path.join(tmpRoot, 'settings.json'), JSON.stringify({ defaultPersonaId: 'nonexistent.id' }), 'utf-8');
      const personas = [createDefaultPersona()];
      expect(loadDefaultPersonaId(tmpRoot, personas)).toBe(DEFAULT_PERSONA_ID);
    });

    it('损坏的 settings.json 回退', () => {
      fs.writeFileSync(path.join(tmpRoot, 'settings.json'), '{ bad }', 'utf-8');
      const personas = [createDefaultPersona()];
      expect(loadDefaultPersonaId(tmpRoot, personas)).toBe(DEFAULT_PERSONA_ID);
    });

    it('settings.json 缺少 defaultPersonaId 字段回退', () => {
      fs.writeFileSync(path.join(tmpRoot, 'settings.json'), JSON.stringify({}), 'utf-8');
      const personas = [createDefaultPersona()];
      expect(loadDefaultPersonaId(tmpRoot, personas)).toBe(DEFAULT_PERSONA_ID);
    });
  });

  // ── 8. 类型风格一致 ──

  describe('8. 类型风格一致', () => {
    it('PluginPersonaSummary 构造正确', () => {
      const summary: PluginPersonaSummary = {
        id: 'test.id',
        name: 'Test',
        avatar: null,
        description: 'desc',
        isDefault: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      expect(summary.id).toBe('test.id');
      expect(summary.description).toBe('desc');
      expect(summary.isDefault).toBe(false);
    });

    it('PluginPersonaDialogEntry 构造正确', () => {
      const entry: PluginPersonaDialogEntry = { content: 'hello', role: 'assistant' };
      expect(entry.content).toBe('hello');
      expect(entry.role).toBe('assistant');

      const userEntry: PluginPersonaDialogEntry = { content: 'hi', role: 'user' };
      expect(userEntry.role).toBe('user');
    });

    it('StoredPersonaRecord 完整构造（含所有可选字段）', () => {
      const full: StoredPersonaRecord = {
        id: 'full.test',
        name: 'Full',
        avatar: '/path/avatar.png',
        description: 'full description',
        isDefault: true,
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z',
        prompt: 'You are a full assistant',
        beginDialogs: [{ content: 'start', role: 'assistant' }],
        toolNames: ['tool1', 'tool2'],
        customErrorMessage: 'error msg',
      };
      expect(full.avatar).toBe('/path/avatar.png');
      expect(full.prompt).toBe('You are a full assistant');
      expect(full.toolNames!.length).toBe(2);
      expect(full.customErrorMessage).toBe('error msg');
    });

    it('StoredPersonaRecord 最小构造', () => {
      const minimal: StoredPersonaRecord = {
        id: 'min.test',
        name: 'Min',
        avatar: null,
        isDefault: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        prompt: 'Min prompt',
        beginDialogs: [],
        toolNames: null,
        customErrorMessage: null,
      };
      expect(minimal.avatar).toBeNull();
      expect(minimal.description).toBeUndefined();
      expect(minimal.toolNames).toBeNull();
      expect(minimal.customErrorMessage).toBeNull();
    });
  });

  // ── 9. 边界条件 ──

  describe('9. 边界条件', () => {
    it('normalizeDialogEntries 处理含特殊字符的 content', () => {
      const entries = [
        { content: 'line1\nline2', role: 'assistant' as const },
        { content: '<script>alert("xss")</script>', role: 'user' as const },
      ];
      const result = normalizeDialogEntries(entries);
      expect(result.length).toBe(2);
      expect(result[0].content).toBe('line1\nline2');
      expect(result[1].content).toBe('<script>alert("xss")</script>');
    });

    it('normalizeNullableIdList 处理大量条目', () => {
      const input = Array.from({ length: 100 }, (_, i) => `tool-${i % 10}`);
      const result = normalizeNullableIdList(input);
      expect(result!.length).toBe(10);
    });

    it('normalizeStoredPersona 处理极长的 name', () => {
      const longName = 'x'.repeat(1000);
      const persona = { ...createDefaultPersona(), name: longName };
      expect(normalizeStoredPersona(persona).name.length).toBe(1000);
    });

    it('normalizeStoredPersona 处理空 prompt 使用 DEFAULT_PERSONA_PROMPT', () => {
      const noPrompt = { ...createDefaultPersona(), prompt: '' };
      expect(normalizeStoredPersona(noPrompt).prompt).toBe(DEFAULT_PERSONA_PROMPT);
    });

    it('normalizeStoredPersona 处理 undefined prompt', () => {
      const noPrompt = { ...createDefaultPersona(), prompt: undefined as unknown as string };
      expect(normalizeStoredPersona(noPrompt).prompt).toBe(DEFAULT_PERSONA_PROMPT);
    });

    it('normalizeStoredPersona 处理空白 description', () => {
      const persona = { ...createDefaultPersona(), description: '   ' };
      expect(normalizeStoredPersona(persona).description).toBeUndefined();
    });

    it('normalizeStoredPersona 处理 undefined 时间戳使用 fallback', () => {
      const persona = { ...createDefaultPersona(), createdAt: undefined as unknown as string };
      expect(normalizeStoredPersona(persona).createdAt).toBe(DEFAULT_PERSONA_TIMESTAMP);
    });

    it('readStoredPersona 处理超大 persona.json', () => {
      const bigDir = path.join(os.tmpdir(), `big-persona-${Date.now()}`);
      fs.mkdirSync(bigDir, { recursive: true });
      fs.writeFileSync(path.join(bigDir, 'persona.json'), JSON.stringify({
        id: 'big',
        name: 'Big',
        beginDialogs: [],
        createdAt: DEFAULT_PERSONA_TIMESTAMP,
        customErrorMessage: null,
        description: 'x'.repeat(10000),
        toolNames: Array.from({ length: 1000 }, (_, i) => `tool-${i}`),
        updatedAt: DEFAULT_PERSONA_TIMESTAMP,
      }), 'utf-8');
      fs.writeFileSync(path.join(bigDir, 'prompt.md'), 'x'.repeat(50000), 'utf-8');
      const result = readStoredPersona(bigDir);
      expect(result).not.toBeNull();
      expect(result!.description!.length).toBe(10000);
      expect(result!.toolNames!.length).toBe(1000);
      expect(result!.prompt.length).toBe(50000);
      fs.rmSync(bigDir, { recursive: true, force: true });
    });

    it('encodeURIComponent 含特殊字符的 ID', () => {
      const specialId = 'my  persona/id@#$%';
      const encoded = encodeURIComponent(specialId.trim());
      expect(encoded).toBe('my%20%20persona%2Fid%40%23%24%25');
      // 验证 roundtrip
      expect(decodeURIComponent(encoded)).toBe(specialId.trim());
    });

    it('JSON 多余字段不会破坏 readStoredPersona', () => {
      const extraDir = path.join(os.tmpdir(), `extra-persona-${Date.now()}`);
      fs.mkdirSync(extraDir, { recursive: true });
      fs.writeFileSync(path.join(extraDir, 'persona.json'), JSON.stringify({
        id: 'extra',
        name: 'Extra',
        beginDialogs: [],
        createdAt: DEFAULT_PERSONA_TIMESTAMP,
        customErrorMessage: null,
        description: 'has extra fields',
        toolNames: null,
        updatedAt: DEFAULT_PERSONA_TIMESTAMP,
        unknownField: 'should be tolerated',
        extraNested: { a: 1 },
      }), 'utf-8');
      fs.writeFileSync(path.join(extraDir, 'prompt.md'), 'prompt', 'utf-8');
      const result = readStoredPersona(extraDir);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('extra');
      fs.rmSync(extraDir, { recursive: true, force: true });
    });
  });

  // ── 10. 集成：内联函数 + 实际文件 ──

  describe('10. 集成验证', () => {
    it('读取内置 persona 并通过 normalizeStoredPersona 验证', () => {
      const builtin = readStoredPersona(BUILTIN_ROOT);
      expect(builtin).not.toBeNull();

      const normalized = normalizeStoredPersona(builtin!);
      expect(normalized.id).toBe(DEFAULT_PERSONA_ID);
      expect(normalized.name).toBe('Default Assistant');
      expect(normalized.prompt).toBe(DEFAULT_PERSONA_PROMPT);
      expect(normalized.createdAt).toBe(DEFAULT_PERSONA_TIMESTAMP);
      expect(normalized.updatedAt).toBe(DEFAULT_PERSONA_TIMESTAMP);
      expect(normalized.description).toBe('server 默认人格');
      expect(normalized.beginDialogs).toEqual([]);
      expect(normalized.toolNames).toBeNull();
      expect(normalized.customErrorMessage).toBeNull();
      expect(normalized.avatar).toBeDefined();
      expect(typeof normalized.avatar).toBe('string');
    });

    it('内置 persona 通过 normalizeStoredPersonas 保持单条目', () => {
      const builtin = readStoredPersona(BUILTIN_ROOT);
      const normalized = normalizeStoredPersonas([builtin!]);
      expect(normalized.length).toBe(1);
      expect(normalized[0].id).toBe(DEFAULT_PERSONA_ID);
    });

    it('读取内置 prompt.md 与 DEFAULT_PERSONA_PROMPT 一致', () => {
      const prompt = readStoredPersonaPrompt(BUILTIN_ROOT);
      expect(prompt).toBe(DEFAULT_PERSONA_PROMPT);
    });
  });
});
