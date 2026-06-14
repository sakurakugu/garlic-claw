import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── 类型定义（对齐 @garlic-claw/shared） ───

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

interface PluginPersonaCurrentInfo extends PluginPersonaDetail {
  personaId: string;
  source: 'context' | 'conversation' | 'default';
}

interface PluginPersonaUpsertInput {
  id: string;
  name: string;
  prompt: string;
  description?: string;
  beginDialogs?: PluginPersonaDialogEntry[];
  toolNames?: string[] | null;
  customErrorMessage?: string | null;
  isDefault?: boolean;
}

interface PluginPersonaUpdateInput {
  name?: string;
  prompt?: string;
  description?: string;
  beginDialogs?: PluginPersonaDialogEntry[];
  toolNames?: string[] | null;
  customErrorMessage?: string | null;
  isDefault?: boolean;
}

interface PluginPersonaDeleteResult {
  deletedPersonaId: string;
  fallbackPersonaId: string;
  reassignedConversationCount: number;
}

interface StoredPersonaRecord extends PluginPersonaDetail {
  isDefault: boolean;
}

type PersonaSource = 'context' | 'conversation' | 'default';

// ─── 常量 ───

const DEFAULT_PERSONA_ID = 'builtin.default-assistant';
const DEFAULT_PERSONA_TIMESTAMP = '2026-04-10T00:00:00.000Z';
const AVATAR_BASENAME = 'avatar';
const AVATAR_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif', '.ico', '.tif', '.tiff']);

const DEFAULT_PERSONA_PROMPT = `你是一个乐于助人的 AI 助手，名为 Garlic Claw（蒜蓉龙虾）。你可以帮助用户完成各种任务。
你可以使用工具来获取信息和执行操作。
一些工具让你可以控制连接的设备（PC、手机、IoT）。设备工具以设备名称为前缀，如果它们存在的话。
你可以使用 save_memory 将重要信息保存到长期记忆中，使用 search_memory 回忆过去的信息，使用 create_automation 创建自动化任务。
当用户分享个人偏好或重要事实时，主动将它们保存到记忆中。
始终保持乐于助人、简洁和友好的态度。使用用户使用的语言回复。`

// ─── 内联纯函数（对齐 persona.service.ts） ───

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeNullableText(value: string | null | undefined): string | null {
  return normalizeOptionalText(value) ?? null;
}

function normalizeRequiredText(value: unknown, errorMessage: string): string {
  const normalized = normalizeOptionalText(value);
  if (normalized) return normalized;
  throw new Error(errorMessage);
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

function toPersonaSummary(persona: StoredPersonaRecord): PluginPersonaSummary {
  return {
    avatar: persona.avatar ? `/api/personas/${encodeURIComponent(persona.id)}/avatar` : null,
    createdAt: persona.createdAt,
    description: persona.description,
    id: persona.id,
    isDefault: persona.isDefault,
    name: persona.name,
    updatedAt: persona.updatedAt,
  };
}

function toPersonaDetail(persona: StoredPersonaRecord): PluginPersonaDetail {
  return {
    ...toPersonaSummary(persona),
    beginDialogs: persona.beginDialogs.map((entry) => ({ ...entry })),
    customErrorMessage: persona.customErrorMessage,
    prompt: persona.prompt,
    toolNames: persona.toolNames ? [...persona.toolNames] : null,
  };
}

function toCurrentPersona(input: { persona: StoredPersonaRecord; source: PersonaSource }): PluginPersonaCurrentInfo {
  return { ...toPersonaDetail(input.persona), personaId: input.persona.id, source: input.source };
}

function createStoredPersona(input: PluginPersonaUpsertInput, personaId: string): StoredPersonaRecord {
  const timestamp = new Date().toISOString();
  return {
    avatar: null,
    beginDialogs: normalizeDialogEntries(input.beginDialogs),
    createdAt: timestamp,
    customErrorMessage: normalizeNullableText(input.customErrorMessage),
    description: normalizeOptionalText(input.description),
    id: personaId,
    isDefault: input.isDefault === true,
    name: normalizeRequiredText(input.name, '名称不能为空'),
    prompt: normalizeRequiredText(input.prompt, '提示词不能为空'),
    toolNames: normalizeNullableIdList(input.toolNames),
    updatedAt: timestamp,
  };
}

function updateStoredPersona(current: StoredPersonaRecord, patch: PluginPersonaUpdateInput): StoredPersonaRecord {
  return {
    ...current,
    ...(patch.beginDialogs !== undefined ? { beginDialogs: normalizeDialogEntries(patch.beginDialogs) } : {}),
    ...(patch.customErrorMessage !== undefined ? { customErrorMessage: normalizeNullableText(patch.customErrorMessage) } : {}),
    ...(patch.description !== undefined ? { description: normalizeOptionalText(patch.description) } : {}),
    ...(patch.isDefault !== undefined ? { isDefault: patch.isDefault } : {}),
    ...(patch.name !== undefined ? { name: normalizeRequiredText(patch.name, '名称不能为空') } : {}),
    ...(patch.prompt !== undefined ? { prompt: normalizeRequiredText(patch.prompt, '提示词不能为空') } : {}),
    ...(patch.toolNames !== undefined ? { toolNames: normalizeNullableIdList(patch.toolNames) } : {}),
    updatedAt: new Date().toISOString(),
  };
}

function mimetypeToExtension(mimetype: string): string {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/bmp': '.bmp',
    'image/svg+xml': '.svg',
    'image/avif': '.avif',
    'image/tiff': '.tiff',
  };
  return map[mimetype] ?? '.png';
}

