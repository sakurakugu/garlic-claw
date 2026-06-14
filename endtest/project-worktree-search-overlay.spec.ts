import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ─── 内联对齐 runtime-search-result-report.ts ───

function readRuntimeSearchSuggestedReadPath(
  matches: Array<string | { virtualPath: string }>,
): string | undefined {
  const candidates = [...matches.reduce((map, match) => {
    const virtualPath = typeof match === 'string' ? match : match.virtualPath;
    if (!virtualPath) return map;
    const existing = map.get(virtualPath);
    if (existing) { existing.hits += 1; return map; }
    map.set(virtualPath, {
      depth: virtualPath.replace(/\\/g, '/').split('/').filter(Boolean).length,
      hits: 1,
      path: virtualPath,
    });
    return map;
  }, new Map<string, { depth: number; hits: number; path: string }>()).values()];
  candidates.sort((left, right) => (
    right.hits - left.hits
    || left.depth - right.depth
    || left.path.length - right.path.length
    || left.path.localeCompare(right.path)
  ));
  return candidates[0]?.path;
}

// ─── 内联对齐 project-worktree-root.service.ts ───

function findRoot(startPath: string): string | null {
  let currentPath = path.resolve(startPath);
  while (true) {
    if (
      fs.existsSync(path.join(currentPath, 'package.json'))
      && fs.existsSync(path.join(currentPath, 'packages', 'server', 'package.json'))
    ) {
      return currentPath;
    }
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) return null;
    currentPath = parentPath;
  }
}

// ─── 内联对齐 host-path.ts ───

function toHostPath(sessionRoot: string, virtualRoot: string, virtualPath: string): string {
  const relativePath = virtualRoot === '/'
    ? virtualPath.replace(/^\/+/, '')
    : virtualPath === virtualRoot ? '' : virtualPath.slice(virtualRoot.length + 1);
  return relativePath ? path.join(sessionRoot, ...relativePath.split('/')) : sessionRoot;
}

// ─── 内联归一化 ───

function normalizeProjectRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  return normalized.length > 0 ? normalized : '.';
}

// ─── 内联 overlay 构建（对齐 ProjectWorktreeSearchOverlayService） ───

async function buildSearchOverlay(input: {
  basePath: string;
  matches?: Array<string | { virtualPath: string }>;
  sessionId: string;
  sessionRoot: string;
  visibleRoot: string;
}): Promise<string[]> {
  const overlay: string[] = [];
  const baseOverlay = await renderOverlay(input.sessionRoot, input.visibleRoot, input.basePath, 'Project Base');
  if (baseOverlay) overlay.push(baseOverlay);
  const suggestedReadPath = readRuntimeSearchSuggestedReadPath(input.matches ?? []);
  if (suggestedReadPath) {
    const readOverlay = await renderOverlay(input.sessionRoot, input.visibleRoot, suggestedReadPath, 'Project Next Read');
    if (readOverlay) overlay.push(readOverlay);
  }
  return overlay;
}

async function renderOverlay(
  sessionRoot: string,
  visibleRoot: string,
  virtualPath: string,
  label: 'Project Base' | 'Project Next Read',
): Promise<string | undefined> {
  const hostPath = toHostPath(sessionRoot, visibleRoot, virtualPath);
  const projectRoot = findRoot(hostPath);
  if (!projectRoot) return undefined;
  const relativePath = normalizeProjectRelativePath(path.relative(projectRoot, hostPath));
  return `${label}: ${relativePath}`;
}

// ─── 创建 session 环境 ───

async function createSessionEnvironment(
  workspaceRoot: string,
  sessionId: string,
): Promise<{ sessionRoot: string; visibleRoot: string }> {
  const sessionRoot = path.join(workspaceRoot, encodeURIComponent(sessionId));
  await fs.promises.mkdir(sessionRoot, { recursive: true });
  return { sessionRoot, visibleRoot: '/' };
}

// ========================================================================

