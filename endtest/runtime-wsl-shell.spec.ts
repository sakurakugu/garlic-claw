import { describe, it, expect, vi, afterEach } from 'vitest'

function normalizeRuntimeWslShellError(error: unknown, timeoutMs: number): Error {
  if (error instanceof Error && error.message === 'runtime-one-shot-shell-timeout') {
    return new Error(`bash 执行超时（>${Math.ceil(timeoutMs / 1000)} 秒）。如果这条命令本应耗时更久，且不是在等待交互输入，请调大 timeout 后重试。`);
  }
  return error instanceof Error ? error : new Error('bash 执行失败');
}

function normalizeWslHostWorkdir(workdir: string): string {
  const pathModule = { resolve: (p: string) => p.replace(/\//g, '\\') } as any
  const normalized = workdir.trim();
  const driveMatch = normalized.match(/^\/mnt\/([A-Za-z])(?:\/(.*))?$/u);
  if (!driveMatch) {
    return pathModule.resolve(normalized);
  }
  const drive = driveMatch[1].toUpperCase();
  const rest = (driveMatch[2] ?? '').replace(/\//g, '\\');
  return rest.length > 0 ? `${drive}:\\${rest}` : `${drive}:\\`;
}

function readRuntimeShellToolName(backendKind?: string): 'bash' | 'powershell' {
  const usesPowerShell = process.platform === 'win32' && backendKind?.includes('native-shell') && !backendKind?.includes('wsl');
  return usesPowerShell ? 'powershell' : 'bash';
}

function isAbsoluteShellWorkdir(backendKind: string | undefined, workdir: string): boolean {
  const normalized = workdir.trim();
  if (normalized.length === 0) { return false; }
  if (/^[A-Za-z]:[\\/]/u.test(normalized) || normalized.startsWith('\\\\')) {
    return backendKind === 'native-shell' || backendKind === 'wsl-shell';
  }
  return backendKind === 'wsl-shell' && normalized.startsWith('/mnt/');
}

function resolveRuntimeVisiblePath(visibleRoot: string, inputPath?: string, violationMessage?: string): string {
  function normalizeRuntimeVisiblePath(input: string): string {
    const parts = input.split('/').filter((entry: string) => entry.length > 0 && entry !== '.');
    const stack: string[] = [];
    for (const part of parts) {
      if (part === '..') { stack.pop(); continue; }
      stack.push(part);
    }
    return `/${stack.join('/')}`;
  }
  if (!inputPath || !inputPath.trim()) { return visibleRoot; }
  const normalized = inputPath.trim().startsWith('/')
    ? normalizeRuntimeVisiblePath(inputPath.trim())
    : normalizeRuntimeVisiblePath(`${visibleRoot}/${inputPath.trim()}`);
  if (visibleRoot !== '/' && normalized !== visibleRoot && !normalized.startsWith(`${visibleRoot}/`)) {
    throw new Error(violationMessage ?? `路径必须位于 ${visibleRoot} 内`);
  }
  return normalized;
}

function toHostPath(sessionRoot: string, virtualRoot: string, virtualPath: string): string {
  const pathModule = { resolve: (p: string) => p.replace(/\//g, '\\'), sep: '\\' } as any
  const normalizedRoot = normalizeVisiblePath(virtualRoot)
  const relativePath = virtualRoot === '/'
    ? virtualPath.replace(/^\/+/, '')
    : virtualPath === virtualRoot ? '' : virtualPath.slice(virtualRoot.length + 1);
  const hostPath = relativePath ? pathModule.join(sessionRoot, ...relativePath.split('/')) : sessionRoot;
  const resolved = pathModule.resolve(hostPath);
  return resolved;
}

function normalizeVisiblePath(input: string): string {
  const parts = input.split('/').filter((entry: string) => entry.length > 0 && entry !== '.');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '..') { stack.pop(); continue; }
    stack.push(part);
  }
  return `/${stack.join('/')}`;
}

describe('RuntimeWslShellService - pure functions', () => {
  describe('normalizeRuntimeWslShellError', () => {
    it('converts timeout error with readable message', () => {
      const err = normalizeRuntimeWslShellError(new Error('runtime-one-shot-shell-timeout'), 30000)
      expect(err.message).toContain('bash 执行超时')
      expect(err.message).toContain('30 秒')
    })

    it('passes through other errors', () => {
      const original = new Error('original error')
      const err = normalizeRuntimeWslShellError(original, 30000)
      expect(err).toBe(original)
    })

    it('wraps non-Error values', () => {
      const err = normalizeRuntimeWslShellError('string error', 30000)
      expect(err.message).toBe('bash 执行失败')
    })

    it('formats timeout with correct seconds (ceil)', () => {
      const err = normalizeRuntimeWslShellError(new Error('runtime-one-shot-shell-timeout'), 65000)
      expect(err.message).toContain('65 秒')
    })
  })

  describe('normalizeWslHostWorkdir', () => {
    it('converts /mnt/c/Users to C:\\Users', () => {
      expect(normalizeWslHostWorkdir('/mnt/c/Users/test')).toBe('C:\\Users\\test')
    })

    it('converts /mnt/d/Projects to D:\\Projects', () => {
      expect(normalizeWslHostWorkdir('/mnt/d/Projects/foo')).toBe('D:\\Projects\\foo')
    })

    it('handles /mnt/c alone as C:\\', () => {
      expect(normalizeWslHostWorkdir('/mnt/c')).toBe('C:\\')
    })

    it('handles /mnt/c/ alone as C:\\', () => {
      expect(normalizeWslHostWorkdir('/mnt/c/')).toBe('C:\\')
    })

    it('passes through non-WSL paths via resolve', () => {
      const result = normalizeWslHostWorkdir('/home/user')
      expect(result).toContain('home')
    })

    it('trims whitespace', () => {
      expect(normalizeWslHostWorkdir('  /mnt/c/Users  ')).toBe('C:\\Users')
    })
  })

  describe('readRuntimeShellToolName', () => {
    const ORIGINAL_PLATFORM = process.platform

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
    })

    it('returns bash for wsl-shell', () => {
      expect(readRuntimeShellToolName('wsl-shell')).toBe('bash')
    })

    it('returns powershell for native-shell on win32', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      expect(readRuntimeShellToolName('native-shell')).toBe('powershell')
    })

    it('returns bash for native-shell on non-win32', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      expect(readRuntimeShellToolName('native-shell')).toBe('bash')
    })

    it('returns bash for undefined backend', () => {
      expect(readRuntimeShellToolName(undefined)).toBe('bash')
    })
  })

  describe('isAbsoluteShellWorkdir', () => {
    it('returns true for Windows absolute path with wsl-shell', () => {
      expect(isAbsoluteShellWorkdir('wsl-shell', 'C:\\Users')).toBe(true)
    })

    it('returns true for Windows absolute path with native-shell', () => {
      expect(isAbsoluteShellWorkdir('native-shell', 'D:\\Projects')).toBe(true)
    })

    it('returns false for Windows absolute path with other backends', () => {
      expect(isAbsoluteShellWorkdir('bash', 'C:\\Users')).toBe(false)
    })

    it('returns true for /mnt/ path with wsl-shell', () => {
      expect(isAbsoluteShellWorkdir('wsl-shell', '/mnt/c/Users')).toBe(true)
    })

    it('returns false for /mnt/ path with non-wsl backends', () => {
      expect(isAbsoluteShellWorkdir('native-shell', '/mnt/c/Users')).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(isAbsoluteShellWorkdir('wsl-shell', '')).toBe(false)
    })

    it('returns false for whitespace-only string', () => {
      expect(isAbsoluteShellWorkdir('wsl-shell', '   ')).toBe(false)
    })

    it('returns true for UNC paths with wsl-shell', () => {
      expect(isAbsoluteShellWorkdir('wsl-shell', '\\\\server\\share')).toBe(true)
    })
  })

  describe('resolveRuntimeVisiblePath', () => {
    it('returns visibleRoot when inputPath is empty', () => {
      expect(resolveRuntimeVisiblePath('/workspace', '')).toBe('/workspace')
    })

    it('returns visibleRoot when inputPath is whitespace', () => {
      expect(resolveRuntimeVisiblePath('/workspace', '   ')).toBe('/workspace')
    })

    it('resolves absolute path', () => {
      expect(resolveRuntimeVisiblePath('/', '/foo/bar')).toBe('/foo/bar')
    })

    it('resolves relative path', () => {
      expect(resolveRuntimeVisiblePath('/workspace', 'subdir/file.txt')).toBe('/workspace/subdir/file.txt')
    })

    it('throws on path traversal outside visible root', () => {
      expect(() => resolveRuntimeVisiblePath('/workspace', '../outside')).toThrow()
    })

    it('normalizes double dots within visible root', () => {
      expect(resolveRuntimeVisiblePath('/workspace', 'a/b/../c')).toBe('/workspace/a/c')
    })

    it('normalizes single dots', () => {
      expect(resolveRuntimeVisiblePath('/workspace', './file')).toBe('/workspace/file')
    })
  })
})
