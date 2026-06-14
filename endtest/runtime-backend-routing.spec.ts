import { describe, it, expect, beforeEach, afterEach } from 'vitest'

function normalizeRuntimeBackendKind(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

describe('RuntimeBackendRoutingService', () => {
  const ENV_KEYS = {
    FILESYSTEM: 'GARLIC_CLAW_RUNTIME_FILESYSTEM_BACKEND',
    SHELL: 'GARLIC_CLAW_RUNTIME_SHELL_BACKEND',
  } as const

  beforeEach(() => {
    delete process.env[ENV_KEYS.FILESYSTEM]
    delete process.env[ENV_KEYS.SHELL]
  })

  describe('normalizeRuntimeBackendKind', () => {
    it('returns undefined when value is undefined', () => {
      expect(normalizeRuntimeBackendKind(undefined)).toBeUndefined()
    })

    it('returns undefined when value is empty string', () => {
      expect(normalizeRuntimeBackendKind('')).toBeUndefined()
    })

    it('returns undefined when value is whitespace', () => {
      expect(normalizeRuntimeBackendKind('   ')).toBeUndefined()
    })

    it('trims whitespace and returns value', () => {
      expect(normalizeRuntimeBackendKind('  native-shell  ')).toBe('native-shell')
    })

    it('returns the value as-is when valid', () => {
      expect(normalizeRuntimeBackendKind('wsl-shell')).toBe('wsl-shell')
    })

    it('accepts any non-empty string as valid backend kind', () => {
      expect(normalizeRuntimeBackendKind('custom-backend')).toBe('custom-backend')
    })
  })

  describe('getConfiguredFilesystemBackendKind', () => {
    it('returns undefined when env var is not set', () => {
      delete process.env[ENV_KEYS.FILESYSTEM]
      expect(normalizeRuntimeBackendKind(process.env[ENV_KEYS.FILESYSTEM])).toBeUndefined()
    })

    it('returns undefined when env var is empty', () => {
      process.env[ENV_KEYS.FILESYSTEM] = ''
      expect(normalizeRuntimeBackendKind(process.env[ENV_KEYS.FILESYSTEM])).toBeUndefined()
    })

    it('returns the configured filesystem backend kind', () => {
      process.env[ENV_KEYS.FILESYSTEM] = 'native-filesystem'
      expect(normalizeRuntimeBackendKind(process.env[ENV_KEYS.FILESYSTEM])).toBe('native-filesystem')
    })
  })

  describe('getConfiguredShellBackendKind', () => {
    it('returns undefined when env var is not set', () => {
      delete process.env[ENV_KEYS.SHELL]
      expect(normalizeRuntimeBackendKind(process.env[ENV_KEYS.SHELL])).toBeUndefined()
    })

    it('returns undefined when env var is empty', () => {
      process.env[ENV_KEYS.SHELL] = ''
      expect(normalizeRuntimeBackendKind(process.env[ENV_KEYS.SHELL])).toBeUndefined()
    })

    it('returns the configured shell backend kind', () => {
      process.env[ENV_KEYS.SHELL] = 'wsl-shell'
      expect(normalizeRuntimeBackendKind(process.env[ENV_KEYS.SHELL])).toBe('wsl-shell')
    })
  })

  describe('independent routing', () => {
    it('supports different backends for filesystem and shell', () => {
      process.env[ENV_KEYS.FILESYSTEM] = 'native-filesystem'
      process.env[ENV_KEYS.SHELL] = 'native-shell'
      expect(normalizeRuntimeBackendKind(process.env[ENV_KEYS.FILESYSTEM])).toBe('native-filesystem')
      expect(normalizeRuntimeBackendKind(process.env[ENV_KEYS.SHELL])).toBe('native-shell')
    })

    it('supports same backend for both', () => {
      process.env[ENV_KEYS.FILESYSTEM] = 'native'
      process.env[ENV_KEYS.SHELL] = 'native'
      expect(normalizeRuntimeBackendKind(process.env[ENV_KEYS.FILESYSTEM])).toBe('native')
      expect(normalizeRuntimeBackendKind(process.env[ENV_KEYS.SHELL])).toBe('native')
    })
  })
})
