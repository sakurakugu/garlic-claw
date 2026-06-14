import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── 类型定义（从 @garlic-claw/shared 对齐） ───

type SkillSourceKind = 'project';
type SkillLoadPolicy = 'allow' | 'ask' | 'deny';
type SkillAssetKind = 'script' | 'template' | 'reference' | 'asset' | 'other';

interface SkillGovernanceInfo {
  loadPolicy: SkillLoadPolicy;
  eventLog: { maxFileSizeMb: number };
}

interface SkillAssetSummary {
  path: string;
  kind: SkillAssetKind;
  textReadable: boolean;
  executable: boolean;
}

interface SkillSummary {
  id: string;
  name: string;
  description: string;
  tags: string[];
  sourceKind: SkillSourceKind;
  entryPath: string;
  promptPreview: string;
  governance: SkillGovernanceInfo;
}

interface SkillDetail extends SkillSummary {
  content: string;
  assets: SkillAssetSummary[];
}

interface SkillLoadResult {
  id: string;
  name: string;
  description: string;
  content: string;
  entryPath: string;
  baseDirectory: string;
  files: SkillAssetSummary[];
  modelOutput: string;
}

interface SkillGovernanceFile {
  skills: Record<string, SkillGovernanceInfo>;
}

interface PluginParamSchema {
  description: string;
  required: boolean;
  type: string;
}

// ─── 常量 ───

const DEFAULT_SKILL_GOVERNANCE: SkillGovernanceInfo = { eventLog: { maxFileSizeMb: 1 }, loadPolicy: 'allow' };
const VALID_SKILL_NAME_RE = /^[a-zA-Z0-9_\-\u4e00-\u9fff\s]+$/;

// ─── 内联纯函数（对齐 skill-registry.service.ts） ───

const EXECUTABLE_EXTENSIONS = ['.ps1', '.sh', '.bat', '.cmd', '.py', '.js', '.mjs', '.cjs'];
const TEXT_READABLE_EXTENSIONS = ['.txt', '.md', '.json', '.yaml', '.yml', '.toml', '.ini', '.csv', '.svg', '.xml', '.html', '.css', '.js', '.mjs', '.cjs', '.ts', '.py', '.ps1', '.sh', '.bat', '.cmd'];

function isExecutableAsset(extension: string): boolean {
  return EXECUTABLE_EXTENSIONS.includes(extension.toLowerCase());
}

function isTextReadableAsset(extension: string): boolean {
  return TEXT_READABLE_EXTENSIONS.includes(extension);
}

function readSkillAssetKind(extension: string): SkillAssetKind {
  if (isExecutableAsset(extension)) return 'script';
  if (extension === '.md') return 'reference';
  if (['.json', '.yaml', '.yml', '.toml'].includes(extension)) return 'template';
  return isTextReadableAsset(extension) ? 'asset' : 'other';
}

function copySkillAssetSummary(asset: SkillAssetSummary): SkillAssetSummary {
  return {
    executable: asset.executable,
    kind: asset.kind,
    path: asset.path,
    textReadable: asset.textReadable,
  };
}

function escapeXml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&apos;');
}

function readBlockedSkillMessage(loadPolicy: SkillLoadPolicy, skillName: string): string {
  return loadPolicy === 'ask'
    ? `Skill "${skillName}" requires host confirmation and is not available for automatic loading`
    : `Skill "${skillName}" is denied by governance policy`;
}

function readOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseSkillFile(text: string): { frontmatter: Record<string, unknown>; content: string } {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { frontmatter: {}, content: normalized.trim() };
  const frontmatterEnd = normalized.indexOf('\n---\n', 4);
  if (frontmatterEnd === -1) return { frontmatter: {}, content: normalized.trim() };
  const frontmatterRaw = normalized.slice(4, frontmatterEnd);
  const frontmatter: Record<string, unknown> = {};
  for (const line of frontmatterRaw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value: unknown = trimmed.slice(colonIdx + 1).trim();
    if (typeof value === 'string') {
      if (value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
      } else if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (/^\d+$/.test(value)) value = Number(value);
      else if (value.length > 0) {
        value = value.replace(/^['"]|['"]$/g, '');
      } else {
        value = undefined;
      }
    }
    if (value !== undefined) {
      frontmatter[key] = value;
    }
  }
  return { frontmatter, content: normalized.slice(frontmatterEnd + '\n---\n'.length).trim() };
}

function buildSkillDetailFromFrontmatter(
  entryPath: string,
  parsed: { frontmatter: Record<string, unknown>; content: string },
  assetPaths: string[],
): SkillDetail {
  const skillPath = entryPath.replace(/\/SKILL\.md$/i, '').split('/').at(-1) ?? 'root';
  return {
    id: `project/${entryPath.replace(/\/SKILL\.md$/i, '').split(path.sep).join('/') || 'root'}`,
    name: typeof parsed.frontmatter.name === 'string' && parsed.frontmatter.name.trim().length > 0
      ? parsed.frontmatter.name.trim()
      : (skillPath.replace(/[-_]+/g, ' ').trim()),
    description: typeof parsed.frontmatter.description === 'string' ? parsed.frontmatter.description.trim() : '',
    tags: Array.isArray(parsed.frontmatter.tags)
      ? parsed.frontmatter.tags.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [],
    sourceKind: 'project',
    entryPath,
    promptPreview: parsed.content.replace(/^#+\s+/gm, '').replace(/\s+/g, ' ').trim().slice(0, 160),
    governance: DEFAULT_SKILL_GOVERNANCE,
    content: parsed.content,
    assets: assetPaths.filter((p) => path.basename(p) !== 'SKILL.md').map((p) => ({
      executable: isExecutableAsset(path.extname(p).toLowerCase()),
      kind: readSkillAssetKind(path.extname(p).toLowerCase()),
      path: p,
      textReadable: isTextReadableAsset(path.extname(p).toLowerCase()),
    })),
  };
}

// ─── 内联纯函数（对齐 skill-tool.service.ts） ───

const MODEL_OUTPUT_FILE_LIMIT = 10;
const SKILL_TOOL_PARAMETERS: Record<string, PluginParamSchema> = {
  name: { description: 'The name of the skill from available_skills.', required: true, type: 'string' },
};

function renderSkillModelOutput(input: Omit<SkillLoadResult, 'modelOutput'>): string {
  const sampled = input.files.slice(0, MODEL_OUTPUT_FILE_LIMIT);
  return [
    `<skill_content name="${escapeXml(input.name)}">`,
    `# Skill: ${input.name}`,
    '',
    input.content.trim(),
    '',
    `Base directory for this skill: ${input.baseDirectory}`,
    `Entry file: ${input.entryPath}`,
    'Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.',
    sampled.length < input.files.length
      ? `Note: file list is sampled (${sampled.length}/${input.files.length}).`
      : 'Note: file list is sampled.',
    '',
    '<skill_files>',
    ...sampled.map((file) => `<file>${escapeXml(file.path)}</file>`),
    '</skill_files>',
    '</skill_content>',
  ].join('\n');
}

function buildToolDescription(skills: SkillSummary[]): string {
  if (skills.length === 0) {
    return 'Load a specialized skill that provides domain-specific instructions and workflows. No skills are currently available.';
  }
  return [
    'Load a specialized skill that provides domain-specific instructions and workflows.',
    '',
    'When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.',
    '',
    'The skill injects the full skill content, base directory, and sampled file list into the current conversation.',
    '',
    'Tool output includes a `<skill_content name="...">` block with the loaded content.',
    '',
    '<available_skills>',
    ...skills.map((skill) => [
      '  <skill>',
      `    <name>${escapeXml(skill.name)}</name>`,
      `    <description>${escapeXml(skill.description)}</description>`,
      `    <location>${escapeXml(`config/skills/definitions/${skill.entryPath}`)}</location>`,
      '  </skill>',
    ].join('\n')),
    '</available_skills>',
  ].join('\n');
}

function readSkillGovernanceFile(filePath: string): SkillGovernanceFile {
  try {
    if (!fs.existsSync(filePath)) return { skills: {} };
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<SkillGovernanceFile>;
    const skills: Record<string, SkillGovernanceInfo> = {};
    if (parsed.skills && typeof parsed.skills === 'object') {
      for (const [skillId, governance] of Object.entries(parsed.skills)) {
        if (governance && typeof governance === 'object') {
          const eventLog = governance.eventLog && typeof governance.eventLog === 'object'
            ? { maxFileSizeMb: typeof governance.eventLog.maxFileSizeMb === 'number' && !Number.isNaN(governance.eventLog.maxFileSizeMb)
              ? Math.max(0, governance.eventLog.maxFileSizeMb) : 1 }
            : { maxFileSizeMb: 1 };
          skills[skillId] = {
            eventLog,
            loadPolicy: (typeof governance.loadPolicy === 'string' && ['allow', 'ask', 'deny'].includes(governance.loadPolicy))
              ? governance.loadPolicy as SkillLoadPolicy
              : DEFAULT_SKILL_GOVERNANCE.loadPolicy,
          };
        }
      }
    }
    return { skills };
  } catch {
    return { skills: {} };
  }
}

function writeSkillGovernanceFile(filePath: string, governance: SkillGovernanceFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(governance, null, 2), 'utf8');
}

async function walkSkillFiles(root: string): Promise<string[]> {
  if (!fs.existsSync(root)) return [];
  const entries = await fsPromises.readdir(root, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...await walkSkillFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function findSkillDirectories(skillsRoot: string): string[] {
  if (!fs.existsSync(skillsRoot)) return [];
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

function readSkillCode(skillRoot: string): string {
  const scriptsDir = path.join(skillRoot, 'scripts');
  if (!fs.existsSync(scriptsDir)) return '';
  const entries = fs.readdirSync(scriptsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(js|ts|mjs)$/i.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length === 0) return '';
  try {
    return fs.readFileSync(path.join(scriptsDir, entries[0].name), 'utf-8');
  } catch {
    return '';
  }
}

function countEffectiveLines(code: string): number {
  return code.split('\n').length;
}

// ========================================================================
// 测试
// ========================================================================

describe('Skill 系统核心 — 资产分类', () => {

  describe('isExecutableAsset', () => {
    it.each([
      ['.js', true],
      ['.mjs', true],
      ['.cjs', true],
      ['.py', true],
      ['.sh', true],
      ['.ps1', true],
      ['.bat', true],
      ['.cmd', true],
      ['.md', false],
      ['.json', false],
      ['.txt', false],
      ['.ts', false],
      ['.jpg', false],
      ['.png', false],
      ['.dll', false],
    ])('扩展名 %s → %s', (ext, expected) => {
      expect(isExecutableAsset(ext)).toBe(expected);
    });

    it('大小写不敏感', () => {
      expect(isExecutableAsset('.JS')).toBe(true);
      expect(isExecutableAsset('.Py')).toBe(true);
    });
  });

  describe('isTextReadableAsset', () => {
    it.each([
      ['.txt', true], ['.md', true], ['.json', true], ['.yaml', true],
      ['.yml', true], ['.toml', true], ['.ini', true], ['.csv', true],
      ['.svg', true], ['.xml', true], ['.html', true], ['.css', true],
      ['.js', true], ['.mjs', true], ['.cjs', true], ['.ts', true],
      ['.py', true], ['.ps1', true], ['.sh', true], ['.bat', true],
      ['.cmd', true], ['.jpg', false], ['.png', false], ['.zip', false],
      ['.exe', false], ['.bin', false], ['.wasm', false],
    ])('扩展名 %s → %s', (ext, expected) => {
      expect(isTextReadableAsset(ext)).toBe(expected);
    });
  });

  describe('readSkillAssetKind', () => {
    it('可执行文件返回 script', () => {
      expect(readSkillAssetKind('.js')).toBe('script');
      expect(readSkillAssetKind('.py')).toBe('script');
      expect(readSkillAssetKind('.sh')).toBe('script');
    });

    it('.md 返回 reference', () => {
      expect(readSkillAssetKind('.md')).toBe('reference');
    });

    it('结构化数据返回 template', () => {
      expect(readSkillAssetKind('.json')).toBe('template');
      expect(readSkillAssetKind('.yaml')).toBe('template');
      expect(readSkillAssetKind('.toml')).toBe('template');
    });

    it('可读非可执行返回 asset', () => {
      expect(readSkillAssetKind('.txt')).toBe('asset');
      expect(readSkillAssetKind('.csv')).toBe('asset');
      expect(readSkillAssetKind('.xml')).toBe('asset');
    });

    it('其他返回 other', () => {
      expect(readSkillAssetKind('.jpg')).toBe('other');
      expect(readSkillAssetKind('.zip')).toBe('other');
      expect(readSkillAssetKind('.exe')).toBe('other');
    });
  });
});

describe('Skill 系统核心 — XML 转义', () => {

  describe('escapeXml', () => {
    it('转义 & < > " \'', () => {
      expect(escapeXml('a & b < c > d "e" f\'g')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot; f&apos;g');
    });

    it('普通文本不变', () => {
      expect(escapeXml('hello world')).toBe('hello world');
    });

    it('空字符串不变', () => {
      expect(escapeXml('')).toBe('');
    });

    it('Unicode 字符不变', () => {
      expect(escapeXml('天气查询')).toBe('天气查询');
    });

    it('数字不变', () => {
      expect(escapeXml('123')).toBe('123');
    });
  });
});

describe('Skill 系统核心 — 治理消息与输出', () => {

  describe('readBlockedSkillMessage', () => {
    it('ask 策略返回主机确认消息', () => {
      expect(readBlockedSkillMessage('ask', 'test-skill')).toBe(
        'Skill "test-skill" requires host confirmation and is not available for automatic loading',
      );
    });

    it('deny 策略返回拒绝消息', () => {
      expect(readBlockedSkillMessage('deny', 'my-skill')).toBe(
        'Skill "my-skill" is denied by governance policy',
      );
    });

    it('allow 策略（不会调用该函数，但确保类型安全）', () => {
      // allow 时不会调用 readBlockedSkillMessage，但函数不报错
      expect(() => readBlockedSkillMessage('allow', 'x')).not.toThrow();
    });
  });

  describe('copySkillAssetSummary', () => {
    it('返回新引用且字段一致', () => {
      const asset: SkillAssetSummary = { path: 'scripts/weather.js', kind: 'script', textReadable: true, executable: true };
      const copy = copySkillAssetSummary(asset);
      expect(copy).toEqual(asset);
      expect(copy).not.toBe(asset);
    });
  });

  describe('renderSkillModelOutput', () => {
    const baseResult: SkillLoadResult = {
      id: 'project/weather-query',
      name: 'weather-query',
      description: '查询天气',
      content: '# weather-query\n\n使用脚本查询天气。',
      entryPath: 'weather-query/SKILL.md',
      baseDirectory: '/tmp/skills/weather-query',
      files: [
        { path: 'scripts/weather.js', kind: 'script', textReadable: true, executable: true },
      ],
      modelOutput: '',
    };

    it('包含 skill_content 标签', () => {
      const output = renderSkillModelOutput(baseResult);
      expect(output).toContain('<skill_content name="weather-query">');
      expect(output).toContain('</skill_content>');
    });

    it('包含 skill 标题和内容', () => {
      const output = renderSkillModelOutput(baseResult);
      expect(output).toContain('# Skill: weather-query');
      expect(output).toContain('使用脚本查询天气。');
    });

    it('包含 base directory 和 entry file', () => {
      const output = renderSkillModelOutput(baseResult);
      expect(output).toContain('/tmp/skills/weather-query');
      expect(output).toContain('weather-query/SKILL.md');
    });

    it('包含 skill_files 块', () => {
      const output = renderSkillModelOutput(baseResult);
      expect(output).toContain('<skill_files>');
      expect(output).toContain('<file>scripts/weather.js</file>');
      expect(output).toContain('</skill_files>');
    });

    it('文件超过 10 个时显示采样信息', () => {
      const manyFiles: SkillAssetSummary[] = Array.from({ length: 15 }, (_, i) => ({
        path: `file-${i}.js`, kind: 'script', textReadable: true, executable: true,
      }));
      const output = renderSkillModelOutput({ ...baseResult, files: manyFiles });
      expect(output).toContain('Note: file list is sampled (10/15).');
      expect(output).not.toContain('file-14.js');
    });

    it('文件不超过 10 个时显示一般采样信息', () => {
      const output = renderSkillModelOutput(baseResult);
      expect(output).toContain('Note: file list is sampled.');
      expect(output).not.toContain('(1/1)');
    });

    it('XML 转义技能名称', () => {
      const result = { ...baseResult, name: 'test & skill <foo>' };
      const output = renderSkillModelOutput(result);
      expect(output).toContain('test &amp; skill &lt;foo&gt;');
    });
  });

  describe('buildToolDescription', () => {
    it('无技能返回空描述', () => {
      const desc = buildToolDescription([]);
      expect(desc).toContain('No skills are currently available');
    });

    it('有技能时包含 available_skills XML 块', () => {
      const skills: SkillSummary[] = [{
        id: 'project/weather-query', name: 'weather-query', description: '查询天气',
        tags: ['weather'], sourceKind: 'project', entryPath: 'weather-query/SKILL.md',
        promptPreview: '查询天气', governance: DEFAULT_SKILL_GOVERNANCE,
      }];
      const desc = buildToolDescription(skills);
      expect(desc).toContain('<available_skills>');
      expect(desc).toContain('<name>weather-query</name>');
      expect(desc).toContain('</available_skills>');
    });

    it('包含 API 文档风格的描述', () => {
      const skills: SkillSummary[] = [{
        id: 'project/test', name: 'test', description: 'desc',
        tags: [], sourceKind: 'project', entryPath: 'test/SKILL.md',
        promptPreview: '', governance: DEFAULT_SKILL_GOVERNANCE,
      }];
      const desc = buildToolDescription(skills);
      expect(desc).toContain('Load a specialized skill');
      expect(desc).toContain('<skill_content name="...">');
    });

    it('location 路径格式正确', () => {
      const skills: SkillSummary[] = [{
        id: 'project/test', name: 'test', description: 'desc',
        tags: [], sourceKind: 'project', entryPath: 'test/SKILL.md',
        promptPreview: '', governance: DEFAULT_SKILL_GOVERNANCE,
      }];
      const desc = buildToolDescription(skills);
      expect(desc).toContain('<location>config/skills/definitions/test/SKILL.md</location>');
    });

    it('XML 转义技能描述中的特殊字符', () => {
      const skills: SkillSummary[] = [{
        id: 'project/test', name: 'test', description: 'a & b < c > d',
        tags: [], sourceKind: 'project', entryPath: 'test/SKILL.md',
        promptPreview: '', governance: DEFAULT_SKILL_GOVERNANCE,
      }];
      const desc = buildToolDescription(skills);
      expect(desc).toContain('a &amp; b &lt; c &gt; d');
    });
  });

  describe('getToolParameters', () => {
    it('返回 name 参数', () => {
      const params = SKILL_TOOL_PARAMETERS;
      expect(params.name).toBeDefined();
      expect(params.name.required).toBe(true);
      expect(params.name.type).toBe('string');
    });
  });
});

describe('Skill 系统核心 — 治理文件解析', () => {

  describe('readSkillGovernanceFile', () => {
    const tmpDir = path.join(os.tmpdir(), `skill-gov-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('不存在的文件返回空技能表', () => {
      const result = readSkillGovernanceFile(path.join(tmpDir, 'nonexistent.json'));
      expect(result.skills).toEqual({});
    });

    it('空文件返回空技能表', () => {
      const filePath = path.join(tmpDir, 'empty.json');
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(filePath, '{}', 'utf8');
      expect(readSkillGovernanceFile(filePath).skills).toEqual({});
    });

    it('解析合法 governance 文件', () => {
      const filePath = path.join(tmpDir, 'valid.json');
      fs.writeFileSync(filePath, JSON.stringify({
        skills: {
          'weather-query': { loadPolicy: 'allow', eventLog: { maxFileSizeMb: 5 } },
          'secret-skill': { loadPolicy: 'deny', eventLog: { maxFileSizeMb: 1 } },
        },
      }), 'utf8');
      const result = readSkillGovernanceFile(filePath);
      expect(result.skills['weather-query'].loadPolicy).toBe('allow');
      expect(result.skills['weather-query'].eventLog.maxFileSizeMb).toBe(5);
      expect(result.skills['secret-skill'].loadPolicy).toBe('deny');
    });

    it('损坏 JSON 返回空技能表', () => {
      const filePath = path.join(tmpDir, 'broken.json');
      fs.writeFileSync(filePath, '{invalid json}', 'utf8');
      const result = readSkillGovernanceFile(filePath);
      expect(result.skills).toEqual({});
    });

    it('缺失 loadPolicy 使用默认值 allow', () => {
      const filePath = path.join(tmpDir, 'default-policy.json');
      fs.writeFileSync(filePath, JSON.stringify({
        skills: { 'test': { eventLog: { maxFileSizeMb: 2 } } },
      }), 'utf8');
      const result = readSkillGovernanceFile(filePath);
      expect(result.skills['test'].loadPolicy).toBe('allow');
    });

    it('缺失 eventLog 使用默认值', () => {
      const filePath = path.join(tmpDir, 'default-eventlog.json');
      fs.writeFileSync(filePath, JSON.stringify({
        skills: { 'test': { loadPolicy: 'ask' } },
      }), 'utf8');
      const result = readSkillGovernanceFile(filePath);
      expect(result.skills['test'].eventLog.maxFileSizeMb).toBe(1);
    });

    it('负数 maxFileSizeMb 被钳制为 0', () => {
      const filePath = path.join(tmpDir, 'negative.json');
      fs.writeFileSync(filePath, JSON.stringify({
        skills: { 'test': { loadPolicy: 'allow', eventLog: { maxFileSizeMb: -5 } } },
      }), 'utf8');
      const result = readSkillGovernanceFile(filePath);
      expect(result.skills['test'].eventLog.maxFileSizeMb).toBe(0);
    });

    it('NaN maxFileSizeMb 使用默认值', () => {
      const filePath = path.join(tmpDir, 'nan.json');
      fs.writeFileSync(filePath, JSON.stringify({
        skills: { 'test': { loadPolicy: 'allow', eventLog: { maxFileSizeMb: null } } },
      }), 'utf8');
      const result = readSkillGovernanceFile(filePath);
      expect(result.skills['test'].eventLog.maxFileSizeMb).toBe(1);
    });

    it('非法 loadPolicy 使用默认值 allow', () => {
      const filePath = path.join(tmpDir, 'bad-policy.json');
      fs.writeFileSync(filePath, JSON.stringify({
        skills: { 'test': { loadPolicy: 'super-admin', eventLog: { maxFileSizeMb: 1 } } },
      }), 'utf8');
      const result = readSkillGovernanceFile(filePath);
      expect(result.skills['test'].loadPolicy).toBe('allow');
    });
  });

  describe('writeSkillGovernanceFile', () => {
    const tmpDir = path.join(os.tmpdir(), `skill-gov-write-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    afterAll(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('写入并读取 governance 文件', () => {
      const filePath = path.join(tmpDir, 'settings.json');
      const governance: SkillGovernanceFile = {
        skills: {
          'weather-query': { loadPolicy: 'allow', eventLog: { maxFileSizeMb: 5 } },
        },
      };
      writeSkillGovernanceFile(filePath, governance);
      expect(fs.existsSync(filePath)).toBe(true);
      const read = readSkillGovernanceFile(filePath);
      expect(read.skills['weather-query'].loadPolicy).toBe('allow');
      expect(read.skills['weather-query'].eventLog.maxFileSizeMb).toBe(5);
    });

    it('写入空 skills 对象', () => {
      const filePath = path.join(tmpDir, 'empty-settings.json');
      writeSkillGovernanceFile(filePath, { skills: {} });
      const read = readSkillGovernanceFile(filePath);
      expect(read.skills).toEqual({});
    });

    it('多次写入覆盖', () => {
      const filePath = path.join(tmpDir, 'overwrite.json');
      writeSkillGovernanceFile(filePath, { skills: { a: { loadPolicy: 'allow', eventLog: { maxFileSizeMb: 1 } } } });
      writeSkillGovernanceFile(filePath, { skills: { b: { loadPolicy: 'deny', eventLog: { maxFileSizeMb: 2 } } } });
      const read = readSkillGovernanceFile(filePath);
      expect(read.skills.a).toBeUndefined();
      expect(read.skills.b.loadPolicy).toBe('deny');
    });
  });
});

describe('Skill 系统核心 — Skill 文件解析', () => {

  describe('parseSkillFile', () => {
    it('解析标准 frontmatter + body', () => {
      const result = parseSkillFile('---\nname: test-skill\ndescription: A test skill\ntags: [weather, script]\n---\n\n# Test Skill\n\nBody content.');
      expect(result.frontmatter.name).toBe('test-skill');
      expect(result.frontmatter.description).toBe('A test skill');
      expect(result.frontmatter.tags).toEqual(['weather', 'script']);
      expect(result.content).toContain('# Test Skill');
    });

    it('无 frontmatter 时返回空 frontmatter', () => {
      const result = parseSkillFile('# Just a title\n\nSome content.');
      expect(result.frontmatter).toEqual({});
      expect(result.content).toContain('# Just a title');
    });

    it('缺失闭合 frontmatter 标记时返回空 frontmatter', () => {
      const result = parseSkillFile('---\nname: broken\nSome text without close');
      expect(result.frontmatter).toEqual({});
    });

    it('空字符串返回空 frontmatter', () => {
      const result = parseSkillFile('');
      expect(result.frontmatter).toEqual({});
    });

    it('CRLF 行尾被规范化', () => {
      const result = parseSkillFile('---\r\nname: test\r\ntags: [a, b]\r\n---\r\n\r\nbody');
      expect(result.frontmatter.name).toBe('test');
      expect(result.frontmatter.tags).toEqual(['a', 'b']);
      expect(result.content).toBe('body');
    });

    it('frontmatter 中布尔值解析', () => {
      const result = parseSkillFile('---\nenabled: true\nvisible: false\n---\nbody');
      expect(result.frontmatter.enabled).toBe(true);
      expect(result.frontmatter.visible).toBe(false);
    });

    it('frontmatter 中数字解析', () => {
      const result = parseSkillFile('---\nversion: 42\n---\nbody');
      expect(result.frontmatter.version).toBe(42);
    });

    it('frontmatter 字段顺序无关', () => {
      const result = parseSkillFile('---\ndescription: desc\nname: my-skill\ntags: [a]\n---\nbody');
      expect(result.frontmatter.name).toBe('my-skill');
      expect(result.frontmatter.description).toBe('desc');
    });
  });

  describe('buildSkillDetailFromFrontmatter', () => {
    it('从 frontmatter 构建 SkillDetail', () => {
      const parsed = parseSkillFile('---\nname: test-skill\ndescription: A test skill\ntags: [weather, script]\n---\n\n# Test Skill\n\nContent.');
      const detail = buildSkillDetailFromFrontmatter('test-skill/SKILL.md', parsed, ['scripts/test.js', 'data/settings.json']);
      expect(detail.name).toBe('test-skill');
      expect(detail.description).toBe('A test skill');
      expect(detail.tags).toEqual(['weather', 'script']);
      expect(detail.id).toBe('project/test-skill');
      expect(detail.sourceKind).toBe('project');
      expect(detail.entryPath).toBe('test-skill/SKILL.md');
      expect(detail.content).toContain('# Test Skill');
    });

    it('缺失 name 时从目录名推导', () => {
      const parsed = parseSkillFile('---\ndescription: desc\n---\nbody');
      const detail = buildSkillDetailFromFrontmatter('my-cool-skill/SKILL.md', parsed, []);
      expect(detail.name).toBe('my cool skill');
    });

    it('缺失标签时返回空数组', () => {
      const parsed = parseSkillFile('---\nname: test\n---\nbody');
      const detail = buildSkillDetailFromFrontmatter('test/SKILL.md', parsed, []);
      expect(detail.tags).toEqual([]);
    });

    it('过滤非字符串标签', () => {
      const parsed = parseSkillFile('---\nname: test\ntags: [valid, 42, null]\n---\nbody');
      const detail = buildSkillDetailFromFrontmatter('test/SKILL.md', parsed, []);
      expect(detail.tags.every((t) => typeof t === 'string' && t.length > 0)).toBe(true);
    });

    it('promptPreview 截取前 160 字符', () => {
      const longContent = '# Title\n\n' + 'a'.repeat(200);
      const parsed = parseSkillFile(`---\nname: test\n---\n${longContent}`);
      const detail = buildSkillDetailFromFrontmatter('test/SKILL.md', parsed, []);
      expect(detail.promptPreview.length).toBeLessThanOrEqual(160);
      expect(detail.promptPreview).not.toContain('#');
    });

    it('资产分类正确', () => {
      const parsed = parseSkillFile('---\nname: test\n---\nbody');
      const detail = buildSkillDetailFromFrontmatter('test/SKILL.md', parsed, ['scripts/test.js', 'README.md', 'config.json', 'image.png']);
      const assets = detail.assets;
      expect(assets.find((a) => a.path === 'scripts/test.js')).toEqual(
        expect.objectContaining({ kind: 'script', executable: true, textReadable: true }),
      );
      expect(assets.find((a) => a.path === 'README.md')).toEqual(
        expect.objectContaining({ kind: 'reference', executable: false, textReadable: true }),
      );
      expect(assets.find((a) => a.path === 'config.json')).toEqual(
        expect.objectContaining({ kind: 'template', executable: false, textReadable: true }),
      );
      expect(assets.find((a) => a.path === 'image.png')).toEqual(
        expect.objectContaining({ kind: 'other', executable: false, textReadable: false }),
      );
    });

    it('SKILL.md 本身不在资产列表中', () => {
      const parsed = parseSkillFile('---\nname: test\n---\nbody');
      const detail = buildSkillDetailFromFrontmatter('test/SKILL.md', parsed, ['SKILL.md', 'scripts/test.js']);
      const assetPaths = detail.assets.map((a) => a.path);
      expect(assetPaths).not.toContain('SKILL.md');
      expect(assetPaths).toContain('scripts/test.js');
    });
  });
});

describe('Skill 系统核心 — 文件系统集成', () => {

  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'skill-fs-test-'));
  });

  afterEach(async () => {
    await fsPromises.rm(tmpRoot, { recursive: true, force: true });
  });

  describe('walkSkillFiles', () => {
    it('不存在的目录返回空数组', async () => {
      const files = await walkSkillFiles(path.join(tmpRoot, 'nonexistent'));
      expect(files).toEqual([]);
    });

    it('空目录返回空数组', async () => {
      await fsPromises.mkdir(path.join(tmpRoot, 'empty'), { recursive: true });
      const files = await walkSkillFiles(path.join(tmpRoot, 'empty'));
      expect(files).toEqual([]);
    });

    it('递归收集所有文件', async () => {
      await fsPromises.mkdir(path.join(tmpRoot, 'skills', 'alpha', 'scripts'), { recursive: true });
      await fsPromises.writeFile(path.join(tmpRoot, 'skills', 'alpha', 'SKILL.md'), 'content');
      await fsPromises.writeFile(path.join(tmpRoot, 'skills', 'alpha', 'scripts', 'test.js'), 'code');
      await fsPromises.writeFile(path.join(tmpRoot, 'skills', 'alpha', 'config.json'), '{}');

      const files = await walkSkillFiles(path.join(tmpRoot, 'skills'));
      expect(files).toHaveLength(3);
      expect(files.some((f) => f.endsWith('SKILL.md'))).toBe(true);
      expect(files.some((f) => f.endsWith('test.js'))).toBe(true);
      expect(files.some((f) => f.endsWith('config.json'))).toBe(true);
    });

    it('多技能目录不互相污染', async () => {
      await fsPromises.mkdir(path.join(tmpRoot, 'skills', 'alpha'), { recursive: true });
      await fsPromises.mkdir(path.join(tmpRoot, 'skills', 'beta'), { recursive: true });
      await fsPromises.writeFile(path.join(tmpRoot, 'skills', 'alpha', 'SKILL.md'), 'alpha');
      await fsPromises.writeFile(path.join(tmpRoot, 'skills', 'beta', 'SKILL.md'), 'beta');

      const files = await walkSkillFiles(path.join(tmpRoot, 'skills'));
      expect(files).toHaveLength(2);
    });
  });

  describe('findSkillDirectories', () => {
    it('不存在的目录返回空数组', () => {
      expect(findSkillDirectories(path.join(tmpRoot, 'nonexistent'))).toEqual([]);
    });

    it('枚举子目录', () => {
      fs.mkdirSync(path.join(tmpRoot, 'alpha'), { recursive: true });
      fs.mkdirSync(path.join(tmpRoot, 'beta'), { recursive: true });
      fs.mkdirSync(path.join(tmpRoot, 'gamma'), { recursive: true });
      // 创建文件不应被枚举
      fs.writeFileSync(path.join(tmpRoot, 'file.txt'), '');
      const dirs = findSkillDirectories(tmpRoot);
      expect(dirs).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('空目录返回空数组', () => {
      fs.mkdirSync(tmpRoot, { recursive: true });
      expect(findSkillDirectories(tmpRoot)).toEqual([]);
    });

    it('返回的列表按字母序排列', () => {
      fs.mkdirSync(path.join(tmpRoot, 'zeta'), { recursive: true });
      fs.mkdirSync(path.join(tmpRoot, 'alpha'), { recursive: true });
      fs.mkdirSync(path.join(tmpRoot, 'beta'), { recursive: true });
      const dirs = findSkillDirectories(tmpRoot);
      expect(dirs).toEqual(['alpha', 'beta', 'zeta']);
    });
  });

  describe('readSkillCode', () => {
    it('无 scripts 目录返回空字符串', () => {
      const dir = path.join(tmpRoot, 'noscripts');
      fs.mkdirSync(dir, { recursive: true });
      expect(readSkillCode(dir)).toBe('');
    });

    it('空 scripts 目录返回空字符串', () => {
      const dir = path.join(tmpRoot, 'emptyscripts');
      fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
      expect(readSkillCode(dir)).toBe('');
    });

    it('读取第一个脚本文件内容', () => {
      const dir = path.join(tmpRoot, 'has-scripts');
      fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'scripts', 'main.js'), 'console.log("hello");', 'utf8');
      const code = readSkillCode(dir);
      expect(code).toBe('console.log("hello");');
    });

    it('按字母序选择第一个文件', () => {
      const dir = path.join(tmpRoot, 'ordered');
      fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'scripts', 'b.js'), '// b', 'utf8');
      fs.writeFileSync(path.join(dir, 'scripts', 'a.js'), '// a', 'utf8');
      const code = readSkillCode(dir);
      expect(code).toBe('// a');
    });

    it('只读取 .js/.ts/.mjs 文件', () => {
      const dir = path.join(tmpRoot, 'filtered');
      fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'scripts', 'script.py'), 'print("hello")', 'utf8');
      fs.writeFileSync(path.join(dir, 'scripts', 'script.js'), 'console.log("js")', 'utf8');
      const code = readSkillCode(dir);
      expect(code).toContain('js');
      expect(code).not.toContain('print');
    });
  });

  describe('集成：walkSkillFiles + parseSkillFile + buildSkillDetailFromFrontmatter', () => {
    it('完整端到端：扫描目录 → 解析 SKILL.md → 构建技能详情', async () => {
      const skillsRoot = path.join(tmpRoot, 'skills', 'definitions');
      await fsPromises.mkdir(path.join(skillsRoot, 'weather-query', 'scripts'), { recursive: true });
      await fsPromises.writeFile(path.join(skillsRoot, 'weather-query', 'SKILL.md'), [
        '---',
        'name: weather-query',
        'description: 查询指定地点天气。',
        'tags: [weather, script, node]',
        '---',
        '',
        '# weather-query',
        '',
        '使用仓库内脚本查询天气。',
      ].join('\n'), 'utf8');
      await fsPromises.writeFile(path.join(skillsRoot, 'weather-query', 'scripts', 'weather.js'), 'console.log("weather")\n', 'utf8');
      await fsPromises.writeFile(path.join(skillsRoot, 'weather-query', 'README.md'), 'Some docs\n', 'utf8');

      const files = await walkSkillFiles(skillsRoot);
      const skillMds = files.filter((f) => path.basename(f) === 'SKILL.md');
      expect(skillMds).toHaveLength(1);

      const raw = await fsPromises.readFile(skillMds[0], 'utf8');
      const parsed = parseSkillFile(raw);

      expect(parsed.frontmatter.name).toBe('weather-query');
      expect(parsed.frontmatter.tags).toEqual(['weather', 'script', 'node']);
      expect(parsed.content).toContain('使用仓库内脚本查询天气。');

      const relativeDir = path.relative(skillsRoot, skillMds[0]).split(path.sep).join('/');
      const relativeFiles = files.map((f) => path.relative(path.dirname(skillMds[0]), f).split(path.sep).join('/'));
      const detail = buildSkillDetailFromFrontmatter(relativeDir, parsed, relativeFiles);

      expect(detail.name).toBe('weather-query');
      expect(detail.entryPath).toBe('weather-query/SKILL.md');
      expect(detail.tags).toEqual(['weather', 'script', 'node']);
      expect(detail.assets).toHaveLength(2);
      expect(detail.assets.find((a) => a.path === 'scripts/weather.js')?.kind).toBe('script');
      expect(detail.assets.find((a) => a.path === 'README.md')?.kind).toBe('reference');
    });

    it('多技能目录正确排序', async () => {
      const skillsRoot = path.join(tmpRoot, 'multi');
      for (const name of ['zeta-skill', 'alpha-skill', 'beta-skill']) {
        await fsPromises.mkdir(path.join(skillsRoot, name), { recursive: true });
        await fsPromises.writeFile(path.join(skillsRoot, name, 'SKILL.md'), `---\nname: ${name}\ndescription: desc\n---\nbody`, 'utf8');
      }
      const dirs = findSkillDirectories(skillsRoot);
      expect(dirs).toEqual(['alpha-skill', 'beta-skill', 'zeta-skill']);
    });

    it('无 SKILL.md 的目录被跳过', async () => {
      const skillsRoot = path.join(tmpRoot, 'noskills');
      await fsPromises.mkdir(path.join(skillsRoot, 'empty-dir'), { recursive: true });
      await fsPromises.writeFile(path.join(skillsRoot, 'empty-dir', 'readme.txt'), 'not a skill', 'utf8');

      const files = await walkSkillFiles(skillsRoot);
      const skillMds = files.filter((f) => path.basename(f) === 'SKILL.md');
      expect(skillMds).toHaveLength(0);
    });
  });
});

