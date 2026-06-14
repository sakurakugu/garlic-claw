import { describe, it, expect, vi } from 'vitest'

interface RuntimeFilesystemBackend {
  copyPath(sessionId: string, fromPath: string, toPath: string): Promise<{ fromPath: string; path: string }>
  createSymlink(sessionId: string, input: { linkPath: string; targetPath: string }): Promise<{ path: string; target: string }>
  deletePath(sessionId: string, inputPath: string): Promise<{ deleted: boolean; path: string }>
  editTextFile(sessionId: string, input: { filePath: string; newString: string; oldString: string; replaceAll?: boolean }): Promise<{ diff: any; occurrences: number; postWrite: any; path: string; strategy: string }>
  ensureDirectory(sessionId: string, inputPath: string): Promise<{ created: boolean; path: string }>
  getDescriptor(): { capabilities: Record<string, boolean>; kind: string; permissionPolicy: Record<string, string> }
  getKind(): string
  globPaths(sessionId: string, input: { maxResults: number; pattern: string; path?: string }): Promise<{ basePath: string; matches: string[]; partial: boolean; skippedEntries: any[]; skippedPaths: string[]; totalMatches: number; truncated: boolean }>
  grepText(sessionId: string, input: { include?: string; maxLineLength: number; maxMatches: number; path?: string; pattern: string }): Promise<{ basePath: string; matches: any[]; partial: boolean; skippedEntries: any[]; skippedPaths: string[]; totalMatches: number; truncated: boolean }>
  listFiles(sessionId: string, inputPath?: string): Promise<{ basePath: string; files: { virtualPath: string }[] }>
  movePath(sessionId: string, fromPath: string, toPath: string): Promise<{ fromPath: string; path: string }>
  readDirectoryEntries(sessionId: string, inputPath?: string): Promise<{ entries: string[]; path: string }>
  readPathRange(sessionId: string, input: { limit: number; maxLineLength: number; offset: number; path?: string }): Promise<any>
  readSymlink(sessionId: string, inputPath: string): Promise<{ path: string; target: string }>
  resolvePath(sessionId: string, inputPath?: string): Promise<{ exists: boolean; type: string; virtualPath: string }>
  statPath(sessionId: string, inputPath?: string): Promise<{ exists: boolean; mtime: string | null; size: number | null; type: string; virtualPath: string }>
  readTextFile(sessionId: string, inputPath?: string): Promise<{ content: string; path: string }>
  writeTextFile(sessionId: string, inputPath: string, content: string, options?: { mode?: string }): Promise<{ created: boolean; diff: any; lineCount: number; postWrite: any; path: string; size: number; status: string }>
}

class RuntimeFilesystemBackendService {
  private readonly backends = new Map<string, RuntimeFilesystemBackend>()
  private readonly defaultBackendKind: string

  constructor(filesystemBackends: RuntimeFilesystemBackend[]) {
    if (filesystemBackends.length === 0) { throw new Error('RuntimeFilesystemBackendService 至少需要一个 filesystem backend') }
    for (const backend of filesystemBackends) { this.backends.set(backend.getKind(), backend) }
    this.defaultBackendKind = filesystemBackends[0].getKind()
  }

  getBackend(backendKind?: string): RuntimeFilesystemBackend { return this.requireBackend(backendKind) }
  getBackendDescriptor(backendKind?: string): ReturnType<RuntimeFilesystemBackend['getDescriptor']> { return this.requireBackend(backendKind).getDescriptor() }
  getDefaultBackend(): RuntimeFilesystemBackend { return this.requireBackend() }
  getDefaultBackendDescriptor(): ReturnType<RuntimeFilesystemBackend['getDescriptor']> { return this.requireBackend().getDescriptor() }
  getDefaultBackendKind(): string { return this.defaultBackendKind }
  hasBackend(backendKind: string): boolean { return this.backends.has(backendKind) }
  listBackendKinds(): string[] { return [...this.backends.keys()] }