function readPersonaFolderName(personaId: string): string {
  return encodeURIComponent(personaId.trim());
}

function resolvePersonaForContext(
  storedPersonas: StoredPersonaRecord[],
  contextPersonaId?: string,
  conversationPersonaId?: string,
): { persona: StoredPersonaRecord; source: PersonaSource } {
  const contextPersona = contextPersonaId ? storedPersonas.find((p) => p.id === contextPersonaId) ?? null : null;
  if (contextPersona) {
    return { persona: contextPersona, source: contextPersona.id === DEFAULT_PERSONA_ID ? 'default' : 'context' };
  }
  const conversationPersona = conversationPersonaId ? storedPersonas.find((p) => p.id === conversationPersonaId) ?? null : null;
  if (conversationPersona) {
    return { persona: conversationPersona, source: conversationPersona.id === DEFAULT_PERSONA_ID ? 'default' : 'conversation' };
  }
  const defaultPersona = storedPersonas.find((p) => p.isDefault) ?? storedPersonas.find((p) => p.id === DEFAULT_PERSONA_ID);
  if (!defaultPersona) throw new Error('未找到默认人设');
  return { persona: defaultPersona, source: 'default' };
}

function persistPersonas(
  storedPersonas: StoredPersonaRecord[],
  personas: StoredPersonaRecord[],
  preferredDefaultPersonaId?: string,
): { sorted: StoredPersonaRecord[]; defaultId: string } {
  const defaultPersonaId = preferredDefaultPersonaId
    ?? personas.find((persona) => persona.isDefault)?.id
    ?? (personas.some((persona) => persona.id === DEFAULT_PERSONA_ID) ? DEFAULT_PERSONA_ID : personas[0]?.id);
  if (!defaultPersonaId) throw new Error('No default persona available');
  return {
    sorted: personas.sort((left, right) => left.id.localeCompare(right.id)),
    defaultId: defaultPersonaId,
  };
}

function requireDefaultPersona(personas: StoredPersonaRecord[]): StoredPersonaRecord {
  const persona = personas.find((entry) => entry.isDefault) ?? personas.find((entry) => entry.id === DEFAULT_PERSONA_ID);
  if (persona) return persona;
  throw new Error('未找到默认人设');
}

function requirePersonaById(personas: StoredPersonaRecord[], personaId: string): StoredPersonaRecord {
  const persona = personas.find((p) => p.id === personaId);
  if (persona) return persona;
  throw new Error(`未找到人设: ${personaId}`);
}

// ─── 文件系统辅助（对齐 persona-store.service.ts） ───

function readPersonaAvatarFilePath(personaRoot: string): string | null {
  if (!fs.existsSync(personaRoot)) return null;
  const match = fs.readdirSync(personaRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .find((entry) => {
      const extension = path.extname(entry.name).toLowerCase();
      return path.basename(entry.name, extension).toLowerCase() === AVATAR_BASENAME && AVATAR_IMAGE_EXTENSIONS.has(extension);
    });
  return match ? path.join(personaRoot, match.name) : null;
}

function readStoredPersona(personaRoot: string): StoredPersonaRecord | null {
  const configPath = path.join(personaRoot, 'persona.json');
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
    const promptPath = path.join(personaRoot, 'prompt.md');
    const prompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf-8') : undefined;
    return {
      avatar: readPersonaAvatarFilePath(personaRoot),
      beginDialogs: (config.beginDialogs ?? []) as PluginPersonaDialogEntry[],
      createdAt: config.createdAt as string,
      customErrorMessage: config.customErrorMessage as string | null,
      description: config.description as string,
      id: (config.id as string) ?? path.basename(personaRoot),
      isDefault: false,
      name: config.name as string,
      prompt: prompt ?? '',
      toolNames: config.toolNames as string[] | null,
      updatedAt: config.updatedAt as string,
    } as StoredPersonaRecord;
  } catch {
    return null;
  }
}