describe('Skill 系统核心 — 类型合约', () => {

  describe('SkillGovernanceInfo', () => {
    it('完整构造', () => {
      const info: SkillGovernanceInfo = { loadPolicy: 'allow', eventLog: { maxFileSizeMb: 5 } };
      expect(info.loadPolicy).toBe('allow');
      expect(info.eventLog.maxFileSizeMb).toBe(5);
    });

    it('最小构造', () => {
      const info: SkillGovernanceInfo = { loadPolicy: 'deny', eventLog: { maxFileSizeMb: 1 } };
      expect(info.loadPolicy).toBe('deny');
    });
  });

  describe('SkillAssetSummary', () => {
    it('完整构造', () => {
      const asset: SkillAssetSummary = { path: 'scripts/test.js', kind: 'script', textReadable: true, executable: true };
      expect(asset.kind).toBe('script');
      expect(asset.textReadable).toBe(true);
    });
  });

  describe('SkillSummary', () => {
    it('完整构造', () => {
      const summary: SkillSummary = {
        id: 'project/test', name: 'Test', description: 'desc', tags: ['tag1'],
        sourceKind: 'project', entryPath: 'test/SKILL.md', promptPreview: 'preview',
        governance: DEFAULT_SKILL_GOVERNANCE,
      };
      expect(summary.id).toBe('project/test');
      expect(summary.sourceKind).toBe('project');
    });
  });

  describe('SkillDetail', () => {
    it('完整构造（继承 SkillSummary）', () => {
      const detail: SkillDetail = {
        id: 'project/test', name: 'Test', description: 'desc', tags: [],
        sourceKind: 'project', entryPath: 'test/SKILL.md', promptPreview: '',
        governance: DEFAULT_SKILL_GOVERNANCE,
        content: '# Test\n\nContent.', assets: [{ path: 'test.js', kind: 'script', textReadable: true, executable: true }],
      };
      expect(detail.content).toContain('Content');
      expect(detail.assets).toHaveLength(1);
    });
  });

  describe('SkillLoadResult', () => {
    it('完整构造', () => {
      const result: SkillLoadResult = {
        id: 'project/test', name: 'Test', description: 'desc',
        content: '# Test', entryPath: 'test/SKILL.md',
        baseDirectory: '/tmp/test', files: [],
        modelOutput: '<skill_content name="Test">...</skill_content>',
      };
      expect(result.modelOutput).toContain('skill_content');
    });
  });

  describe('SkillLoadPolicy 枚举', () => {
    it('三种合法值', () => {
      const policies: SkillLoadPolicy[] = ['allow', 'ask', 'deny'];
      expect(policies).toHaveLength(3);
    });
  });

  describe('SkillSourceKind 枚举', () => {
    it('当前仅 project', () => {
      const kinds: SkillSourceKind[] = ['project'];
      expect(kinds).toHaveLength(1);
    });
  });

  describe('SkillAssetKind 枚举', () => {
    it('五种合法值', () => {
      const kinds: SkillAssetKind[] = ['script', 'template', 'reference', 'asset', 'other'];
      expect(kinds).toHaveLength(5);
    });
  });
});

