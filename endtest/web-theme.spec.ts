import { describe, it, expect } from 'vitest'
import { getPreset, presetMap, themePresets, DEFAULT_PRESET_ID, STORAGE_KEY } from '@/shared/theme/constants'
import { PRIMITIVE, ALIAS, DEPTH, ALIAS_TO_PRIMITIVE, PRIMITIVE_KEYS, ALIAS_KEYS, DEPTH_KEYS, ALL_TOKEN_KEYS } from '@/shared/theme/registry'
import { TOKEN_GROUPS, GROUP_IDS, GROUP_LIST, TOKEN_TO_GROUP, getGroup, getTokenGroup } from '@/shared/theme/groups'
import { computeThemeBase } from '@/shared/theme/tokens'
import { computeAliases, computeAllTokens, validateAliases } from '@/shared/theme/aliases'
import { computeDepthTokens } from '@/shared/theme/depth'
import { computeDiff } from '@/shared/theme/diff'
import { computeTokenHash, devFreezeTokens } from '@/shared/utils/freeze'
import type { TokenMap } from '@/shared/theme/types'

describe('constants', () => {
  it('has DEFAULT_PRESET_ID set to natural', () => {
    expect(DEFAULT_PRESET_ID).toBe('natural')
  })

  it('STORAGE_KEY is set', () => {
    expect(STORAGE_KEY).toBe('garlic-claw:appearance')
  })

  it('contains 6 theme presets', () => {
    expect(themePresets).toHaveLength(6)
  })

  it('each preset has required fields', () => {
    for (const p of themePresets) {
      expect(p).toHaveProperty('id')
      expect(p).toHaveProperty('name')
      expect(typeof p.hue).toBe('number')
      expect(typeof p.saturation).toBe('number')
      expect(p.light).toHaveProperty('backgroundLightness')
      expect(p.dark).toHaveProperty('backgroundLightness')
    }
  })

  it('all presets are in presetMap', () => {
    for (const p of themePresets) {
      expect(presetMap[p.id]).toBe(p)
    }
  })

  it('getPreset returns correct preset by id', () => {
    expect(getPreset('blue').hue).toBe(220)
  })

  it('getPreset returns default for unknown id', () => {
    expect(getPreset('nonexistent').id).toBe(DEFAULT_PRESET_ID)
  })

  it('natural preset has hue=200 saturation=16', () => {
    const natural = getPreset('natural')
    expect(natural.hue).toBe(200)
    expect(natural.saturation).toBe(16)
  })
})

describe('registry', () => {
  it('PRIMITIVE has all expected keys', () => {
    expect(PRIMITIVE.hue).toBe('--hue')
    expect(PRIMITIVE.background).toBe('--background')
    expect(PRIMITIVE.foreground).toBe('--foreground')
    expect(PRIMITIVE.primary).toBe('--primary')
    expect(PRIMITIVE.glassBg).toBe('--glass-bg')
    expect(PRIMITIVE.atmosphere1).toBe('--atmosphere-1')
    expect(PRIMITIVE.glassReflection).toBe('--glass-reflection')
  })

  it('ALIAS has all expected keys', () => {
    expect(ALIAS.gcHue).toBe('--gc-hue')
    expect(ALIAS.gcBackground).toBe('--gc-background')
    expect(ALIAS.gcForeground).toBe('--gc-foreground')
    expect(ALIAS.gcPrimary).toBe('--gc-primary')
    expect(ALIAS.gcGlassBg).toBe('--gc-glass-bg')
    expect(ALIAS.gcInteractiveHoverBg).toBe('--gc-interactive-hover-bg')
  })

  it('DEPTH has all expected keys', () => {
    expect(DEPTH.gcShadowSm).toBe('--gc-shadow-sm')
    expect(DEPTH.gcSurfaceBase).toBe('--gc-surface-base')
    expect(DEPTH.gcZModal).toBe('--gc-z-modal')
    expect(DEPTH.gcBlurStandard).toBe('--gc-blur-standard')
    expect(DEPTH.gcTransitionFast).toBe('--gc-transition-fast')
    expect(DEPTH.gcScrollbarThumbBg).toBe('--gc-scrollbar-thumb-bg')
  })

  it('PRIMITIVE_KEYS includes all primitive token keys', () => {
    expect(PRIMITIVE_KEYS).toContain('--hue')
    expect(PRIMITIVE_KEYS).toContain('--background')
    expect(PRIMITIVE_KEYS).toContain('--atmosphere-1')
  })

  it('ALIAS_KEYS includes all alias token keys', () => {
    expect(ALIAS_KEYS).toContain('--gc-hue')
    expect(ALIAS_KEYS).toContain('--gc-background')
    expect(ALIAS_KEYS).toContain('--gc-interactive-hover-bg')
  })

  it('DEPTH_KEYS includes all depth token keys', () => {
    expect(DEPTH_KEYS).toContain('--gc-shadow-sm')
    expect(DEPTH_KEYS).toContain('--gc-surface-base')
    expect(DEPTH_KEYS).toContain('--gc-z-tooltip')
  })

  it('ALL_TOKEN_KEYS combines all token key arrays', () => {
    expect(ALL_TOKEN_KEYS.length).toBe(PRIMITIVE_KEYS.length + ALIAS_KEYS.length + DEPTH_KEYS.length)
  })

  it('ALIAS_TO_PRIMITIVE maps every alias to a primitive (some interactive state aliases lack mapping)', () => {
    const orphans: string[] = []
    for (const aliasKey of ALIAS_KEYS) {
      if (!ALIAS_TO_PRIMITIVE[aliasKey]) orphans.push(aliasKey)
    }
    // Interactive state aliases have no primitive mapping — known gap
    expect(orphans).toEqual([
      '--gc-interactive-hover-bg',
      '--gc-interactive-active-bg',
      '--gc-interactive-focus-ring',
      '--gc-interactive-glow',
    ])
  })

  it('ALIAS_TO_PRIMITIVE mappings are correct', () => {
    expect(ALIAS_TO_PRIMITIVE['--gc-hue']).toBe('--hue')
    expect(ALIAS_TO_PRIMITIVE['--gc-background']).toBe('--background')
    expect(ALIAS_TO_PRIMITIVE['--gc-primary']).toBe('--primary')
    expect(ALIAS_TO_PRIMITIVE['--gc-glass-bg']).toBe('--glass-bg')
  })
})

