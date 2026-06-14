import { describe, it, expect, beforeEach } from 'vitest'
import { computeAtmosphereLighting } from '@/shared/atmosphere/lighting-tokens'
import { DEFAULT_ATMOSPHERE_CONFIG } from '@/shared/atmosphere/types'
import type { SampledColors } from '@/shared/atmosphere/types'
import { DEFAULT_MATERIAL_CONFIG, setMaterialRuntimeConfig, resetMaterialRuntimeConfig, materialRuntimeConfig } from '@/shared/theme/material-config'
import { computeMaterialTokens } from '@/shared/theme/material'
import { computeThemeBase } from '@/shared/theme/tokens'
import { getPreset } from '@/shared/theme/constants'
import {
  backgroundPresets, getGradientCSS,
} from '@/shared/background/presets'
import {
  MAX_SLIDESHOW_PHOTOS, DEFAULT_INTERVAL_SEC, INTERVAL_SEC_OPTIONS,
  DISPLAY_MODE_LABELS, OBJECT_FIT_MAP, DEFAULT_ADJUSTMENTS, DEFAULT_CONFIG,
  DEFAULT_OVERLAY_INTENSITY,
} from '@/shared/background/types'
import { setAtmosphereSamples, atmosphereSamples } from '@/shared/atmosphere/samples'
import type { TokenMap } from '@/shared/theme/types'

describe('Atmosphere lighting tokens', () => {
  const mockSamples: SampledColors = {
    dominantHue: 220,
    dominantSaturation: 0.3,
    dominantLightness: 45,
    accentHue: 200,
    accentSaturation: 0.5,
    accentLightness: 50,
    averageLuminance: 40,
    brightSpotX: 0.6,
    brightSpotY: 0.2,
    darkSpotX: 0.3,
    darkSpotY: 0.7,
    sampledAt: Date.now(),
  }

  it('returns empty tokens when no samples', () => {
    const result = computeAtmosphereLighting(null, 0.5, DEFAULT_ATMOSPHERE_CONFIG)
    expect(result).toEqual({})
  })

  it('returns tokens for valid samples', () => {
    const result = computeAtmosphereLighting(mockSamples, 0.5, DEFAULT_ATMOSPHERE_CONFIG)
    expect(result['--atmosphere-1']).toMatch(/^oklch/)
    expect(result['--atmosphere-2']).toMatch(/^oklch/)
    expect(result['--atmosphere-3']).toMatch(/^oklch/)
    expect(result['--atmosphere-glow']).toMatch(/^oklch/)
    expect(result['--atmosphere-hue']).toBe('200')
    expect(result['--atmosphere-saturation']).toBe('0.4')
    expect(result['--atmosphere-luminance']).toBe('50')
  })

  it('intensity scales alpha values', () => {
    const low = computeAtmosphereLighting(mockSamples, 0.1, DEFAULT_ATMOSPHERE_CONFIG)
    const high = computeAtmosphereLighting(mockSamples, 1.0, DEFAULT_ATMOSPHERE_CONFIG)
    expect(low['--atmosphere-1']).not.toBe(high['--atmosphere-1'])
  })

  it('intensity clamps between 0 and 1', () => {
    const result = computeAtmosphereLighting(mockSamples, 2.5, DEFAULT_ATMOSPHERE_CONFIG)
    expect(result['--atmosphere-1']).toBeDefined()
  })

  it('glowScale affects atmosphere-glow alpha', () => {
    const low = computeAtmosphereLighting(mockSamples, 1.0, { ...DEFAULT_ATMOSPHERE_CONFIG, glowScale: 0.5 })
    const high = computeAtmosphereLighting(mockSamples, 1.0, { ...DEFAULT_ATMOSPHERE_CONFIG, glowScale: 2.0 })
    expect(low['--atmosphere-glow']).not.toBe(high['--atmosphere-glow'])
  })

  it('saturation is capped at 0.40', () => {
    const highSatSamples: SampledColors = {
      ...mockSamples,
      accentSaturation: 0.9,
    }
    const result = computeAtmosphereLighting(highSatSamples, 0.5, DEFAULT_ATMOSPHERE_CONFIG)
    expect(result['--atmosphere-saturation']).toBe('0.4')
  })

  it('produces glass-reflection token', () => {
    const result = computeAtmosphereLighting(mockSamples, 0.5, DEFAULT_ATMOSPHERE_CONFIG)
    expect(result['--glass-reflection']).toContain('linear-gradient')
    expect(result['--glass-reflection']).toContain('oklch')
  })
})