describe('Skill 系统核心 — 边界条件', () => {

  describe('escapeXml', () => {
    it('处理空字符串', () => expect(escapeXml('')).toBe(''));
    it('只含特殊字符', () => expect(escapeXml('<>&"\'')).toBe('&lt;&gt;&amp;&quot;&apos;'));
    it('不转义非特殊字符', () => expect(escapeXml('normal text 123')).toBe('normal text 123'));
  });

  describe('readBlockedSkillMessage', () => {
    it('ask 消息不含 skill 名', () => {
      expect(readBlockedSkillMessage('ask', '')).toBe(
        'Skill "" requires host confirmation and is not available for automatic loading',
      );
    });
    it('deny 消息不含 skill 名', () => {
      expect(readBlockedSkillMessage('deny', '')).toBe(
        'Skill "" is denied by governance policy',
      );
    });
  });

  describe('buildToolDescription 边界', () => {
    it('空技能列表', () => {
      expect(buildToolDescription([])).toContain('No skills are currently available');
    });

    it('单技能', () => {
      const skills: SkillSummary[] = [{
        id: 'project/s', name: 's', description: 'd', tags: [],
        sourceKind: 'project', entryPath: 's/SKILL.md', promptPreview: '',
        governance: DEFAULT_SKILL_GOVERNANCE,
      }];
      const desc = buildToolDescription(skills);
      expect(desc).toContain('<name>s</name>');
    });

    it('技能名含特殊字符', () => {
      const skills: SkillSummary[] = [{
        id: 'project/x', name: '<test>', description: 'a&b', tags: [],
        sourceKind: 'project', entryPath: 'x/SKILL.md', promptPreview: '',
        governance: DEFAULT_SKILL_GOVERNANCE,
      }];
      const desc = buildToolDescription(skills);
      expect(desc).not.toContain('<test>');
      expect(desc).toContain('&lt;test&gt;');
    });
  });

  describe('renderSkillModelOutput 边界', () => {
    it('空文件列表', () => {
      const result: SkillLoadResult = {
        id: 'project/empty', name: 'empty', description: '', content: '',
        entryPath: 'empty/SKILL.md', baseDirectory: '/tmp/empty', files: [], modelOutput: '',
      };
      const output = renderSkillModelOutput(result);
      expect(output).toContain('<skill_content name="empty">');
      expect(output).toContain('<skill_files>');
      expect(output).toContain('</skill_files>');
    });

    it('最多 10 个文件被包含', () => {
      const files: SkillAssetSummary[] = Array.from({ length: 20 }, (_, i) => ({
        path: `file-${i}.js`, kind: 'script', textReadable: true, executable: true,
      }));
      const result: SkillLoadResult = {
        id: 'project/many', name: 'many', description: '', content: '',
        entryPath: 'many/SKILL.md', baseDirectory: '/tmp/many', files, modelOutput: '',
      };
      const output = renderSkillModelOutput(result);
      const fileMatches = output.match(/<file>/g);
      expect(fileMatches).toHaveLength(10);
    });

    it('内容为空时输出为空行', () => {
      const result: SkillLoadResult = {
        id: 'project/empty', name: 'empty', description: '', content: '',
        entryPath: 'empty/SKILL.md', baseDirectory: '/tmp/empty', files: [], modelOutput: '',
      };
      const output = renderSkillModelOutput(result);
      expect(output).toContain('# Skill: empty\n\n\n');
    });
  });

  describe('readSkillGovernanceFile 边界', () => {
    it('skills 字段非对象时容错', () => {
      const tmpPath = path.join(os.tmpdir(), `gov-boundary-${Date.now()}.json`);
      try {
        fs.writeFileSync(tmpPath, JSON.stringify({ skills: 'not-an-object' }), 'utf8');
        const result = readSkillGovernanceFile(tmpPath);
        expect(result.skills).toEqual({});
      } finally {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      }
    });

    it('技能条目非对象时跳过', () => {
      const tmpPath = path.join(os.tmpdir(), `gov-skip-${Date.now()}.json`);
      try {
        fs.writeFileSync(tmpPath, JSON.stringify({ skills: { bad: 'string' } }), 'utf8');
        const result = readSkillGovernanceFile(tmpPath);
        expect(result.skills).toEqual({});
      } finally {
        try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      }
    });
  });

  describe('parseSkillFile 边界', () => {
    it('只含 frontmatter 分隔符', () => {
      const result = parseSkillFile('---\n---');
      expect(result.frontmatter).toEqual({});
    });

    it('frontmatter 中空值字段跳过', () => {
      const result = parseSkillFile('---\nname:\nkey: value\n---\nbody');
      expect(result.frontmatter.name).toBeUndefined();
      expect(result.frontmatter.key).toBe('value');
    });

    it('frontmatter 中含注释行', () => {
      const result = parseSkillFile('---\nname: test\n# comment\ntags: [a]\n---\nbody');
      expect(result.frontmatter.name).toBe('test');
      expect(result.frontmatter.tags).toEqual(['a']);
    });
  });
});
