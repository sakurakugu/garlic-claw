import { describe, it, expect } from 'vitest'

function isJsonArray(value: unknown): value is unknown[] { return Array.isArray(value) && value.every((entry) => isJsonValue(entry)) }
function isJsonObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((entry) => isJsonValue(entry)) }
function isJsonValue(value: unknown): value is unknown { return value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string' || isJsonArray(value) || isJsonObject(value) }

function cloneJsonValue<T>(value: T): T { return structuredClone(value) }

function readOptionalString(params: Record<string, unknown>, key: string): string | null {
  const value = params[key]; const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || null
}

function readPositiveInteger(params: Record<string, unknown>, key: string): number | null {
  const value = params[key]
  if (value === undefined) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null
  return value
}

function readRequiredString(params: Record<string, unknown>, key: string): string {
  const value = readOptionalString(params, key)
  if (value) return value
  throw new Error(`${key} 不能为空`)
}

const KB_ENTRIES = [{
  id: 'kb-plugin-runtime',
  title: '统一插件运行时',
  excerpt: 'Garlic Claw 使用 builtin 与 remote 统一插件运行时。',
  content: 'Garlic Claw 使用 builtin 与 remote 统一插件运行时。',
  tags: ['plugin', 'runtime'],
  createdAt: '2026-03-28T02:00:00.000Z',
  updatedAt: '2026-03-28T02:00:00.000Z',
}]

function getKbEntry(params: Record<string, unknown>): unknown {
  const entryId = readRequiredString(params, 'entryId')
  const entry = KB_ENTRIES.find((item) => item.id === entryId)
  if (entry) return cloneJsonValue(entry)
  throw new Error(`KB entry not found: ${entryId}`)
}

function listKbEntries(params: Record<string, unknown>): unknown {
  const limit = readPositiveInteger(params, 'limit') ?? 20
  return KB_ENTRIES.slice(0, limit).map((entry) => cloneJsonValue({
    createdAt: entry.createdAt,
    excerpt: entry.excerpt,
    id: entry.id,
    tags: [...entry.tags],
    title: entry.title,
    updatedAt: entry.updatedAt,
  }))
}

function searchKbEntries(params: Record<string, unknown>): unknown {
  const limit = readPositiveInteger(params, 'limit') ?? 5
  const query = readRequiredString(params, 'query').toLowerCase()
  return KB_ENTRIES
    .filter((entry) => entry.title.toLowerCase().includes(query) || entry.excerpt.toLowerCase().includes(query) || entry.content.toLowerCase().includes(query) || entry.tags.some((tag) => tag.toLowerCase().includes(query)))
    .slice(0, limit)
    .map((entry) => cloneJsonValue(entry))
}

describe('KnowledgeReaderService', () => {
  describe('getKbEntry', () => {
    it('returns entry by id', () => {
      const result = getKbEntry({ entryId: 'kb-plugin-runtime' }) as any
      expect(result.id).toBe('kb-plugin-runtime')
      expect(result.title).toBe('统一插件运行时')
      expect(result.tags).toEqual(['plugin', 'runtime'])
    })

    it('throws for unknown entryId', () => {
      expect(() => getKbEntry({ entryId: 'nonexistent' })).toThrow('KB entry not found')
    })

    it('throws for missing entryId', () => {
      expect(() => getKbEntry({})).toThrow('不能为空')
    })

    it('returns a deep clone (immutable)', () => {
      const a = getKbEntry({ entryId: 'kb-plugin-runtime' }) as any
      const b = getKbEntry({ entryId: 'kb-plugin-runtime' }) as any
      expect(a).toEqual(b)
      expect(a).not.toBe(b)
    })
  })

  describe('listKbEntries', () => {
    it('returns all entries by default', () => {
      const result = listKbEntries({}) as any[]
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('kb-plugin-runtime')
    })

    it('excludes content field from listing', () => {
      const result = listKbEntries({}) as any
      expect(result[0].content).toBeUndefined()
    })

    it('includes excerpt field', () => {
      const result = listKbEntries({}) as any
      expect(result[0].excerpt).toBeTruthy()
    })

    it('returns deep clones', () => {
      const result = listKbEntries({}) as any
      expect(result[0].tags).not.toBe(KB_ENTRIES[0].tags)
    })
  })

  describe('searchKbEntries', () => {
    it('finds by title match', () => {
      const result = searchKbEntries({ query: '统一' }) as any[]
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('kb-plugin-runtime')
    })

    it('finds by tag match', () => {
      const result = searchKbEntries({ query: 'plugin' }) as any[]
      expect(result).toHaveLength(1)
    })

    it('is case-insensitive', () => {
      const result = searchKbEntries({ query: 'PLUGIN' }) as any[]
      expect(result).toHaveLength(1)
    })

    it('returns empty array for no match', () => {
      const result = searchKbEntries({ query: 'nonexistent' }) as any[]
      expect(result).toHaveLength(0)
    })

    it('positive integer limit restricts results', () => {
      const resultLimit = searchKbEntries({ query: 'plugin', limit: 1 }) as any[]
      expect(resultLimit).toHaveLength(1)
    })

    it('throws for missing query', () => {
      expect(() => searchKbEntries({})).toThrow('不能为空')
    })

    it('returns deep clones', () => {
      const result = searchKbEntries({ query: 'runtime' }) as any
      expect(result).toHaveLength(1)
    })
  })
})
