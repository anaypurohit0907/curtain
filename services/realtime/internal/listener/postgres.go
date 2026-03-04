package listener

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/curtain/curtain/services/realtime/internal/hub"
)

const pgNotifyChannel = "curtain_changes"

// ChangePayload mirrors the JSON emitted by the Postgres trigger.
type ChangePayload struct {
	Schema    string          `json:"schema"`
	Table     string          `json:"table"`
	EventType string          `json:"event_type"` // INSERT | UPDATE | DELETE
	OldRecord json.RawMessage `json:"old_record,omitempty"`
	NewRecord json.RawMessage `json:"new_record,omitempty"`
	Truncated bool            `json:"truncated,omitempty"`
}

// Listener maintains a single dedicated Postgres connection for LISTEN.
// On disconnect it reconnects automatically with exponential backoff.
type Listener struct {
	pool *pgxpool.Pool
	hub  *hub.Hub
}

func New(pool *pgxpool.Pool, h *hub.Hub) *Listener {
	return &Listener{pool: pool, hub: h}
}

// Run runs until ctx is cancelled.
func (l *Listener) Run(ctx context.Context) {
	backoff := time.Second
	for {
		if err := l.listen(ctx); err != nil {
			if ctx.Err() != nil {
				return // clean shutdown
			}
			log.Printf("realtime/listener: error: %v — reconnecting in %s", err, backoff)
			select {
			case <-time.After(backoff):
			case <-ctx.Done():
				return
			}
			if backoff < 32*time.Second {
				backoff *= 2
			}
		} else {
			backoff = time.Second // reset after successful run
		}
	}
}

func (l *Listener) listen(ctx context.Context) error {
	// Acquire a raw *pgx.Conn (not pooled) for the lifetime of this LISTEN session.
	conn, err := l.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, "LISTEN "+pgNotifyChannel); err != nil {
		return err
	}
	log.Printf("realtime/listener: LISTEN %s — waiting for notifications", pgNotifyChannel)

	for {
		notification, err := conn.Conn().WaitForNotification(ctx)
		if err != nil {
			return err
		}

		var p ChangePayload
		if err := json.Unmarshal([]byte(notification.Payload), &p); err != nil {
			log.Printf("realtime/listener: bad payload: %v", err)
			continue
		}

		outPayload, err := json.Marshal(map[string]any{
			"schema":     p.Schema,
			"table":      p.Table,
			"event_type": p.EventType,
			"old":        p.OldRecord,
			"new":        p.NewRecord,
			"truncated":  p.Truncated,
		})
		if err != nil {
			continue
		}

		// Broadcast to "<schema>:<table>:<event_type>" subscribers
		specific := p.Schema + ":" + p.Table + ":" + p.EventType
		l.hub.Broadcast(&hub.BroadcastMessage{
			Channel: specific,
			Payload: hub.MarshalOutbound("postgres_changes", specific, outPayload),
		})

		// Also broadcast to wildcard "<schema>:<table>:*" subscribers
		wildcard := p.Schema + ":" + p.Table + ":*"
		l.hub.Broadcast(&hub.BroadcastMessage{
			Channel: wildcard,
			Payload: hub.MarshalOutbound("postgres_changes", wildcard, outPayload),
		})
	}
}