describe('execution/project/ 模块 — ProjectWorktreeSearchOverlayService', () => {
  const runtimeWorkspaceRoots: string[] = [];
  const originalWorkspaceRoot = process.env.GARLIC_CLAW_RUNTIME_WORKSPACES_PATH;

  afterEach(() => {
    if (originalWorkspaceRoot === undefined) {
      delete process.env.GARLIC_CLAW_RUNTIME_WORKSPACES_PATH;
    } else {
      process.env.GARLIC_CLAW_RUNTIME_WORKSPACES_PATH = originalWorkspaceRoot;
    }
    while (runtimeWorkspaceRoots.length > 0) {
      const r = runtimeWorkspaceRoots.pop();
      if (r && fs.existsSync(r)) fs.rmSync(r, { force: true, recursive: true });
    }
  });

  // ── Overlay 渲染 ──

  describe('Overlay 渲染', () => {
    it('在项目 worktree 中返回 base 和 next-read overlay', async () => {
      const runtimeWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-overlay-test-'));
      runtimeWorkspaceRoots.push(runtimeWorkspaceRoot);
      process.env.GARLIC_CLAW_RUNTIME_WORKSPACES_PATH = runtimeWorkspaceRoot;

      const env = await createSessionEnvironment(runtimeWorkspaceRoot, 'session-test-1');

      // 创建项目结构
      fs.mkdirSync(path.join(env.sessionRoot, 'packages', 'server'), { recursive: true });
      fs.writeFileSync(path.join(env.sessionRoot, 'package.json'), '{}', 'utf8');
      fs.writeFileSync(path.join(env.sessionRoot, 'packages', 'server', 'package.json'), '{}', 'utf8');

      const result = await buildSearchOverlay({
        basePath: '/packages/server/src',
        matches: [
          '/packages/server/src/internal/deep-demo.ts',
          '/packages/server/src/demo.ts',
        ],
        sessionId: 'session-test-1',
        sessionRoot: env.sessionRoot,
        visibleRoot: env.visibleRoot,
      });

      expect(result).toEqual([
        'Project Base: packages/server/src',
        'Project Next Read: packages/server/src/demo.ts',
      ]);
    });

    it('非项目 worktree 返回空 overlay', async () => {
      const runtimeWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-overlay-no-project-'));
      runtimeWorkspaceRoots.push(runtimeWorkspaceRoot);
      process.env.GARLIC_CLAW_RUNTIME_WORKSPACES_PATH = runtimeWorkspaceRoot;

      const env = await createSessionEnvironment(runtimeWorkspaceRoot, 'session-no-project');
      fs.mkdirSync(path.join(env.sessionRoot, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(env.sessionRoot, 'docs', 'README.md'), '# Docs\n', 'utf8');

      const result = await buildSearchOverlay({
        basePath: '/docs',
        matches: ['/docs/README.md'],
        sessionId: 'session-no-project',
        sessionRoot: env.sessionRoot,
        visibleRoot: env.visibleRoot,
      });

      expect(result).toEqual([]);
    });

    it('没有 matches 时只返回 base overlay', async () => {
      const runtimeWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-overlay-no-matches-'));
      runtimeWorkspaceRoots.push(runtimeWorkspaceRoot);
      process.env.GARLIC_CLAW_RUNTIME_WORKSPACES_PATH = runtimeWorkspaceRoot;

      const env = await createSessionEnvironment(runtimeWorkspaceRoot, 'session-no-matches');
      fs.mkdirSync(path.join(env.sessionRoot, 'packages', 'server'), { recursive: true });
      fs.writeFileSync(path.join(env.sessionRoot, 'package.json'), '{}', 'utf8');
      fs.writeFileSync(path.join(env.sessionRoot, 'packages', 'server', 'package.json'), '{}', 'utf8');

      const result = await buildSearchOverlay({
        basePath: '/src',
        matches: [],
        sessionId: 'session-no-matches',
        sessionRoot: env.sessionRoot,
        visibleRoot: env.visibleRoot,
      });

      expect(result).toEqual(['Project Base: src']);
    });
  });

  // ── suggestReadPath 逻辑 ──

  describe('suggestReadPath 逻辑', () => {
    it('高命中文件优先', () => {
      const result = readRuntimeSearchSuggestedReadPath([
        '/a/file.ts',
        '/a/file.ts',
        '/b/file.ts',
      ]);
      expect(result).toBe('/a/file.ts');
    });

    it('命中相同时浅路径优先', () => {
      const result = readRuntimeSearchSuggestedReadPath([
        '/a/b/c/file.ts',
        '/a/file.ts',
      ]);
      expect(result).toBe('/a/file.ts');
    });

    it('命中深度相同时短路径名优先', () => {
      const result = readRuntimeSearchSuggestedReadPath([
        '/a/long-filename.ts',
        '/a/short.ts',
      ]);
      expect(result).toBe('/a/short.ts');
    });

    it('空 matches 返回 undefined', () => {
      expect(readRuntimeSearchSuggestedReadPath([])).toBeUndefined();
    });

    it('过滤空路径', () => {
      expect(readRuntimeSearchSuggestedReadPath([
        '',
        '/a/valid.ts',
      ])).toBe('/a/valid.ts');
    });

    it('支持 virtualPath 对象输入', () => {
      const result = readRuntimeSearchSuggestedReadPath([
        { virtualPath: '/a/file.ts' },
        { virtualPath: '/a/file.ts' },
        { virtualPath: '/b/file.ts' },
      ]);
      expect(result).toBe('/a/file.ts');
    });
  });

  // ── 路径归一化 ──

  describe('normalizeProjectRelativePath', () => {
    it('将反斜杠转为正斜杠', () => {
      expect(normalizeProjectRelativePath('packages\\server\\src')).toBe('packages/server/src');
    });

    it('空路径返回点', () => {
      expect(normalizeProjectRelativePath('')).toBe('.');
    });

    it('正常路径不变', () => {
      expect(normalizeProjectRelativePath('src/main.ts')).toBe('src/main.ts');
    });

    it('根相对路径保持', () => {
      expect(normalizeProjectRelativePath('.')).toBe('.');
    });
  });
});