describe('Atmosphere samples bridge', () => {
  it('initializes with null', () => {
    expect(atmosphereSamples.value).toBeNull()
  })

  it('setAtmosphereSamples updates the samples', () => {
    const samples: SampledColors = {
      dominantHue: 200, dominantSaturation: 0.2, dominantLightness: 50,
      accentHue: 200, accentSaturation: 0.4, accentLightness: 55,
      averageLuminance: 50, brightSpotX: 0.55, brightSpotY: 0.15,
      darkSpotX: 0.5, darkSpotY: 0.5, sampledAt: Date.now(),
    }
    setAtmosphereSamples(samples)
    expect(atmosphereSamples.value).toEqual(samples)
    setAtmosphereSamples(null)
    expect(atmosphereSamples.value).toBeNull()
  })
})

describe('Material config', () => {
  beforeEach(() => {
    resetMaterialRuntimeConfig()
  })

  it('has default config', () => {
    expect(materialRuntimeConfig.value).toEqual(DEFAULT_MATERIAL_CONFIG)
  })

  it('setMaterialRuntimeConfig updates partial config', () => {
    setMaterialRuntimeConfig({ glassOpacity: 80 })
    expect(materialRuntimeConfig.value.glassOpacity).toBe(80)
    expect(materialRuntimeConfig.value.reflectionIntensity).toBe(35)
  })

  it('resetMaterialRuntimeConfig restores defaults', () => {
    setMaterialRuntimeConfig({ glassOpacity: 100, blurDensity: 90 })
    resetMaterialRuntimeConfig()
    expect(materialRuntimeConfig.value).toEqual(DEFAULT_MATERIAL_CONFIG)
  })

  it('default glassOpacity is 40', () => {
    expect(DEFAULT_MATERIAL_CONFIG.glassOpacity).toBe(40)
  })

  it('default noiseEnabled is true', () => {
    expect(DEFAULT_MATERIAL_CONFIG.noiseEnabled).toBe(true)
  })
})

describe('Material tokens', () => {
  const natural = getPreset('natural')
  const primitives = computeThemeBase(natural, natural.light)

  beforeEach(() => {
    resetMaterialRuntimeConfig()
  })

  it('returns material-specific tokens', () => {
    const tokens = computeMaterialTokens(primitives)
    expect(tokens['--reflection-intensity']).toMatch(/^\d\.\d{4}$/)
    expect(tokens['--grain-opacity']).toMatch(/^\d\.\d{4}$/)
    expect(tokens['--blur-density']).toMatch(/^\d+px$/)
  })

  it('edge lighting produces gradient when enabled', () => {
    const tokens = computeMaterialTokens(primitives)
    expect(tokens['--edge-light']).toContain('linear-gradient')
  })

  it('edge lighting returns none when disabled', () => {
    setMaterialRuntimeConfig({ edgeLighting: false })
    const tokens = computeMaterialTokens(primitives)
    expect(tokens['--edge-light']).toBe('none')
  })

  it('noise ref is svg url when enabled', () => {
    const tokens = computeMaterialTokens(primitives)
    expect(tokens['--glass-noise']).toBe('url(#gc-glass-noise)')
  })

  it('noise ref is none when disabled', () => {
    setMaterialRuntimeConfig({ noiseEnabled: false })
    const tokens = computeMaterialTokens(primitives)
    expect(tokens['--glass-noise']).toBe('none')
  })

  it('refraction tint is oklch', () => {
    const tokens = computeMaterialTokens(primitives)
    expect(tokens['--refraction-tint']).toMatch(/^oklch/)
  })

  it('glass reflection is gradient', () => {
    const tokens = computeMaterialTokens(primitives)
    expect(tokens['--gc-glass-reflection']).toContain('linear-gradient')
  })

  it('blur standard is overridden by material', () => {
    const tokens = computeMaterialTokens(primitives)
    expect(tokens['--gc-blur-standard']).toMatch(/^\d+px$/)
  })

  it('responds to glow ratio changes', () => {
    const tokensLow = computeMaterialTokens(computeThemeBase(natural, natural.light, { glowStrength: 0 }))
    const tokensHigh = computeMaterialTokens(computeThemeBase(natural, natural.light, { glowStrength: 1 }))
    expect(tokensLow['--reflection-intensity']).not.toBe(tokensHigh['--reflection-intensity'])
  })
})

