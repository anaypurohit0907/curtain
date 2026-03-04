package hub

import (
	"encoding/json"
	"sync"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// Client is a single authenticated WebSocket connection.
type Client struct {
	ID       uuid.UUID
	UserID   string
	Role     string
	Conn     *websocket.Conn
	Send     chan []byte
	channels sync.Map // key: channel string, value: bool
}

func NewClient(userID, role string, conn *websocket.Conn) *Client {
	return &Client{
		ID:     uuid.New(),
		UserID: userID,
		Role:   role,
		Conn:   conn,
		Send:   make(chan []byte, 256),
	}
}

func (c *Client) Subscribe(channel string) {
	c.channels.Store(channel, true)
}

func (c *Client) Unsubscribe(channel string) {
	c.channels.Delete(channel)
}

func (c *Client) IsSubscribed(channel string) bool {
	_, ok := c.channels.Load(channel)
	return ok
}

// BroadcastMessage is the envelope sent to all subscribers.
type BroadcastMessage struct {
	Channel string
	Payload []byte
}

// Hub is the central registry for all connected clients.
// A single goroutine (Run) owns the client map to avoid locking.
type Hub struct {
	clients    map[uuid.UUID]*Client
	mu         sync.RWMutex
	register   chan *Client
	unregister chan *Client
	broadcast  chan *BroadcastMessage
}

func New() *Hub {
	return &Hub{
		clients:    make(map[uuid.UUID]*Client),
		register:   make(chan *Client, 512),
		unregister: make(chan *Client, 512),
		broadcast:  make(chan *BroadcastMessage, 4096),
	}
}

// Run is the event loop — must be called in a goroutine.
func (h *Hub) Run() {
	for {
		select {
		case c := <-h.register:
			h.mu.Lock()
			h.clients[c.ID] = c
			h.mu.Unlock()

		case c := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[c.ID]; ok {
				delete(h.clients, c.ID)
				close(c.Send)
			}
			h.mu.Unlock()

		case msg := <-h.broadcast:
			h.mu.RLock()
			for _, c := range h.clients {
				if c.IsSubscribed(msg.Channel) {
					select {
					case c.Send <- msg.Payload:
					default:
						// Slow client: channel buffer full, drop message.
						// The writePump will detect the closed channel on next tick.
					}
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (h *Hub) Register(c *Client)              { h.register <- c }
func (h *Hub) Unregister(c *Client)            { h.unregister <- c }
func (h *Hub) Broadcast(m *BroadcastMessage)   { h.broadcast <- m }

// Stats returns connected client count (for /health endpoint).
func (h *Hub) Stats() map[string]int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return map[string]int{"connected_clients": len(h.clients)}
}

// ── Wire protocol messages ────────────────────────────────────────────────────

// InboundMessage is a message from the client to the server.
type InboundMessage struct {
	Type    string `json:"type"`    // "subscribe" | "unsubscribe" | "ping"
	Channel string `json:"channel"` // e.g. "public:products:INSERT"
}

// OutboundMessage is a message from the server to the client.
type OutboundMessage struct {
	Type    string          `json:"type"`
	Channel string          `json:"channel,omitempty"`
	Payload json.RawMessage `json:"payload,omitempty"`
	Error   string          `json:"error,omitempty"`
}

func MarshalOutbound(t, channel string, payload json.RawMessage) []byte {
	b, _ := json.Marshal(OutboundMessage{
		Type:    t,
		Channel: channel,
		Payload: payload,
	})
	return b
}
