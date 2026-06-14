import fsSync from 'node:fs'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

function normalizeVirtualPath(input: string): string {
  const stack: string[] = [];
  for (const part of input.split('/').filter((entry) => entry.length > 0 && entry !== '.')) { if (part === '..') { stack.pop(); } else { stack.push(part); } }
  return `/${stack.join('/')}`;
}

function normalizeMountedWorkspacePath(input: string): string {
  const normalized = normalizeVirtualPath(input);
  return normalized === '/' ? normalized : normalized.replace(/\/+$/, '');
}

function readMountedEncoding(encoding: string | null | undefined): string { return !encoding || encoding === 'utf-8' ? 'utf8' : encoding; }
function toMountedFsStat(stat: fsSync.Stats) { return { isDirectory: stat.isDirectory(), isFile: stat.isFile(), isSymbolicLink: stat.isSymbolicLink(), mode: stat.mode, mtime: stat.mtime, size: stat.size }; }

class RuntimeMountedWorkspaceFileSystem {
  private readonly root: string;
  private readonly mountPoint: string;

  constructor(root: string, mountPoint = '/') {
    this.root = path.resolve(root);
    this.mountPoint = normalizeMountedWorkspacePath(mountPoint);
  }

  async readFile(filePath: string, options?: any): Promise<string> { return Buffer.from(await this.readFileBuffer(filePath)).toString(readMountedEncoding(typeof options === 'string' ? options : options?.encoding ?? 'utf8')); }
  async readFileBuffer(filePath: string): Promise<Uint8Array> { return new Uint8Array(await fsPromises.readFile(this.toHostPath(filePath))); }
  async writeFile(filePath: string, content: string | Uint8Array, options?: any): Promise<void> { await this.writeMountedFile(filePath, content, options, 'writeFile'); }
  async appendFile(filePath: string, content: string | Uint8Array, options?: any): Promise<void> { await this.writeMountedFile(filePath, content, options, 'appendFile'); }
  async exists(filePath: string): Promise<boolean> { try { await fsPromises.access(this.toHostPath(filePath)); return true; } catch { return false; } }
  async stat(filePath: string) { return toMountedFsStat(await fsPromises.stat(this.toHostPath(filePath))); }
  async lstat(filePath: string) { return toMountedFsStat(await fsPromises.lstat(this.toHostPath(filePath))); }
  async mkdir(filePath: string, options?: { recursive?: boolean }): Promise<void> { await fsPromises.mkdir(this.toHostPath(filePath), { recursive: options?.recursive }); }
  async readdir(filePath: string): Promise<string[]> { return fsPromises.readdir(this.toHostPath(filePath)); }
  async readdirWithFileTypes(filePath: string) { return (await fsPromises.readdir(this.toHostPath(filePath), { withFileTypes: true })).map((entry) => ({ isDirectory: entry.isDirectory(), isFile: entry.isFile(), isSymbolicLink: entry.isSymbolicLink(), name: entry.name })); }
  async rm(filePath: string, options?: { force?: boolean; recursive?: boolean }): Promise<void> { await fsPromises.rm(this.toHostPath(filePath), { force: options?.force ?? false, recursive: options?.recursive ?? false }); }
  async cp(src: string, dest: string, options?: { recursive?: boolean }): Promise<void> { await fsPromises.cp(this.toHostPath(src), this.toHostPath(dest), { force: true, recursive: options?.recursive ?? false }); }
  async mv(src: string, dest: string): Promise<void> { const destinationPath = this.toHostPath(dest); await fsPromises.mkdir(path.dirname(destinationPath), { recursive: true }); await fsPromises.rename(this.toHostPath(src), destinationPath); }
  resolvePath(base: string, nextPath: string): string { return !nextPath.trim() ? normalizeVirtualPath(base) : nextPath.startsWith('/') ? normalizeVirtualPath(nextPath) : normalizeVirtualPath(path.posix.join(normalizeVirtualPath(base), nextPath)); }
  getAllPaths(): string[] { return ['/', ...collectMountedWorkspacePaths(this.root, this.root)].sort(); }
  async chmod(filePath: string, mode: number): Promise<void> { await fsPromises.chmod(this.toHostPath(filePath), mode); }
  async symlink(target: string, linkPath: string): Promise<void> { const hostLinkPath = this.toHostPath(linkPath), hostTarget = this.toHostSymlinkTarget(target, linkPath); await fsPromises.mkdir(path.dirname(hostLinkPath), { recursive: true }); await fsPromises.symlink(hostTarget, hostLinkPath, await readMountedSymlinkNodeType(hostLinkPath, hostTarget)); }
  async link(existingPath: string, newPath: string): Promise<void> { const hostNewPath = this.toHostPath(newPath); await fsPromises.mkdir(path.dirname(hostNewPath), { recursive: true }); await fsPromises.link(this.toHostPath(existingPath), hostNewPath); }
  async readlink(filePath: string): Promise<string> { return this.toVirtualReadlinkTarget(await fsPromises.readlink(this.toHostPath(filePath))); }
  async realpath(filePath: string): Promise<string> { return this.toMountedVirtualPath(await fsPromises.realpath(this.toHostPath(filePath)), filePath); }
  async utimes(filePath: string, atime: Date, mtime: Date): Promise<void> { await fsPromises.utimes(this.toHostPath(filePath), atime, mtime); }

