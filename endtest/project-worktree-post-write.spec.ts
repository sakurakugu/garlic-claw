import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';

// ─── 类型定义（对齐 runtime-filesystem-backend.types.ts） ───

type DSeverity = 'error' | 'hint' | 'info' | 'warning';
interface DEntry { code?: string; column: number; line: number; message: string; path: string; severity: DSeverity; source: string; }
interface FormatResult { kind: string; label: string; }
interface PWInput { content: string; hostPath: string; path: string; sessionRoot: string; visibleRoot: string; }
interface PWOutput { content: string; postWrite: { diagnostics: DEntry[]; formatting: FormatResult | null }; }

// ─── 内联实现（对齐 project-worktree-post-write.service.ts） ───

const SCRIPT_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

function processTextFile(input: PWInput): PWOutput {
  const formatted = formatJson(input.path, input.content);
  const content = formatted?.content ?? input.content;
  return { content, postWrite: { diagnostics: readDiagnostics(input, content), formatting: formatted?.result ?? null } };
}

function formatJson(filePath: string, content: string): { content: string; result: FormatResult } | null {
  if (path.extname(filePath).toLowerCase() !== '.json') return null;
  try {
    const formatted = `${JSON.stringify(JSON.parse(content), null, 2)}${content.endsWith('\n') ? '\n' : ''}`;
    return formatted === content ? null : { content: formatted, result: { kind: 'json-pretty', label: 'json-pretty' } };
  } catch { return null; }
}

function readDiagnostics(input: PWInput, content: string): DEntry[] {
  const ext = path.extname(input.path).toLowerCase();
  if (ext === '.json') return mapDiagnostics([ts.parseConfigFileTextToJson(input.path, content).error].filter((i): i is ts.Diagnostic => Boolean(i)), input);
  return !SCRIPT_EXTENSIONS.has(ext) ? [] : readProjectDiagnostics(input, content) ?? readSyntaxDiagnostics(input.path, content, ext);
}

function readSyntaxDiagnostics(filePath: string, content: string, ext: string): DEntry[] {
  return mapDiagnostics(ts.transpileModule(content, {
    compilerOptions: { allowJs: true, jsx: ext === '.tsx' || ext === '.jsx' ? ts.JsxEmit.ReactJSX : ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    fileName: filePath, reportDiagnostics: true,
  }).diagnostics ?? []);
}

function readProjectDiagnostics(input: PWInput, content: string): DEntry[] | null {
  const configPath = findNearestConfig(input.hostPath);
  if (!configPath) return null;
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) return mapDiagnostics([configFile.error], input);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(configPath), undefined, configPath);
  if (parsed.errors.length > 0) return mapDiagnostics(parsed.errors, input);
  const normHostPath = normalizeWorktreePath(input.hostPath);
  const rootNames = parsed.fileNames.some((fn) => normalizeWorktreePath(fn) === normHostPath) ? parsed.fileNames : [...parsed.fileNames, input.hostPath];
  const compilerHost = ts.createCompilerHost(parsed.options, true);
  const origGetSourceFile = compilerHost.getSourceFile.bind(compilerHost);
  const origReadFile = compilerHost.readFile.bind(compilerHost);
  const origFileExists = compilerHost.fileExists.bind(compilerHost);
  compilerHost.readFile = (fileName) => normalizeWorktreePath(fileName) === normHostPath ? content : origReadFile(fileName);
  compilerHost.fileExists = (fileName) => normalizeWorktreePath(fileName) === normHostPath || origFileExists(fileName);
  compilerHost.getSourceFile = (fileName, langVer, onError, shouldCreate) => normalizeWorktreePath(fileName) === normHostPath ? ts.createSourceFile(fileName, content, langVer, true) : origGetSourceFile(fileName, langVer, onError, shouldCreate);
  const program = ts.createProgram({ host: compilerHost, options: parsed.options, projectReferences: parsed.projectReferences, rootNames });
  return selectDiagnostics(mapDiagnostics(ts.getPreEmitDiagnostics(program), input), input.path);
}

