import { describe, it, expect } from 'vitest'

type RuntimeToolBackendRole = 'filesystem' | 'shell';

interface RuntimeToolAccessRequest {
  backendKind: string;
  role: RuntimeToolBackendRole;
  requiredOperations: string[];
  summary: string;
  metadata?: Record<string, unknown>;
}

describe('RuntimeToolAccess types', () => {
  it('constructs a filesystem tool access request', () => {
    const req: RuntimeToolAccessRequest = {
      backendKind: 'native-filesystem',
      role: 'filesystem',
      requiredOperations: ['file.read', 'file.write'],
      summary: 'Read and write files',
    }
    expect(req.backendKind).toBe('native-filesystem')
    expect(req.role).toBe('filesystem')
    expect(req.requiredOperations).toEqual(['file.read', 'file.write'])
    expect(req.summary).toBe('Read and write files')
    expect(req.metadata).toBeUndefined()
  })

  it('constructs a shell tool access request', () => {
    const req: RuntimeToolAccessRequest = {
      backendKind: 'native-shell',
      role: 'shell',
      requiredOperations: ['command.execute'],
      summary: 'Execute shell commands',
      metadata: { cwd: '/workspace' },
    }
    expect(req.backendKind).toBe('native-shell')
    expect(req.role).toBe('shell')
    expect(req.metadata).toEqual({ cwd: '/workspace' })
  })

  it('accepts wsl-shell backend kind', () => {
    const req: RuntimeToolAccessRequest = {
      backendKind: 'wsl-shell',
      role: 'shell',
      requiredOperations: ['command.execute'],
      summary: 'WSL shell',
    }
    expect(req.backendKind).toBe('wsl-shell')
  })

  it('accepts arbitrary backend kind strings', () => {
    const req: RuntimeToolAccessRequest = {
      backendKind: 'custom-backend-v2',
      role: 'filesystem',
      requiredOperations: ['file.list'],
      summary: 'Custom',
    }
    expect(req.backendKind).toBe('custom-backend-v2')
  })

  it('accepts empty required operations', () => {
    const req: RuntimeToolAccessRequest = {
      backendKind: 'test',
      role: 'shell',
      requiredOperations: [],
      summary: 'No ops',
    }
    expect(req.requiredOperations).toEqual([])
  })

  it('accepts multiple required operations', () => {
    const req: RuntimeToolAccessRequest = {
      backendKind: 'test',
      role: 'filesystem',
      requiredOperations: ['file.read', 'file.write', 'file.edit', 'file.delete'],
      summary: 'Full filesystem access',
    }
    expect(req.requiredOperations).toHaveLength(4)
  })
})