  async copyPath(sessionId: string, fromPath: string, toPath: string, backendKind?: string) { return this.requireBackend(backendKind).copyPath(sessionId, fromPath, toPath) }
  async createSymlink(sessionId: string, input: { linkPath: string; targetPath: string }, backendKind?: string) { return this.requireBackend(backendKind).createSymlink(sessionId, input) }
  async deletePath(sessionId: string, inputPath: string, backendKind?: string) { return this.requireBackend(backendKind).deletePath(sessionId, inputPath) }
  async editTextFile(sessionId: string, input: { filePath: string; newString: string; oldString: string; replaceAll?: boolean }, backendKind?: string) { return this.requireBackend(backendKind).editTextFile(sessionId, input) }
  async ensureDirectory(sessionId: string, inputPath: string, backendKind?: string) { return this.requireBackend(backendKind).ensureDirectory(sessionId, inputPath) }
  async globPaths(sessionId: string, input: { maxResults: number; pattern: string; path?: string }, backendKind?: string) { return this.requireBackend(backendKind).globPaths(sessionId, input) }
  async grepText(sessionId: string, input: { include?: string; maxLineLength: number; maxMatches: number; path?: string; pattern: string }, backendKind?: string) { return this.requireBackend(backendKind).grepText(sessionId, input) }
  async listFiles(sessionId: string, inputPath?: string, backendKind?: string) { return this.requireBackend(backendKind).listFiles(sessionId, inputPath) }
  async movePath(sessionId: string, fromPath: string, toPath: string, backendKind?: string) { return this.requireBackend(backendKind).movePath(sessionId, fromPath, toPath) }
  async readDirectoryEntries(sessionId: string, inputPath?: string, backendKind?: string) { return this.requireBackend(backendKind).readDirectoryEntries(sessionId, inputPath) }
  async readPathRange(sessionId: string, input: { limit: number; maxLineLength: number; offset: number; path?: string }, backendKind?: string) { return this.requireBackend(backendKind).readPathRange(sessionId, input) }
  async readSymlink(sessionId: string, inputPath: string, backendKind?: string) { return this.requireBackend(backendKind).readSymlink(sessionId, inputPath) }
  async resolvePath(sessionId: string, inputPath?: string, backendKind?: string) { return this.requireBackend(backendKind).resolvePath(sessionId, inputPath) }
  async statPath(sessionId: string, inputPath?: string, backendKind?: string) { return this.requireBackend(backendKind).statPath(sessionId, inputPath) }
  async readTextFile(sessionId: string, inputPath?: string, backendKind?: string) { return this.requireBackend(backendKind).readTextFile(sessionId, inputPath) }
  async writeTextFile(sessionId: string, inputPath: string, content: string, backendKind?: string, options?: { mode?: string }) { return this.requireBackend(backendKind).writeTextFile(sessionId, inputPath, content, options) }

  private requireBackend(backendKind?: string): RuntimeFilesystemBackend {
    const resolvedBackendKind = backendKind ?? this.defaultBackendKind
    const backend = this.backends.get(resolvedBackendKind)
    if (!backend) { throw new Error(`Unknown runtime filesystem backend: ${resolvedBackendKind}`) }
    return backend
  }
}

function createMockBackend(kind: string): RuntimeFilesystemBackend {
  const mock: RuntimeFilesystemBackend = {
    copyPath: vi.fn().mockResolvedValue({ fromPath: '', path: '' }),
    createSymlink: vi.fn().mockResolvedValue({ path: '', target: '' }),
    deletePath: vi.fn().mockResolvedValue({ deleted: true, path: '' }),
    editTextFile: vi.fn().mockResolvedValue({ diff: null, occurrences: 1, postWrite: null, path: '', strategy: '' }),
    ensureDirectory: vi.fn().mockResolvedValue({ created: true, path: '' }),
    getDescriptor: vi.fn().mockReturnValue({
      capabilities: { workspaceRead: true, workspaceWrite: true, persistentFilesystem: true },
      kind,
      permissionPolicy: { workspaceRead: 'allow', workspaceWrite: 'allow', persistentFilesystem: 'allow' },
    }),
    getKind: vi.fn().mockReturnValue(kind),
    globPaths: vi.fn().mockResolvedValue({ basePath: '/', matches: [], partial: false, skippedEntries: [], skippedPaths: [], totalMatches: 0, truncated: false }),
    grepText: vi.fn().mockResolvedValue({ basePath: '/', matches: [], partial: false, skippedEntries: [], skippedPaths: [], totalMatches: 0, truncated: false }),
    listFiles: vi.fn().mockResolvedValue({ basePath: '/', files: [] }),
    movePath: vi.fn().mockResolvedValue({ fromPath: '', path: '' }),
    readDirectoryEntries: vi.fn().mockResolvedValue({ entries: [], path: '/' }),
    readPathRange: vi.fn().mockResolvedValue({ limit: 100, offset: 0, path: '/', truncated: false, type: 'file' }),
    readSymlink: vi.fn().mockResolvedValue({ path: '', target: '' }),
    resolvePath: vi.fn().mockResolvedValue({ exists: true, type: 'file', virtualPath: '/' }),
    statPath: vi.fn().mockResolvedValue({ exists: true, mtime: null, size: null, type: 'file', virtualPath: '/' }),
    readTextFile: vi.fn().mockResolvedValue({ content: '', path: '/' }),
    writeTextFile: vi.fn().mockResolvedValue({ created: true, diff: null, lineCount: 0, postWrite: null, path: '/', size: 0, status: 'created' }),
  }
  return mock
}