  private async writeMountedFile(filePath: string, content: string | Uint8Array, options: any, mode: 'appendFile' | 'writeFile'): Promise<void> {
    const hostPath = this.toHostPath(filePath);
    await fsPromises.mkdir(path.dirname(hostPath), { recursive: true });
    await fsPromises[mode](hostPath, typeof content === 'string' ? content : Buffer.from(content), readMountedWriteOptions(options));
  }

  private toHostPath(filePath: string): string {
    const relativePath = normalizeVirtualPath(filePath).slice(1);
    const resolved = path.resolve(relativePath ? path.join(this.root, ...relativePath.split('/')) : this.root);
    if (resolved !== this.root && !resolved.startsWith(`${this.root}${path.sep}`)) { throw new Error(`runtime workspace 路径越界: ${filePath}`); }
    return resolved;
  }

  private toHostSymlinkTarget(target: string, linkPath: string): string {
    if (target.startsWith('/')) { return this.toHostPath(this.readAbsoluteTargetPath(target)); }
    const hostTarget = this.toHostPath(normalizeVirtualPath(path.posix.join(path.posix.dirname(normalizeVirtualPath(linkPath)), target)));
    return path.relative(path.dirname(this.toHostPath(linkPath)), hostTarget) || '.';
  }

  private readAbsoluteTargetPath(target: string): string {
    const normalizedTarget = normalizeVirtualPath(target);
    if (this.mountPoint === '/') { return normalizedTarget; }
    if (normalizedTarget === this.mountPoint) { return '/'; }
    if (normalizedTarget.startsWith(`${this.mountPoint}/`)) { return normalizedTarget.slice(this.mountPoint.length); }
    throw new Error(`runtime workspace 符号链接目标必须位于 ${this.mountPoint} 内: ${target}`);
  }

  private toMountedVirtualPath(resolved: string, filePath: string): string {
    if (resolved !== this.root && !resolved.startsWith(`${this.root}${path.sep}`)) { throw new Error(`runtime workspace 路径越界: ${filePath}`); }
    const relativePath = path.relative(this.root, resolved);
    return relativePath ? `/${relativePath.split(path.sep).join('/')}` : '/';
  }

  private toVirtualReadlinkTarget(target: string): string {
    if (!path.isAbsolute(path.normalize(target))) { return path.normalize(target).split(path.sep).join('/'); }
    const virtualTarget = this.toMountedVirtualPath(path.resolve(path.normalize(target)), target);
    return this.mountPoint === '/' ? virtualTarget : virtualTarget === '/' ? this.mountPoint : `${this.mountPoint}${virtualTarget}`;
  }
}

function collectMountedWorkspacePaths(root: string, currentPath: string): string[] {
  const entries: string[] = [];
  for (const entry of fsSync.readdirSync(currentPath, { withFileTypes: true })) {
    const hostPath = path.join(currentPath, entry.name);
    entries.push(`/${path.relative(root, hostPath).split(path.sep).join('/')}`);
    if (entry.isDirectory()) { entries.push(...collectMountedWorkspacePaths(root, hostPath)); }
  }
  return entries;
}

function readMountedWriteOptions(options?: any): { encoding?: string } | undefined { return !options ? undefined : { encoding: readMountedEncoding(typeof options === 'string' ? options : options.encoding) }; }

