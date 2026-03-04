// =============================================================================
// realtime.test.ts — RealtimeChannel WebSocket tests
// =============================================================================
// WebSocket is mocked globally so no real connections are made.
// The mock exposes helpers (triggerOpen / triggerMessage / triggerClose) that
// let tests simulate server-to-client events synchronously.
// =============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RealtimeChannel } from './index'

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------

class MockWebSocket {
  /** Accumulated list of all instances created during a test. */
  static instances: MockWebSocket[] = []

  url: string

  // Mirrors the real WebSocket event handlers the SDK assigns
  onopen:    (() => void)                              | null = null
  onmessage: ((evt: { data: string }) => void)         | null = null
  onclose:   (() => void)                              | null = null
  onerror:   (() => void)                              | null = null

  send  = vi.fn()
  close = vi.fn()

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  // ── helpers used in tests ─────────────────────────────────────────────────

  /** Simulate the server accepting the connection. */
  triggerOpen() {
    this.onopen?.()
  }

  /** Simulate a postgres_changes message from the server. */
  triggerMessage(payload: object) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  /** Simulate the connection dropping. */
  triggerClose() {
    this.onclose?.()
  }
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const BASE    = 'http://localhost:8080'
const WS_BASE = 'ws://localhost:8080'
const TOKEN   = 'test-realtime-token'
const CHANNEL = 'public:products'

/** Returns the most-recently-created MockWebSocket instance. */
function latestWS(): MockWebSocket {
  return MockWebSocket.instances[MockWebSocket.instances.length - 1]
}

/** Build a postgres_changes message in the format the SDK expects. */
function makeMsg(event: 'INSERT' | 'UPDATE' | 'DELETE', row: object = {}) {
  return {
    type:    'postgres_changes',
    payload: {
      event,
      schema: 'public',
      table:  'products',
      new:    event !== 'DELETE' ? row : null,
      old:    event !== 'INSERT' ? row : null,
    },
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  MockWebSocket.instances = []
  vi.stubGlobal('WebSocket', MockWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllTimers()
})

// ---------------------------------------------------------------------------
// subscribe()
// ---------------------------------------------------------------------------

describe('RealtimeChannel.subscribe', () => {
  it('opens a WebSocket to the correct URL with token query param', () => {
    const ch = new RealtimeChannel(BASE, CHANNEL, TOKEN)
    ch.subscribe()

    expect(MockWebSocket.instances).toHaveLength(1)
    const ws = latestWS()
    expect(ws.url).toBe(`${WS_BASE}/realtime/v1/websocket?token=${TOKEN}`)
  })

  it('opens a WebSocket without query param when no token is provided', () => {
    const ch = new RealtimeChannel(BASE, CHANNEL, null)
    ch.subscribe()

    expect(latestWS().url).toBe(`${WS_BASE}/realtime/v1/websocket`)
  })

  it('converts https:// base URL to wss://', () => {
    const ch = new RealtimeChannel('https://baas.example.com', CHANNEL, TOKEN)
    ch.subscribe()

    expect(latestWS().url).toMatch(/^wss:\/\//)
  })

  it('sends a subscribe message for each registered event type on open', () => {
    const ch = new RealtimeChannel(BASE, CHANNEL, TOKEN)
    ch.on('INSERT', () => {}).on('UPDATE', () => {}).subscribe()

    latestWS().triggerOpen()

    // Should have sent two subscribe messages — one per event type
    expect(latestWS().send).toHaveBeenCalledTimes(2)

    const sentMessages = (latestWS().send as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => JSON.parse(c[0] as string),
    )
    expect(sentMessages.some((m) => m.type === 'subscribe')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// on() + message routing
// ---------------------------------------------------------------------------

describe('RealtimeChannel.on', () => {
  it('INSERT callback is called when an INSERT postgres_changes message is received', () => {
    const cb = vi.fn()
    const ch = new RealtimeChannel(BASE, CHANNEL, TOKEN)
    ch.on('INSERT', cb).subscribe()

    latestWS().triggerOpen()
    latestWS().triggerMessage(makeMsg('INSERT', { id: 1, name: 'Laptop' }))

    expect(cb).toHaveBeenCalledTimes(1)
    const payload = cb.mock.calls[0][0]
    expect(payload.event).toBe('INSERT')
    expect(payload.new).toEqual({ id: 1, name: 'Laptop' })
  })

  it('UPDATE callback fires on UPDATE messages only', () => {
    const insertCb = vi.fn()
    const updateCb = vi.fn()
    const ch = new RealtimeChannel(BASE, CHANNEL, TOKEN)
    ch.on('INSERT', insertCb).on('UPDATE', updateCb).subscribe()

    latestWS().triggerOpen()
    latestWS().triggerMessage(makeMsg('UPDATE', { id: 2, name: 'Desktop' }))

    expect(updateCb).toHaveBeenCalledTimes(1)
    expect(insertCb).not.toHaveBeenCalled()
  })

  it('DELETE callback fires on DELETE messages', () => {
    const cb = vi.fn()
    new RealtimeChannel(BASE, CHANNEL, TOKEN).on('DELETE', cb).subscribe()

    latestWS().triggerOpen()
    latestWS().triggerMessage(makeMsg('DELETE', { id: 99 }))

    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0].event).toBe('DELETE')
  })

  it('wildcard "*" callback fires for INSERT, UPDATE, and DELETE', () => {
    const cb = vi.fn()
    new RealtimeChannel(BASE, CHANNEL, TOKEN).on('*', cb).subscribe()

    latestWS().triggerOpen()
    latestWS().triggerMessage(makeMsg('INSERT'))
    latestWS().triggerMessage(makeMsg('UPDATE'))
    latestWS().triggerMessage(makeMsg('DELETE'))

    expect(cb).toHaveBeenCalledTimes(3)
  })

  it('multiple on() handlers for the same event all fire independently', () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    const cb3 = vi.fn()
    new RealtimeChannel(BASE, CHANNEL, TOKEN)
      .on('INSERT', cb1)
      .on('INSERT', cb2)
      .on('INSERT', cb3)
      .subscribe()

    latestWS().triggerOpen()
    latestWS().triggerMessage(makeMsg('INSERT', { id: 7 }))

    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).toHaveBeenCalledTimes(1)
    expect(cb3).toHaveBeenCalledTimes(1)

    // All three receive the same payload object
    expect(cb1.mock.calls[0][0]).toEqual(cb2.mock.calls[0][0])
  })

  it('does not fire an exact callback when a different event type is received', () => {
    const insertCb = vi.fn()
    new RealtimeChannel(BASE, CHANNEL, TOKEN).on('INSERT', insertCb).subscribe()

    latestWS().triggerOpen()
    latestWS().triggerMessage(makeMsg('DELETE'))

    expect(insertCb).not.toHaveBeenCalled()
  })

  it('silently ignores malformed (non-JSON) messages', () => {
    const cb = vi.fn()
    const ch = new RealtimeChannel(BASE, CHANNEL, TOKEN)
    ch.on('INSERT', cb).subscribe()

    latestWS().triggerOpen()
    latestWS().onmessage?.({ data: 'not-json-at-all' })

    expect(cb).not.toHaveBeenCalled()
  })

  it('silently ignores messages with an unknown type field', () => {
    const cb = vi.fn()
    new RealtimeChannel(BASE, CHANNEL, TOKEN).on('INSERT', cb).subscribe()

    latestWS().triggerOpen()
    latestWS().triggerMessage({ type: 'ping' })

    expect(cb).not.toHaveBeenCalled()
  })

  it('exact and wildcard callbacks both fire on the same message', () => {
    const exactCb    = vi.fn()
    const wildcardCb = vi.fn()
    new RealtimeChannel(BASE, CHANNEL, TOKEN)
      .on('UPDATE', exactCb)
      .on('*', wildcardCb)
      .subscribe()

    latestWS().triggerOpen()
    latestWS().triggerMessage(makeMsg('UPDATE', { id: 10 }))

    expect(exactCb).toHaveBeenCalledTimes(1)
    expect(wildcardCb).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// unsubscribe()
// ---------------------------------------------------------------------------

describe('RealtimeChannel.unsubscribe', () => {
  it('closes the WebSocket connection', () => {
    const ch = new RealtimeChannel(BASE, CHANNEL, TOKEN)
    ch.on('INSERT', () => {}).subscribe()

    const ws = latestWS()
    ch.unsubscribe()

    expect(ws.close).toHaveBeenCalledTimes(1)
  })

  it('prevents reconnection after unsubscribe', () => {
    vi.useFakeTimers()

    const ch = new RealtimeChannel(BASE, CHANNEL, TOKEN)
    ch.subscribe()

    const ws = latestWS()

    // Unsubscribe, then simulate a close event
    ch.unsubscribe()
    ws.triggerClose()

    // Fast-forward past any potential reconnect timer
    vi.runAllTimers()

    // Only the original WS should ever have been created
    expect(MockWebSocket.instances).toHaveLength(1)

    vi.useRealTimers()
  })

  it('can be called before subscribe() without throwing', () => {
    const ch = new RealtimeChannel(BASE, CHANNEL, TOKEN)
    expect(() => ch.unsubscribe()).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Reconnection behaviour (shouldReconnect=true)
// ---------------------------------------------------------------------------

describe('RealtimeChannel reconnection', () => {
  it('reconnects after an unexpected close when still subscribed', () => {
    vi.useFakeTimers()

    const ch = new RealtimeChannel(BASE, CHANNEL, TOKEN)
    ch.subscribe()

    expect(MockWebSocket.instances).toHaveLength(1)

    // Simulate unexpected close
    latestWS().triggerClose()

    // Advance past the initial 1 000 ms reconnect delay
    vi.advanceTimersByTime(1100)

    expect(MockWebSocket.instances).toHaveLength(2)

    // Clean up
    ch.unsubscribe()
    vi.useRealTimers()
  })
})
