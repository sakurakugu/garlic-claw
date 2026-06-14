import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

function buildOneShotPowerShellScript(command: string): string {
  const safeCommand = command.replace(/\r\n/g, '\n');
  const base64Command = Buffer.from(safeCommand, 'utf8').toString('base64');
  return [
    '$ErrorActionPreference = "Stop"',
    '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    'chcp 65001 > $null',
    '$global:LASTEXITCODE = 0',
    '$__gc_status = 0',
    '$__gc_user_command = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String(\'' + base64Command + '\'))',
    'try { Invoke-Expression -Command $__gc_user_command; $__gc_status = [int]$LASTEXITCODE } catch { [Console]::Error.WriteLine($_.Exception.Message); $__gc_status = 1 }',
    'exit $__gc_status',
  ].join('\n');
}

function usesOneShotPowerShell(backendKind: string): boolean {
  return process.platform === 'win32'
    && backendKind.includes('native-shell')
    && !backendKind.includes('wsl');
}

function toWslPath(hostPath: string): string {
  const normalized = hostPath.replace(/\//g, '\\');
  const driveMatch = normalized.match(/^([A-Za-z]):\\(.*)$/u);
  if (driveMatch) {
    const drive = driveMatch[1].toLowerCase();
    const rest = driveMatch[2].replace(/\\/g, '/');
    return `/mnt/${drive}/${rest}`;
  }
  return normalized.replace(/\\/g, '/');
}

function normalizeOneShotOutput(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

interface RuntimeOneShotShellInput {
  backendKind: string;
  command: string;
  cwd: string;
  timeoutMs: number;
}

interface OneShotSpawnArgs {
  command: string;
  args: string[];
  cwd: string;
}

function buildOneShotSpawnArgs(input: RuntimeOneShotShellInput): OneShotSpawnArgs[] {
  if (input.backendKind === 'wsl-shell') {
    return [{
      command: 'wsl.exe',
      args: ['--cd', toWslPath(input.cwd), 'bash', '--noprofile', '--norc', '-c', input.command],
      cwd: process.cwd(),
    }];
  }
  if (usesOneShotPowerShell(input.backendKind)) {
    const encodedScript = buildOneShotPowerShellScript(input.command);
    return ['pwsh.exe', 'pwsh', 'powershell.exe', 'powershell'].map((command) => ({
      command,
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', encodedScript],
      cwd: input.cwd,
    }));
  }
  return [{
    command: 'bash',
    args: ['--noprofile', '--norc', '-c', input.command],
    cwd: input.cwd,
  }];
}

describe('RuntimeOneShotShellService - pure functions', () => {
  const ORIGINAL_PLATFORM = process.platform

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
  })

  describe('normalizeOneShotOutput', () => {
    it('converts CRLF to LF', () => {
      expect(normalizeOneShotOutput('line1\r\nline2\r\n')).toBe('line1\nline2\n')
    })

    it('leaves LF alone', () => {
      expect(normalizeOneShotOutput('line1\nline2\n')).toBe('line1\nline2\n')
    })

    it('handles empty string', () => {
      expect(normalizeOneShotOutput('')).toBe('')
    })
  })

  describe('toWslPath', () => {
    it('converts C:\\ path to /mnt/c/ path', () => {
      expect(toWslPath('C:\\Users\\test')).toBe('/mnt/c/Users/test')
    })

    it('handles D:\\ paths', () => {
      expect(toWslPath('D:\\Projects\\foo')).toBe('/mnt/d/Projects/foo')
    })

    it('handles forward slashes too', () => {
      expect(toWslPath('C:/Users/test')).toBe('/mnt/c/Users/test')
    })

    it('handles root drive', () => {
      expect(toWslPath('C:\\')).toBe('/mnt/c/')
    })
  })

  describe('buildOneShotPowerShellScript', () => {
    it('encodes command in base64', () => {
      const script = buildOneShotPowerShellScript('echo hello')
      const expectedB64 = Buffer.from('echo hello', 'utf8').toString('base64')
      expect(script).toContain(expectedB64)
    })

    it('normalizes CRLF to LF', () => {
      const script = buildOneShotPowerShellScript('echo hello\r\necho world')
      const expectedB64 = Buffer.from('echo hello\necho world', 'utf8').toString('base64')
      expect(script).toContain(expectedB64)
    })

    it('includes UTF-8 encoding settings', () => {
      const script = buildOneShotPowerShellScript('echo test')
      expect(script).toContain('$OutputEncoding = [System.Text.UTF8Encoding]::new($false)')
      expect(script).toContain('[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)')
      expect(script).toContain('[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)')
      expect(script).toContain('chcp 65001 > $null')
    })

    it('includes error handling', () => {
      const script = buildOneShotPowerShellScript('echo test')
      expect(script).toContain('Invoke-Expression')
      expect(script).toContain('$__gc_status = 1')
      expect(script).toContain('exit $__gc_status')
    })
  })

  describe('usesOneShotPowerShell', () => {
    it('returns true on win32 with native-shell backend', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      expect(usesOneShotPowerShell('native-shell')).toBe(true)
    })

    it('returns false on win32 with wsl backend', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      expect(usesOneShotPowerShell('wsl-shell')).toBe(false)
    })

    it('returns false on non-win32 platform', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      expect(usesOneShotPowerShell('native-shell')).toBe(false)
    })

    it('returns false for other backends on win32', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      expect(usesOneShotPowerShell('bash')).toBe(false)
    })
  })

  describe('buildOneShotSpawnArgs', () => {
    it('builds bash args for non-wsl non-win32 backends', () => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      const args = buildOneShotSpawnArgs({ backendKind: 'bash', command: 'ls -la', cwd: '/home', timeoutMs: 5000 })
      expect(args).toHaveLength(1)
      expect(args[0].command).toBe('bash')
      expect(args[0].args).toContain('--noprofile')
      expect(args[0].args).toContain('--norc')
      expect(args[0].args).toContain('-c')
      expect(args[0].args).toContain('ls -la')
    })

    it('builds wsl args for wsl-shell backend', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      const args = buildOneShotSpawnArgs({ backendKind: 'wsl-shell', command: 'ls -la', cwd: 'C:\\Users', timeoutMs: 5000 })
      expect(args).toHaveLength(1)
      expect(args[0].command).toBe('wsl.exe')
      expect(args[0].args).toContain('--cd')
      expect(args[0].args).toContain('/mnt/c/Users')
      expect(args[0].cwd).toBe(process.cwd())
    })

    it('builds PowerShell args for native-shell on win32', () => {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      const args = buildOneShotSpawnArgs({ backendKind: 'native-shell', command: 'dir', cwd: 'C:\\', timeoutMs: 5000 })
      expect(args.length).toBeGreaterThan(0)
      for (const candidate of args) {
        expect(candidate.args).toContain('-NoLogo')
        expect(candidate.args).toContain('-NoProfile')
        expect(candidate.args).toContain('-NonInteractive')
        expect(candidate.args).toContain('-ExecutionPolicy')
        expect(candidate.args).toContain('Bypass')
      }
    })
  })
})
