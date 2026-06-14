import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BadRequestException } from '@nestjs/common';

const SERVICE_PATH = '../../packages/server/src/modules/execution/project/project-worktree-root.service';

// ─── 内联实现（对齐 ProjectWorktreeRootService） ───

function resolveRoot(startPath: string = process.cwd()): string {
  const configuredRoot = readConfiguredRoot();
  if (configuredRoot) return configuredRoot;
  return findRoot(startPath) ?? findRoot(__dirname) ?? process.cwd();
}

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

function readConfiguredRoot(): string | null {
  const configuredRoot = process.env.GARLIC_CLAW_PROJECT_WORKTREE_PATH?.trim();
  if (!configuredRoot) return null;
  return path.resolve(configuredRoot);
}

// ─── 路径安全内联（对齐 project-worktree-file.service.ts） ───

function resolveProjectPath(projectRoot: string, inputPath?: string): string {
  const normalizedInput = typeof inputPath === 'string' ? inputPath.trim() : '';
  const normalizedProjectRoot = path.resolve(projectRoot);
  const absolutePath = path.resolve(
    normalizedInput
      ? (path.isAbsolute(normalizedInput) ? normalizedInput : path.join(projectRoot, normalizedInput))
      : projectRoot,
  );
  if (absolutePath !== normalizedProjectRoot && !absolutePath.startsWith(`${normalizedProjectRoot}${path.sep}`)) {
    throw new BadRequestException(`路径必须位于项目目录内: ${normalizedInput || '.'}`);
  }
  return absolutePath;
}

function toProjectRelativePath(projectRoot: string, absolutePath: string): string {
  const relativePath = path.relative(projectRoot, absolutePath);
  return relativePath ? relativePath.replace(/\\/g, '/') : '.';
}

function joinProjectRelativePath(basePath: string, childName: string): string {
  return basePath === '.' ? childName : path.posix.join(basePath, childName);
}

// ========================================================================