describe('groups', () => {
  it('TOKEN_GROUPS has all 9 groups', () => {
    expect(Object.keys(TOKEN_GROUPS)).toHaveLength(9)
  })

  it('GROUP_IDS contains all group ids', () => {
    expect(GROUP_IDS).toContain('base')
    expect(GROUP_IDS).toContain('surface')
    expect(GROUP_IDS).toContain('text')
    expect(GROUP_IDS).toContain('interactive')
    expect(GROUP_IDS).toContain('overlay')
    expect(GROUP_IDS).toContain('effect')
    expect(GROUP_IDS).toContain('atmosphere')
    expect(GROUP_IDS).toContain('material')
    expect(GROUP_IDS).toContain('depth')
  })

  it('getGroup returns correct group', () => {
    expect(getGroup('base').label).toBe('Base')
    expect(getGroup('surface').keys).toContain('--gc-background')
  })

  it('getTokenGroup returns correct group for token', () => {
    expect(getTokenGroup('--gc-hue')).toBe('base')
    expect(getTokenGroup('--gc-background')).toBe('surface')
    expect(getTokenGroup('--gc-foreground')).toBe('text')
    expect(getTokenGroup('--gc-primary')).toBe('interactive')
  })

  it('getTokenGroup returns undefined for unknown token', () => {
    expect(getTokenGroup('--unknown')).toBeUndefined()
  })

  it('GROUP_LIST contains all groups in order', () => {
    expect(GROUP_LIST).toHaveLength(9)
    expect(GROUP_LIST[0].id).toBe('base')
  })
})

