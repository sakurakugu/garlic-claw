import { describe, it, expect } from 'vitest'
import {
  AppError, NetworkError, ValidationError, AuthError, BusinessError,
  toAppError, getErrorMessage, isRetryableError, isAbortedAppError,
} from '@/shared/utils/error'
import { isUuidV7Text, isValidConversationRouteId } from '@/shared/utils/uuid'
import { healthLabel, formatPluginTime, pluginHealthStatus } from '@/shared/utils/plugin-labels'
import { formatBytes, measureDataUrlBytes } from '@/shared/utils/chat-image-upload'

describe('AppError', () => {
  it('creates a basic AppError', () => {
    const err = new AppError('network', 'test error')
    expect(err.message).toBe('test error')
    expect(err.type).toBe('network')
    expect(err.retryable).toBe(false)
  })

  it('supports all options', () => {
    const err = new AppError('business', 'fail', {
      status: 400,
      code: 'BAD',
      details: { field: 'name' },
      originalError: new Error('cause'),
      retryable: true,
    })
    expect(err.status).toBe(400)
    expect(err.code).toBe('BAD')
    expect(err.details).toEqual({ field: 'name' })
    expect(err.retryable).toBe(true)
  })

  it('NetworkError defaults retryable to true', () => {
    const err = new NetworkError('timeout')
    expect(err.type).toBe('network')
    expect(err.retryable).toBe(true)
  })

  it('ValidationError defaults retryable to false', () => {
    const err = new ValidationError('invalid')
    expect(err.type).toBe('validation')
    expect(err.retryable).toBe(false)
  })

  it('AuthError defaults retryable to false', () => {
    const err = new AuthError('unauthorized')
    expect(err.type).toBe('auth')
    expect(err.retryable).toBe(false)
  })

  it('BusinessError defaults retryable to false', () => {
    const err = new BusinessError('business logic error')
    expect(err.type).toBe('business')
    expect(err.retryable).toBe(false)
  })
})

describe('toAppError', () => {
  it('returns AppError instances as-is', () => {
    const original = new NetworkError('test')
    expect(toAppError(original)).toBe(original)
  })

  it('converts TypeError to NetworkError with original message', () => {
    const result = toAppError(new TypeError('fetch failed'))
    expect(result).toBeInstanceOf(NetworkError)
    expect(result.message).toBe('fetch failed')
  })

  it('converts AbortError to BusinessError', () => {
    const err = new DOMException('Aborted', 'AbortError')
    const result = toAppError(err)
    expect(result).toBeInstanceOf(BusinessError)
    expect(result.code).toBe('ABORTED')
  })

  it('converts http-like error with status', () => {
    const result = toAppError({ status: 500, message: 'server error' })
    expect(result).toBeInstanceOf(NetworkError)
    expect(result.status).toBe(500)
  })

  it('converts 401 to AuthError', () => {
    const result = toAppError({ status: 401, message: 'unauthorized' })
    expect(result).toBeInstanceOf(AuthError)
  })

  it('converts 400 to ValidationError', () => {
    const result = toAppError({ status: 400 })
    expect(result).toBeInstanceOf(ValidationError)
    expect(result.message).toBe('请求参数有误')
  })

  it('converts 404 to BusinessError', () => {
    const result = toAppError({ status: 404 })
    expect(result).toBeInstanceOf(BusinessError)
    expect(result.message).toBe('请求资源不存在')
  })

  it('converts string error to BusinessError', () => {
    const result = toAppError('something went wrong')
    expect(result).toBeInstanceOf(BusinessError)
    expect(result.message).toBe('something went wrong')
  })

  it('uses fallback message for unknown errors', () => {
    const result = toAppError(42, 'fallback message')
    expect(result.message).toBe('fallback message')
  })

  it('extracts message from JSON error body', () => {
    const result = toAppError({
      status: 422,
      body: JSON.stringify({ message: 'Validation failed' }),
    })
    expect(result.message).toBe('Validation failed')
  })

  it('handles null/undefined gracefully', () => {
    const result = toAppError(null, 'fallback')
    expect(result).toBeInstanceOf(BusinessError)
    expect(result.message).toBe('fallback')
  })

  it('converts 429 to NetworkError with retryable', () => {
    const result = toAppError({ status: 429 })
    expect(result).toBeInstanceOf(NetworkError)
    expect(result.retryable).toBe(true)
  })

  it('converts 408 to NetworkError', () => {
    const result = toAppError({ status: 408 })
    expect(result).toBeInstanceOf(NetworkError)
    expect(result.status).toBe(408)
  })

  it('converts 403 to AuthError', () => {
    const result = toAppError({ status: 403 })
    expect(result).toBeInstanceOf(AuthError)
    expect(result.message).toBe('登录状态失效，请重新登录')
  })

  it('uses body as fallback when no message in parsed body', () => {
    const result = toAppError({
      status: 400,
      body: JSON.stringify({ error: 'bad request' }),
    })
    expect(result.message).toBe(JSON.stringify({ error: 'bad request' }))
  })
})