describe('Background presets', () => {
  it('has 4 background presets', () => {
    expect(backgroundPresets).toHaveLength(4)
  })

  it('each preset has required fields', () => {
    for (const p of backgroundPresets) {
      expect(p).toHaveProperty('id')
      expect(p).toHaveProperty('label')
      expect(p).toHaveProperty('source')
      expect(p.source.kind).toBe('gradient')
    }
  })

  it('getGradientCSS returns CSS for known presets', () => {
    const css = getGradientCSS('warm-dawn')
    expect(css).toContain('linear-gradient')
  })

  it('getGradientCSS returns empty for unknown preset', () => {
    expect(getGradientCSS('unknown')).toBe('')
  })

  it('includes warm-dawn and bamboo-mist as light presets', () => {
    const warm = backgroundPresets.find(p => p.id === 'warm-dawn')
    expect(warm?.capabilities?.recommendedTheme).toBe('light')
    const bamboo = backgroundPresets.find(p => p.id === 'bamboo-mist')
    expect(bamboo?.capabilities?.recommendedTheme).toBe('light')
  })

  it('includes starry-night and aurora-night as dark presets', () => {
    const starry = backgroundPresets.find(p => p.id === 'starry-night')
    expect(starry?.capabilities?.recommendedTheme).toBe('dark')
    const aurora = backgroundPresets.find(p => p.id === 'aurora-night')
    expect(aurora?.capabilities?.recommendedTheme).toBe('dark')
  })
})

describe('Background types and constants', () => {
  it('MAX_SLIDESHOW_PHOTOS is 5', () => {
    expect(MAX_SLIDESHOW_PHOTOS).toBe(5)
  })

  it('DEFAULT_INTERVAL_SEC is 10', () => {
    expect(DEFAULT_INTERVAL_SEC).toBe(10)
  })

  it('INTERVAL_SEC_OPTIONS has valid options', () => {
    expect(INTERVAL_SEC_OPTIONS).toEqual([5, 10, 15, 30, 60])
  })

  it('DISPLAY_MODE_LABELS has all modes', () => {
    expect(DISPLAY_MODE_LABELS.fill).toBe('填充')
    expect(DISPLAY_MODE_LABELS.fit).toBe('适应')
    expect(DISPLAY_MODE_LABELS.stretch).toBe('拉伸')
  })

  it('OBJECT_FIT_MAP maps correctly', () => {
    expect(OBJECT_FIT_MAP.fill).toBe('cover')
    expect(OBJECT_FIT_MAP.fit).toBe('contain')
    expect(OBJECT_FIT_MAP.stretch).toBe('fill')
  })

  it('DEFAULT_OVERLAY_INTENSITY is 0', () => {
    expect(DEFAULT_OVERLAY_INTENSITY).toBe(0)
  })

  it('DEFAULT_ADJUSTMENTS has sane defaults', () => {
    expect(DEFAULT_ADJUSTMENTS.blur).toBe(0)
    expect(DEFAULT_ADJUSTMENTS.opacity).toBe(1)
    expect(DEFAULT_ADJUSTMENTS.saturation).toBe(100)
    expect(DEFAULT_ADJUSTMENTS.brightness).toBe(100)
    expect(DEFAULT_ADJUSTMENTS.contrast).toBe(100)
  })

  it('DEFAULT_CONFIG has kind=none', () => {
    expect(DEFAULT_CONFIG.source.kind).toBe('none')
  })
})

describe('Cross-module: composer integrates all layers', () => {
  it('computeThemeBase + computeMaterialTokens produces no NaN values in dark mode', () => {
    const preset = getPreset('purple')
    const primitives = computeThemeBase(preset, preset.dark)
    const material = computeMaterialTokens(primitives)
    for (const val of Object.values(material)) {
      expect(val).not.toContain('NaN')
    }
  })

  it('all presets produce valid tokens in both light and dark modes', () => {
    const presets = [getPreset('natural'), getPreset('orange'), getPreset('pink'),
                    getPreset('blue'), getPreset('green'), getPreset('purple')]
    for (const preset of presets) {
      for (const mode of [preset.light, preset.dark]) {
        const primitives = computeThemeBase(preset, mode)
        const material = computeMaterialTokens(primitives)
        for (const [k, v] of Object.entries(material)) {
          expect(v, `${preset.id} ${mode === preset.light ? 'light' : 'dark'} ${k}`).not.toContain('NaN')
        }
      }
    }
  })

  it('computeAtmosphereLighting + computeMaterialTokens no NaN', () => {
    const samples: SampledColors = {
      dominantHue: 340, dominantSaturation: 0.6, dominantLightness: 50,
      accentHue: 10, accentSaturation: 0.7, accentLightness: 55,
      averageLuminance: 45, brightSpotX: 0.5, brightSpotY: 0.3,
      darkSpotX: 0.4, darkSpotY: 0.6, sampledAt: Date.now(),
    }
    const atmosphere = computeAtmosphereLighting(samples, 0.8, DEFAULT_ATMOSPHERE_CONFIG)
    const primitives = computeThemeBase(getPreset('natural'), getPreset('natural').dark)
    const merged: TokenMap = { ...primitives, ...atmosphere }
    const material = computeMaterialTokens(merged)
    for (const [k, v] of Object.entries(material)) {
      expect(v, k).not.toContain('NaN')
    }
  })
})