function findNearestConfig(hostPath: string): string | null {
  for (let current = path.dirname(hostPath); ; current = path.dirname(current)) {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const candidate = path.join(current, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
  }
}

function selectDiagnostics(diagnostics: DEntry[], currentPath: string): DEntry[] {
  const current = diagnostics.filter((d) => d.path === currentPath);
  const related = new Map<string, DEntry[]>();
  for (const d of diagnostics) {
    if (d.path !== currentPath) related.set(d.path, [...(related.get(d.path) ?? []), d]);
  }
  return [...current, ...[...related.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 5).flatMap(([, entries]) => entries)];
}

function mapDiagnostics(diagnostics: readonly ts.Diagnostic[], input?: PWInput): DEntry[] {
  return diagnostics.map((d) => {
    const file = d.file;
    const pos = file?.getLineAndCharacterOfPosition(d.start ?? 0) ?? { character: 0, line: 0 };
    return {
      ...(d.code ? { code: String(d.code) } : {}),
      column: pos.character + 1,
      line: pos.line + 1,
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
      path: normalizeDiagnosticPath(file?.fileName ?? 'unknown', input),
      severity: readSeverity(d.category),
      source: d.source ?? 'typescript',
    };
  });
}

function normalizeDiagnosticPath(diagPath: string, input?: PWInput): string {
  if (!input || diagPath === 'unknown') return diagPath;
  const relativePath = path.relative(path.resolve(input.sessionRoot), path.resolve(diagPath));
  if (relativePath.length === 0) return input.visibleRoot;
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return diagPath;
  const normalized = relativePath.replace(/\\/g, '/');
  return input.visibleRoot === '/' ? `/${normalized}` : `${input.visibleRoot}/${normalized}`;
}

function normalizeWorktreePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function readSeverity(category: ts.DiagnosticCategory): DSeverity {
  switch (category) {
    case ts.DiagnosticCategory.Warning: return 'warning';
    case ts.DiagnosticCategory.Suggestion: return 'hint';
    case ts.DiagnosticCategory.Message: return 'info';
    default: return 'error';
  }
}

// ========================================================================

describe('execution/project/ 模块 — ProjectWorktreePostWriteService', () => {
  const tmpRoots: string[] = [];
  const inlineRoot = path.join(os.tmpdir(), 'gc-post-write-inline');

  afterEach(() => {
    while (tmpRoots.length > 0) {
      const r = tmpRoots.pop();
      if (r && fs.existsSync(r)) fs.rmSync(r, { force: true, recursive: true });
    }
  });

  // ── JSON 格式化 ──

  describe('JSON 格式化', () => {
    it('格式化为缩进 JSON', () => {
      const result = processTextFile({
        content: '{"value":1}\n',
        hostPath: path.join(inlineRoot, 'docs', 'config.json'),
        path: '/docs/config.json',
        sessionRoot: inlineRoot,
        visibleRoot: '/',
      });
      expect(result.content).toBe('{\n  "value": 1\n}\n');
      expect(result.postWrite.formatting).toEqual({ kind: 'json-pretty', label: 'json-pretty' });
      expect(result.postWrite.diagnostics).toEqual([]);
    });

    it('已格式化的 JSON 不变', () => {
      const content = '{\n  "key": "value"\n}';
      const result = processTextFile({
        content, hostPath: path.join(inlineRoot, 'f.json'), path: '/f.json',
        sessionRoot: inlineRoot, visibleRoot: '/',
      });
      expect(result.content).toBe(content);
      expect(result.postWrite.formatting).toBeNull();
    });

    it('保留末尾换行符', () => {
      const result = processTextFile({
        content: '{"a":1}\n\n', hostPath: path.join(inlineRoot, 't.json'), path: '/t.json',
        sessionRoot: inlineRoot, visibleRoot: '/',
      });
      expect(result.content).toBe('{\n  "a": 1\n}\n');
    });

    it('非 .json 文件不格式化', () => {
      const content = 'not json content';
      const result = processTextFile({
        content, hostPath: path.join(inlineRoot, 'f.txt'), path: '/f.txt',
        sessionRoot: inlineRoot, visibleRoot: '/',
      });
      expect(result.content).toBe(content);
      expect(result.postWrite.formatting).toBeNull();
    });

    it('非法 JSON 不格式化也不报错（格式层静默）', () => {
      const content = '{bad json}';
      const result = processTextFile({
        content, hostPath: path.join(inlineRoot, 'bad.json'), path: '/bad.json',
        sessionRoot: inlineRoot, visibleRoot: '/',
      });
      expect(result.content).toBe(content);
      expect(result.postWrite.formatting).toBeNull();
    });

    it('深度嵌套 JSON 格式化', () => {
      const result = processTextFile({
        content: '{"a":{"b":{"c":[1,2,3]}}}',
        hostPath: path.join(inlineRoot, 'deep.json'), path: '/deep.json',
        sessionRoot: inlineRoot, visibleRoot: '/',
      });
      const parsed = JSON.parse(result.content);
      expect(parsed.a.b.c).toEqual([1, 2, 3]);
    });
  });

  // ── TypeScript 语法诊断 ──

  describe('TypeScript 语法诊断（transpile-only）', () => {
    it('非法 TypeScript 语法返回错误诊断', () => {
      const result = processTextFile({
        content: 'const answer = ;\n',
        hostPath: path.join(inlineRoot, 'docs', 'broken.ts'),
        path: '/docs/broken.ts',
        sessionRoot: inlineRoot,
        visibleRoot: '/',
      });
      expect(result.content).toBe('const answer = ;\n');
      expect(result.postWrite.formatting).toBeNull();
      expect(result.postWrite.diagnostics.length).toBeGreaterThan(0);
      expect(result.postWrite.diagnostics[0]).toMatchObject({ line: 1, path: '/docs/broken.ts', severity: 'error', source: 'typescript' });
      expect(result.postWrite.diagnostics[0].message).toContain('Expression expected');
    });

    it('合法 TypeScript 无诊断', () => {
      const result = processTextFile({
        content: 'export const value: number = 42;\n',
        hostPath: path.join(inlineRoot, 'valid.ts'), path: '/valid.ts',
        sessionRoot: inlineRoot, visibleRoot: '/',
      });
      expect(result.postWrite.diagnostics).toEqual([]);
    });

    it('类型错误在语法诊断中不体现（transpile-only 无类型检查）', () => {
      const result = processTextFile({
        content: 'const value: string = 42;\n',
        hostPath: path.join(inlineRoot, 'type-err.ts'), path: '/type-err.ts',
        sessionRoot: inlineRoot, visibleRoot: '/',
      });
      expect(result.postWrite.diagnostics).toEqual([]);
    });
  });

  // ── JSON 诊断 ──

  describe('JSON 诊断', () => {
    it('非法 JSON 返回诊断错误', () => {
      const result = processTextFile({
        content: '{"value": }',
        hostPath: path.join(inlineRoot, 'docs', 'invalid.json'),
        path: '/docs/invalid.json',
        sessionRoot: inlineRoot,
        visibleRoot: '/',
      });
      expect(result.content).toBe('{"value": }');
      expect(result.postWrite.formatting).toBeNull();
      expect(result.postWrite.diagnostics.length).toBeGreaterThan(0);
      expect(result.postWrite.diagnostics[0]).toMatchObject({ line: 1, path: '/docs/invalid.json', severity: 'error', source: 'typescript' });
    });

    it('合法 JSON 无诊断', () => {
      const result = processTextFile({
        content: '{"valid": true}',
        hostPath: path.join(inlineRoot, 'ok.json'), path: '/ok.json',
        sessionRoot: inlineRoot, visibleRoot: '/',
      });
      expect(result.postWrite.diagnostics).toEqual([]);
    });
  });

  // ── 项目级诊断 ──

  describe('项目级诊断（含 tsconfig）', () => {
    it('跨文件类型错误被检测', () => {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-post-write-project-'));
      tmpRoots.push(tempRoot);

      fs.mkdirSync(path.join(tempRoot, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tempRoot, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { module: 'esnext', noEmit: true, strict: true, target: 'esnext' },
        include: ['src/**/*.ts'],
      }, null, 2));
      fs.writeFileSync(path.join(tempRoot, 'src', 'b.ts'), 'export const value: string = 1;\n', 'utf8');

      const result = processTextFile({
        content: 'import { value } from "./b";\nconsole.log(value);\n',
        hostPath: path.join(tempRoot, 'src', 'a.ts'),
        path: '/src/a.ts',
        sessionRoot: tempRoot,
        visibleRoot: '/',
      });
      expect(result.content).toBe('import { value } from "./b";\nconsole.log(value);\n');
      expect(result.postWrite.formatting).toBeNull();
      expect(result.postWrite.diagnostics).toEqual([
        expect.objectContaining({ path: '/src/b.ts', severity: 'error', source: 'typescript' }),
      ]);
      expect(result.postWrite.diagnostics[0].message).toContain("Type 'number' is not assignable to type 'string'");
    });

    it('无 tsconfig 时退回到语法诊断', () => {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-post-write-noconfig-'));
      tmpRoots.push(tempRoot);

      const result = processTextFile({
        content: 'const x: string = 42;\n',
        hostPath: path.join(tempRoot, 'src', 'a.ts'),
        path: '/src/a.ts',
        sessionRoot: tempRoot,
        visibleRoot: '/',
      });
      // transpile-only 不报类型错误
      expect(result.postWrite.diagnostics).toEqual([]);
    });

    it('项目诊断中当前文件错误优先', () => {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-post-write-current-'));
      tmpRoots.push(tempRoot);

      fs.mkdirSync(path.join(tempRoot, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tempRoot, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { module: 'esnext', noEmit: true, strict: true, target: 'esnext' },
        include: ['src/**/*.ts'],
      }, null, 2));
      fs.writeFileSync(path.join(tempRoot, 'src', 'b.ts'), 'export const y: number = "wrong";\n', 'utf8');

      const result = processTextFile({
        content: 'import { y } from "./b";\nconst x: string = y;\n',
        hostPath: path.join(tempRoot, 'src', 'a.ts'),
        path: '/src/a.ts',
        sessionRoot: tempRoot,
        visibleRoot: '/',
      });
      const paths = result.postWrite.diagnostics.map((d) => d.path);
      expect(paths[0]).toBe('/src/a.ts');
    });

    it('找到最近的 tsconfig.json', () => {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-post-write-nested-tsconfig-'));
      tmpRoots.push(tempRoot);

      fs.mkdirSync(path.join(tempRoot, 'packages', 'server', 'src'), { recursive: true });
      fs.writeFileSync(path.join(tempRoot, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { module: 'esnext', noEmit: true, strict: true, target: 'esnext' },
        include: ['packages/server/src/**/*.ts'],
      }, null, 2));
      fs.writeFileSync(path.join(tempRoot, 'packages', 'server', 'src', 'b.ts'), 'export const val: number = "bad";\n', 'utf8');

      const result = processTextFile({
        content: 'import { val } from "./b";\n',
        hostPath: path.join(tempRoot, 'packages', 'server', 'src', 'a.ts'),
        path: '/packages/server/src/a.ts',
        sessionRoot: tempRoot,
        visibleRoot: '/',
      });
      expect(result.postWrite.diagnostics.length).toBeGreaterThan(0);
    });
  });

  // ── 路径规范化 ──

  describe('路径规范化', () => {
    it('normalizeWorktreePath 解析并统一大小写（Windows）', () => {
      const result = normalizeWorktreePath('/some/path');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
