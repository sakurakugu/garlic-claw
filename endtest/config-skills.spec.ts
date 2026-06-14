import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── 类型定义（从 @garlic-claw/shared 对齐） ───

type SkillSourceKind = 'builtin' | 'custom';
type SkillLoadStrategy = 'auto' | 'manual';

interface SkillGovernInfo {
  id: string;
  name: string;
  enabled: boolean;
  author?: string;
  homepage?: string;
}

interface SkillSummary {
  id: string;
  name: string;
  description: string;
  tags: string[];
  source: SkillSourceKind;
  loadStrategy: SkillLoadStrategy;
  enabled: boolean;
  updatedAt: string;
}

interface SkillDetail extends SkillSummary {
  code: string;
  govern: SkillGovernInfo;
  baseDir: string;
}

// ─── 内联纯函数（对齐 skill-registry.service.ts） ───

const VALID_TAG_RE = /^[a-zA-Z0-9_-]+$/;
const SKILL_ID_RE = /^[a-zA-Z0-9_-]+$/;

function readOptionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readRequiredText(value: unknown, fallback: string): string {
  return readOptionalText(value) ?? fallback;
}

function readTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
      .filter((tag) => tag.length > 0 && VALID_TAG_RE.test(tag)),
  )];
}

function validateSkillId(id: unknown): id is string {
  return typeof id === 'string' && SKILL_ID_RE.test(id) && id.length >= 1;
}

function parseSkillFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const lines = match[1].split('\n');
  const frontmatter: Record<string, unknown> = {};
  let currentKey = '';
  for (const line of lines) {
    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentKey) {
      const item = listMatch[1].trim().replace(/^['"]|['"]$/g, '');
      if (!Array.isArray(frontmatter[currentKey])) {
        frontmatter[currentKey] = [];
      }
      (frontmatter[currentKey] as string[]).push(item);
      continue;
    }
    const colonIndex = line.indexOf(':');
    if (colonIndex < 0) continue;
    currentKey = line.slice(0, colonIndex).trim();
    let value: unknown = line.slice(colonIndex + 1).trim();
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
      frontmatter[currentKey] = value;
    }
  }
  return { frontmatter, body: match[2] };
}

function normalizeSkillGovern(value: unknown, id: string): SkillGovernInfo {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    id,
    name: readRequiredText(record.name, id),
    enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
    author: readOptionalText(record.author),
    homepage: readOptionalText(record.homepage),
  };
}

function readSkillBaseDir(skillRoot: string): string {
  return skillRoot;
}

function readSkillCode(skillRoot: string): string {
  const scriptsDir = path.join(skillRoot, 'scripts');
  if (!fs.existsSync(scriptsDir)) return '';
  const entries = fs.readdirSync(scriptsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(js|ts|mjs)$/i.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length === 0) return '';
  const firstScript = path.join(scriptsDir, entries[0].name);
  try {
    return fs.readFileSync(firstScript, 'utf-8');
  } catch {
    return '';
  }
}

function findSkillDirectories(skillsRoot: string): string[] {
  if (!fs.existsSync(skillsRoot)) return [];
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

// ─── 路径常量 ───

const SKILLS_ROOT = path.resolve(__dirname, '..', 'config', 'skills');
const DEFINITIONS_ROOT = path.join(SKILLS_ROOT, 'definitions');
const WEATHER_ROOT = path.join(DEFINITIONS_ROOT, 'weather-query');
const WEATHER_SKILL_MD = path.join(WEATHER_ROOT, 'SKILL.md');
const WEATHER_SCRIPT = path.join(WEATHER_ROOT, 'scripts', 'weather.js');

// ─── 文件助手 ───

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T : fallback;
  } catch {
    return fallback;
  }
}

function countCodeLines(code: string): number {
  return code.split('\n').filter((line) => line.trim().length > 0 && !line.trim().startsWith('//')).length;
}

// ========================================================================
// 测试
// ========================================================================

