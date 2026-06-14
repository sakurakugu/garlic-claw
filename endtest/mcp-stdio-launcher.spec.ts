import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'node:path'
import * as fs from 'node:fs'

// ============================================================================
// 内联纯函数（对齐 mcp-stdio-launcher.ts）
// ============================================================================

const MCP_CHILD_ENV_KEYS_ENV_KEY = 'GARLIC_CLAW_MCP_CHILD_ENV_KEYS'

function resolveLaunchTarget(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32' || (command !== 'npm' && command !== 'npx')) {
    return { command, args: [...args] }
  }
  return {
    command: process.execPath,
    args: [resolveBundledNpmCli(command), ...args],
  }
}

function readMcpChildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowedKeys = new Set((env[MCP_CHILD_ENV_KEYS_ENV_KEY] ?? '')
    .split('\n')
    .map((key) => key.trim())
    .filter((key) => key.length > 0))
  const entries: Array<[string, string]> = [...allowedKeys].flatMap((key) => {
    const value = env[key]
    return typeof value === 'string' ? [[key, value]] : []
  })
  return Object.fromEntries(entries)
}

function resolveBundledNpmCli(command: 'npm' | 'npx'): string {
  const cliFileName = command === 'npx' ? 'npx-cli.js' : 'npm-cli.js'
  const candidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', cliFileName),
    path.join(path.dirname(path.dirname(process.execPath)), 'lib', 'node_modules', 'npm', 'bin', cliFileName),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error(`无法解析 ${command} CLI 入口: ${candidates.join(', ')}`)
}

// ========================================================================
// 测试
// ========================================================================

describe('McpStdioLauncher — resolveLaunchTarget', () => {
  it('非 win32 直接返回 command + args', () => {
    const orig = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      const result = resolveLaunchTarget('node', ['server.js'])
      expect(result.command).toBe('node')
      expect(result.args).toEqual(['server.js'])
    } finally {
      Object.defineProperty(process, 'platform', { value: orig })
    }
  })

  it('win32 上 npm 被重写', () => {
    const orig = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      const result = resolveLaunchTarget('npm', ['install'])
      expect(result.command).toBe(process.execPath)
      expect(result.args[0]).toContain('npm-cli.js')
      expect(result.args[1]).toBe('install')
    } finally {
      Object.defineProperty(process, 'platform', { value: orig })
    }
  })

  it('win32 上 npx 被重写', () => {
    const orig = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      const result = resolveLaunchTarget('npx', ['-y', 'tool'])
      expect(result.command).toBe(process.execPath)
      expect(result.args[0]).toContain('npx-cli.js')
      expect(result.args.slice(1)).toEqual(['-y', 'tool'])
    } finally {
      Object.defineProperty(process, 'platform', { value: orig })
    }
  })

  it('win32 上非 npm/npx 命令直接返回', () => {
    const orig = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      const result = resolveLaunchTarget('python', ['script.py'])
      expect(result.command).toBe('python')
      expect(result.args).toEqual(['script.py'])
    } finally {
      Object.defineProperty(process, 'platform', { value: orig })
    }
  })

  it('args 数组副本不被外部修改影响', () => {
    const args = ['a', 'b']
    const result = resolveLaunchTarget('node', args)
    args.push('c')
    expect(result.args).toEqual(['a', 'b'])
  })
})

describe('McpStdioLauncher — readMcpChildEnv', () => {
  it('无 GARLIC_CLAW_MCP_CHILD_ENV_KEYS 返回空对象', () => {
    expect(readMcpChildEnv({})).toEqual({})
  })

  it('空字符串值返回空对象', () => {
    expect(readMcpChildEnv({ [MCP_CHILD_ENV_KEYS_ENV_KEY]: '' })).toEqual({})
  })

  it('仅允许的 key 被提取', () => {
    const env = {
      [MCP_CHILD_ENV_KEYS_ENV_KEY]: 'PATH\nHOME',
      PATH: '/usr/bin',
      HOME: '/root',
      SECRET: 'hidden',
    }
    const result = readMcpChildEnv(env)
    expect(result.PATH).toBe('/usr/bin')
    expect(result.HOME).toBe('/root')
    expect(result).not.toHaveProperty('SECRET')
  })

  it('不存在的 key 被跳过', () => {
    const env = {
      [MCP_CHILD_ENV_KEYS_ENV_KEY]: 'PATH\nMISSING',
      PATH: '/usr/bin',
    }
    const result = readMcpChildEnv(env)
    expect(result.PATH).toBe('/usr/bin')
    expect(result).not.toHaveProperty('MISSING')
  })

  it('允许多行键列表', () => {
    const env = {
      [MCP_CHILD_ENV_KEYS_ENV_KEY]: 'KEY1\nKEY2\n  KEY3  ',
      KEY1: 'v1',
      KEY2: 'v2',
      KEY3: 'v3',
    }
    const result = readMcpChildEnv(env)
    expect(result.KEY1).toBe('v1')
    expect(result.KEY2).toBe('v2')
    expect(result.KEY3).toBe('v3')
  })

  it('空行被过滤', () => {
    const env = {
      [MCP_CHILD_ENV_KEYS_ENV_KEY]: 'KEY\n\n  \nOTHER',
      KEY: 'v',
      OTHER: 'o',
    }
    const result = readMcpChildEnv(env)
    expect(result.KEY).toBe('v')
    expect(result.OTHER).toBe('o')
  })

  it('非字符串值被跳过', () => {
    const env = {
      [MCP_CHILD_ENV_KEYS_ENV_KEY]: 'PATH',
      PATH: undefined,
    }
    const result = readMcpChildEnv(env as NodeJS.ProcessEnv)
    expect(result).not.toHaveProperty('PATH')
  })
})

describe('McpStdioLauncher — resolveBundledNpmCli', () => {
  it('npm 返回 npm-cli.js 路径', () => {
    const result = resolveBundledNpmCli('npm')
    expect(result).toContain('npm-cli.js')
    expect(fs.existsSync(result)).toBe(true)
  })

  it('npx 返回 npx-cli.js 路径', () => {
    const result = resolveBundledNpmCli('npx')
    expect(result).toContain('npx-cli.js')
    expect(fs.existsSync(result)).toBe(true)
  })

  it('候选路径格式正确', () => {
    const npmPath = resolveBundledNpmCli('npm')
    expect(path.isAbsolute(npmPath)).toBe(true)
    expect(npmPath.endsWith('npm-cli.js')).toBe(true)
  })
})
