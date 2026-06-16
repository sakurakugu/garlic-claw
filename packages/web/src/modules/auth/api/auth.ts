import { post } from '@/shared/api/http'

function ensureRequiredText(value: string | null | undefined, field: 'secret') {
  const normalized = value?.trim() ?? ''
  if (!normalized) {
    throw new Error(field === 'secret' ? '访问密钥不能为空' : `${field} 不能为空`)
  }

  return normalized
}

export function login(secret: string) {
  return post<{ accessToken: string }>(
    '/auth/login',
    {
      secret: ensureRequiredText(secret, 'secret'),
    },
    {
      skipAuth: true,
      skipUnauthorizedRedirect: true,
    },
  )
}
