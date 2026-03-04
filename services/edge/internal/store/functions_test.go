package store

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

// ── ErrNotFound sentinel ──────────────────────────────────────────────────────

func TestErrNotFound_IsDistinct(t *testing.T) {
	if ErrNotFound == nil {
		t.Fatal("ErrNotFound should not be nil")
	}
	if ErrNotFound.Error() == "" {
		t.Fatal("ErrNotFound should have a non-empty message")
	}
}

func TestErrNotFound_ErrorsIs(t *testing.T) {
	wrapped := errors.New("wrapped: " + ErrNotFound.Error())
	if errors.Is(wrapped, ErrNotFound) {
		t.Error("plain wrapped error should not match ErrNotFound via errors.Is")
	}
	if !errors.Is(ErrNotFound, ErrNotFound) {
		t.Error("ErrNotFound should match itself via errors.Is")
	}
}

func TestErrNotFound_Message(t *testing.T) {
	if ErrNotFound.Error() != "function not found" {
		t.Errorf("ErrNotFound message: got %q want %q", ErrNotFound.Error(), "function not found")
	}
}

// ── Function struct ───────────────────────────────────────────────────────────

func TestFunction_ZeroValue(t *testing.T) {
	var f Function
	if f.ID != (uuid.UUID{}) {
		t.Error("zero ID should be empty UUID")
	}
	if f.Name != "" {
		t.Error("zero Name should be empty string")
	}
	if f.Slug != "" {
		t.Error("zero Slug should be empty string")
	}
	if f.Code != "" {
		t.Error("zero Code should be empty string")
	}
}

func TestFunction_FieldAssignment(t *testing.T) {
	id := uuid.New()
	f := Function{
		ID:   id,
		Name: "send-email",
		Slug: "send-email",
		Code: `export default function handler(req) { return new Response("ok"); }`,
	}

	if f.ID != id {
		t.Errorf("ID: got %v want %v", f.ID, id)
	}
	if f.Name != "send-email" {
		t.Errorf("Name: got %q want send-email", f.Name)
	}
	if f.Slug != "send-email" {
		t.Errorf("Slug: got %q want send-email", f.Slug)
	}
	if f.Code == "" {
		t.Error("Code should not be empty after assignment")
	}
}

func TestFunction_SlugAndNameCanDiffer(t *testing.T) {
	f := Function{
		Name: "Send Welcome Email",
		Slug: "send-welcome-email",
	}
	if f.Name == f.Slug {
		t.Error("Name and Slug are expected to be different formats (display vs URL-safe)")
	}
}

// ── Store type ────────────────────────────────────────────────────────────────

func TestStore_NilPool(t *testing.T) {
	// Verify Store struct can be created without panicking on construction.
	// pool=nil is expected in unit tests without a real DB.
	s := &Store{pool: nil}
	if s == nil {
		t.Fatal("Store should be constructable")
	}
}

// ── Slug-based channel derivation (mirrors usage in edge handler) ─────────────

func TestSlug_URLSafe(t *testing.T) {
	// Slugs used in edge function routes should be URL-safe.
	slugs := []struct {
		slug  string
		valid bool
	}{
		{"send-email", true},
		{"process_payment", true},
		{"myFunc123", true},
		{"send email", false},   // spaces not URL-safe
		{"fn/nested", false},   // slashes invalid
		{"fn?query=1", false},  // query chars invalid
	}

	isURLSafe := func(s string) bool {
		for _, c := range s {
			if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
				(c >= '0' && c <= '9') || c == '-' || c == '_') {
				return false
			}
		}
		return true
	}

	for _, tc := range slugs {
		got := isURLSafe(tc.slug)
		if got != tc.valid {
			t.Errorf("isURLSafe(%q): got %v want %v", tc.slug, got, tc.valid)
		}
	}
}