describe('RuntimeFilesystemBackendService', () => {
  describe('constructor', () => {
    it('throws when no backends are provided', () => {
      expect(() => new RuntimeFilesystemBackendService([])).toThrow('至少需要一个 filesystem backend')
    })

    it('uses first backend as default', () => {
      const alpha = createMockBackend('alpha')
      const beta = createMockBackend('beta')
      const service = new RuntimeFilesystemBackendService([alpha, beta])
      expect(service.getDefaultBackendKind()).toBe('alpha')
    })
  })

  describe('getBackend / getDefaultBackend', () => {
    it('returns the default backend when no kind specified', () => {
      const alpha = createMockBackend('alpha')
      const service = new RuntimeFilesystemBackendService([alpha])
      expect(service.getBackend()).toBe(alpha)
      expect(service.getDefaultBackend()).toBe(alpha)
    })

    it('returns the requested backend by kind', () => {
      const alpha = createMockBackend('alpha')
      const beta = createMockBackend('beta')
      const service = new RuntimeFilesystemBackendService([alpha, beta])
      expect(service.getBackend('beta')).toBe(beta)
    })

    it('throws for unknown backend kind', () => {
      const service = new RuntimeFilesystemBackendService([createMockBackend('alpha')])
      expect(() => service.getBackend('unknown')).toThrow('Unknown runtime filesystem backend: unknown')
    })
  })

  describe('getBackendDescriptor', () => {
    it('returns descriptor from default backend', () => {
      const backend = createMockBackend('test')
      const service = new RuntimeFilesystemBackendService([backend])
      const desc = service.getBackendDescriptor()
      expect(desc.kind).toBe('test')
      expect(desc.capabilities).toBeDefined()
    })

    it('returns descriptor from specific backend', () => {
      const alpha = createMockBackend('alpha')
      const beta = createMockBackend('beta')
      const service = new RuntimeFilesystemBackendService([alpha, beta])
      expect(service.getBackendDescriptor('beta').kind).toBe('beta')
    })
  })

  describe('hasBackend / listBackendKinds', () => {
    it('checks if a backend exists', () => {
      const service = new RuntimeFilesystemBackendService([createMockBackend('alpha')])
      expect(service.hasBackend('alpha')).toBe(true)
      expect(service.hasBackend('beta')).toBe(false)
    })

    it('lists all backend kinds', () => {
      const service = new RuntimeFilesystemBackendService([
        createMockBackend('alpha'),
        createMockBackend('beta'),
        createMockBackend('gamma'),
      ])
      expect(service.listBackendKinds()).toEqual(['alpha', 'beta', 'gamma'])
    })
  })

  describe('delegation methods', () => {
    it('delegates to default backend when no kind specified', async () => {
      const backend = createMockBackend('test')
      const service = new RuntimeFilesystemBackendService([backend])

      await service.copyPath('s1', '/a', '/b')
      expect(backend.copyPath).toHaveBeenCalledWith('s1', '/a', '/b')

      await service.deletePath('s1', '/a')
      expect(backend.deletePath).toHaveBeenCalledWith('s1', '/a')

      await service.ensureDirectory('s1', '/a')
      expect(backend.ensureDirectory).toHaveBeenCalledWith('s1', '/a')
    })

    it('delegates to specific backend when kind specified', async () => {
      const alpha = createMockBackend('alpha')
      const beta = createMockBackend('beta')
      const service = new RuntimeFilesystemBackendService([alpha, beta])

      await service.readTextFile('s1', '/f', 'beta')
      expect(alpha.readTextFile).not.toHaveBeenCalled()
      expect(beta.readTextFile).toHaveBeenCalledWith('s1', '/f')
    })

    it('propagates write options correctly', async () => {
      const backend = createMockBackend('test')
      const service = new RuntimeFilesystemBackendService([backend])

      await service.writeTextFile('s1', '/f', 'content', undefined, { mode: 'append' })
      expect(backend.writeTextFile).toHaveBeenCalledWith('s1', '/f', 'content', { mode: 'append' })
    })

    it('delegates editTextFile', async () => {
      const backend = createMockBackend('test')
      const service = new RuntimeFilesystemBackendService([backend])

      await service.editTextFile('s1', { filePath: '/f', newString: 'new', oldString: 'old', replaceAll: true })
      expect(backend.editTextFile).toHaveBeenCalledWith('s1', { filePath: '/f', newString: 'new', oldString: 'old', replaceAll: true })
    })

    it('delegates globPaths', async () => {
      const backend = createMockBackend('test')
      const service = new RuntimeFilesystemBackendService([backend])

      await service.globPaths('s1', { maxResults: 10, pattern: '*.ts', path: '/src' })
      expect(backend.globPaths).toHaveBeenCalledWith('s1', { maxResults: 10, pattern: '*.ts', path: '/src' })
    })

    it('delegates grepText', async () => {
      const backend = createMockBackend('test')
      const service = new RuntimeFilesystemBackendService([backend])

      await service.grepText('s1', { maxLineLength: 200, maxMatches: 50, pattern: 'test' })
      expect(backend.grepText).toHaveBeenCalledWith('s1', { maxLineLength: 200, maxMatches: 50, pattern: 'test' })
    })

    it('delegates listFiles without inputPath', async () => {
      const backend = createMockBackend('test')
      const service = new RuntimeFilesystemBackendService([backend])

      await service.listFiles('s1')
      expect(backend.listFiles).toHaveBeenCalledWith('s1', undefined)
    })

    it('delegates readPathRange', async () => {
      const backend = createMockBackend('test')
      const service = new RuntimeFilesystemBackendService([backend])

      await service.readPathRange('s1', { limit: 100, maxLineLength: 200, offset: 0, path: '/f' })
      expect(backend.readPathRange).toHaveBeenCalledWith('s1', { limit: 100, maxLineLength: 200, offset: 0, path: '/f' })
    })

    it('delegates resolvePath', async () => {
      const backend = createMockBackend('test')
      const service = new RuntimeFilesystemBackendService([backend])

      await service.resolvePath('s1', '/path')
      expect(backend.resolvePath).toHaveBeenCalledWith('s1', '/path')
    })

    it('delegates statPath', async () => {
      const backend = createMockBackend('test')
      const service = new RuntimeFilesystemBackendService([backend])

      await service.statPath('s1', '/f')
      expect(backend.statPath).toHaveBeenCalledWith('s1', '/f')
    })

    it('delegates createSymlink', async () => {
      const backend = createMockBackend('test')
      const service = new RuntimeFilesystemBackendService([backend])

      await service.createSymlink('s1', { linkPath: '/link', targetPath: '/target' })
      expect(backend.createSymlink).toHaveBeenCalledWith('s1', { linkPath: '/link', targetPath: '/target' })
    })

    it('delegates movePath', async () => {
      const backend = createMockBackend('test')
      const service = new RuntimeFilesystemBackendService([backend])

      await service.movePath('s1', '/a', '/b')
      expect(backend.movePath).toHaveBeenCalledWith('s1', '/a', '/b')
    })

    it('delegates readDirectoryEntries', async () => {
      const backend = createMockBackend('test')
      const service = new RuntimeFilesystemBackendService([backend])

      await service.readDirectoryEntries('s1', '/dir')
      expect(backend.readDirectoryEntries).toHaveBeenCalledWith('s1', '/dir')
    })

    it('delegates readSymlink', async () => {
      const backend = createMockBackend('test')
      const service = new RuntimeFilesystemBackendService([backend])

      await service.readSymlink('s1', '/link')
      expect(backend.readSymlink).toHaveBeenCalledWith('s1', '/link')
    })
  })
})
