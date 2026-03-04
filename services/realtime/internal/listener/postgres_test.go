package listener

import (
	"encoding/json"
	"testing"
)

// ── ChangePayload JSON marshal/unmarshal ──────────────────────────────────────

func TestChangePayload_InsertRoundTrip(t *testing.T) {
	payload := `{
		"schema": "public",
		"table": "products",
		"event_type": "INSERT",
		"new_record": {"id":1,"name":"chai"}
	}`

	var p ChangePayload
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	if p.Schema != "public" {
		t.Errorf("Schema: got %q want public", p.Schema)
	}
	if p.Table != "products" {
		t.Errorf("Table: got %q want products", p.Table)
	}
	if p.EventType != "INSERT" {
		t.Errorf("EventType: got %q want INSERT", p.EventType)
	}
	if string(p.NewRecord) != `{"id":1,"name":"chai"}` {
		t.Errorf("NewRecord: got %s", p.NewRecord)
	}
	if p.OldRecord != nil {
		t.Errorf("OldRecord should be nil for INSERT, got: %s", p.OldRecord)
	}
	if p.Truncated {
		t.Error("Truncated should be false")
	}
}

func TestChangePayload_UpdateContainsOldAndNew(t *testing.T) {
	payload := `{
		"schema": "public",
		"table": "orders",
		"event_type": "UPDATE",
		"old_record": {"status":"pending"},
		"new_record": {"status":"shipped"}
	}`

	var p ChangePayload
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	if p.EventType != "UPDATE" {
		t.Errorf("EventType: got %q want UPDATE", p.EventType)
	}
	if string(p.OldRecord) != `{"status":"pending"}` {
		t.Errorf("OldRecord: got %s", p.OldRecord)
	}
	if string(p.NewRecord) != `{"status":"shipped"}` {
		t.Errorf("NewRecord: got %s", p.NewRecord)
	}
}

func TestChangePayload_DeleteEventType(t *testing.T) {
	payload := `{
		"schema": "auth",
		"table": "users",
		"event_type": "DELETE",
		"old_record": {"id":"abc"}
	}`

	var p ChangePayload
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	if p.EventType != "DELETE" {
		t.Errorf("EventType: got %q want DELETE", p.EventType)
	}
	if p.Schema != "auth" {
		t.Errorf("Schema: got %q want auth", p.Schema)
	}
	if p.NewRecord != nil {
		t.Errorf("NewRecord should be nil for DELETE, got: %s", p.NewRecord)
	}
}

func TestChangePayload_TruncatedFlag(t *testing.T) {
	payload := `{
		"schema": "public",
		"table": "logs",
		"event_type": "INSERT",
		"truncated": true,
		"new_record": {"id":42}
	}`

	var p ChangePayload
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	if !p.Truncated {
		t.Error("Truncated should be true")
	}
}

func TestChangePayload_EmptyPayloadErrors(t *testing.T) {
	var p ChangePayload
	err := json.Unmarshal([]byte(""), &p)
	if err == nil {
		t.Fatal("expected error for empty payload")
	}
}

func TestChangePayload_InvalidJSON(t *testing.T) {
	var p ChangePayload
	err := json.Unmarshal([]byte("{not valid json"), &p)
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestChangePayload_MissingFields_DoesNotError(t *testing.T) {
	// Minimal payload with only required subset — should still parse.
	payload := `{"schema":"s","table":"t","event_type":"INSERT"}`
	var p ChangePayload
	if err := json.Unmarshal([]byte(payload), &p); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.Schema != "s" || p.Table != "t" || p.EventType != "INSERT" {
		t.Errorf("unexpected parsed values: %+v", p)
	}
}

// ── Channel key construction (mirrors logic in listener.listen) ───────────────

func TestChannelKey_SpecificAndWildcard(t *testing.T) {
	p := ChangePayload{
		Schema:    "public",
		Table:     "products",
		EventType: "INSERT",
	}

	specific := p.Schema + ":" + p.Table + ":" + p.EventType
	wildcard := p.Schema + ":" + p.Table + ":*"

	if specific != "public:products:INSERT" {
		t.Errorf("specific channel key: got %q", specific)
	}
	if wildcard != "public:products:*" {
		t.Errorf("wildcard channel key: got %q", wildcard)
	}
}

// ── pgNotifyChannel constant ──────────────────────────────────────────────────

func TestPgNotifyChannel_Value(t *testing.T) {
	if pgNotifyChannel != "curtain_changes" {
		t.Errorf("pgNotifyChannel: got %q want curtain_changes", pgNotifyChannel)
	}
}
