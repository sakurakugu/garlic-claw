import { describe, it, expect } from 'vitest'

interface RuntimeGatewayAuthClaims {
  authMode?: string
  pluginName?: string
  remoteEnvironment?: string
}

interface RuntimeGatewayConnectionRecord {
  authenticated: boolean
  claims: RuntimeGatewayAuthClaims | null
  connectionId: string
  remoteEnvironment: string | null
  lastHeartbeatAt: string
  pluginId: string | null
  remoteAddress?: string
}

interface RuntimeGatewayOutboundMessage {
  action: string
  payload: unknown
  requestId: string
  type: string
}

describe('RuntimeGateway types', () => {
  describe('RuntimeGatewayAuthClaims', () => {
    it('can be constructed with optional fields', () => {
      const claims: RuntimeGatewayAuthClaims = {
        authMode: 'required',
        pluginName: 'remote.echo',
        remoteEnvironment: 'api',
      }
      expect(claims.authMode).toBe('required')
      expect(claims.pluginName).toBe('remote.echo')
      expect(claims.remoteEnvironment).toBe('api')
    })

    it('can be constructed as empty', () => {
      const claims: RuntimeGatewayAuthClaims = {}
      expect(claims.authMode).toBeUndefined()
      expect(claims.pluginName).toBeUndefined()
      expect(claims.remoteEnvironment).toBeUndefined()
    })
  })

  describe('RuntimeGatewayConnectionRecord', () => {
    it('can be constructed with all fields', () => {
      const record: RuntimeGatewayConnectionRecord = {
        authenticated: true,
        claims: { authMode: 'required', pluginName: 'test', remoteEnvironment: 'api' },
        connectionId: 'conn-1',
        remoteEnvironment: 'api',
        lastHeartbeatAt: '2026-01-01T00:00:00.000Z',
        pluginId: 'test-plugin',
        remoteAddress: '127.0.0.1',
      }
      expect(record.authenticated).toBe(true)
      expect(record.connectionId).toBe('conn-1')
      expect(record.pluginId).toBe('test-plugin')
      expect(record.remoteAddress).toBe('127.0.0.1')
    })

    it('can be constructed in unauthenticated state', () => {
      const record: RuntimeGatewayConnectionRecord = {
        authenticated: false,
        claims: null,
        connectionId: 'conn-1',
        remoteEnvironment: null,
        lastHeartbeatAt: '2026-01-01T00:00:00.000Z',
        pluginId: null,
      }
      expect(record.authenticated).toBe(false)
      expect(record.claims).toBeNull()
      expect(record.remoteAddress).toBeUndefined()
    })
  })

  describe('RuntimeGatewayOutboundMessage', () => {
    it('can be constructed', () => {
      const msg: RuntimeGatewayOutboundMessage = {
        action: 'execute',
        payload: { query: 'test' },
        requestId: 'runtime-request-1',
        type: 'command',
      }
      expect(msg.action).toBe('execute')
      expect(msg.type).toBe('command')
      expect(msg.requestId).toBe('runtime-request-1')
    })
  })
})