describe('execution/project/ 模块 — ProjectWorktreeRootService', () => {
  let originalWorktreePath: string | undefined;
  let tempRoot: string;

  beforeEach(() => {
    originalWorktreePath = process.env.GARLIC_CLAW_PROJECT_WORKTREE_PATH;
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-project-root-'));
  });

  afterEach(() => {
    if (originalWorktreePath === undefined) {
      delete process.env.GARLIC_CLAW_PROJECT_WORKTREE_PATH;
    } else {
      process.env.GARLIC_CLAW_PROJECT_WORKTREE_PATH = originalWorktreePath;
    }
    fs.rmSync(tempRoot, { force: true, recursive: true });
  });

  describe('findRoot', () => {
    it('返回最近的 worktree root（包含 package.json + packages/server/package.json）', () => {
      const projectRoot = path.join(tempRoot, 'repo');
      const nestedRoot = path.join(projectRoot, 'packages', 'server', 'src', 'nested');
      fs.mkdirSync(nestedRoot, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}', 'utf8');
      fs.mkdirSync(path.join(projectRoot, 'packages', 'server'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'packages', 'server', 'package.json'), '{}', 'utf8');

      expect(findRoot(nestedRoot)).toBe(projectRoot);
    });

    it('缺少 packages/server/package.json 时返回 null', () => {
      const dir = path.join(tempRoot, 'partial-repo');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');

      expect(findRoot(dir)).toBeNull();
    });

    it('没有 package.json 时返回 null', () => {
      const dir = path.join(tempRoot, 'empty-dir');
      fs.mkdirSync(dir, { recursive: true });

      expect(findRoot(dir)).toBeNull();
    });

    it('在嵌套深层目录中也能找到 root', () => {
      const projectRoot = path.join(tempRoot, 'deep-repo');
      const deepDir = path.join(projectRoot, 'a', 'b', 'c', 'd');
      fs.mkdirSync(deepDir, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}', 'utf8');
      fs.mkdirSync(path.join(projectRoot, 'packages', 'server'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'packages', 'server', 'package.json'), '{}', 'utf8');

      expect(findRoot(deepDir)).toBe(projectRoot);
    });
  });

  describe('resolveRoot', () => {
    it('无环境变量时通过 findRoot 查找', () => {
      const projectRoot = path.join(tempRoot, 'resolve-test');
      fs.mkdirSync(path.join(projectRoot, 'packages', 'server'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}', 'utf8');
      fs.writeFileSync(path.join(projectRoot, 'packages', 'server', 'package.json'), '{}', 'utf8');

      expect(resolveRoot(projectRoot)).toBe(path.resolve(projectRoot));
    });

    it('环境变量 GARLIC_CLAW_PROJECT_WORKTREE_PATH 优先', () => {
      const configuredRoot = path.join(tempRoot, 'configured-root');
      fs.mkdirSync(configuredRoot, { recursive: true });
      process.env.GARLIC_CLAW_PROJECT_WORKTREE_PATH = configuredRoot;

      expect(resolveRoot(path.join(tempRoot, 'other'))).toBe(path.resolve(configuredRoot));
    });

    it('环境变量中前后空白被 trim', () => {
      const configuredRoot = path.join(tempRoot, 'trim-root');
      fs.mkdirSync(configuredRoot, { recursive: true });
      process.env.GARLIC_CLAW_PROJECT_WORKTREE_PATH = `  ${configuredRoot}  `;

      expect(resolveRoot()).toBe(path.resolve(configuredRoot));
    });

    it('空字符串环境变量等同于未设置，回退到 findRoot', () => {
      process.env.GARLIC_CLAW_PROJECT_WORKTREE_PATH = '';
      const projectRoot = path.join(tempRoot, 'fallback-repo');
      fs.mkdirSync(path.join(projectRoot, 'packages', 'server'), { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}', 'utf8');
      fs.writeFileSync(path.join(projectRoot, 'packages', 'server', 'package.json'), '{}', 'utf8');

      expect(resolveRoot(projectRoot)).toBe(path.resolve(projectRoot));
    });
  });

  describe('resolveProjectPath（路径安全）', () => {
    let projectRoot: string;

    beforeEach(() => {
      projectRoot = path.join(tempRoot, 'project');
      fs.mkdirSync(projectRoot, { recursive: true });
    });

    it('解析相对路径', () => {
      const result = resolveProjectPath(projectRoot, 'src/foo.ts');
      expect(result).toBe(path.join(projectRoot, 'src', 'foo.ts'));
    });

    it('解析绝对路径在项目内', () => {
      const target = path.join(projectRoot, 'src', 'bar.ts');
      fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
      const result = resolveProjectPath(projectRoot, target);
      expect(result).toBe(target);
    });

    it('拒绝项目外的路径', () => {
      const outsidePath = path.join(tempRoot, 'outside.txt');
      expect(() => resolveProjectPath(projectRoot, outsidePath)).toThrow(BadRequestException);
    });

    it('拒绝相对路径 .. 超出项目', () => {
      expect(() => resolveProjectPath(projectRoot, '../outside.txt')).toThrow(BadRequestException);
    });

    it('空字符串退回到项目根', () => {
      const result = resolveProjectPath(projectRoot, '');
      expect(result).toBe(path.resolve(projectRoot));
    });

    it('undefined 退回到项目根', () => {
      const result = resolveProjectPath(projectRoot, undefined);
      expect(result).toBe(path.resolve(projectRoot));
    });

    it('trim 输入路径中的前后空白', () => {
      const result = resolveProjectPath(projectRoot, '  src/foo.ts  ');
      expect(result).toBe(path.join(projectRoot, 'src', 'foo.ts'));
    });

    it('点路径表示项目根', () => {
      const result = resolveProjectPath(projectRoot, '.');
      expect(result).toBe(path.resolve(projectRoot));
    });
  });

  describe('toProjectRelativePath', () => {
    it('将绝对路径转为 POSIX 风格相对路径', () => {
      const result = toProjectRelativePath('/repo', '/repo/src/file.ts');
      expect(result).toBe('src/file.ts');
    });

    it('项目根路径返回点', () => {
      const result = toProjectRelativePath('/repo', '/repo');
      expect(result).toBe('.');
    });

    it('替换反斜杠为正斜杠（Windows）', () => {
      const result = toProjectRelativePath('C:\\repo', 'C:\\repo\\src\\file.ts');
      expect(result).toBe('src/file.ts');
    });
  });

  describe('joinProjectRelativePath', () => {
    it('根路径 . 使用子路径', () => {
      expect(joinProjectRelativePath('.', 'child.ts')).toBe('child.ts');
    });

    it('嵌套路径拼接', () => {
      expect(joinProjectRelativePath('src', 'child.ts')).toBe('src/child.ts');
    });

    it('深嵌套路径拼接', () => {
      expect(joinProjectRelativePath('src/nested', 'deep.ts')).toBe('src/nested/deep.ts');
    });
  });
});