describe('tokens (computeThemeBase)', () => {
  const natural = getPreset('natural')

  it('returns a TokenMap with base tokens', () => {
    const tokens = computeThemeBase(natural, natural.light)
    expect(tokens['--hue']).toBe('200')
    expect(tokens['--saturation']).toBe('16%')
    expect(tokens['--background']).toMatch(/^oklch/)
    expect(tokens['--foreground']).toMatch(/^oklch/)
    expect(tokens['--primary']).toMatch(/^oklch/)
    expect(tokens['--card']).toMatch(/^oklch/)
    expect(tokens['--border']).toMatch(/^oklch/)
  })

  it('generates oklch format strings', () => {
    const tokens = computeThemeBase(natural, natural.light)
    const oklchPattern = /^oklch\(\d+\.?\d*% [\d.]+ [\d.]+(?:\s*\/\s*[\d.]+)?\)$/
    for (const key of ['--background', '--foreground', '--primary', '--card', '--border']) {
      expect(tokens[key]).toMatch(oklchPattern)
    }
  })

  it('supports dark mode', () => {
    const lightTokens = computeThemeBase(natural, natural.light)
    const darkTokens = computeThemeBase(natural, natural.dark)
    expect(lightTokens['--lightness']).not.toBe(darkTokens['--lightness'])
    expect(lightTokens['--background']).not.toBe(darkTokens['--background'])
  })

  it('applies hue override', () => {
    const tokens = computeThemeBase(natural, natural.light, { hue: 100 })
    expect(tokens['--hue']).toBe('100')
  })

  it('applies saturation override', () => {
    const tokens = computeThemeBase(natural, natural.light, { saturation: 50 })
    expect(tokens['--saturation']).toBe('50%')
  })

  it('applies brightness override (clamped to max 98%)', () => {
    const tokens = computeThemeBase(natural, natural.light, { brightness: 75 })
    // brightness=75: deltaL = (75-50)*0.5 = 12.5, bgL=97+12.5=109.5 → clamped to 98
    expect(tokens['--lightness']).toBe('98%')
  })

  it('produces all slider controller tokens', () => {
    const tokens = computeThemeBase(natural, natural.light)
    expect(tokens['--glow-strength']).toBe('0.5')
    expect(tokens['--glass-opacity']).toBe('0.5')
    expect(tokens['--blur-strength']).toBe('0.5')
  })

  it('produces surface tint token', () => {
    const tokens = computeThemeBase(natural, natural.light)
    expect(tokens['--surface-tint']).toMatch(/^oklch/)
  })

  it('ring token includes alpha with glow ratio', () => {
    const tokens = computeThemeBase(natural, natural.light, { glowStrength: 1 })
    expect(tokens['--ring']).toContain('/ 0.3')
  })

  it('produces glass tokens', () => {
    const tokens = computeThemeBase(natural, natural.light)
    expect(tokens['--glass-bg']).toMatch(/^oklch/)
    expect(tokens['--glass-border']).toMatch(/^oklch/)
    expect(tokens['--glass-reflection']).toContain('linear-gradient')
  })

  it('all presets produce valid token maps without errors', () => {
    for (const preset of themePresets) {
      const lightTokens = computeThemeBase(preset, preset.light)
      expect(lightTokens['--hue']).toBe(String(preset.hue))
      const darkTokens = computeThemeBase(preset, preset.dark)
      expect(darkTokens['--hue']).toBe(String(preset.hue))
    }
  })
})

describe('aliases', () => {
  const natural = getPreset('natural')
  const primitives = computeThemeBase(natural, natural.light)

  it('computeAliases maps primitives to gc-* aliases', () => {
    const aliases = computeAliases(primitives)
    expect(aliases['--gc-hue']).toBe(primitives['--hue'])
    expect(aliases['--gc-background']).toBe(primitives['--background'])
    expect(aliases['--gc-foreground']).toBe(primitives['--foreground'])
    expect(aliases['--gc-primary']).toBe(primitives['--primary'])
  })

  it('computeAliases includes alias keys that have primitive mappings', () => {
    const aliases = computeAliases(primitives)
    // Atmosphere/glass/material aliases need atmosphere layer primitives
    expect(aliases['--gc-hue']).toBe('200')
    expect(aliases['--gc-background']).toMatch(/^oklch/)
    expect(aliases['--gc-primary']).toMatch(/^oklch/)
    // Interactive state aliases have no primitive mapping
    expect(aliases['--gc-interactive-hover-bg']).toBeUndefined()
  })

  it('validateAliases returns 4 interactive state orphans (no primitive mapping)', () => {
    const orphans = validateAliases()
    expect(orphans).toEqual([
      '--gc-interactive-hover-bg',
      '--gc-interactive-active-bg',
      '--gc-interactive-focus-ring',
      '--gc-interactive-glow',
    ])
  })

  it('computeAllTokens combines all available layers', () => {
    const all = computeAllTokens(primitives)
    expect(all['--hue']).toBeDefined()
    expect(all['--gc-hue']).toBeDefined()
    // Only keys with primitive mappings are included
    expect(all['--gc-shadow-sm']).toMatch(/oklch/)
    expect(all['--border']).toBeDefined()
  })

  it('computeAllTokens produces no NaN values', () => {
    const all = computeAllTokens(primitives)
    for (const [key, val] of Object.entries(all)) {
      expect(val).not.toContain('NaN')
    }
  })
})

