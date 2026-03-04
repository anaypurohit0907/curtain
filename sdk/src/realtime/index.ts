// =============================================================================
// Realtime — WebSocket subscriptions to Postgres changes
// =============================================================================

type EventCallback = (payload: RealtimePayload) => void

export interface RealtimePayload {
  event:      string                        // INSERT | UPDATE | DELETE
  schema:     string
  table:      string
  new:        Record<string, unknown> | null
  old:        Record<string, unknown> | null
  truncated?: boolean
}

export class RealtimeChannel {
  private ws: WebSocket | null = null
  private callbacks = new Map<string, EventCallback[]>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private shouldReconnect = true

  constructor(
    private baseURL: string,
    private name:    string,   // "public:products"
    private token:   string | null,
  ) {}

  /**
   * Listen for a specific event type on this channel.
   * Use '*' to listen for all event types.
   *
   * @example
   * client.channel('public:products')
   *   .on('INSERT', p => console.log('new row:', p.new))
   *   .on('*',      p => console.log('any change:', p))
   *   .subscribe()
   */
  on(event: 'INSERT' | 'UPDATE' | 'DELETE' | '*', callback: EventCallback): this {
    const existing = this.callbacks.get(event) ?? []
    this.callbacks.set(event, [...existing, callback])
    return this
  }

  /** Connect to the WebSocket server and subscribe. */
  subscribe(): this {
    this.shouldReconnect = true
    this._connect()
    return this
  }

  /** Disconnect and stop reconnecting. */
  unsubscribe(): void {
    this.shouldReconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  private _connect(): void {
    const wsBase = this.baseURL
      .replace(/^https:\/\//, 'wss://')
      .replace(/^http:\/\//, 'ws://')

    const url = `${wsBase}/realtime/v1/websocket${this.token ? `?token=${this.token}` : ''}`

    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.reconnectDelay = 1000  // reset backoff on successful connect

      // Subscribe to all registered event types
      for (const event of this.callbacks.keys()) {
        const [schema, table] = this.name.split(':')
        const channelKey = event === '*'
          ? `${schema ?? 'public'}:${table}:*`
          : `${schema ?? 'public'}:${table}:${event}`

        this.ws!.send(JSON.stringify({
          type:    'subscribe',
          channel: channelKey,
        }))
      }
    }

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data as string) as {
          type:    string
          channel?: string
          payload?: RealtimePayload
        }

        if (msg.type !== 'postgres_changes' || !msg.payload) return

        const payload = msg.payload
        const event   = payload.event  // INSERT | UPDATE | DELETE

        // Invoke exact callbacks
        const exact = this.callbacks.get(event)
        exact?.forEach(cb => cb(payload))

        // Invoke wildcard callbacks
        const wildcard = this.callbacks.get('*')
        wildcard?.forEach(cb => cb(payload))

      } catch {
        // ignore parse errors
      }
    }

    this.ws.onclose = () => {
      if (!this.shouldReconnect) return
      this.reconnectTimer = setTimeout(() => {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000)
        this._connect()
      }, this.reconnectDelay)
    }

    this.ws.onerror = () => {
      // onclose will fire after onerror; let it handle reconnection
    }
  }
}