describe('getErrorMessage', () => {
  it('extracts message from AppError', () => {
    expect(getErrorMessage(new AuthError('login failed'))).toBe('login failed')
  })

  it('uses fallback for unknown errors', () => {
    expect(getErrorMessage('', 'fallback')).toBe('fallback')
  })
})

describe('isRetryableError', () => {
  it('returns true for retryable error', () => {
    expect(isRetryableError(new NetworkError('timeout'))).toBe(true)
  })

  it('returns true for retryable status codes', () => {
    expect(isRetryableError({ status: 503 })).toBe(true)
    expect(isRetryableError({ status: 429 })).toBe(true)
    expect(isRetryableError({ status: 408 })).toBe(true)
    expect(isRetryableError({ status: 425 })).toBe(true)
  })

  it('returns false for non-retryable errors', () => {
    expect(isRetryableError(new ValidationError('bad'))).toBe(false)
  })

  it('returns false for non-retryable status', () => {
    expect(isRetryableError({ status: 400 })).toBe(false)
    expect(isRetryableError({ status: 404 })).toBe(false)
  })
})

describe('isAbortedAppError', () => {
  it('returns true for ABORTED error', () => {
    const err = new BusinessError('cancelled', { code: 'ABORTED' })
    expect(isAbortedAppError(err)).toBe(true)
  })

  it('returns false for other errors', () => {
    expect(isAbortedAppError(new NetworkError('timeout'))).toBe(false)
  })
})

describe('uuid utilities', () => {
  it('isUuidV7Text returns true for valid UUID v7', () => {
    expect(isUuidV7Text('017f21e0-0000-7000-8000-000000000000')).toBe(true)
  })

  it('isUuidV7Text returns false for non-UUID strings', () => {
    expect(isUuidV7Text('not-a-uuid')).toBe(false)
    expect(isUuidV7Text('')).toBe(false)
  })

  it('isUuidV7Text returns false for UUID v4', () => {
    expect(isUuidV7Text('550e8400-e29b-41d4-a716-446655440000')).toBe(false)
  })

  it('isValidConversationRouteId returns true for UUID v7', () => {
    expect(isValidConversationRouteId('017f21e0-0000-7000-8000-000000000000')).toBe(true)
  })

  it('isValidConversationRouteId: non-UUID strings pass (first branch negates)', () => {
    // !/^uuid$/iu.test('not-valid') = !false = true
    expect(isValidConversationRouteId('not-valid')).toBe(true)
    expect(isValidConversationRouteId('')).toBe(true)
  })

  it('isValidConversationRouteId returns false for UUID v4 (not v7)', () => {
    // UUID v4 matches regex → !true=false, isUuidV7Text=false → false
    const v4 = '550e8400-e29b-41d4-a716-446655440000'
    expect(isValidConversationRouteId(v4)).toBe(false)
  })
})

describe('plugin-labels', () => {
  it('healthLabel returns correct Chinese labels', () => {
    expect(healthLabel({ status: 'healthy', detail: '' } as any)).toBe('健康')
    expect(healthLabel({ status: 'degraded', detail: '' } as any)).toBe('降级')
    expect(healthLabel({ status: 'error', detail: '' } as any)).toBe('异常')
    expect(healthLabel({ status: 'offline', detail: '' } as any)).toBe('离线')
  })

  it('healthLabel returns unknown for null/undefined', () => {
    expect(healthLabel(null)).toBe('未知')
    expect(healthLabel(undefined)).toBe('未知')
  })

  it('formatPluginTime returns formatted date for valid string', () => {
    const result = formatPluginTime('2026-01-15T10:30:00Z')
    expect(result).toContain('2026')
  })

  it('formatPluginTime returns 未检查 for null/undefined', () => {
    expect(formatPluginTime(null)).toBe('未检查')
    expect(formatPluginTime(undefined)).toBe('未检查')
  })

  it('pluginHealthStatus returns status or unknown', () => {
    expect(pluginHealthStatus({ status: 'healthy', detail: '' } as any)).toBe('healthy')
    expect(pluginHealthStatus(null)).toBe('unknown')
  })
})

describe('chat-image-upload pure functions', () => {
  it('formatBytes returns correct formatting', () => {
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    // >= 100 → no decimal
    expect(formatBytes(102400)).toBe('100 KB')
    expect(formatBytes(1048576)).toBe('1.0 MB')
  })

  it('formatBytes handles edge cases', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(10300)).toBe('10.1 KB')
  })

  it('measureDataUrlBytes returns correct byte count', () => {
    const result = measureDataUrlBytes('data:text/plain,hello')
    expect(result).toBeGreaterThan(0)
  })
})
