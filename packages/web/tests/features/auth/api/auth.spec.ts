import { beforeEach, describe, expect, it, vi } from 'vitest'

const postMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/api/http', () => ({
  post: postMock,
}))

import { login } from '@/modules/auth/api/auth'

describe('auth api', () => {
  beforeEach(() => {
    postMock.mockClear()
  })

  it('sends login as a public request and preserves server auth errors', async () => {
    postMock.mockResolvedValueOnce({ accessToken: 'token' })

    await expect(login(' dev-secret ')).resolves.toEqual({ accessToken: 'token' })

    expect(postMock).toHaveBeenCalledWith(
      '/auth/login',
      { secret: 'dev-secret' },
      {
        skipAuth: true,
        skipUnauthorizedRedirect: true,
      },
    )
  })

  it('rejects empty login secrets before sending the request', async () => {
    expect(() => login('  ')).toThrow('访问密钥不能为空')

    expect(postMock).not.toHaveBeenCalled()
  })
})
