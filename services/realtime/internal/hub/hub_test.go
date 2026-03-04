package hub

import (
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
)

// ── helpers ───────────────────────────────────────────────────────────────────

// newTestClient creates a Client without a real WebSocket connection.
// Send buffer is 4 to avoid blocking in tests.
func newTestClient() *Client {
	return &Client{
		ID:     uuid.New(),
		UserID: "user-1",
		Role:   "authenticated",
		Conn:   nil, // not used in Hub tests
		Send:   make(chan []byte, 4),
	}
}

// startHub starts the Hub event loop in a goroutine and returns a stop function.
func startHub(h *Hub) (stop func()) {
	done := make(chan struct{})
	go func() {
		// Run until stop is called via channel drain trick — we simply
		// let the goroutine run since Hub.Run loops forever.
		// Signal stop via closing done.
		<-done
	}()
	go h.Run()
	// Give the goroutine a moment to start
	time.Sleep(5 * time.Millisecond)
	return func() { close(done) }
}

// waitFor polls fn up to maxWait for it to return true.
func waitFor(t *testing.T, maxWait time.Duration, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(maxWait)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatal("condition not met within timeout")
}

// ── Client subscribe/unsubscribe ──────────────────────────────────────────────

func TestClient_SubscribeUnsubscribe(t *testing.T) {
	c := newTestClient()

	if c.IsSubscribed("public:products:INSERT") {
		t.Fatal("client should not be subscribed before Subscribe call")
	}

	c.Subscribe("public:products:INSERT")
	if !c.IsSubscribed("public:products:INSERT") {
		t.Fatal("client should be subscribed after Subscribe call")
	}

	c.Unsubscribe("public:products:INSERT")
	if c.IsSubscribed("public:products:INSERT") {
		t.Fatal("client should not be subscribed after Unsubscribe call")
	}
}

func TestClient_MultipleChannels(t *testing.T) {
	c := newTestClient()
	channels := []string{
		"public:orders:INSERT",
		"public:orders:UPDATE",
		"public:orders:*",
	}
	for _, ch := range channels {
		c.Subscribe(ch)
	}
	for _, ch := range channels {
		if !c.IsSubscribed(ch) {
			t.Errorf("expected subscribed to %q", ch)
		}
	}

	c.Unsubscribe(channels[1])
	if c.IsSubscribed(channels[1]) {
		t.Errorf("should not be subscribed to %q after unsubscribe", channels[1])
	}
	if !c.IsSubscribed(channels[0]) {
		t.Errorf("should still be subscribed to %q", channels[0])
	}
}

// ── NewClient ─────────────────────────────────────────────────────────────────

func TestNewClient_Fields(t *testing.T) {
	c := NewClient("user-abc", "authenticated", nil)
	if c.UserID != "user-abc" {
		t.Errorf("UserID: got %q want user-abc", c.UserID)
	}
	if c.Role != "authenticated" {
		t.Errorf("Role: got %q want authenticated", c.Role)
	}
	if c.ID == (uuid.UUID{}) {
		t.Error("ID should be non-zero")
	}
	if c.Send == nil {
		t.Error("Send channel should be non-nil")
	}
}

// ── Hub Register / Unregister ─────────────────────────────────────────────────

func TestHub_RegisterIncrementsStats(t *testing.T) {
	h := New()
	stop := startHub(h)
	defer stop()

	c := newTestClient()
	h.Register(c)

	waitFor(t, 100*time.Millisecond, func() bool {
		return h.Stats()["connected_clients"] == 1
	})
}

func TestHub_UnregisterDecrementsStats(t *testing.T) {
	h := New()
	stop := startHub(h)
	defer stop()

	c := newTestClient()
	h.Register(c)
	waitFor(t, 100*time.Millisecond, func() bool {
		return h.Stats()["connected_clients"] == 1
	})

	h.Unregister(c)
	waitFor(t, 100*time.Millisecond, func() bool {
		return h.Stats()["connected_clients"] == 0
	})
}

func TestHub_UnregisterClosesSendChannel(t *testing.T) {
	h := New()
	stop := startHub(h)
	defer stop()

	c := newTestClient()
	h.Register(c)
	waitFor(t, 100*time.Millisecond, func() bool {
		return h.Stats()["connected_clients"] == 1
	})

	h.Unregister(c)

	// After unregister, the Send channel should be closed.
	waitFor(t, 100*time.Millisecond, func() bool {
		select {
		case _, ok := <-c.Send:
			return !ok // channel closed
		default:
			return false
		}
	})
}

func TestHub_MultipleClients(t *testing.T) {
	h := New()
	stop := startHub(h)
	defer stop()

	clients := make([]*Client, 5)
	for i := range clients {
		clients[i] = newTestClient()
		h.Register(clients[i])
	}

	waitFor(t, 200*time.Millisecond, func() bool {
		return h.Stats()["connected_clients"] == 5
	})

	// Unregister 2
	h.Unregister(clients[0])
	h.Unregister(clients[4])

	waitFor(t, 200*time.Millisecond, func() bool {
		return h.Stats()["connected_clients"] == 3
	})
}

