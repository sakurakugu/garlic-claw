import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { BadRequestException } from '@nestjs/common';

// ─── 内联对齐 runtime-file-tree.ts ───

async function readRuntimeDirectoryEntryNames(absolutePath: string): Promise<string[]> {
  return (await fsPromises.readdir(absolutePath, { withFileTypes: true }))
    .map((entry) => entry.isDirectory() ? `${entry.name}/` : entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function readRuntimePathType(absolutePath: string): Promise<'directory' | 'file' | 'missing'> {
  try {
    return (await fsPromises.stat(absolutePath)).isDirectory() ? 'directory' : 'file';
  } catch (error) {
    if (isRuntimeNotFoundError(error)) return 'missing';
    throw error;
  }
}

function isRuntimeNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function readRuntimeCheckedTextFile(absolutePath: string, displayPath: string): Promise<string> {
  const buffer = await fsPromises.readFile(absolutePath);
  if (containsRuntimeBinarySample(buffer)) {
    throw new BadRequestException(`暂不支持读取二进制文件: ${displayPath}`);
  }
  return buffer.toString('utf8').replace(/\r\n/g, '\n');
}

function containsRuntimeBinarySample(buffer: Buffer): boolean {
  const sampleSize = Math.min(buffer.length, 4096);
  if (sampleSize === 0) return false;
  let nonPrintableCount = 0;
  for (let index = 0; index < sampleSize; index += 1) {
    if (buffer[index] === 0) return true;
    if (buffer[index] < 9 || (buffer[index] > 13 && buffer[index] < 32)) nonPrintableCount += 1;
  }
  return nonPrintableCount / sampleSize > 0.3;
}

// ─── 内联对齐 runtime-text-replace.ts ───

type RuntimeTextReplaceStrategy = 'block-anchor' | 'context-aware' | 'escape-normalized' | 'exact' | 'indentation-flexible' | 'line-ending-normalized' | 'line-trimmed' | 'trailing-whitespace-trimmed' | 'trimmed-boundary' | 'whitespace-normalized';
interface RTReplaceResult { content: string; occurrences: number; strategy: RuntimeTextReplaceStrategy; }
interface RTMatch { candidate: string; line: number; startIndex: number; }
interface RTSource { lines: string[]; starts: number[]; }

const STRATEGIES: RuntimeTextReplaceStrategy[] = ['exact', 'escape-normalized', 'line-ending-normalized', 'trailing-whitespace-trimmed', 'trimmed-boundary', 'indentation-flexible', 'line-trimmed', 'context-aware', 'block-anchor', 'whitespace-normalized'];

function replaceRuntimeText(content: string, oldString: string, newString: string, replaceAll = false): RTReplaceResult {
  if (oldString === newString) throw new BadRequestException('edit.oldString 和 edit.newString 不能完全相同');
  const source = readSource(content);
  for (const strategy of STRATEGIES) {
    const matches = dedupeMatches(readStrategyMatches(strategy, content, oldString, source));
    if (matches.length === 0) continue;
    if (replaceAll) return replaceAllMatches(content, oldString, newString, strategy, matches);
    if (matches.length > 1) throw new BadRequestException(readAmbiguousMessage(strategy, matches, false));
    const match = matches[0], replacement = normalizeReplacement(strategy, match.candidate, oldString, newString);
    return { content: `${content.slice(0, match.startIndex)}${replacement}${content.slice(match.startIndex + match.candidate.length)}`, occurrences: 1, strategy };
  }
  throw new BadRequestException('edit.oldString 未在文件中找到。');
}

function replaceAllMatches(content: string, oldString: string, newString: string, strategy: RuntimeTextReplaceStrategy, matches: RTMatch[]): RTReplaceResult {
  const candidates = [...new Set(matches.map((m) => m.candidate))];
  if (candidates.length > 1) throw new BadRequestException(readAmbiguousMessage(strategy, matches, true));
  const candidate = candidates[0], replacement = normalizeReplacement(strategy, candidate, oldString, newString);
  return { content: content.split(candidate).join(replacement), occurrences: countOccurrences(content, candidate), strategy };
}

function readStrategyMatches(strategy: RuntimeTextReplaceStrategy, content: string, find: string, source: RTSource): RTMatch[] {
  switch (strategy) {
    case 'exact': return readExactMatches(content, find);
    case 'escape-normalized': { const unescaped = unescapeValue(find); return unescaped === find ? [] : readLooseMatches(content, find, source, unescaped, (b) => unescapeValue(b) === unescaped, true); }
    case 'line-ending-normalized': return /[\r\n]/u.test(find) ? readNormalizedMatches(find, source, normalizeLineEndings) : [];
    case 'trailing-whitespace-trimmed': return readNormalizedMatches(find, source, (l) => l.trimEnd(), true);
    case 'trimmed-boundary': { const trimmed = find.trim(); return trimmed === find ? [] : readLooseMatches(content, find, source, trimmed, (b) => b.trim() === trimmed); }
    case 'indentation-flexible': { const lines = splitFindLines(find), normalized = normalizeIndentationBlock(lines.join('\n')); return readWindowMatches(source, find, lines, (b) => normalizeIndentationBlock(b.join('\n')) === normalized); }
    case 'line-trimmed': return readNormalizedMatches(find, source, (l) => l.trim());
    case 'context-aware': return readAnchoredMatches(find, source, true);
    case 'block-anchor': return readAnchoredMatches(find, source, false);
    case 'whitespace-normalized': return readLooseMatches(content, find, source, '', (b) => normalizeWhitespace(b) === normalizeWhitespace(find));
  }
}

function readSource(content: string): RTSource {
  const lines = content.split('\n'), starts: number[] = [];
  let index = 0;
  for (const line of lines) { starts.push(index); index += line.length + 1; }
  return { lines, starts };
}

function readExactMatches(content: string, target: string): RTMatch[] {
  if (!target.length) return [];
  const matches: RTMatch[] = [];
  for (let index = 0; index <= content.length;) {
    const startIndex = content.indexOf(target, index);
    if (startIndex < 0) break;
    matches.push({ candidate: target, line: startIndex <= 0 ? 1 : content.slice(0, startIndex).split('\n').length, startIndex });
    index = startIndex + target.length;
  }
  return matches;
}

function readLooseMatches(content: string, find: string, source: RTSource, exactCandidate: string, matchesBlock: (b: string) => boolean, skipSingleLineBlock = false): RTMatch[] {
  const lines = splitFindLines(find), exactMatches = exactCandidate ? readExactMatches(content, exactCandidate) : [];
  return skipSingleLineBlock && lines.length < 2 ? exactMatches : [...exactMatches, ...readWindowMatches(source, find, lines, (b) => matchesBlock(b.join('\n')))];
}

function readNormalizedMatches(find: string, source: RTSource, normalize: (l: string) => string, skipIfUnchanged = false): RTMatch[] {
  const lines = splitFindLines(find), normalized = lines.map(normalize);
  return skipIfUnchanged && normalized.every((l, i) => l === lines[i]) ? [] : readWindowMatches(source, find, lines, (b) => b.every((l, i) => normalize(l) === normalized[i]));
}

function readWindowMatches(source: RTSource, find: string, findLines: string[], matches: (b: string[], li: number) => boolean): RTMatch[] {
  if (findLines.length === 0 || findLines.length > source.lines.length) return [];
  const result: RTMatch[] = [];
  for (let li = 0; li <= source.lines.length - findLines.length; li += 1) {
    const block = source.lines.slice(li, li + findLines.length);
    if (matches(block, li)) result.push({ candidate: find.endsWith('\n') ? `${block.join('\n')}\n` : block.join('\n'), line: li + 1, startIndex: source.starts[li] ?? 0 });
  }
  return result;
}

function readAnchoredMatches(find: string, source: RTSource, fixedLength: boolean): RTMatch[] {
  const lines = splitFindLines(find);
  if (lines.length < 3) return [];
  const first = lines[0].trim(), last = lines.at(-1)?.trim() ?? '';
  let best = 0.5;
  const matches: RTMatch[] = [];
  for (let start = 0; start < source.lines.length; start += 1) {
    if (source.lines[start].trim() !== first) continue;
    for (let end = start + (fixedLength ? lines.length - 1 : 2); end < source.lines.length; end += 1) {
      if (fixedLength && end > start + lines.length - 1) break;
      if (source.lines[end].trim() !== last) continue;
      const block = source.lines.slice(start, end + 1);
      if (fixedLength && block.length !== lines.length) continue;
      const score = readAnchorSimilarity(block, lines, fixedLength);
      if (score < 0.5) continue;
      const match = { candidate: find.endsWith('\n') ? `${block.join('\n')}\n` : block.join('\n'), line: start + 1, startIndex: source.starts[start] ?? 0 };
      if (score > best + 0.0001) { best = score; matches.length = 0; matches.push(match); } else if (Math.abs(score - best) < 0.0001) { matches.push(match); }
      break;
    }
  }
  return matches;
}

function readAnchorSimilarity(block: string[], find: string[], fixedLength: boolean): number {
  const middle = Math.min(block.length, find.length) - 2;
  if (middle <= 0) return 1;
  let matched = 0, total = 0;
  for (let index = 1; index <= middle; index += 1) {
    const left = block[index].trim(), right = find[index].trim();
    if (fixedLength) { if (!left.length && !right.length) continue; total += 1; if (left === right) matched += 1; continue; }
    const maxLen = Math.max(left.length, right.length);
    total += 1; matched += maxLen === 0 ? 1 : 1 - readLevenshtein(left, right) / maxLen;
  }
  return total === 0 ? 1 : matched / total;
}

function normalizeReplacement(strategy: RuntimeTextReplaceStrategy, candidate: string, target: string, replacement: string): string {
  return normalizeReplacementLineEndings(candidate, strategy === 'indentation-flexible' ? normalizeIndentationReplacement(candidate, target, replacement) : replacement);
}

function normalizeReplacementLineEndings(candidate: string, replacement: string): string {
  const replEndings = Array.from(replacement.matchAll(/\r?\n/g), (m) => m[0]), candEndings = Array.from(candidate.matchAll(/\r?\n/g), (m) => m[0]);
  if (replEndings.length === 0 || candEndings.length === 0) return replacement;
  const preferred = candEndings.filter((e) => e === '\r\n').length * 2 >= candEndings.length ? '\r\n' : '\n';
  const endings = candEndings.length === replEndings.length ? candEndings : Array.from({ length: replEndings.length }, () => preferred);
  return replacement.split(/\r?\n/g).reduce((text, part, i) => i === 0 ? part : `${text}${endings[i - 1]}${part}`, '');
}

function normalizeIndentationReplacement(candidate: string, target: string, replacement: string): string {
  const candIndent = readCommonIndentation(normalizeLineEndings(candidate)), targetIndent = readCommonIndentation(normalizeLineEndings(target));
  if (candIndent === targetIndent) return normalizeLineEndings(replacement);
  return normalizeLineEndings(replacement).split('\n').map((l) => !l.trim().length ? l : !targetIndent.length ? `${candIndent}${l}` : l.startsWith(targetIndent) ? `${candIndent}${l.slice(targetIndent.length)}` : l).join('\n');
}

function normalizeIndentationBlock(value: string): string {
  const indentation = readCommonIndentation(value);
  return indentation ? value.split('\n').map((l) => !l.trim().length ? l : l.startsWith(indentation) ? l.slice(indentation.length) : l).join('\n') : value;
}

function readCommonIndentation(value: string): string {
  const lines = splitFindLines(value).filter((l) => l.trim().length > 0);
  return lines.reduce((common, l) => { const cur = l.match(/^\s*/u)?.[0] ?? ''; return !common.length || cur.length < common.length ? cur : common; }, lines[0]?.match(/^\s*/u)?.[0] ?? '');
}

function readAmbiguousMessage(strategy: RuntimeTextReplaceStrategy, matches: RTMatch[], replaceAll: boolean): string {
  return [`edit.oldString 按 ${strategy} 策略匹配到多个位置。`, `当前命中 ${matches.length} 处：${matches.slice(0, 5).map((m) => `第 ${m.line} 行`).join('、')}${matches.length > 5 ? ' 等' : ''}。`, replaceAll ? 'replaceAll 只允许同一段文本的全量替换' : '请补更多上下文，缩小到唯一位置'].join(' ');
}

function dedupeMatches(matches: RTMatch[]): RTMatch[] {
  const seen = new Set<string>();
  return matches.filter((m) => { const key = `${m.startIndex}:${m.candidate}`; return m.candidate.length > 0 && m.startIndex >= 0 && !seen.has(key) ? (seen.add(key), true) : false; });
}

function countOccurrences(content: string, target: string): number {
  let count = 0, index = 0;
  while (target.length > 0 && index <= content.length) {
    const matched = content.indexOf(target, index);
    if (matched < 0) break;
    count += 1; index = matched + target.length;
  }
  return count;
}

function splitFindLines(find: string): string[] {
  const lines = find.split('\n');
  return lines.length > 0 && lines.at(-1) === '' ? lines.slice(0, -1) : lines;
}
const normalizeWhitespace = (v: string) => v.replace(/\s+/g, ' ').trim();
const normalizeLineEndings = (v: string) => v.replace(/\r\n/g, '\n').replace(/\r/g, '');
const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\'': '\'', '"': '"', '`': '`', '\\': '\\', '\n': '\n', $: '$' };
function unescapeValue(value: string): string {
  return value.replace(/\\u([0-9A-Fa-f]{4})|\\x([0-9A-Fa-f]{2})|\\(n|t|r|'|"|`|\\|\n|\$)/g, (_, uh, bh, t) => uh ? String.fromCodePoint(Number.parseInt(uh, 16)) : bh ? String.fromCodePoint(Number.parseInt(bh, 16)) : ESCAPES[t] ?? _);
}
function readLevenshtein(left: string, right: string): number {
  if (!left.length || !right.length) return Math.max(left.length, right.length);
  const matrix = Array.from({ length: left.length + 1 }, (_, r) => Array.from({ length: right.length + 1 }, (_, c) => r === 0 ? c : c === 0 ? r : 0));
  for (let r = 1; r <= left.length; r += 1) for (let c = 1; c <= right.length; c += 1) matrix[r][c] = Math.min(matrix[r - 1][c] + 1, matrix[r][c - 1] + 1, matrix[r - 1][c - 1] + (left[r - 1] === right[c - 1] ? 0 : 1));
  return matrix[left.length][right.length];
}

// ─── 内联 file entry 收集 ───

interface FTEntry { absolutePath: string; relativePath: string; }

async function collectFileTreeEntries(input: {
  absolutePath: string;
  files: FTEntry[];
  logicalPath: string;
  visitedDirectories: Set<string>;
  projectRoot: string;
}): Promise<void> {
  try {
    const stat = await fsPromises.stat(input.absolutePath);
    if (!stat.isDirectory()) {
      const relativePath = toProjectRelativePath(input.projectRoot, input.absolutePath);
      input.files.push({ absolutePath: input.absolutePath, relativePath });
      return;
    }
  } catch { return; }
  const entries = await fsPromises.readdir(input.absolutePath, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
  for (const entry of entries) {
    const childAbsolute = path.join(input.absolutePath, entry.name);
    const childRelative = toProjectRelativePath(input.projectRoot, childAbsolute);
    if (entry.isDirectory()) {
      if (input.visitedDirectories.has(childAbsolute)) continue;
      input.visitedDirectories.add(childAbsolute);
      await collectFileTreeEntries({ ...input, absolutePath: childAbsolute, logicalPath: childRelative });
    } else {
      input.files.push({ absolutePath: childAbsolute, relativePath: childRelative });
    }
  }
}

function toProjectRelativePath(projectRoot: string, absolutePath: string): string {
  const r = path.relative(projectRoot, absolutePath);
  return r ? r.replace(/\\/g, '/') : '.';
}

// ========================================================================

describe('execution/project/ 模块 — ProjectWorktreeFileService', () => {
  let tempRoot: string;
  let projectRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-worktree-file-'));
    projectRoot = path.join(tempRoot, 'repo');
    fs.mkdirSync(path.join(projectRoot, 'packages', 'server'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(projectRoot, 'packages', 'server', 'package.json'), '{}', 'utf8');
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { force: true, recursive: true });
  });

  // ── 路径解析 ──

  describe('路径解析', () => {
    it('解析存在的文件路径', async () => {
      const dir = path.join(projectRoot, 'src');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'demo.ts'), 'export const a = 1;\n', 'utf8');

      expect(await readRuntimePathType(path.join(projectRoot, 'src', 'demo.ts'))).toBe('file');
    });

    it('解析目录路径', async () => {
      fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
      expect(await readRuntimePathType(path.join(projectRoot, 'src'))).toBe('directory');
    });

    it('不存在的路径返回 missing', async () => {
      expect(await readRuntimePathType(path.join(projectRoot, 'nonexistent.ts'))).toBe('missing');
    });
  });

  // ── 目录读取 ──

  describe('目录读取', () => {
    it('读取目录条目', async () => {
      fs.mkdirSync(path.join(projectRoot, 'lib'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'lib', 'a.ts'), '', 'utf8');
      fs.writeFileSync(path.join(projectRoot, 'lib', 'b.ts'), '', 'utf8');

      const entries = await readRuntimeDirectoryEntryNames(path.join(projectRoot, 'lib'));
      expect(entries).toEqual(['a.ts', 'b.ts']);
    });

    it('目录条目按字母序排列', async () => {
      fs.mkdirSync(path.join(projectRoot, 'lib'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'lib', 'z.ts'), '', 'utf8');
      fs.writeFileSync(path.join(projectRoot, 'lib', 'a.ts'), '', 'utf8');
      fs.writeFileSync(path.join(projectRoot, 'lib', 'm.ts'), '', 'utf8');

      const entries = await readRuntimeDirectoryEntryNames(path.join(projectRoot, 'lib'));
      expect(entries).toEqual(['a.ts', 'm.ts', 'z.ts']);
    });

    it('目录条目中目录名称后追加斜杠', async () => {
      fs.mkdirSync(path.join(projectRoot, 'lib', 'sub'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'lib', 'f.ts'), '', 'utf8');

      const entries = await readRuntimeDirectoryEntryNames(path.join(projectRoot, 'lib'));
      expect(entries).toEqual(['f.ts', 'sub/']);
    });
  });

  // ── 文件读取 ──

  describe('文件读取', () => {
    it('读取文本文件', async () => {
      const filePath = path.join(projectRoot, 'hello.txt');
      fs.writeFileSync(filePath, 'Hello, World!\n', 'utf8');

      const content = await readRuntimeCheckedTextFile(filePath, 'hello.txt');
      expect(content).toBe('Hello, World!\n');
    });

    it('拒绝二进制文件', async () => {
      const filePath = path.join(projectRoot, 'binary.bin');
      fs.writeFileSync(filePath, Buffer.from([0, 1, 2, 3, 4]));

      await expect(readRuntimeCheckedTextFile(filePath, 'binary.bin')).rejects.toThrow(BadRequestException);
    });

    it('将 CRLF 转换为 LF', async () => {
      const filePath = path.join(projectRoot, 'crlf.txt');
      fs.writeFileSync(filePath, 'line1\r\nline2\r\n', 'utf8');

      const content = await readRuntimeCheckedTextFile(filePath, 'crlf.txt');
      expect(content).toBe('line1\nline2\n');
    });
  });

  // ── 文件写入 ──

  describe('文件写入', () => {
    it('写入新文件', async () => {
      const filePath = path.join(projectRoot, 'new-file.ts');
      await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
      await fsPromises.writeFile(filePath, 'export const value = 1;\n', 'utf8');

      expect(fs.readFileSync(filePath, 'utf8')).toBe('export const value = 1;\n');
    });

    it('递归创建目录', async () => {
      const filePath = path.join(projectRoot, 'deep', 'nested', 'file.ts');
      await fsPromises.mkdir(path.dirname(filePath), { recursive: true });
      await fsPromises.writeFile(filePath, 'content', 'utf8');

      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('覆盖已有文件', async () => {
      const filePath = path.join(projectRoot, 'overwrite.txt');
      fs.writeFileSync(filePath, 'old content', 'utf8');
      await fsPromises.writeFile(filePath, 'new content', 'utf8');

      expect(fs.readFileSync(filePath, 'utf8')).toBe('new content');
    });
  });

  // ── 文件编辑（文本替换） ──

  describe('文件编辑（文本替换）', () => {
    it('精确替换', () => {
      const result = replaceRuntimeText('hello world', 'world', 'there');
      expect(result.content).toBe('hello there');
      expect(result.occurrences).toBe(1);
    });

    it('replaceAll 替换所有匹配', () => {
      const result = replaceRuntimeText('a b a c a', 'a', 'x', true);
      expect(result.content).toBe('x b x c x');
      expect(result.occurrences).toBe(3);
    });

    it('拒绝 oldString === newString', () => {
      expect(() => replaceRuntimeText('content', 'same', 'same')).toThrow(BadRequestException);
    });

    it('替换多行文本', () => {
      const result = replaceRuntimeText('line1\nline2\nline3\n', 'line1\nline2', 'new');
      expect(result.content).toBe('new\nline3\n');
      expect(result.occurrences).toBe(1);
    });

    it('找不到时抛出错误', () => {
      expect(() => replaceRuntimeText('hello', 'world')).toThrow(BadRequestException);
    });

    it('行末空白容忍替换', () => {
      const result = replaceRuntimeText('hello   \nworld', 'hello\nworld', 'hi\nearth');
      expect(result.content).toBe('hi\nearth');
      expect(result.occurrences).toBe(1);
    });

    it('CRLF 标准化替换', () => {
      const result = replaceRuntimeText('hello\r\nworld', 'hello\nworld', 'hi\nearth');
      expect(result.content).toMatch(/^hi\r\nearth/);
    });
  });

  // ── 文件列表 ──

  describe('文件列表', () => {
    it('列出目录下所有文件', async () => {
      fs.mkdirSync(path.join(projectRoot, 'src', 'nested'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'src', 'a.ts'), 'a\n', 'utf8');
      fs.writeFileSync(path.join(projectRoot, 'src', 'nested', 'b.ts'), 'b\n', 'utf8');

      const files: FTEntry[] = [];
      await collectFileTreeEntries({
        absolutePath: path.join(projectRoot, 'src'),
        files,
        logicalPath: 'src',
        visitedDirectories: new Set<string>(),
        projectRoot,
      });

      files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
      expect(files.map((f) => f.relativePath)).toEqual(['src/a.ts', 'src/nested/b.ts']);
    });

    it('单文件路径直接返回', async () => {
      fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'src', 'single.ts'), 'content\n', 'utf8');

      const files: FTEntry[] = [];
      await collectFileTreeEntries({
        absolutePath: path.join(projectRoot, 'src', 'single.ts'),
        files,
        logicalPath: 'src/single.ts',
        visitedDirectories: new Set<string>(),
        projectRoot,
      });

      expect(files.map((f) => f.relativePath)).toEqual(['src/single.ts']);
    });

    it('空目录返回空列表', async () => {
      fs.mkdirSync(path.join(projectRoot, 'empty-dir'), { recursive: true });

      const files: FTEntry[] = [];
      await collectFileTreeEntries({
        absolutePath: path.join(projectRoot, 'empty-dir'),
        files,
        logicalPath: 'empty-dir',
        visitedDirectories: new Set<string>(),
        projectRoot,
      });

      expect(files).toEqual([]);
    });
  });

  // ── 二进制检测 ──

  describe('二进制检测', () => {
    it('空缓冲区不被识别为二进制', () => {
      expect(containsRuntimeBinarySample(Buffer.alloc(0))).toBe(false);
    });

    it('含 null 字节的缓冲区被识别为二进制', () => {
      expect(containsRuntimeBinarySample(Buffer.from([104, 101, 0, 108, 108, 111]))).toBe(true);
    });

    it('普通文本不被识别为二进制', () => {
      expect(containsRuntimeBinarySample(Buffer.from('hello world\n123\n', 'utf8'))).toBe(false);
    });

    it('大量不可打印字符被识别为二进制', () => {
      const buf = Buffer.alloc(100);
      for (let i = 0; i < 50; i++) buf[i] = 3;
      for (let i = 50; i < 100; i++) buf[i] = 65;
      expect(containsRuntimeBinarySample(buf)).toBe(true);
    });
  });
});