function writeStoredPersona(storageRoot: string, persona: StoredPersonaRecord): void {
  const personaRoot = path.join(storageRoot, readPersonaFolderName(persona.id));
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

// ========================================================================
// 测试
// ========================================================================

describe('server 模块 — persona/', () => {

  // ── 1. DEFAULT_PERSONA_PROMPT 内容 ──
  describe('1. DEFAULT_PERSONA_PROMPT 内容', () => {
    it('包含 Garlic Claw 标识', () => {
      expect(DEFAULT_PERSONA_PROMPT).toContain('Garlic Claw');
    });

    it('包含 蒜蓉龙虾 标识', () => {
      expect(DEFAULT_PERSONA_PROMPT).toContain('蒜蓉龙虾');
    });

    it('提及工具能力', () => {
      expect(DEFAULT_PERSONA_PROMPT).toContain('工具');
    });

    it('提及记忆能力', () => {
      expect(DEFAULT_PERSONA_PROMPT).toContain('save_memory');
      expect(DEFAULT_PERSONA_PROMPT).toContain('search_memory');
    });

    it('提及自动化能力', () => {
      expect(DEFAULT_PERSONA_PROMPT).toContain('create_automation');
    });

    it('提示使用用户语言回复', () => {
      expect(DEFAULT_PERSONA_PROMPT).toContain('使用用户使用的语言回复');
    });

    it('非空', () => {
      expect(DEFAULT_PERSONA_PROMPT.length).toBeGreaterThan(0);
    });

    it('结尾无多余空白', () => {
      expect(DEFAULT_PERSONA_PROMPT.endsWith('\n')).toBe(false);
    });
  });

  // ── 2. toPersonaSummary / toPersonaDetail ──
  describe('2. toPersonaSummary / toPersonaDetail', () => {
    const defaultPersona = createDefaultPersona();

    it('toPersonaSummary 返回正确结构', () => {
      const summary = toPersonaSummary(defaultPersona);
      expect(summary).toEqual({
        avatar: null,
        createdAt: DEFAULT_PERSONA_TIMESTAMP,
        description: 'server 默认人格',
        id: DEFAULT_PERSONA_ID,
        isDefault: false,
        name: 'Default Assistant',
        updatedAt: DEFAULT_PERSONA_TIMESTAMP,
      });
    });

    it('toPersonaSummary 含 avatar 时生成 URL', () => {
      const withAvatar: StoredPersonaRecord = {
        ...defaultPersona,
        avatar: '/some/path/avatar.webp',
      };
      const summary = toPersonaSummary(withAvatar);
      expect(summary.avatar).toBe(`/api/personas/${encodeURIComponent(DEFAULT_PERSONA_ID)}/avatar`);
    });

    it('toPersonaSummary avatar 为 null 时返回 null', () => {
      const summary = toPersonaSummary(defaultPersona);
      expect(summary.avatar).toBeNull();
    });

    it('toPersonaDetail 包含所有字段', () => {
      const detail = toPersonaDetail(defaultPersona);
      expect(detail).toHaveProperty('id');
      expect(detail).toHaveProperty('name');
      expect(detail).toHaveProperty('avatar');
      expect(detail).toHaveProperty('description');
      expect(detail).toHaveProperty('isDefault');
      expect(detail).toHaveProperty('createdAt');
      expect(detail).toHaveProperty('updatedAt');
      expect(detail).toHaveProperty('prompt');
      expect(detail).toHaveProperty('beginDialogs');
      expect(detail).toHaveProperty('toolNames');
      expect(detail).toHaveProperty('customErrorMessage');
    });

    it('toPersonaDetail 返回 beginDialogs 的副本', () => {
      const withDialogs: StoredPersonaRecord = {
        ...defaultPersona,
        beginDialogs: [{ content: 'hello', role: 'assistant' }],
      };
      const detail = toPersonaDetail(withDialogs);
      expect(detail.beginDialogs).toEqual([{ content: 'hello', role: 'assistant' }]);
      expect(detail.beginDialogs).not.toBe(withDialogs.beginDialogs);
    });

    it('toPersonaDetail 返回 toolNames 的副本', () => {
      const withTools: StoredPersonaRecord = {
        ...defaultPersona,
        toolNames: ['tool-a', 'tool-b'],
      };
      const detail = toPersonaDetail(withTools);
      expect(detail.toolNames).toEqual(['tool-a', 'tool-b']);
      expect(detail.toolNames).not.toBe(withTools.toolNames);
    });

    it('toPersonaDetail toolNames 为 null 时返回 null', () => {
      const detail = toPersonaDetail(defaultPersona);
      expect(detail.toolNames).toBeNull();
    });
  });

  // ── 3. toCurrentPersona ──
  describe('3. toCurrentPersona', () => {
    const defaultPersona = createDefaultPersona();

    it('返回包含 personaId 和 source', () => {
      const result = toCurrentPersona({ persona: defaultPersona, source: 'default' });
      expect(result.personaId).toBe(DEFAULT_PERSONA_ID);
      expect(result.source).toBe('default');
    });

    it('source 为 context 时正确传递', () => {
      const result = toCurrentPersona({ persona: defaultPersona, source: 'context' });
      expect(result.source).toBe('context');
    });

    it('source 为 conversation 时正确传递', () => {
      const result = toCurrentPersona({ persona: defaultPersona, source: 'conversation' });
      expect(result.source).toBe('conversation');
    });

    it('包含 detail 所有字段', () => {
      const result = toCurrentPersona({ persona: defaultPersona, source: 'default' });
      expect(result.prompt).toBe(DEFAULT_PERSONA_PROMPT);
      expect(result.name).toBe('Default Assistant');
    });
  });

  // ── 4. createStoredPersona ──
  describe('4. createStoredPersona', () => {
    const validInput: PluginPersonaUpsertInput = {
      id: 'persona.test',
      name: 'Test Persona',
      prompt: '你是一个测试助手',
    };

    it('创建包含时间戳的记录', () => {
      const before = Date.now();
      const result = createStoredPersona(validInput, 'persona.test');
      const after = Date.now();
      expect(result.id).toBe('persona.test');
      expect(result.name).toBe('Test Persona');
      expect(result.prompt).toBe('你是一个测试助手');
      expect(result.avatar).toBeNull();
      expect(result.isDefault).toBe(false);
      const createdAt = new Date(result.createdAt).getTime();
      expect(createdAt).toBeGreaterThanOrEqual(before);
      expect(createdAt).toBeLessThanOrEqual(after);
    });

    it('isDefault 为 true 时设置标志', () => {
      const result = createStoredPersona({ ...validInput, isDefault: true }, 'persona.test');
      expect(result.isDefault).toBe(true);
    });

    it('处理 beginDialogs', () => {
      const result = createStoredPersona({
        ...validInput,
        beginDialogs: [{ content: '你好', role: 'assistant' }],
      }, 'persona.test');
      expect(result.beginDialogs).toEqual([{ content: '你好', role: 'assistant' }]);
    });

    it('非法 beginDialogs 被过滤', () => {
      const result = createStoredPersona({
        ...validInput,
        beginDialogs: [{ content: '', role: 'assistant' }],
      }, 'persona.test');
      expect(result.beginDialogs).toEqual([]);
    });

    it('处理 toolNames', () => {
      const result = createStoredPersona({
        ...validInput,
        toolNames: ['tool-a', 'tool-b'],
      }, 'persona.test');
      expect(result.toolNames).toEqual(['tool-a', 'tool-b']);
    });

    it('去重 toolNames', () => {
      const result = createStoredPersona({
        ...validInput,
        toolNames: ['tool-a', 'tool-b', 'tool-a'],
      }, 'persona.test');
      expect(result.toolNames).toEqual(['tool-a', 'tool-b']);
    });

    it('处理 customErrorMessage', () => {
      const result = createStoredPersona({
        ...validInput,
        customErrorMessage: '当前人格不可用',
      }, 'persona.test');
      expect(result.customErrorMessage).toBe('当前人格不可用');
    });

    it('处理 description', () => {
      const result = createStoredPersona({
        ...validInput,
        description: '测试描述',
      }, 'persona.test');
      expect(result.description).toBe('测试描述');
    });

    it('name 为空时抛出异常', () => {
      expect(() => createStoredPersona({ ...validInput, name: '' }, 'persona.test')).toThrow('名称不能为空');
    });

    it('prompt 为空时抛出异常', () => {
      expect(() => createStoredPersona({ ...validInput, prompt: '' }, 'persona.test')).toThrow('提示词不能为空');
    });
  });

  // ── 5. updateStoredPersona ──
  describe('5. updateStoredPersona', () => {
    const defaultPersona = createDefaultPersona();
    const patch: PluginPersonaUpdateInput = {
      name: 'Updated Name',
      prompt: '更新的提示词',
      description: '更新的描述',
      beginDialogs: [{ content: '更新对话', role: 'assistant' }],
      customErrorMessage: '更新错误消息',
      isDefault: true,
      toolNames: ['tool-x'],
    };

    it('更新所有字段', () => {
      const result = updateStoredPersona(defaultPersona, patch);
      expect(result.name).toBe('Updated Name');
      expect(result.prompt).toBe('更新的提示词');
      expect(result.description).toBe('更新的描述');
      expect(result.isDefault).toBe(true);
      expect(result.beginDialogs).toEqual([{ content: '更新对话', role: 'assistant' }]);
      expect(result.customErrorMessage).toBe('更新错误消息');
      expect(result.toolNames).toEqual(['tool-x']);
    });

    it('部分更新只更新指定字段', () => {
      const result = updateStoredPersona(defaultPersona, { name: 'Only Name' });
      expect(result.name).toBe('Only Name');
      expect(result.prompt).toBe(DEFAULT_PERSONA_PROMPT);
      expect(result.description).toBe('server 默认人格');
      expect(result.isDefault).toBe(false);
    });

    it('不修改未提供的字段', () => {
      const result = updateStoredPersona(defaultPersona, {});
      expect(result.name).toBe('Default Assistant');
      expect(result.prompt).toBe(DEFAULT_PERSONA_PROMPT);
    });

    it('更新 updatedAt 时间戳', () => {
      const before = Date.now();
      const result = updateStoredPersona(defaultPersona, { name: 'New Name' });
      const after = Date.now();
      const updatedAt = new Date(result.updatedAt).getTime();
      expect(updatedAt).toBeGreaterThanOrEqual(before);
      expect(updatedAt).toBeLessThanOrEqual(after);
    });

    it('设置 toolNames 为空数组', () => {
      const result = updateStoredPersona(defaultPersona, { toolNames: [] });
      expect(result.toolNames).toEqual([]);
    });

    it('设置 toolNames 为 null', () => {
      const result = updateStoredPersona(defaultPersona, { toolNames: null });
      expect(result.toolNames).toBeNull();
    });

    it('设置 customErrorMessage 为 null', () => {
      const withError: StoredPersonaRecord = { ...defaultPersona, customErrorMessage: '旧错误' };
      const result = updateStoredPersona(withError, { customErrorMessage: null });
      expect(result.customErrorMessage).toBeNull();
    });

    it('覆盖 beginDialogs', () => {
      const oldDialogs: StoredPersonaRecord = {
        ...defaultPersona,
        beginDialogs: [{ content: '旧', role: 'assistant' }],
      };
      const result = updateStoredPersona(oldDialogs, {
        beginDialogs: [{ content: '新', role: 'user' }],
      });
      expect(result.beginDialogs).toEqual([{ content: '新', role: 'user' }]);
    });

    it('空 name 抛出异常', () => {
      expect(() => updateStoredPersona(defaultPersona, { name: '' })).toThrow('名称不能为空');
    });

    it('空 prompt 抛出异常', () => {
      expect(() => updateStoredPersona(defaultPersona, { prompt: '' })).toThrow('提示词不能为空');
    });
  });

  // ── 6. resolvePersonaForContext ──
  describe('6. resolvePersonaForContext', () => {
    const defaultPersona = createDefaultPersona();
    const customPersona: StoredPersonaRecord = {
      ...createDefaultPersona(),
      id: 'custom.analyst',
      name: 'Analyst',
      isDefault: false,
    };
    const personas = [defaultPersona, customPersona];

    it('无上下文时返回默认 persona', () => {
      const result = resolvePersonaForContext(personas);
      expect(result.persona.id).toBe(DEFAULT_PERSONA_ID);
      expect(result.source).toBe('default');
    });

    it('contextPersonaId 存在时优先', () => {
      const result = resolvePersonaForContext(personas, 'custom.analyst');
      expect(result.persona.id).toBe('custom.analyst');
      expect(result.source).toBe('context');
    });

    it('默认 persona 作为 context 时 source 为 default', () => {
      const result = resolvePersonaForContext(personas, DEFAULT_PERSONA_ID);
      expect(result.persona.id).toBe(DEFAULT_PERSONA_ID);
      expect(result.source).toBe('default');
    });

    it('回退到 conversationPersonaId', () => {
      const result = resolvePersonaForContext(personas, undefined, 'custom.analyst');
      expect(result.persona.id).toBe('custom.analyst');
      expect(result.source).toBe('conversation');
    });

    it('conversationPersonaId 指向默认时 source 为 default', () => {
      const result = resolvePersonaForContext(personas, undefined, DEFAULT_PERSONA_ID);
      expect(result.source).toBe('default');
    });

    it('context 不存在时忽略', () => {
      const result = resolvePersonaForContext(personas, 'nonexistent.id');
      expect(result.persona.id).toBe(DEFAULT_PERSONA_ID);
    });

    it('conversation 不存在时忽略', () => {
      const result = resolvePersonaForContext(personas, undefined, 'nonexistent.id');
      expect(result.persona.id).toBe(DEFAULT_PERSONA_ID);
    });

    it('context 优先于 conversation', () => {
      const result = resolvePersonaForContext(personas, 'custom.analyst', DEFAULT_PERSONA_ID);
      expect(result.persona.id).toBe('custom.analyst');
      expect(result.source).toBe('context');
    });

    it('无 persona 时抛出异常', () => {
      expect(() => resolvePersonaForContext([])).toThrow('未找到默认人设');
    });
  });

  // ── 7. persistPersonas / requirePersonaById / requireDefaultPersona ──
  describe('7. 业务逻辑辅助函数', () => {
    const defaultPersona = createDefaultPersona();
    const customPersona: StoredPersonaRecord = {
      ...createDefaultPersona(),
      id: 'custom.test',
      name: 'Custom',
      isDefault: false,
    };

    describe('persistPersonas', () => {
      it('按 ID 排序', () => {
        const result = persistPersonas([defaultPersona, customPersona], [customPersona, defaultPersona]);
        expect(result.sorted[0].id).toBe(DEFAULT_PERSONA_ID);
        expect(result.sorted[1].id).toBe('custom.test');
      });

      it('preferredDefaultPersonaId 优先', () => {
        const result = persistPersonas([defaultPersona, customPersona], [defaultPersona, customPersona], 'custom.test');
        expect(result.defaultId).toBe('custom.test');
      });

      it('isDefault 标志作为默认选择', () => {
        const flaggedDefault: StoredPersonaRecord = { ...customPersona, isDefault: true };
        const result = persistPersonas([defaultPersona, customPersona], [defaultPersona, flaggedDefault]);
        expect(result.defaultId).toBe('custom.test');
      });

      it('回退到 DEFAULT_PERSONA_ID', () => {
        const noFlag: StoredPersonaRecord = { ...customPersona, isDefault: false };
        const result = persistPersonas([defaultPersona, customPersona], [defaultPersona, noFlag]);
        expect(result.defaultId).toBe(DEFAULT_PERSONA_ID);
      });

      it('DEFAULT_PERSONA_ID 不在时用第一个', () => {
        const a: StoredPersonaRecord = { ...customPersona, id: 'a.first' };
        const b: StoredPersonaRecord = { ...customPersona, id: 'b.second' };
        const result = persistPersonas([a, b], [a, b]);
        expect(result.defaultId).toBe('a.first');
      });
    });

    describe('requireDefaultPersona', () => {
      it('找到 isDefault 的 persona', () => {
        const flagged: StoredPersonaRecord = { ...customPersona, isDefault: true };
        const result = requireDefaultPersona([defaultPersona, flagged]);
        expect(result.isDefault).toBe(true);
      });

      it('找不到时抛出异常', () => {
        expect(() => requireDefaultPersona([])).toThrow('未找到默认人设');
      });
    });

    describe('requirePersonaById', () => {
      it('找到存在的 persona', () => {
        const result = requirePersonaById([defaultPersona], DEFAULT_PERSONA_ID);
        expect(result.id).toBe(DEFAULT_PERSONA_ID);
      });

      it('找不到时抛出异常', () => {
        expect(() => requirePersonaById([defaultPersona], 'nonexistent')).toThrow('未找到人设: nonexistent');
      });
    });
  });

  // ── 8. mimetypeToExtension ──
  describe('8. mimetypeToExtension', () => {
    const cases: Array<[string, string]> = [
      ['image/png', '.png'],
      ['image/jpeg', '.jpg'],
      ['image/webp', '.webp'],
      ['image/gif', '.gif'],
      ['image/bmp', '.bmp'],
      ['image/svg+xml', '.svg'],
      ['image/avif', '.avif'],
      ['image/tiff', '.tiff'],
    ];

    it.each(cases)('mimetype %s → %s', (mimetype, expected) => {
      expect(mimetypeToExtension(mimetype)).toBe(expected);
    });

    it('未知 mimetype 回退到 .png', () => {
      expect(mimetypeToExtension('image/unknown')).toBe('.png');
    });

    it('空字符串回退到 .png', () => {
      expect(mimetypeToExtension('')).toBe('.png');
    });
  });

  // ── 9. DTO 结构验证 ──
  describe('9. DTO 结构验证', () => {
    it('CreatePersonaDto 应有所有必要字段', () => {
      const dtoSource = fs.readFileSync(
        path.resolve(__dirname, '..', 'packages', 'server', 'src', 'modules', 'persona', 'dto', 'create-persona.dto.ts'),
        'utf-8',
      );
      expect(dtoSource).toContain('@IsString()');
      expect(dtoSource).toContain('id!: string');
      expect(dtoSource).toContain('name!: string');
      expect(dtoSource).toContain('prompt!: string');
      expect(dtoSource).toContain('@IsOptional()');
      expect(dtoSource).toContain('description?: string');
      expect(dtoSource).toContain('@IsBoolean()');
      expect(dtoSource).toContain('isDefault?: boolean');
    });

    it('UpdatePersonaDto 所有字段可选', () => {
      const dtoSource = fs.readFileSync(
        path.resolve(__dirname, '..', 'packages', 'server', 'src', 'modules', 'persona', 'dto', 'update-persona.dto.ts'),
        'utf-8',
      );
      const optionalCount = (dtoSource.match(/@IsOptional\(\)/g) ?? []).length;
      expect(optionalCount).toBe(7);
      expect(dtoSource).toContain('name?: string');
      expect(dtoSource).toContain('prompt?: string');
    });

    it('PersonaDialogEntryDto 验证 role 枚举', () => {
      const dtoSource = fs.readFileSync(
        path.resolve(__dirname, '..', 'packages', 'server', 'src', 'modules', 'persona', 'dto', 'persona-dialog-entry.dto.ts'),
        'utf-8',
      );
      expect(dtoSource).toContain("@IsIn(['assistant', 'user'])");
      expect(dtoSource).toContain("role!: 'assistant' | 'user'");
    });

    it('ActivateConversationPersonaDto 包含 conversationId 和 personaId', () => {
      const dtoSource = fs.readFileSync(
        path.resolve(__dirname, '..', 'packages', 'server', 'src', 'modules', 'persona', 'dto', 'activate-conversation-persona.dto.ts'),
        'utf-8',
      );
      expect(dtoSource).toContain('conversationId!: string');
      expect(dtoSource).toContain('personaId!: string');
    });
  });

  // ── 10. Controller 路由结构 ──
  describe('10. Controller 路由结构', () => {
    const controllerSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'packages', 'server', 'src', 'modules', 'persona', 'persona.controller.ts'),
      'utf-8',
    );

    it('控制器路径为 personas', () => {
      expect(controllerSource).toContain("@Controller('personas')");
    });

    it('包含 GET / 列表路由', () => {
      expect(controllerSource).toMatch(/@Get\(\s*\)/);
      expect(controllerSource).toContain('listPersonas()');
    });

    it('包含 GET /current 当前人设路由', () => {
      expect(controllerSource).toContain("@Get('current')");
      expect(controllerSource).toContain('getCurrentPersona');
    });

    it('包含 PUT /current 激活人设路由', () => {
      expect(controllerSource).toContain("@Put('current')");
      expect(controllerSource).toContain('activateCurrentPersona');
    });

    it('包含 POST / 创建路由', () => {
      expect(controllerSource).toContain('@Post()');
      expect(controllerSource).toContain('createPersona');
    });

    it('包含 PUT /:personaId 更新路由', () => {
      expect(controllerSource).toContain("@Put(':personaId')");
      expect(controllerSource).toContain('updatePersona');
    });

    it('包含 DELETE /:personaId 删除路由', () => {
      expect(controllerSource).toContain("@Delete(':personaId')");
      expect(controllerSource).toContain('deletePersona');
    });

    it('包含 GET /:personaId 读取路由', () => {
      expect(controllerSource).toContain("@Get(':personaId')");
      expect(controllerSource).toContain('getPersona');
    });

    it('包含 POST /:personaId/avatar 上传头像路由', () => {
      expect(controllerSource).toContain("@Post(':personaId/avatar')");
      expect(controllerSource).toContain('uploadPersonaAvatar');
    });

    it('包含 GET /:personaId/avatar 获取头像路由', () => {
      expect(controllerSource).toContain("@Get(':personaId/avatar')");
      expect(controllerSource).toContain('getPersonaAvatar');
    });

    it('createPersona 有 JwtAuthGuard', () => {
      const lines = controllerSource.split('\n');
      const createLineIdx = lines.findIndex((l) => l.includes('async createPersona'));
      const beforeCreate = lines.slice(Math.max(0, createLineIdx - 5), createLineIdx).join('\n');
      expect(beforeCreate).toContain('JwtAuthGuard');
    });

    it('uploadPersonaAvatar 有 FileInterceptor', () => {
      expect(controllerSource).toContain('FileInterceptor');
      expect(controllerSource).toContain('5 * 1024 * 1024');
    });
  });

  // ── 11. 文件系统 avatar 读写 ──
  describe('11. 文件系统 avatar 读写', () => {
    const tmpRoot = path.join(os.tmpdir(), `persona-avatar-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    afterAll(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('写入 avatar 并读取路径', () => {
      const personaRoot = path.join(tmpRoot, readPersonaFolderName('persona.test'));
      fs.mkdirSync(personaRoot, { recursive: true });
      const avatarContent = Buffer.from('fake-image-data');
      fs.writeFileSync(path.join(personaRoot, 'avatar.webp'), avatarContent);

      const avatarPath = readPersonaAvatarFilePath(personaRoot);
      expect(avatarPath).not.toBeNull();
      expect(path.basename(avatarPath!)).toBe('avatar.webp');
      expect(fs.readFileSync(avatarPath!)).toEqual(avatarContent);
    });

    it('avatar 格式变化时正确识别', () => {
      const personaRoot = path.join(tmpRoot, readPersonaFolderName('persona.png'));
      fs.mkdirSync(personaRoot, { recursive: true });
      fs.writeFileSync(path.join(personaRoot, 'avatar.png'), 'png-data');

      const avatarPath = readPersonaAvatarFilePath(personaRoot);
      expect(avatarPath).not.toBeNull();
      expect(path.extname(avatarPath!)).toBe('.png');
    });

    it('不存在的目录返回 null', () => {
      const result = readPersonaAvatarFilePath(path.join(tmpRoot, 'nonexistent'));
      expect(result).toBeNull();
    });

    it('无 avatar 文件时返回 null', () => {
      const emptyDir = path.join(tmpRoot, 'empty');
      fs.mkdirSync(emptyDir, { recursive: true });
      fs.writeFileSync(path.join(emptyDir, 'readme.txt'), 'hello');
      const result = readPersonaAvatarFilePath(emptyDir);
      expect(result).toBeNull();
    });

    it('avatar 替换旧头像', () => {
      const personaRoot = path.join(tmpRoot, readPersonaFolderName('persona.replace'));
      fs.mkdirSync(personaRoot, { recursive: true });
      fs.writeFileSync(path.join(personaRoot, 'avatar.png'), 'old-avatar');
      const oldAvatar = readPersonaAvatarFilePath(personaRoot);
      expect(oldAvatar).not.toBeNull();

      // 模拟替换：删除旧文件，写新文件
      fs.unlinkSync(oldAvatar!);
      fs.writeFileSync(path.join(personaRoot, 'avatar.webp'), 'new-avatar');
      const newAvatar = readPersonaAvatarFilePath(personaRoot);
      expect(newAvatar).not.toBeNull();
      expect(path.extname(newAvatar!)).toBe('.webp');
    });

    it('mimetypeToExtension 与 avatar 写入一致', () => {
      const testCases: Array<[string, string]> = [
        ['image/png', '.png'],
        ['image/jpeg', '.jpg'],
        ['image/webp', '.webp'],
        ['image/gif', '.gif'],
      ];
      for (const [mimetype, ext] of testCases) {
        const personaRoot = path.join(tmpRoot, `mime-test-${ext.replace('.', '')}`);
        fs.mkdirSync(personaRoot, { recursive: true });
        const expectedExt = mimetypeToExtension(mimetype);
        expect(expectedExt).toBe(ext);
      }
    });
  });

  // ── 12. 文件系统 persona 读写 ──
  describe('12. 文件系统 persona 读写', () => {
    const tmpRoot = path.join(os.tmpdir(), `persona-fs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    afterAll(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('写入并读取完整 persona', () => {
      const persona = createDefaultPersona();
      writeStoredPersona(tmpRoot, persona);

      const personaRoot = path.join(tmpRoot, readPersonaFolderName(persona.id));
      expect(fs.existsSync(personaRoot)).toBe(true);
      expect(fs.existsSync(path.join(personaRoot, 'persona.json'))).toBe(true);
      expect(fs.existsSync(path.join(personaRoot, 'prompt.md'))).toBe(true);

      const loaded = readStoredPersona(personaRoot);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(DEFAULT_PERSONA_ID);
      expect(loaded!.name).toBe('Default Assistant');
      expect(loaded!.prompt).toBe(DEFAULT_PERSONA_PROMPT);
    });

    it('persona.json 不含 avatar/prompt/isDefault', () => {
      const persona = createDefaultPersona();
      writeStoredPersona(tmpRoot, persona);

      const configPath = path.join(tmpRoot, readPersonaFolderName(persona.id), 'persona.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      expect(config).not.toHaveProperty('avatar');
      expect(config).not.toHaveProperty('prompt');
      expect(config).not.toHaveProperty('isDefault');
    });

    it('prompt.md 结尾无多余空白', () => {
      const persona: StoredPersonaRecord = {
        ...createDefaultPersona(),
        prompt: '测试提示\n',
      };
      writeStoredPersona(tmpRoot, persona);

      const promptPath = path.join(tmpRoot, readPersonaFolderName(persona.id), 'prompt.md');
      const content = fs.readFileSync(promptPath, 'utf-8');
      expect(content.endsWith('\n')).toBe(false);
    });

    it('损坏的 persona.json 返回 null', () => {
      const badDir = path.join(tmpRoot, 'bad-persona');
      fs.mkdirSync(badDir, { recursive: true });
      fs.writeFileSync(path.join(badDir, 'persona.json'), '{ bad json }', 'utf-8');
      expect(readStoredPersona(badDir)).toBeNull();
    });
  });

  // ── 13. PersonaModule 结构 ──
  describe('13. PersonaModule 结构', () => {
    const moduleSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'packages', 'server', 'src', 'modules', 'persona', 'persona.module.ts'),
      'utf-8',
    );

    it('导入 AuthModule 和 HostModule', () => {
      expect(moduleSource).toContain('AuthModule');
      expect(moduleSource).toContain('HostModule');
    });

    it('注册 PersonaController', () => {
      expect(moduleSource).toContain('PersonaController');
    });

    it('Module 装饰器存在', () => {
      expect(moduleSource).toContain('@Module');
    });
  });

  // ── 14. persona-store.service.ts 关键逻辑 ──
  describe('14. persona-store.service.ts 关键逻辑', () => {
    const storageSource = fs.readFileSync(
      path.resolve(__dirname, '..', 'packages', 'server', 'src', 'modules', 'persona', 'persona-store.service.ts'),
      'utf-8',
    );

    it('默认头像扩展名集合包含主流格式', () => {
      const expectedExts = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg', '.avif', '.ico', '.tif', '.tiff'];
      for (const ext of expectedExts) {
        expect(storageSource).toContain(`'${ext}'`);
      }
    });

    it('环境变量 GARLIC_CLAW_PERSONAS_PATH 可覆盖存储路径', () => {
      expect(storageSource).toContain('GARLIC_CLAW_PERSONAS_PATH');
    });

    it('测试环境下使用临时目录', () => {
      expect(storageSource).toContain('JEST_WORKER_ID');
    });
  });

  // ── 15. 边界条件与异常路径 ──
  describe('15. 边界条件与异常路径', () => {
    it('特殊字符 ID 通过 encodeURIComponent 处理', () => {
      const specialId = 'my  persona/id@#$%';
      const encoded = readPersonaFolderName(specialId);
      expect(encoded).toBe('my%20%20persona%2Fid%40%23%24%25');
      expect(decodeURIComponent(encoded)).toBe(specialId.trim());
    });

    it('normalizeOptionalText 处理各种边界值', () => {
      expect(normalizeOptionalText(undefined)).toBeUndefined();
      expect(normalizeOptionalText(null)).toBeUndefined();
      expect(normalizeOptionalText(0 as unknown as string)).toBeUndefined();
      expect(normalizeOptionalText('')).toBeUndefined();
      expect(normalizeOptionalText('   ')).toBeUndefined();
      expect(normalizeOptionalText('hello')).toBe('hello');
    });

    it('normalizeNullableIdList 处理各种边界值', () => {
      expect(normalizeNullableIdList(undefined)).toBeNull();
      expect(normalizeNullableIdList(null)).toBeNull();
      expect(normalizeNullableIdList([])).toEqual([]);
      expect(normalizeNullableIdList(['a', '', '  ', 'b'])).toEqual(['a', 'b']);
      expect(normalizeNullableIdList(['  a  ', 'b'])).toEqual(['a', 'b']);
    });

    it('createStoredPersona 空 toolNames 为 undefined 时返回 null', () => {
      const result = createStoredPersona({
        id: 'test',
        name: 'Test',
        prompt: 'Test prompt',
      }, 'test');
      expect(result.toolNames).toBeNull();
    });

    it('createStoredPersona toolNames 显式 null 返回 null', () => {
      const result = createStoredPersona({
        id: 'test',
        name: 'Test',
        prompt: 'Test prompt',
        toolNames: null,
      }, 'test');
      expect(result.toolNames).toBeNull();
    });

    it('normalizeDialogEntries 处理混合有效/无效条目', () => {
      const entries = [
        { content: 'valid', role: 'assistant' as const },
        { content: '', role: 'user' as const },
        { content: 'also valid', role: 'user' as const },
        null as unknown as PluginPersonaDialogEntry,
        undefined as unknown as PluginPersonaDialogEntry,
      ];
      const result = normalizeDialogEntries(entries);
      expect(result).toEqual([
        { content: 'valid', role: 'assistant' },
        { content: 'also valid', role: 'user' },
      ]);
    });
  });

  // ── 16. 文件存在性集成验证 ──
  describe('16. 文件存在性集成验证', () => {
    it('persona.service.ts 存在', () => {
      const filePath = path.resolve(__dirname, '..', 'packages', 'server', 'src', 'modules', 'persona', 'persona.service.ts');
      expect(fs.existsSync(filePath)).toBe(true);
      const stat = fs.statSync(filePath);
      expect(stat.size).toBeGreaterThan(0);
    });

    it('persona-store.service.ts 存在', () => {
      const filePath = path.resolve(__dirname, '..', 'packages', 'server', 'src', 'modules', 'persona', 'persona-store.service.ts');
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.statSync(filePath).size).toBeGreaterThan(0);
    });

    it('default-persona.ts 存在且非空', () => {
      const filePath = path.resolve(__dirname, '..', 'packages', 'server', 'src', 'modules', 'persona', 'default-persona.ts');
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.statSync(filePath).size).toBeGreaterThan(0);
    });

    it('4 个 DTO 文件全部存在', () => {
      const dtos = ['create-persona.dto.ts', 'update-persona.dto.ts', 'persona-dialog-entry.dto.ts', 'activate-conversation-persona.dto.ts'];
      for (const dto of dtos) {
        const filePath = path.resolve(__dirname, '..', 'packages', 'server', 'src', 'modules', 'persona', 'dto', dto);
        expect(fs.existsSync(filePath)).toBe(true);
      }
    });
  });
});