async function readMountedSymlinkNodeType(hostLinkPath: string, hostTarget: string): Promise<'dir' | 'file' | undefined> {
  if (process.platform !== 'win32') { return undefined; }
  try {
    return (await fsPromises.stat(path.isAbsolute(hostTarget) ? hostTarget : path.resolve(path.dirname(hostLinkPath), hostTarget))).isDirectory() ? 'dir' : 'file';
  } catch { return 'file'; }
}

describe('RuntimeMountedWorkspaceFileSystem', () => {
  let rootDir: string
  let tmpDir: string

  beforeEach(async () => {
    rootDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'gc-mounted-fs-'))
    tmpDir = path.join(rootDir, 'subdir')
    await fsPromises.mkdir(tmpDir, { recursive: true })
    await fsPromises.writeFile(path.join(rootDir, 'hello.txt'), 'Hello World', 'utf8')
    await fsPromises.writeFile(path.join(tmpDir, 'nested.txt'), 'Nested content', 'utf8')
  })

  afterEach(async () => {
    try { fsSync.rmSync(rootDir, { force: true, recursive: true }) } catch { /* ignore cleanup errors */ }
  })

  describe('normalizeVirtualPath', () => {
    it('handles root', () => { expect(normalizeVirtualPath('/')).toBe('/') })
    it('handles simple path', () => { expect(normalizeVirtualPath('/foo/bar')).toBe('/foo/bar') })
    it('collapses dots', () => { expect(normalizeVirtualPath('/foo/./bar')).toBe('/foo/bar') })
    it('resolves double dots', () => { expect(normalizeVirtualPath('/foo/bar/../baz')).toBe('/foo/baz') })
    it('handles leading double dot', () => { expect(normalizeVirtualPath('/foo/../../bar')).toBe('/bar') })
    it('strips trailing slash', () => { expect(normalizeVirtualPath('/foo/bar/')).toBe('/foo/bar') })
    it('strips multiple slashes', () => { expect(normalizeVirtualPath('//foo///bar')).toBe('/foo/bar') })
  })

  describe('normalizeMountedWorkspacePath', () => {
    it('returns / for root', () => { expect(normalizeMountedWorkspacePath('/')).toBe('/') })
    it('strips trailing slash for non-root', () => { expect(normalizeMountedWorkspacePath('/mnt/')).toBe('/mnt') })
    it('normalizes path', () => { expect(normalizeMountedWorkspacePath('/mnt/./point/')).toBe('/mnt/point') })
  })

  describe('readMountedEncoding', () => {
    it('defaults to utf8', () => { expect(readMountedEncoding(undefined)).toBe('utf8') })
    it('converts utf-8 to utf8', () => { expect(readMountedEncoding('utf-8')).toBe('utf8') })
    it('passes through other encodings', () => { expect(readMountedEncoding('base64')).toBe('base64') })
    it('handles null', () => { expect(readMountedEncoding(null)).toBe('utf8') })
  })

  describe('filesystem operations', () => {
    it('reads a file', async () => {
      const fs = new RuntimeMountedWorkspaceFileSystem(rootDir)
      const content = await fs.readFile('/hello.txt')
      expect(content).toBe('Hello World')
    })

    it('reads a file buffer', async () => {
      const fs = new RuntimeMountedWorkspaceFileSystem(rootDir)
      const buf = await fs.readFileBuffer('/hello.txt')
      expect(buf).toBeInstanceOf(Uint8Array)
    })

    it('writes and reads a file', async () => {
      const fs = new RuntimeMountedWorkspaceFileSystem(rootDir)
      await fs.writeFile('/new-file.txt', 'new content')
      const content = await fs.readFile('/new-file.txt')
      expect(content).toBe('new content')
    })

    it('appends to a file', async () => {
      const fs = new RuntimeMountedWorkspaceFileSystem(rootDir)
      await fs.writeFile('/append-me.txt', 'first')
      await fs.appendFile('/append-me.txt', '-second')
      const content = await fs.readFile('/append-me.txt')
      expect(content).toBe('first-second')
    })

    it('checks file existence', async () => {
      const fs = new RuntimeMountedWorkspaceFileSystem(rootDir)
      await expect(fs.exists('/hello.txt')).resolves.toBe(true)
      await expect(fs.exists('/nonexistent.txt')).resolves.toBe(false)
    })

    it('stats a file', async () => {
      const fs = new RuntimeMountedWorkspaceFileSystem(rootDir)
      const stat = await fs.stat('/hello.txt')
      expect(stat.isFile).toBe(true)
      expect(stat.size).toBeGreaterThan(0)
    })

    it('lists directory', async () => {
      const fs = new RuntimeMountedWorkspaceFileSystem(rootDir)
      const entries = await fs.readdir('/')
      expect(entries).toContain('hello.txt')
      expect(entries).toContain('subdir')
    })

    it('creates a directory', async () => {
      const fs = new RuntimeMountedWorkspaceFileSystem(rootDir)
      await fs.mkdir('/newdir')
      expect(fsSync.existsSync(path.join(rootDir, 'newdir'))).toBe(true)
    })

    it('copies a file', async () => {
      const fs = new RuntimeMountedWorkspaceFileSystem(rootDir)
      await fs.cp('/hello.txt', '/hello-copy.txt')
      const content = await fs.readFile('/hello-copy.txt')
      expect(content).toBe('Hello World')
    })

    it('moves a file', async () => {
      const fs = new RuntimeMountedWorkspaceFileSystem(rootDir)
      await fs.writeFile('/move-src.txt', 'movable')
      await fs.mv('/move-src.txt', '/moved.txt')
      await expect(fs.exists('/move-src.txt')).resolves.toBe(false)
      await expect(fs.exists('/moved.txt')).resolves.toBe(true)
    })

    it('resolves paths', () => {
      const fs = new RuntimeMountedWorkspaceFileSystem(rootDir)
      expect(fs.resolvePath('/foo', 'bar')).toBe('/foo/bar')
      expect(fs.resolvePath('/foo', '/absolute')).toBe('/absolute')
      expect(fs.resolvePath('/foo', '')).toBe('/foo')
      expect(fs.resolvePath('/', '')).toBe('/')
    })

    it('removes files', async () => {
      const fs = new RuntimeMountedWorkspaceFileSystem(rootDir)
      await fs.writeFile('/to-delete.txt', 'bye')
      await fs.rm('/to-delete.txt')
      await expect(fs.exists('/to-delete.txt')).resolves.toBe(false)
    })
  })

  describe('path boundary enforcement', () => {
    it('normalizeVirtualPath prevents upward traversal past root', () => {
      expect(normalizeVirtualPath('/../outside')).toBe('/outside')
      expect(normalizeVirtualPath('/../../../etc/passwd')).toBe('/etc/passwd')
    })

    it('toHostPath resolves valid paths within root', async () => {
      const fs = new RuntimeMountedWorkspaceFileSystem(rootDir)
      await expect(fs.readFile('/hello.txt')).resolves.toBe('Hello World')
      await expect(fs.writeFile('/safe-file.txt', 'safe')).resolves.toBeUndefined()
    })
  })

  describe('mount point', () => {
    it('constructs with custom mount point', () => {
      const fs = new RuntimeMountedWorkspaceFileSystem(rootDir, '/mnt/workspace')
      expect(fs).toBeDefined()
    })

    it('normalizeMountedWorkspacePath strips trailing slash for non-root', () => {
      expect(normalizeMountedWorkspacePath('/')).toBe('/')
      expect(normalizeMountedWorkspacePath('/mnt/')).toBe('/mnt')
      expect(normalizeMountedWorkspacePath('/mnt/point/')).toBe('/mnt/point')
    })
  })

  describe('getAllPaths', () => {
    it('lists all paths in workspace', () => {
      const fs = new RuntimeMountedWorkspaceFileSystem(rootDir)
      const paths = fs.getAllPaths()
      expect(paths).toContain('/')
      expect(paths).toContain('/hello.txt')
      expect(paths).toContain('/subdir')
      expect(paths).toContain('/subdir/nested.txt')
    })
  })

  describe('symlink', () => {
    it('creates and reads a symlink', async () => {
      const fs = new RuntimeMountedWorkspaceFileSystem(rootDir)
      await fs.writeFile('/target.txt', 'linked')
      await fs.symlink('/target.txt', '/link.txt')
      const linkTarget = await fs.readlink('/link.txt')
      expect(linkTarget).toBe('/target.txt')
    })
  })
})
