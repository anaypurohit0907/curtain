package runner

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// ── sanitize ─────────────────────────────────────────────────────────────────

func TestSanitize_AllowsAlphanumericAndDash(t *testing.T) {
	cases := []struct {
		input string
		want  string
	}{
		{"hello-world", "hello-world"},
		{"MyFunction_v2", "MyFunction_v2"},
		{"fn123", "fn123"},
		{"A-Z_a-z_0-9", "A-Z_a-z_0-9"},
	}
	for _, tc := range cases {
		got := sanitize(tc.input)
		if got != tc.want {
			t.Errorf("sanitize(%q): got %q want %q", tc.input, got, tc.want)
		}
	}
}

func TestSanitize_StripsSpecialChars(t *testing.T) {
	got := sanitize("my function!@#$name")
	want := "myfunctionname"
	if got != want {
		t.Errorf("sanitize: got %q want %q", got, want)
	}
}

func TestSanitize_EmptyStringReturnsFn(t *testing.T) {
	got := sanitize("")
	if got != "fn" {
		t.Errorf("sanitize empty: got %q want fn", got)
	}
}

func TestSanitize_AllSpecialCharsReturnsFn(t *testing.T) {
	got := sanitize("!@#$%^&*()")
	if got != "fn" {
		t.Errorf("sanitize all-special: got %q want fn", got)
	}
}

func TestSanitize_SlashStripped(t *testing.T) {
	got := sanitize("path/to/function")
	if strings.Contains(got, "/") {
		t.Errorf("sanitize: forward slash not stripped, got %q", got)
	}
}

// ── wrapUserCode ──────────────────────────────────────────────────────────────

func TestWrapUserCode_ContainsUserCode(t *testing.T) {
	userCode := `export default function handler(req) { return new Response("hi"); }`
	wrapped := wrapUserCode(userCode, nil, nil)

	if !strings.Contains(wrapped, userCode) {
		t.Error("wrapped output does not contain user code")
	}
}

func TestWrapUserCode_ContainsBody(t *testing.T) {
	body := []byte(`{"key":"value"}`)
	wrapped := wrapUserCode("// code", body, nil)

	if !strings.Contains(wrapped, `{"key":"value"}`) {
		t.Errorf("wrapped output does not contain body JSON\n%s", wrapped)
	}
}

func TestWrapUserCode_NilBodyUsesNull(t *testing.T) {
	wrapped := wrapUserCode("// code", nil, nil)
	if !strings.Contains(wrapped, "const __body    = null") {
		t.Errorf("expected null body placeholder\n%s", wrapped)
	}
}

func TestWrapUserCode_HeadersEmbedded(t *testing.T) {
	headers := map[string]string{
		"content-type":  "application/json",
		"x-custom-header": "somevalue",
	}
	wrapped := wrapUserCode("// code", nil, headers)

	headersJSON, _ := json.Marshal(headers)
	if !strings.Contains(wrapped, string(headersJSON)) {
		t.Errorf("wrapped output does not contain headers JSON\nwant to find: %s\ngot:\n%s",
			headersJSON, wrapped)
	}
}

func TestWrapUserCode_ContainsHandlerCheck(t *testing.T) {
	wrapped := wrapUserCode("// code", nil, nil)
	if !strings.Contains(wrapped, "typeof handler") {
		t.Error("wrapped output should include typeof handler check")
	}
}

func TestWrapUserCode_EmptyBodyAndHeaders(t *testing.T) {
	wrapped := wrapUserCode("", []byte(""), map[string]string{})
	// Empty body string ("") should be treated as null per implementation
	if !strings.Contains(wrapped, "const __body    = null") {
		t.Errorf("empty body should produce null\n%s", wrapped)
	}
}

// ── ms ────────────────────────────────────────────────────────────────────────

func TestMs_PositiveDuration(t *testing.T) {
	start := time.Now().Add(-100 * time.Millisecond)
	got := ms(start)
	if got < 50 {
		t.Errorf("ms: expected >= 50ms, got %d", got)
	}
}

func TestMs_RecentStart(t *testing.T) {
	start := time.Now()
	got := ms(start)
	// Should be very small (0-5ms in most cases)
	if got > 100 {
		t.Errorf("ms: unexpectedly large value %d for fresh start", got)
	}
}

// ── New (constructor) ─────────────────────────────────────────────────────────

