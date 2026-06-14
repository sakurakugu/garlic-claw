import { describe, it, expect, vi } from 'vitest'
import { RuntimeGatewayRequestLedger } from '../packages/server/src/modules/runtime/gateway/runtime-gateway-request-ledger'

describe('RuntimeGatewayRequestLedger', () => {
  describe('initial state', () => {
    it('has zero authorized contexts initially', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      expect(ledger.getAuthorizedContextCount()).toBe(0)
    })

    it('returns empty outbound messages for unknown connection', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      expect(ledger.consumeOutboundMessages('nonexistent')).toEqual([])
    })
  })

  describe('createPendingRequest', () => {
    it('generates request IDs with incrementing sequence', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      const p1 = ledger.createPendingRequest({ action: 'execute', connectionId: 'c1', payload: {}, type: 'command' })
      const p2 = ledger.createPendingRequest({ action: 'execute', connectionId: 'c1', payload: {}, type: 'command' })
      expect(p1).toBeInstanceOf(Promise)
      expect(p2).toBeInstanceOf(Promise)
    })

    it('queues outbound messages for the connection', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      ledger.createPendingRequest({ action: 'execute', connectionId: 'c1', payload: { query: 'test' }, type: 'command' })
      const messages = ledger.consumeOutboundMessages('c1')
      expect(messages).toHaveLength(1)
      expect(messages[0]).toMatchObject({
        action: 'execute',
        type: 'command',
        payload: { query: 'test' },
      })
      expect(messages[0].requestId).toBeTruthy()
    })

    it('queues multiple messages in order', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      ledger.createPendingRequest({ action: 'execute', connectionId: 'c1', payload: { seq: 1 }, type: 'command' })
      ledger.createPendingRequest({ action: 'hook_invoke', connectionId: 'c1', payload: { seq: 2 }, type: 'plugin' })
      const messages = ledger.consumeOutboundMessages('c1')
      expect(messages).toHaveLength(2)
      expect(messages[0].payload).toEqual({ seq: 1 })
      expect(messages[1].payload).toEqual({ seq: 2 })
    })

    it('stores authorized context when provided', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      ledger.createPendingRequest({
        action: 'execute',
        connectionId: 'c1',
        context: { source: 'chat-tool', userId: 'u1', conversationId: 'conv-1' },
        payload: {},
        type: 'command',
      })
      expect(ledger.getAuthorizedContextCount()).toBe(1)
    })

    it('does NOT store authorized context when context is omitted', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      ledger.createPendingRequest({ action: 'execute', connectionId: 'c1', payload: {}, type: 'command' })
      expect(ledger.getAuthorizedContextCount()).toBe(0)
    })

    it('deep clones the payload in outbound messages', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      const original = { nested: { value: 42 } }
      ledger.createPendingRequest({ action: 'execute', connectionId: 'c1', payload: original, type: 'command' })
      const messages = ledger.consumeOutboundMessages('c1')
      expect(messages[0].payload).toEqual(original)
      expect(messages[0].payload).not.toBe(original)
      expect(messages[0].payload.nested).not.toBe(original.nested)
    })

    it('handles connections with different connection IDs independently', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      ledger.createPendingRequest({ action: 'execute', connectionId: 'c1', payload: { id: 1 }, type: 'command' })
      ledger.createPendingRequest({ action: 'execute', connectionId: 'c2', payload: { id: 2 }, type: 'command' })
      expect(ledger.consumeOutboundMessages('c1')).toHaveLength(1)
      expect(ledger.consumeOutboundMessages('c2')).toHaveLength(1)
    })
  })

  describe('consumeOutboundMessages', () => {
    it('clears the queue after consumption', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      ledger.createPendingRequest({ action: 'execute', connectionId: 'c1', payload: {}, type: 'command' })
      ledger.consumeOutboundMessages('c1')
      expect(ledger.consumeOutboundMessages('c1')).toEqual([])
    })

    it('deep clones payload on every consumption', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      ledger.createPendingRequest({ action: 'execute', connectionId: 'c1', payload: { x: 1 }, type: 'command' })
      const m1 = ledger.consumeOutboundMessages('c1')
      const m2 = ledger.consumeOutboundMessages('c1')
      expect(m1).toHaveLength(1)
      expect(m2).toEqual([])
    })
  })

  describe('disconnectConnection', () => {
    it('rejects pending requests for the disconnected connection', async () => {
      const ledger = new RuntimeGatewayRequestLedger()
      const promise = ledger.createPendingRequest({ action: 'execute', connectionId: 'c1', payload: {}, type: 'command' })
      ledger.disconnectConnection('c1')
      await expect(promise).rejects.toThrow('Plugin connection closed')
    })

    it('does NOT reject pending requests for other connections', async () => {
      const ledger = new RuntimeGatewayRequestLedger()
      const promise = ledger.createPendingRequest({ action: 'execute', connectionId: 'c2', payload: {}, type: 'command' })
      const settleSpy = vi.fn()
      promise.catch(settleSpy)
      ledger.disconnectConnection('c1')
      expect(settleSpy).not.toHaveBeenCalled()
      ledger.settlePendingRequest({ requestId: 'runtime-request-1', result: { ok: true } })
      await expect(promise).resolves.toEqual({ ok: true })
    })

    it('cleans up outbound messages for the connection', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      const promise = ledger.createPendingRequest({ action: 'execute', connectionId: 'c1', payload: {}, type: 'command' })
      promise.catch(() => {})
      ledger.disconnectConnection('c1')
      expect(ledger.consumeOutboundMessages('c1')).toEqual([])
    })

    it('cleans up authorized contexts for rejected requests', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      const promise = ledger.createPendingRequest({
        action: 'execute', connectionId: 'c1',
        context: { source: 'chat-tool', userId: 'u1' },
        payload: {}, type: 'command',
      })
      promise.catch(() => {})
      expect(ledger.getAuthorizedContextCount()).toBe(1)
      ledger.disconnectConnection('c1')
      expect(ledger.getAuthorizedContextCount()).toBe(0)
    })
  })

  describe('resolveAuthorizedContext', () => {
    it('returns null when context is null', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      expect(ledger.resolveAuthorizedContext('c1', undefined)).toBeNull()
    })

    it('returns null when no matching authorized context', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      ledger.createPendingRequest({
        action: 'execute', connectionId: 'c1',
        context: { source: 'chat-tool', userId: 'u1', conversationId: 'conv-1' },
        payload: {}, type: 'command',
      })
      expect(ledger.resolveAuthorizedContext('c1', { source: 'chat-tool', userId: 'other' })).toBeNull()
    })

    it('returns a clone of the matching authorized context', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      ledger.createPendingRequest({
        action: 'execute', connectionId: 'c1',
        context: { source: 'chat-tool', userId: 'u1', conversationId: 'conv-1' },
        payload: {}, type: 'command',
      })
      const resolved = ledger.resolveAuthorizedContext('c1', { source: 'chat-tool', userId: 'u1', conversationId: 'conv-1' })
      expect(resolved).toEqual({ source: 'chat-tool', userId: 'u1', conversationId: 'conv-1' })
    })

    it('compares metadata via JSON serialization', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      ledger.createPendingRequest({
        action: 'execute', connectionId: 'c1',
        context: { source: 'chat-tool', userId: 'u1', metadata: { role: 'admin' } },
        payload: {}, type: 'command',
      })
      expect(ledger.resolveAuthorizedContext('c1', { source: 'chat-tool', userId: 'u1', metadata: { role: 'admin' } })).toBeTruthy()
      expect(ledger.resolveAuthorizedContext('c1', { source: 'chat-tool', userId: 'u1', metadata: { role: 'user' } })).toBeNull()
    })

    it('only matches if connectionId also matches', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      ledger.createPendingRequest({
        action: 'execute', connectionId: 'c1',
        context: { source: 'chat-tool', userId: 'u1' },
        payload: {}, type: 'command',
      })
      expect(ledger.resolveAuthorizedContext('c2', { source: 'chat-tool', userId: 'u1' })).toBeNull()
    })
  })

  describe('settlePendingRequest', () => {
    it('resolves the promise with the result', async () => {
      const ledger = new RuntimeGatewayRequestLedger()
      const promise = ledger.createPendingRequest({ action: 'execute', connectionId: 'c1', payload: {}, type: 'command' })
      ledger.settlePendingRequest({ requestId: 'runtime-request-1', result: { ok: true } })
      await expect(promise).resolves.toEqual({ ok: true })
    })

    it('rejects the promise with an error', async () => {
      const ledger = new RuntimeGatewayRequestLedger()
      const promise = ledger.createPendingRequest({ action: 'execute', connectionId: 'c1', payload: {}, type: 'command' })
      ledger.settlePendingRequest({ requestId: 'runtime-request-1', error: 'Something went wrong' })
      await expect(promise).rejects.toThrow('Something went wrong')
    })

    it('is a no-op for unknown requestId', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      expect(() => ledger.settlePendingRequest({ requestId: 'unknown', result: null })).not.toThrow()
    })

    it('resolves with null when result is not provided', async () => {
      const ledger = new RuntimeGatewayRequestLedger()
      const promise = ledger.createPendingRequest({ action: 'execute', connectionId: 'c1', payload: {}, type: 'command' })
      ledger.settlePendingRequest({ requestId: 'runtime-request-1' })
      await expect(promise).resolves.toBeNull()
    })

    it('cleans up authorized contexts on settle', () => {
      const ledger = new RuntimeGatewayRequestLedger()
      ledger.createPendingRequest({
        action: 'execute', connectionId: 'c1',
        context: { source: 'chat-tool', userId: 'u1' },
        payload: {}, type: 'command',
      })
      expect(ledger.getAuthorizedContextCount()).toBe(1)
      ledger.settlePendingRequest({ requestId: 'runtime-request-1', result: null })
      expect(ledger.getAuthorizedContextCount()).toBe(0)
    })
  })
})
