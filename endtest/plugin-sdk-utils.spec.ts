import { describe, it, expect } from 'vitest'
import { cloneJsonValue, isOneOf, isJsonValue, isJsonObjectValue, isStringRecord, isJsonEqual, dedupeStrings } from '@garlic-claw/plugin-sdk/utils/json-value'
import { normalizePriority, computeFilterSpecificity, isEmptyMessageFilter, hasOnlyMessageFilterKey, mergeExclusiveMessageFilters, matchesMessageFilter, getMessageReceivedText, detectMessageKind, matchesMessageCommand } from '@garlic-claw/plugin-sdk/utils/message-filter'
import { normalizeCommandSegment, normalizeCommandAliases, buildCanonicalCommandPath, buildCommandVariants, renderCommandGroupHelp } from '@garlic-claw/plugin-sdk/utils/command-match'
import { normalizeRoutePath, normalizeRouteResponse } from '@garlic-claw/plugin-sdk/utils/route'
import type { MessageReceivedHookPayload, PluginHookMessageFilter } from '@garlic-claw/shared'

describe('utils/json-value', () => {
  describe('cloneJsonValue', () => {
    it('clones primitive values', () => {
      expect(cloneJsonValue(42)).toBe(42)
      expect(cloneJsonValue('hello')).toBe('hello')
      expect(cloneJsonValue(null)).toBe(null)
      expect(cloneJsonValue(true)).toBe(true)
    })

    it('deep clones nested objects', () => {
      const input = { a: { b: [1, 2, { c: 3 }] } }
      const output = cloneJsonValue(input)
      expect(output).toEqual(input)
      expect(output).not.toBe(input)
      expect(output.a).not.toBe(input.a)
      expect(output.a.b).not.toBe(input.a.b)
    })
  })

  describe('isOneOf', () => {
    it('returns true if value is in options', () => {
      expect(isOneOf('a', ['a', 'b', 'c'])).toBe(true)
    })

    it('returns false if value is not in options', () => {
      expect(isOneOf('d', ['a', 'b', 'c'])).toBe(false)
    })

    it('returns false for non-string values', () => {
      expect(isOneOf(1, ['1', '2'])).toBe(false)
      expect(isOneOf(null, ['null'])).toBe(false)
    })
  })

  describe('isJsonValue', () => {
    it('accepts primitives', () => {
      expect(isJsonValue(null)).toBe(true)
      expect(isJsonValue('str')).toBe(true)
      expect(isJsonValue(123)).toBe(true)
      expect(isJsonValue(false)).toBe(true)
    })

    it('accepts arrays of valid json values', () => {
      expect(isJsonValue([1, 'a', null, true])).toBe(true)
    })

    it('accepts objects with valid json values', () => {
      expect(isJsonValue({ a: 1, b: 'c' })).toBe(true)
    })

    it('rejects functions', () => {
      expect(isJsonValue(() => {})).toBe(false)
    })

    it('rejects nested functions in objects', () => {
      expect(isJsonValue({ a: () => {} })).toBe(false)
    })
  })

  describe('isJsonObjectValue', () => {
    it('accepts plain objects', () => {
      expect(isJsonObjectValue({ a: 1 })).toBe(true)
    })

    it('rejects arrays', () => {
      expect(isJsonObjectValue([1, 2])).toBe(false)
    })

    it('rejects null', () => {
      expect(isJsonObjectValue(null)).toBe(false)
    })
  })

  describe('isStringRecord', () => {
    it('accepts record of strings', () => {
      expect(isStringRecord({ a: '1', b: '2' })).toBe(true)
    })

    it('rejects record with non-string values', () => {
      expect(isStringRecord({ a: 1 })).toBe(false)
    })
  })

  describe('isJsonEqual', () => {
    it('compares by JSON serialization', () => {
      expect(isJsonEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
    })

    it('detects inequality', () => {
      expect(isJsonEqual({ a: 1 }, { a: 2 })).toBe(false)
    })
  })

  describe('dedupeStrings', () => {
    it('removes duplicates while preserving order', () => {
      expect(dedupeStrings(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c'])
    })

    it('returns empty array for empty input', () => {
      expect(dedupeStrings([])).toEqual([])
    })
  })
})

describe('utils/message-filter', () => {
  describe('normalizePriority', () => {
    it('returns 0 for undefined', () => {
      expect(normalizePriority(undefined)).toBe(0)
    })

    it('truncates float to integer', () => {
      expect(normalizePriority(3.9)).toBe(3)
    })

    it('passes through integers', () => {
      expect(normalizePriority(10)).toBe(10)
    })
  })

  describe('computeFilterSpecificity', () => {
    it('returns 0 for no filter', () => {
      expect(computeFilterSpecificity(undefined)).toBe(0)
    })

    it('counts command words', () => {
      expect(computeFilterSpecificity({ commands: ['/foo bar baz'] })).toBe(3)
    })

    it('adds 1 for regex filter', () => {
      expect(computeFilterSpecificity({ regex: { pattern: 'test' } })).toBe(1)
    })

    it('adds 1 for messageKinds', () => {
      expect(computeFilterSpecificity({ messageKinds: ['text', 'image'] })).toBe(1)
    })
  })

  describe('isEmptyMessageFilter', () => {
    it('returns true for empty filter', () => {
      expect(isEmptyMessageFilter({})).toBe(true)
    })

    it('returns false for filter with commands', () => {
      expect(isEmptyMessageFilter({ commands: ['/help'] })).toBe(false)
    })
  })

  describe('hasOnlyMessageFilterKey', () => {
    it('returns true when only one key is active', () => {
      expect(hasOnlyMessageFilterKey({ commands: ['/help'] }, 'commands')).toBe(true)
    })

    it('returns false when multiple keys', () => {
      expect(hasOnlyMessageFilterKey({ commands: ['/help'], regex: { pattern: 'x' } }, 'commands')).toBe(false)
    })
  })

  describe('mergeExclusiveMessageFilters', () => {
    it('returns undefined for empty array', () => {
      expect(mergeExclusiveMessageFilters([])).toBeUndefined()
    })

    it('returns undefined if any filter is empty', () => {
      expect(mergeExclusiveMessageFilters([{ commands: ['/help'] }, {}])).toBeUndefined()
    })

    it('merges command filters', () => {
      const result = mergeExclusiveMessageFilters([
        { commands: ['/help'] },
        { commands: ['/status'] },
      ])
      expect(result).toEqual({ commands: ['/help', '/status'] })
    })

    it('returns undefined for mixed key types', () => {
      expect(mergeExclusiveMessageFilters([
        { commands: ['/help'] },
        { regex: { pattern: 'test' } },
      ])).toBeUndefined()
    })

    it('merges regex filters', () => {
      const result = mergeExclusiveMessageFilters([
        { regex: { pattern: 'foo' } },
        { regex: { pattern: 'bar' } },
      ])
      expect(result?.regex).toBeDefined()
    })

    it('merges messageKinds', () => {
      const result = mergeExclusiveMessageFilters([
        { messageKinds: ['text'] },
        { messageKinds: ['image'] },
      ])
      expect(result).toEqual({ messageKinds: ['text', 'image'] })
    })
  })

  describe('getMessageReceivedText', () => {
    it('extracts text content from string', () => {
      const payload = { message: { content: 'hello world', parts: [] }, context: { source: 'plugin' }, conversationId: 'c1', providerId: 'p1', modelId: 'm1', modelMessages: [] }
      expect(getMessageReceivedText(payload as unknown as MessageReceivedHookPayload)).toBe('hello world')
    })

    it('extracts text from parts when content is null', () => {
      const payload = { message: { content: null, parts: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }] }, context: { source: 'plugin' }, conversationId: 'c1', providerId: 'p1', modelId: 'm1', modelMessages: [] }
      expect(getMessageReceivedText(payload as unknown as MessageReceivedHookPayload)).toBe('hello\nworld')
    })
  })

  describe('detectMessageKind', () => {
    it('detects text kind', () => {
      const payload = { message: { content: 'hello', parts: [] }, context: { source: 'plugin' }, conversationId: 'c1', providerId: 'p1', modelId: 'm1', modelMessages: [] }
      expect(detectMessageKind(payload as unknown as MessageReceivedHookPayload)).toBe('text')
    })

    it('detects image kind', () => {
      const payload = { message: { content: null, parts: [{ type: 'image', image: 'data:...' }] }, context: { source: 'plugin' }, conversationId: 'c1', providerId: 'p1', modelId: 'm1', modelMessages: [] }
      expect(detectMessageKind(payload as unknown as MessageReceivedHookPayload)).toBe('image')
    })

    it('detects mixed kind', () => {
      const payload = { message: { content: 'desc', parts: [{ type: 'image', image: 'data:...' }] }, context: { source: 'plugin' }, conversationId: 'c1', providerId: 'p1', modelId: 'm1', modelMessages: [] }
      expect(detectMessageKind(payload as unknown as MessageReceivedHookPayload)).toBe('mixed')
    })
  })

  describe('matchesMessageCommand', () => {
    it('matches exact command', () => {
      expect(matchesMessageCommand('/help', '/help')).toBe(true)
    })

    it('matches command with args', () => {
      expect(matchesMessageCommand('/help me', '/help')).toBe(true)
    })

    it('rejects partial prefix match', () => {
      expect(matchesMessageCommand('/helpful', '/help')).toBe(false)
    })

    it('returns false for empty command', () => {
      expect(matchesMessageCommand('hello', '')).toBe(false)
    })
  })

  describe('matchesMessageFilter', () => {
    const basePayload = { message: { content: '/help status', parts: [] }, context: { source: 'plugin' }, conversationId: 'c1', providerId: 'p1', modelId: 'm1', modelMessages: [] } as unknown as MessageReceivedHookPayload

    it('returns true for undefined filter', () => {
      expect(matchesMessageFilter(basePayload, undefined)).toBe(true)
    })

    it('matches command filter', () => {
      const filter: PluginHookMessageFilter = { commands: ['/help'] }
      expect(matchesMessageFilter(basePayload, filter)).toBe(true)
    })

    it('rejects non-matching command filter', () => {
      const filter: PluginHookMessageFilter = { commands: ['/status'] }
      expect(matchesMessageFilter(basePayload, filter)).toBe(false)
    })

    it('matches regex filter', () => {
      const filter: PluginHookMessageFilter = { regex: { pattern: 'help' } }
      expect(matchesMessageFilter(basePayload, filter)).toBe(true)
    })
  })
})

describe('utils/command-match', () => {
  describe('normalizeCommandSegment', () => {
    it('trims leading slashes', () => {
      expect(normalizeCommandSegment('//foo')).toBe('foo')
    })

    it('throws on empty after normalization', () => {
      expect(() => normalizeCommandSegment('/')).toThrow('命令名不能为空')
    })

    it('throws on whitespace', () => {
      expect(() => normalizeCommandSegment('foo bar')).toThrow('不能包含空白字符')
    })
  })

  describe('normalizeCommandAliases', () => {
    it('returns empty for undefined', () => {
      expect(normalizeCommandAliases(undefined)).toEqual([])
    })

    it('normalizes all aliases', () => {
      expect(normalizeCommandAliases(['/foo', '//bar'])).toEqual(['foo', 'bar'])
    })
  })

  describe('buildCanonicalCommandPath', () => {
    it('builds canonical path', () => {
      expect(buildCanonicalCommandPath(['foo', 'bar'])).toBe('/foo bar')
    })
  })

  describe('buildCommandVariants', () => {
    it('builds variants from descriptors', () => {
      const result = buildCommandVariants([
        { segment: 'foo', aliases: ['f'] },
        { segment: 'bar', aliases: ['b'] },
      ])
      expect(result).toContain('/foo bar')
      expect(result).toContain('/f bar')
      expect(result).toContain('/foo b')
      expect(result).toContain('/f b')
      expect(result).toHaveLength(4)
    })
  })

  describe('renderCommandGroupHelp', () => {
    it('renders group help with commands', () => {
      const group = {
        segment: 'tools',
        aliases: [],
        canonicalCommand: '/tools',
        children: [],
        commands: [
          { path: ['tools', 'echo'], variants: ['/tools echo', '/tools e'], description: 'Echo text' },
        ],
      }
      const help = renderCommandGroupHelp(group)
      expect(help).toContain('/tools')
      expect(help).toContain('echo')
      expect(help).toContain('Echo text')
    })

    it('renders empty group with description', () => {
      const group = {
        segment: 'empty',
        aliases: [],
        canonicalCommand: '/empty',
        description: 'No commands',
        children: [],
        commands: [],
      }
      expect(renderCommandGroupHelp(group)).toContain('No commands')
    })
  })
})

describe('utils/route', () => {
  describe('normalizeRoutePath', () => {
    it('trims leading slashes', () => {
      expect(normalizeRoutePath('//foo/bar//')).toBe('foo/bar')
    })

    it('trims trailing slashes', () => {
      expect(normalizeRoutePath('foo/bar///')).toBe('foo/bar')
    })
  })

  describe('normalizeRouteResponse', () => {
    it('defaults status to 200', () => {
      expect(normalizeRouteResponse({ body: {} })).toEqual({ status: 200, body: {} })
    })

    it('preserves existing status', () => {
      expect(normalizeRouteResponse({ status: 404, body: { error: 'Not found' } })).toEqual({ status: 404, body: { error: 'Not found' } })
    })
  })
})