func TestNew_CreatesDirectoryIfMissing(t *testing.T) {
	dir := t.TempDir() + "/edge-fns-test"
	r := New("deno", dir, 10*time.Second)

	if _, err := os.Stat(dir); os.IsNotExist(err) {
		t.Errorf("New should create functionDir %q", dir)
	}
	if r.denoPath != "deno" {
		t.Errorf("denoPath: got %q want deno", r.denoPath)
	}
	if r.timeout != 10*time.Second {
		t.Errorf("timeout: got %v want 10s", r.timeout)
	}
}

// ── Invoke (integration — skipped if deno not found) ─────────────────────────

func denoPath(t *testing.T) string {
	t.Helper()
	path, err := exec.LookPath("deno")
	if err != nil {
		t.Skip("deno not found in PATH — skipping integration test")
	}
	return path
}

func TestInvoke_ValidHandler_Returns200(t *testing.T) {
	deno := denoPath(t)
	dir := t.TempDir()
	r := New(deno, dir, 10*time.Second)

	code := `
export default function handler(req) {
  return new Response(JSON.stringify({ok:true}), {
    status: 200,
    headers: {"content-type":"application/json"},
  });
}
`
	result := r.Invoke(context.Background(), "test-fn", code, nil, nil)
	if result.StatusCode != 200 {
		t.Errorf("StatusCode: got %d want 200\nError: %s", result.StatusCode, result.Error)
	}
	if !strings.Contains(result.Body, "ok") {
		t.Errorf("Body: got %q want to contain 'ok'", result.Body)
	}
	if result.Error != "" {
		t.Errorf("unexpected Error: %s", result.Error)
	}
}

func TestInvoke_Timeout_Returns504(t *testing.T) {
	deno := denoPath(t)
	dir := t.TempDir()
	r := New(deno, dir, 50*time.Millisecond) // very short timeout

	code := `
export default async function handler(req) {
  await new Promise(resolve => setTimeout(resolve, 60000));
  return new Response("done");
}
`
	result := r.Invoke(context.Background(), "slow-fn", code, nil, nil)
	if result.StatusCode != 504 {
		t.Errorf("StatusCode: got %d want 504 for timeout", result.StatusCode)
	}
	if !strings.Contains(result.Error, "timed out") {
		t.Errorf("Error: got %q want 'function timed out'", result.Error)
	}
}

func TestInvoke_MissingHandler_Returns500(t *testing.T) {
	deno := denoPath(t)
	dir := t.TempDir()
	r := New(deno, dir, 5*time.Second)

	// Code that doesn't define a `handler` function
	code := `const x = 1;`

	result := r.Invoke(context.Background(), "no-handler", code, nil, nil)
	if result.StatusCode != 500 {
		t.Errorf("StatusCode: got %d want 500 when handler missing", result.StatusCode)
	}
}

func TestInvoke_RequestBodyPassedThrough(t *testing.T) {
	deno := denoPath(t)
	dir := t.TempDir()
	r := New(deno, dir, 10*time.Second)

	code := `
export default function handler(req) {
  return new Response(JSON.stringify({received: req.body}));
}
`
	body := []byte(`{"hello":"curtain"}`)
	result := r.Invoke(context.Background(), "echo-fn", code, body, nil)
	if result.StatusCode != 200 {
		t.Errorf("StatusCode: got %d want 200\nError: %s", result.StatusCode, result.Error)
	}
	if !strings.Contains(result.Body, "curtain") {
		t.Errorf("Body: expected to contain 'curtain', got %q", result.Body)
	}
}

func TestInvoke_SanitizesFilename(t *testing.T) {
	// Function name with special chars should not cause file system issues.
	deno := denoPath(t)
	dir := t.TempDir()
	r := New(deno, dir, 5*time.Second)

	code := `export default function handler(req) { return new Response("ok"); }`
	result := r.Invoke(context.Background(), "my fn/with hacks!", code, nil, nil)

	// Should not crash — sanitize prevents bad filenames.
	if result == nil {
		t.Fatal("expected non-nil result")
	}
}

func TestInvoke_DurationMsIsNonNegative(t *testing.T) {
	deno := denoPath(t)
	dir := t.TempDir()
	r := New(deno, dir, 5*time.Second)

	code := `export default function handler(req) { return new Response("hi"); }`
	result := r.Invoke(context.Background(), "duration-test", code, nil, nil)

	if result.DurationMs < 0 {
		t.Errorf("DurationMs should be non-negative, got %d", result.DurationMs)
	}
}
