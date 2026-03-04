package ws

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"

	"github.com/curtain/curtain/services/realtime/internal/hub"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10 // slightly less than pongWait
	maxMessageSize = 8 * 1024            // 8KB
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true // CORS is handled by Caddy
	},
}

// Handler upgrades HTTP to WebSocket and manages the client lifecycle.
type Handler struct {
	Hub       *hub.Hub
	JWTSecret []byte
}

// ServeHTTP upgrades the connection and spawns read/write pumps.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Optional JWT authentication via query param or header
	token := r.URL.Query().Get("token")
	if token == "" {
		token = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	}

	userID, role := "anon", "anon"
	if token != "" {
		if claims, err := parseJWT(token, h.JWTSecret); err == nil {
			if sub, ok := claims["sub"].(string); ok {
				userID = sub
			}
			if r, ok := claims["role"].(string); ok {
				role = r
			}
		}
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws: upgrade failed: %v", err)
		return
	}

	client := hub.NewClient(userID, role, conn)
	h.Hub.Register(client)

	log.Printf("ws: client %s connected (user=%s)", client.ID, userID)

	// Send welcome message
	welcome, _ := json.Marshal(map[string]string{
		"type":   "connected",
		"status": "ok",
	})
	client.Send <- welcome

	// Concurrent read/write goroutines
	go h.writePump(client)
	h.readPump(client) // blocks until disconnect
}

// readPump reads messages from the WebSocket and handles subscriptions.
func (h *Handler) readPump(c *hub.Client) {
	defer func() {
		h.Hub.Unregister(c)
		c.Conn.Close()
		log.Printf("ws: client %s disconnected", c.ID)
	}()

	c.Conn.SetReadLimit(maxMessageSize)
	_ = c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	c.Conn.SetPongHandler(func(string) error {
		return c.Conn.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		_, msg, err := c.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err,
				websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("ws: read error for client %s: %v", c.ID, err)
			}
			return
		}

		var in hub.InboundMessage
		if err := json.Unmarshal(msg, &in); err != nil {
			continue
		}

		switch in.Type {
		case "subscribe":
			if in.Channel != "" {
				c.Subscribe(in.Channel)
				ack, _ := json.Marshal(map[string]string{
					"type":    "subscribed",
					"channel": in.Channel,
				})
				select {
				case c.Send <- ack:
				default:
				}
			}

		case "unsubscribe":
			if in.Channel != "" {
				c.Unsubscribe(in.Channel)
			}

		case "ping":
			pong, _ := json.Marshal(map[string]string{"type": "pong"})
			select {
			case c.Send <- pong:
			default:
			}
		}
	}
}

// writePump drains the client's Send channel and writes to WebSocket.
func (h *Handler) writePump(c *hub.Client) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.Conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.Send:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel
				_ = c.Conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.Conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}

		case <-ticker.C:
			_ = c.Conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.Conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func parseJWT(tokenStr string, secret []byte) (jwt.MapClaims, error) {
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return secret, nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}