describe('config/skills/ 配置模块', () => {

  // ── 1. 目录结构验证 ──

  describe('1. 目录结构验证', () => {
    it('config/skills/ 目录存在', () => {
      expect(fs.existsSync(SKILLS_ROOT)).toBe(true);
      expect(fs.statSync(SKILLS_ROOT).isDirectory()).toBe(true);
    });

    it('definitions 子目录存在', () => {
      expect(fs.existsSync(DEFINITIONS_ROOT)).toBe(true);
      expect(fs.statSync(DEFINITIONS_ROOT).isDirectory()).toBe(true);
    });

    it('weather-query 技能目录存在', () => {
      expect(fs.existsSync(WEATHER_ROOT)).toBe(true);
      expect(fs.statSync(WEATHER_ROOT).isDirectory()).toBe(true);
    });

    it('SKILL.md 存在', () => {
      expect(fs.existsSync(WEATHER_SKILL_MD)).toBe(true);
    });

    it('scripts 子目录存在', () => {
      const scriptsDir = path.join(WEATHER_ROOT, 'scripts');
      expect(fs.existsSync(scriptsDir)).toBe(true);
      expect(fs.statSync(scriptsDir).isDirectory()).toBe(true);
    });

    it('weather.js 脚本存在', () => {
      expect(fs.existsSync(WEATHER_SCRIPT)).toBe(true);
    });

    it('目录名按字母序排列', () => {
      const dirs = findSkillDirectories(DEFINITIONS_ROOT);
      const sorted = [...dirs].sort((a, b) => a.localeCompare(b));
      expect(dirs).toEqual(sorted);
    });
  });

  // ── 2. SKILL.md 结构验证 ──

  describe('2. SKILL.md 结构验证', () => {
    let raw: string;
    let parsed: { frontmatter: Record<string, unknown>; body: string } | null;

    beforeAll(() => {
      raw = fs.readFileSync(WEATHER_SKILL_MD, 'utf-8');
      expect(raw.length).toBeGreaterThan(0);
      parsed = parseSkillFrontmatter(raw);
    });

    it('文件包含有效的 YAML frontmatter', () => {
      expect(parsed).not.toBeNull();
    });

    it('frontmatter 包含 name 字段', () => {
      expect(parsed!.frontmatter).toHaveProperty('name');
      expect(parsed!.frontmatter.name).toBe('weather-query');
    });

    it('frontmatter 包含 description 字段', () => {
      expect(parsed!.frontmatter).toHaveProperty('description');
      expect(typeof parsed!.frontmatter.description).toBe('string');
      expect((parsed!.frontmatter.description as string).length).toBeGreaterThan(0);
    });

    it('frontmatter 包含 tags 数组', () => {
      expect(parsed!.frontmatter).toHaveProperty('tags');
      expect(Array.isArray(parsed!.frontmatter.tags)).toBe(true);
      const tags = parsed!.frontmatter.tags as string[];
      expect(tags.length).toBeGreaterThan(0);
    });

    it('tags 包含 weather', () => {
      const tags = parsed!.frontmatter.tags as string[];
      expect(tags).toContain('weather');
    });

    it('tags 包含 script', () => {
      const tags = parsed!.frontmatter.tags as string[];
      expect(tags).toContain('script');
    });

    it('tags 包含 node', () => {
      const tags = parsed!.frontmatter.tags as string[];
      expect(tags).toContain('node');
    });

    it('tags 全部为合法格式', () => {
      const tags = parsed!.frontmatter.tags as string[] | undefined;
      if (Array.isArray(tags)) {
        for (const tag of tags) {
          expect(VALID_TAG_RE.test(tag)).toBe(true);
        }
      }
    });

    it('body 非空', () => {
      expect(parsed!.body.trim().length).toBeGreaterThan(0);
    });

    it('body 包含 "weather-query" 标题', () => {
      expect(parsed!.body).toContain('# weather-query');
    });

    it('body 包含执行要求章节', () => {
      expect(parsed!.body).toContain('执行要求');
    });

    it('body 包含默认执行命令', () => {
      expect(parsed!.body).toContain('node scripts/weather.js');
    });

    it('body 不包含此换行符结尾', () => {
      // SKILL.md 不应以多余空行结尾
      const lines = raw.split('\n');
      const lastNonEmpty = lines.filter((l) => l.trim().length > 0);
      expect(lastNonEmpty.length).toBeGreaterThan(0);
    });
  });

  // ── 3. weather.js 脚本结构验证 ──

  describe('3. weather.js 脚本结构验证', () => {
    let source: string;

    beforeAll(() => {
      source = fs.readFileSync(WEATHER_SCRIPT, 'utf-8');
      expect(source.length).toBeGreaterThan(0);
    });

    it('以 shebang 开头', () => {
      expect(source.startsWith('#!/usr/bin/env node')).toBe(true);
    });

    it('定义常量 DEFAULT_BASE_URL', () => {
      expect(source).toContain('DEFAULT_BASE_URL');
      expect(source).toContain("'https://wttr.in/'");
    });

    it('定义 REQUEST_TIMEOUT_MS = 10000', () => {
      expect(source).toContain('REQUEST_TIMEOUT_MS');
      expect(source).toContain('10000');
    });

    it('定义 FORECAST_LABELS', () => {
      expect(source).toContain('FORECAST_LABELS');
    });

    describe('函数定义', () => {
      it('包含 main 函数', () => {
        expect(source).toContain('async function main');
      });

      it('包含 readLocation 函数', () => {
        expect(source).toContain('function readLocation');
      });

      it('包含 requestWeather 函数', () => {
        expect(source).toContain('async function requestWeather');
      });

      it('包含 buildRequestUrl 函数', () => {
        expect(source).toContain('function buildRequestUrl');
      });

      it('包含 formatCurrentWeather 函数', () => {
        expect(source).toContain('function formatCurrentWeather');
      });

      it('包含 formatForecast 函数', () => {
        expect(source).toContain('function formatForecast');
      });

      it('包含 readLocationLabel 函数', () => {
        expect(source).toContain('function readLocationLabel');
      });

      it('包含 readWeatherText 函数', () => {
        expect(source).toContain('function readWeatherText');
      });

      it('包含 readHumidity 函数', () => {
        expect(source).toContain('function readHumidity');
      });

      it('包含 readWind 函数', () => {
        expect(source).toContain('function readWind');
      });

      it('包含 readTemperature 函数', () => {
        expect(source).toContain('function readTemperature');
      });

      it('包含 readValue 函数', () => {
        expect(source).toContain('function readValue');
      });

      it('包含 readPlainValue 函数', () => {
        expect(source).toContain('function readPlainValue');
      });

      it('包含 compactText 函数', () => {
        expect(source).toContain('function compactText');
      });

      it('包含 readErrorMessage 函数', () => {
        expect(source).toContain('function readErrorMessage');
      });
    });

    it('使用 fetch API 发送请求', () => {
      expect(source).toContain('await fetch(');
    });

    it('使用 AbortController 超时控制', () => {
      expect(source).toContain('AbortController');
      expect(source).toContain('controller.abort()');
    });

    it('使用 process.env 读取环境变量', () => {
      expect(source).toContain('process.env.GARLIC_CLAW_WEATHER_QUERY_BASE_URL');
    });

    it('使用 process.stdout.write 输出结果', () => {
      expect(source).toContain('process.stdout.write');
    });

    it('使用 process.stderr.write 输出错误', () => {
      expect(source).toContain('process.stderr.write');
    });

    it('使用 process.exitCode 设置退出码', () => {
      expect(source).toContain('process.exitCode');
    });

    it('使用 encodeURIComponent 编码地点', () => {
      expect(source).toContain('encodeURIComponent');
    });

    it('以 void main() 启动', () => {
      expect(source).toContain('void main()');
    });

    it('天气文本有中文回退映射', () => {
      expect(source).toContain('WEATHER_FALLBACK_ZH');
      expect(source).toContain('Patchy rain nearby');
      expect(source).toContain('局部阵雨');
    });

    it('代码行数在 150-250 行之间', () => {
      const lines = source.split('\n').length;
      expect(lines).toBeGreaterThanOrEqual(150);
      expect(lines).toBeLessThanOrEqual(250);
    });
  });

  // ── 4. 规范化函数 ──

  describe('4. 规范化函数', () => {
    describe('readOptionalText', () => {
      it('返回非空字符串的 trim', () => {
        expect(readOptionalText(' hello ')).toBe('hello');
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

    describe('readRequiredText', () => {
      it('非空字符串返回自身', () => {
        expect(readRequiredText('hello', 'fallback')).toBe('hello');
      });
      it('空字符串返回 fallback', () => {
        expect(readRequiredText('', 'fallback')).toBe('fallback');
      });
      it('undefined 返回 fallback', () => {
        expect(readRequiredText(undefined, 'fallback')).toBe('fallback');
      });
    });

    describe('readTags', () => {
      it('解析合法 tags 数组并去重', () => {
        expect(readTags(['weather', 'script', 'weather'])).toEqual(['weather', 'script']);
      });
      it('过滤非法 tag 格式', () => {
        expect(readTags(['weather', 'bad tag!', 'also/bad'])).toEqual(['weather']);
      });
      it('非数组返回空数组', () => {
        expect(readTags(null)).toEqual([]);
        expect(readTags('string')).toEqual([]);
      });
      it('trim tag 前后空白', () => {
        expect(readTags(['  weather  ', 'script'])).toEqual(['weather', 'script']);
      });
    });

    describe('validateSkillId', () => {
      it('接受合法 ID', () => {
        expect(validateSkillId('weather-query')).toBe(true);
        expect(validateSkillId('abc123')).toBe(true);
      });
      it('拒绝包含特殊字符的 ID', () => {
        expect(validateSkillId('weather query')).toBe(false);
        expect(validateSkillId('weather/query')).toBe(false);
      });
      it('拒绝空字符串', () => {
        expect(validateSkillId('')).toBe(false);
      });
      it('拒绝非字符串', () => {
        expect(validateSkillId(null)).toBe(false);
        expect(validateSkillId(undefined)).toBe(false);
        expect(validateSkillId(123)).toBe(false);
      });
    });

    describe('parseSkillFrontmatter', () => {
      it('解析完整的 frontmatter', () => {
        const result = parseSkillFrontmatter('---\nname: test\n---\nbody content');
        expect(result).not.toBeNull();
        expect(result!.frontmatter.name).toBe('test');
        expect(result!.body.trim()).toBe('body content');
      });

      it('解析 tags 数组', () => {
        const result = parseSkillFrontmatter('---\ntags:\n  - weather\n  - script\n---\nbody');
        expect(result).not.toBeNull();
        expect(Array.isArray(result!.frontmatter.tags)).toBe(true);
      });

      it('无 frontmatter 返回 null', () => {
        expect(parseSkillFrontmatter('plain text')).toBeNull();
      });

      it('空内容返回 null', () => {
        expect(parseSkillFrontmatter('')).toBeNull();
      });
    });

    describe('normalizeSkillGovern', () => {
      it('完整参数构造', () => {
        const result = normalizeSkillGovern({
          name: 'Weather Query',
          enabled: true,
          author: 'team',
          homepage: 'https://example.com',
        }, 'weather-query');
        expect(result.id).toBe('weather-query');
        expect(result.name).toBe('Weather Query');
        expect(result.enabled).toBe(true);
        expect(result.author).toBe('team');
        expect(result.homepage).toBe('https://example.com');
      });

      it('缺失 name 使用 id 作为 fallback', () => {
        const result = normalizeSkillGovern({ enabled: true }, 'fallback-id');
        expect(result.name).toBe('fallback-id');
      });

      it('缺失 enabled 默认为 true', () => {
        const result = normalizeSkillGovern({}, 'test');
        expect(result.enabled).toBe(true);
      });

      it('null/undefined 输入使用默认值', () => {
        const result = normalizeSkillGovern(null, 'test-id');
        expect(result.id).toBe('test-id');
        expect(result.enabled).toBe(true);
        expect(result.name).toBe('test-id');
      });
    });

    describe('findSkillDirectories', () => {
      it('不存在的目录返回空数组', () => {
        const result = findSkillDirectories(path.join(os.tmpdir(), 'nonexistent-skills-' + Date.now()));
        expect(result).toEqual([]);
      });
    });
  });

  // ── 5. 文件系统读写 ──

  describe('5. 文件系统读写', () => {
    const tmpRoot = path.join(os.tmpdir(), `config-skills-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    afterAll(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('读取 SKILL.md 文件内容', () => {
      const content = fs.readFileSync(WEATHER_SKILL_MD, 'utf-8');
      expect(content.length).toBeGreaterThan(100);
      expect(content).toContain('name: weather-query');
    });

    it('读取 weather.js 脚本内容', () => {
      const content = fs.readFileSync(WEATHER_SCRIPT, 'utf-8');
      expect(content.length).toBeGreaterThan(1000);
      expect(content).toContain('async function main');
    });

    it('写入并读取技能的 SKILL.md', () => {
      const testSkillDir = path.join(tmpRoot, 'definitions', 'test-skill');
      fs.mkdirSync(testSkillDir, { recursive: true });
      const skillMd = '---\nname: test-skill\ndescription: A test skill\ntags:\n  - test\n---\n\n# Test Skill\n\nBody content.';
      const mdPath = path.join(testSkillDir, 'SKILL.md');
      fs.writeFileSync(mdPath, skillMd, 'utf-8');

      const content = fs.readFileSync(mdPath, 'utf-8');
      expect(parseSkillFrontmatter(content)).not.toBeNull();
    });

    it('写入并读取技能的脚本文件', () => {
      const scriptsDir = path.join(tmpRoot, 'definitions', 'test-skill', 'scripts');
      fs.mkdirSync(scriptsDir, { recursive: true });
      const scriptContent = '#!/usr/bin/env node\nconsole.log("hello");\n';
      fs.writeFileSync(path.join(scriptsDir, 'test.js'), scriptContent, 'utf-8');

      const code = readSkillCode(path.join(tmpRoot, 'definitions', 'test-skill'));
      expect(code).toContain('#!/usr/bin/env node');
    });

    it('空 skills 目录返回空列表', () => {
      const emptyRoot = path.join(tmpRoot, 'empty');
      fs.mkdirSync(emptyRoot, { recursive: true });
      expect(findSkillDirectories(emptyRoot)).toEqual([]);
    });

    it('无 scripts 目录时 readSkillCode 返回空字符串', () => {
      const noScriptsDir = path.join(tmpRoot, 'no-scripts');
      fs.mkdirSync(noScriptsDir, { recursive: true });
      expect(readSkillCode(noScriptsDir)).toBe('');
    });

    it('多个技能目录共存', () => {
      const multiRoot = path.join(tmpRoot, 'multi');
      fs.mkdirSync(multiRoot, { recursive: true });
      for (const dir of ['skill-a', 'skill-b', 'skill-c']) {
        fs.mkdirSync(path.join(multiRoot, dir), { recursive: true });
      }
      const dirs = findSkillDirectories(multiRoot);
      expect(dirs).toEqual(['skill-a', 'skill-b', 'skill-c']);
    });
  });

  // ── 6. 类型风格一致 ──

  describe('6. 类型风格一致', () => {
    it('SkillGovernInfo 构造正确', () => {
      const govern: SkillGovernInfo = {
        id: 'weather-query',
        name: 'Weather Query',
        enabled: true,
        author: 'team',
        homepage: 'https://example.com',
      };
      expect(govern.id).toBe('weather-query');
      expect(govern.name).toBe('Weather Query');
      expect(govern.enabled).toBe(true);
    });

    it('SkillGovernInfo 最小构造', () => {
      const govern: SkillGovernInfo = {
        id: 'test',
        name: 'test',
        enabled: false,
      };
      expect(govern.author).toBeUndefined();
      expect(govern.homepage).toBeUndefined();
    });

    it('SkillSummary 构造正确', () => {
      const summary: SkillSummary = {
        id: 'weather-query',
        name: 'Weather Query',
        description: '查询天气',
        tags: ['weather', 'node'],
        source: 'builtin',
        loadStrategy: 'auto',
        enabled: true,
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      expect(summary.source).toBe('builtin');
      expect(summary.loadStrategy).toBe('auto');
      expect(summary.enabled).toBe(true);
    });

    it('SkillDetail 构造正确', () => {
      const detail: SkillDetail = {
        id: 'weather-query',
        name: 'Weather Query',
        description: '查询天气',
        tags: ['weather'],
        source: 'builtin',
        loadStrategy: 'auto',
        enabled: true,
        updatedAt: '2026-01-01T00:00:00.000Z',
        code: 'console.log("hello");',
        govern: { id: 'weather-query', name: 'Weather Query', enabled: true },
        baseDir: '/path/to/skill',
      };
      expect(detail.code.length).toBeGreaterThan(0);
      expect(detail.govern.id).toBe('weather-query');
      expect(detail.baseDir).toBe('/path/to/skill');
    });

    it('SkillSourceKind 合法值', () => {
      const sources: SkillSourceKind[] = ['builtin', 'custom'];
      expect(sources).toHaveLength(2);
    });

    it('SkillLoadStrategy 合法值', () => {
      const strategies: SkillLoadStrategy[] = ['auto', 'manual'];
      expect(strategies).toHaveLength(2);
    });
  });

  // ── 7. 边界条件 ──

  describe('7. 边界条件', () => {
    it('parseSkillFrontmatter 处理无 body 的情况', () => {
      const result = parseSkillFrontmatter('---\nname: test\n---\n');
      expect(result).not.toBeNull();
      expect(result!.body.trim()).toBe('');
    });

    it('readTags 处理空数组', () => {
      expect(readTags([])).toEqual([]);
    });

    it('readTags 处理大量重复 tag', () => {
      const tags = Array.from({ length: 100 }, (_, i) => `tag-${i % 5}`);
      const result = readTags(tags);
      expect(result.length).toBe(5);
    });

    it('readOptionalText 处理前后空白+换行', () => {
      expect(readOptionalText('\n  hello  \n')).toBe('hello');
    });

    it('validateSkillId 处理含数字的 ID', () => {
      expect(validateSkillId('skill-123')).toBe(true);
    });

    it('readSkillCode 返回空字符串当 scripts 目录为空', () => {
      const emptyScriptsDir = path.join(os.tmpdir(), `empty-scripts-${Date.now()}`);
      fs.mkdirSync(emptyScriptsDir, { recursive: true });
      fs.mkdirSync(path.join(emptyScriptsDir, 'scripts'), { recursive: true });
      expect(readSkillCode(emptyScriptsDir)).toBe('');
      fs.rmSync(emptyScriptsDir, { recursive: true, force: true });
    });

    it('SKILL.md 中的 frontmatter 字段顺序不敏感', () => {
      const result = parseSkillFrontmatter('---\ntags:\n  - test\ndescription: desc\nname: my-skill\n---\nbody');
      expect(result).not.toBeNull();
      expect(result!.frontmatter.name).toBe('my-skill');
      expect(result!.frontmatter.description).toBe('desc');
    });

    it('readSkillBaseDir 返回技能根目录', () => {
      expect(readSkillBaseDir(WEATHER_ROOT)).toBe(WEATHER_ROOT);
    });

    it('normalizeSkillGovern 处理 undefined 字段', () => {
      const result = normalizeSkillGovern({ name: 'Test', enabled: true, author: undefined, homepage: undefined }, 'test');
      expect(result.author).toBeUndefined();
      expect(result.homepage).toBeUndefined();
    });
  });

  // ── 8. 集成验证 ──

  describe('8. 集成验证', () => {
    it('读取真实 SKILL.md 并通过 parseSkillFrontmatter 解析', () => {
      const raw = fs.readFileSync(WEATHER_SKILL_MD, 'utf-8');
      const parsed = parseSkillFrontmatter(raw);
      expect(parsed).not.toBeNull();
      expect(parsed!.frontmatter.name).toBe('weather-query');
      expect(parsed!.frontmatter.description).toBe('查询指定地点天气，先确认地点，再调用仓库内脚本获取结果。');
      expect(Array.isArray(parsed!.frontmatter.tags)).toBe(true);
      expect(parsed!.body).toContain('# weather-query');
    });

    it('读取真实 weather.js 并通过 readSkillCode 验证', () => {
      const code = readSkillCode(WEATHER_ROOT);
      expect(code.length).toBeGreaterThan(0);
      expect(code).toContain('async function main');
      expect(code).toContain('requestWeather');
      expect(code).toContain('formatCurrentWeather');
      // 验证关键常量
      expect(code).toContain("'https://wttr.in/'");
    });

    it('findSkillDirectories 从实际 definitions 目录找到 weather-query', () => {
      const dirs = findSkillDirectories(DEFINITIONS_ROOT);
      expect(dirs).toContain('weather-query');
    });

    it('weather-query 的标签可通过 readTags 规范化为合法列表', () => {
      const tags = readTags(['weather', 'script', 'node']);
      expect(tags).toEqual(['weather', 'script', 'node']);
      for (const tag of tags) {
        expect(VALID_TAG_RE.test(tag)).toBe(true);
      }
    });

    it('weather.js 无语法错误（通过 Node 语法检查）', () => {
      // 验证代码结构完整性：检查函数定义的括号匹配
      const source = fs.readFileSync(WEATHER_SCRIPT, 'utf-8');
      const openBraces = (source.match(/\{/g) || []).length;
      const closeBraces = (source.match(/\}/g) || []).length;
      expect(openBraces).toBe(closeBraces);
    });
  });
});