// ── Hub Broadcast ─────────────────────────────────────────────────────────────

func TestHub_BroadcastDeliverToSubscriber(t *testing.T) {
	h := New()
	stop := startHub(h)
	defer stop()

	c := newTestClient()
	c.Subscribe("public:items:INSERT")
	h.Register(c)

	waitFor(t, 100*time.Millisecond, func() bool {
		return h.Stats()["connected_clients"] == 1
	})

	payload := []byte(`{"test":"data"}`)
	h.Broadcast(&BroadcastMessage{
		Channel: "public:items:INSERT",
		Payload: payload,
	})

	select {
	case got := <-c.Send:
		if string(got) != string(payload) {
			t.Errorf("payload: got %q want %q", got, payload)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("timed out waiting for broadcast message")
	}
}

func TestHub_BroadcastNoDeliveryToNonSubscriber(t *testing.T) {
	h := New()
	stop := startHub(h)
	defer stop()

	c := newTestClient()
	c.Subscribe("public:other:INSERT") // subscribed to a different channel
	h.Register(c)

	waitFor(t, 100*time.Millisecond, func() bool {
		return h.Stats()["connected_clients"] == 1
	})

	h.Broadcast(&BroadcastMessage{
		Channel: "public:items:INSERT",
		Payload: []byte(`{"data":"x"}`),
	})

	select {
	case <-c.Send:
		t.Fatal("should not receive message for unsubscribed channel")
	case <-time.After(50 * time.Millisecond):
		// correctly not delivered
	}
}

func TestHub_BroadcastDeliveryToMultipleSubscribers(t *testing.T) {
	h := New()
	stop := startHub(h)
	defer stop()

	const channel = "public:events:*"
	clients := make([]*Client, 3)
	for i := range clients {
		clients[i] = newTestClient()
		clients[i].Subscribe(channel)
		h.Register(clients[i])
	}

	waitFor(t, 200*time.Millisecond, func() bool {
		return h.Stats()["connected_clients"] == 3
	})

	h.Broadcast(&BroadcastMessage{Channel: channel, Payload: []byte(`"hello"`)})

	for i, c := range clients {
		select {
		case <-c.Send:
			// ok
		case <-time.After(200 * time.Millisecond):
			t.Errorf("client %d: timed out waiting for message", i)
		}
	}
}

// ── Hub Stats ─────────────────────────────────────────────────────────────────

func TestHub_StatsZeroWhenEmpty(t *testing.T) {
	h := New()
	stats := h.Stats()
	if v, ok := stats["connected_clients"]; !ok || v != 0 {
		t.Errorf("expected connected_clients=0, got %v", stats)
	}
}

// ── Concurrent safety ─────────────────────────────────────────────────────────

func TestHub_ConcurrentRegistrations(t *testing.T) {
	h := New()
	stop := startHub(h)
	defer stop()

	const n = 50
	var wg sync.WaitGroup
	wg.Add(n)
	clients := make([]*Client, n)
	for i := 0; i < n; i++ {
		clients[i] = newTestClient()
		go func(c *Client) {
			defer wg.Done()
			h.Register(c)
		}(clients[i])
	}
	wg.Wait()

	waitFor(t, 500*time.Millisecond, func() bool {
		return h.Stats()["connected_clients"] == n
	})

	// Now unregister all concurrently
	var wg2 sync.WaitGroup
	wg2.Add(n)
	for i := 0; i < n; i++ {
		go func(c *Client) {
			defer wg2.Done()
			h.Unregister(c)
		}(clients[i])
	}
	wg2.Wait()

	waitFor(t, 500*time.Millisecond, func() bool {
		return h.Stats()["connected_clients"] == 0
	})
}

// ── MarshalOutbound ───────────────────────────────────────────────────────────

func TestMarshalOutbound_Structure(t *testing.T) {
	payload := json.RawMessage(`{"key":"value"}`)
	b := MarshalOutbound("postgres_changes", "public:items:INSERT", payload)

	var out OutboundMessage
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if out.Type != "postgres_changes" {
		t.Errorf("type: got %q want postgres_changes", out.Type)
	}
	if out.Channel != "public:items:INSERT" {
		t.Errorf("channel: got %q want public:items:INSERT", out.Channel)
	}
	if string(out.Payload) != `{"key":"value"}` {
		t.Errorf("payload: got %q want {\"key\":\"value\"}", out.Payload)
	}
}

func TestMarshalOutbound_EmptyPayload(t *testing.T) {
	b := MarshalOutbound("ping", "", nil)
	var out OutboundMessage
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if out.Type != "ping" {
		t.Errorf("type: got %q want ping", out.Type)
	}
}
