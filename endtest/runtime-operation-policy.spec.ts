import { describe, it, expect } from 'vitest'

const RUNTIME_OPERATION_CAPABILITIES: Record<string, string[]> = {
  'command.execute': ['shellExecution', 'workspaceRead', 'workspaceWrite', 'persistentFilesystem'],
  'file.delete': ['workspaceWrite', 'persistentFilesystem'],
  'file.edit': ['workspaceRead', 'workspaceWrite', 'persistentFilesystem'],
  'file.list': ['workspaceRead', 'persistentFilesystem'],
  'file.read': ['workspaceRead', 'persistentFilesystem'],
  'file.symlink': ['workspaceWrite', 'persistentFilesystem'],
  'file.write': ['workspaceWrite', 'persistentFilesystem'],
  'network.access': ['networkAccess'],
};

function expandRuntimeOperationsToCapabilities(operations: string[]): string[] {
  const capabilities = new Set<string>();
  for (const operation of operations) {
    for (const capability of RUNTIME_OPERATION_CAPABILITIES[operation]) {
      capabilities.add(capability);
    }
  }
  return [...capabilities];
}

describe('expandRuntimeOperationsToCapabilities', () => {
  it('expands command.execute to 4 capabilities', () => {
    const result = expandRuntimeOperationsToCapabilities(['command.execute'])
    expect(result).toEqual(['shellExecution', 'workspaceRead', 'workspaceWrite', 'persistentFilesystem'])
  })

  it('expands file.delete', () => {
    const result = expandRuntimeOperationsToCapabilities(['file.delete'])
    expect(result).toEqual(['workspaceWrite', 'persistentFilesystem'])
  })

  it('expands file.edit', () => {
    const result = expandRuntimeOperationsToCapabilities(['file.edit'])
    expect(result).toEqual(['workspaceRead', 'workspaceWrite', 'persistentFilesystem'])
  })

  it('expands file.list', () => {
    const result = expandRuntimeOperationsToCapabilities(['file.list'])
    expect(result).toEqual(['workspaceRead', 'persistentFilesystem'])
  })

  it('expands file.read', () => {
    const result = expandRuntimeOperationsToCapabilities(['file.read'])
    expect(result).toEqual(['workspaceRead', 'persistentFilesystem'])
  })

  it('expands file.symlink', () => {
    const result = expandRuntimeOperationsToCapabilities(['file.symlink'])
    expect(result).toEqual(['workspaceWrite', 'persistentFilesystem'])
  })

  it('expands file.write', () => {
    const result = expandRuntimeOperationsToCapabilities(['file.write'])
    expect(result).toEqual(['workspaceWrite', 'persistentFilesystem'])
  })

  it('expands network.access', () => {
    const result = expandRuntimeOperationsToCapabilities(['network.access'])
    expect(result).toEqual(['networkAccess'])
  })

  it('deduplicates capabilities from multiple operations', () => {
    const result = expandRuntimeOperationsToCapabilities(['file.read', 'file.write', 'command.execute'])
    expect(result).toContain('workspaceRead')
    expect(result).toContain('workspaceWrite')
    expect(result).toContain('persistentFilesystem')
    expect(result).toContain('shellExecution')
    expect(result.length).toBe(4)
  })

  it('returns empty for empty operations list', () => {
    const result = expandRuntimeOperationsToCapabilities([])
    expect(result).toEqual([])
  })

  it('handles single unique capability operation', () => {
    const result = expandRuntimeOperationsToCapabilities(['network.access'])
    expect(result).toEqual(['networkAccess'])
  })

  it('merges overlapping capabilities', () => {
    const result = expandRuntimeOperationsToCapabilities(['file.edit', 'file.delete'])
    expect(result).toEqual(['workspaceRead', 'workspaceWrite', 'persistentFilesystem'])
  })

  it('all 8 operations produce correct union of all capability names', () => {
    const result = expandRuntimeOperationsToCapabilities([
      'command.execute', 'file.delete', 'file.edit', 'file.list',
      'file.read', 'file.symlink', 'file.write', 'network.access',
    ])
    expect(result.sort()).toEqual([
      'networkAccess', 'persistentFilesystem', 'shellExecution', 'workspaceRead', 'workspaceWrite',
    ].sort())
  })
})