describe('depth (computeDepthTokens)', () => {
  const natural = getPreset('natural')
  const primitives = computeThemeBase(natural, natural.light)

  it('returns all depth keys', () => {
    const depth = computeDepthTokens(primitives)
    for (const key of DEPTH_KEYS) {
      expect(depth).toHaveProperty(key)
    }
  })

  it('shadow tokens are oklch box-shadows', () => {
    const depth = computeDepthTokens(primitives)
    expect(depth['--gc-shadow-xs']).toMatch(/^0 \d+px \d+px oklch/)
    expect(depth['--gc-shadow-md']).toMatch(/^0 \d+px \d+px oklch/)
  })

  it('blur tokens are pixel strings', () => {
    const depth = computeDepthTokens(primitives)
    expect(depth['--gc-blur-light']).toMatch(/^\d+px$/)
    expect(depth['--gc-blur-standard']).toMatch(/^\d+px$/)
    expect(depth['--gc-blur-deep']).toMatch(/^\d+px$/)
  })

  it('z-index tokens are string numbers', () => {
    const depth = computeDepthTokens(primitives)
    expect(depth['--gc-z-base']).toBe('0')
    expect(depth['--gc-z-modal']).toBe('1000')
    expect(depth['--gc-z-tooltip']).toBe('2000')
  })

  it('surface layer tokens are oklch with alpha', () => {
    const depth = computeDepthTokens(primitives)
    expect(depth['--gc-surface-base']).toMatch(/^oklch/)
    expect(depth['--gc-surface-elevated']).toMatch(/^oklch/)
  })

  it('alpha slider ratios respond to glassRatio', () => {
    const tokens = computeDepthTokens(primitives)
    expect(tokens['--gc-surface-alpha-base']).toMatch(/^\d\.\d{3}$/)
  })

  it('hover depth tokens exist', () => {
    const depth = computeDepthTokens(primitives)
    expect(depth['--gc-hover-lift']).toBe('-1px')
    expect(depth['--gc-hover-shadow-enhance']).toMatch(/^[\d.]+$/)
  })

  it('interactive state tokens are color-mix or references', () => {
    const depth = computeDepthTokens(primitives)
    expect(depth['--gc-interactive-hover-bg']).toContain('color-mix')
    expect(depth['--gc-interactive-focus-ring']).toContain('var(')
  })
})

describe('diff (computeDiff)', () => {
  it('returns all tokens as set when prev is empty', () => {
    const result = computeDiff({}, { a: '1', b: '2' })
    expect(result.set).toEqual({ a: '1', b: '2' })
    expect(result.remove).toEqual([])
    expect(result.unchanged).toBe(0)
  })

  it('returns empty diff when same reference', () => {
    const map = { a: '1' }
    const result = computeDiff(map, map)
    expect(result.set).toEqual({})
    expect(result.remove).toEqual([])
    expect(result.unchanged).toBe(0)
  })

  it('detects changed tokens', () => {
    const result = computeDiff({ a: '1', b: '2' }, { a: '1', b: '3' })
    expect(result.set).toEqual({ b: '3' })
    expect(result.remove).toEqual([])
    expect(result.unchanged).toBe(1)
  })

  it('detects removed tokens', () => {
    const result = computeDiff({ a: '1', b: '2' }, { a: '1' })
    expect(result.set).toEqual({})
    expect(result.remove).toEqual(['b'])
    expect(result.unchanged).toBe(1)
  })

  it('detects new tokens', () => {
    const result = computeDiff({ a: '1' }, { a: '1', c: '3' })
    expect(result.set).toEqual({ c: '3' })
    expect(result.remove).toEqual([])
    expect(result.unchanged).toBe(1)
  })

  it('returns EMPTY_DIFF when nothing changed', () => {
    const result = computeDiff({ a: '1', b: '2' }, { a: '1', b: '2' })
    expect(result.set).toEqual({})
    expect(result.remove).toEqual([])
    expect(result.unchanged).toBe(0)
  })

  it('handles large token maps efficiently', () => {
    const prev: TokenMap = {}
    const next: TokenMap = {}
    for (let i = 0; i < 100; i++) {
      prev[`k${i}`] = `v${i}`
      next[`k${i}`] = `v${i}`
    }
    next.k50 = 'changed'
    const result = computeDiff(prev, next)
    expect(result.set).toEqual({ k50: 'changed' })
    expect(result.unchanged).toBe(99)
  })
})

describe('freeze (computeTokenHash)', () => {
  it('produces deterministic hash for same tokens', () => {
    const a = computeTokenHash({ a: '1', b: '2' })
    const b = computeTokenHash({ b: '2', a: '1' })
    expect(a).toBe(b)
  })

  it('produces different hashes for different tokens', () => {
    const a = computeTokenHash({ a: '1' })
    const b = computeTokenHash({ a: '2' })
    expect(a).not.toBe(b)
  })

  it('devFreezeTokens returns the same object', () => {
    const tokens = { a: '1' }
    expect(devFreezeTokens(tokens)).toBe(tokens)
  })

  it('devFreezeTokens freezes in DEV (vitest simulates DEV)', () => {
    const tokens = { a: '1' }
    devFreezeTokens(tokens)
    expect(Object.isFrozen(tokens)).toBe(true)
  })

  it('produces same hash regardless of key insertion order', () => {
    const tokens1: TokenMap = {}
    tokens1.z = '1'
    tokens1.a = '2'
    const tokens2: TokenMap = {}
    tokens2.a = '2'
    tokens2.z = '1'
    expect(computeTokenHash(tokens1)).toBe(computeTokenHash(tokens2))
  })
})
