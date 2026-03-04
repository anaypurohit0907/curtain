package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/curtain/curtain/services/auth/internal/model"
)

// ── helpers ───────────────────────────────────────────────────────────────────

var testSecret = []byte("super-secret-test-key-curtain")

func testUser() *model.User {
	return &model.User{
		ID:        uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		Email:     "test@example.com",
		Provider:  "email",
		Role:      "authenticated",
		Confirmed: true,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
}

func newReq(method, path, body string) *http.Request {
	var buf *bytes.Buffer
	if body != "" {
		buf = bytes.NewBufferString(body)
	} else {
		buf = bytes.NewBuffer(nil)
	}
	r := httptest.NewRequest(method, path, buf)
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	return r
}

func decodeResponse(t *testing.T, rr *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&m); err != nil {
		t.Fatalf("failed to decode response body: %v\nbody: %s", err, rr.Body.String())
	}
	return m
}

// ── generateAccessToken ───────────────────────────────────────────────────────

func TestGenerateAccessToken_ContainsClaims(t *testing.T) {
	u := testUser()
	tok, err := generateAccessToken(u, testSecret, time.Hour)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if tok == "" {
		t.Fatal("expected non-empty token")
	}

	claims, err := parseJWT(tok, testSecret)
	if err != nil {
		t.Fatalf("parseJWT error: %v", err)
	}

	if claims["sub"] != u.ID.String() {
		t.Errorf("sub: got %v want %v", claims["sub"], u.ID.String())
	}
	if claims["email"] != u.Email {
		t.Errorf("email: got %v want %v", claims["email"], u.Email)
	}
	if claims["role"] != u.Role {
		t.Errorf("role: got %v want %v", claims["role"], u.Role)
	}
	if claims["iss"] != "curtain" {
		t.Errorf("iss: got %v want curtain", claims["iss"])
	}
}

func TestGenerateAccessToken_RespectsExpiry(t *testing.T) {
	u := testUser()
	// Issue a token with a 1-second expiry and verify the exp claim is in the future.
	tok, err := generateAccessToken(u, testSecret, time.Second)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	claims, err := parseJWT(tok, testSecret)
	if err != nil {
		t.Fatalf("parseJWT error: %v", err)
	}
	expVal, ok := claims["exp"].(float64)
	if !ok {
		t.Fatal("exp claim missing or wrong type")
	}
	exp := time.Unix(int64(expVal), 0)
	if !exp.After(time.Now()) {
		t.Errorf("expected exp %v to be in the future", exp)
	}
}

func TestGenerateAccessToken_WrongSecretFails(t *testing.T) {
	u := testUser()
	tok, err := generateAccessToken(u, testSecret, time.Hour)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	_, err = parseJWT(tok, []byte("wrong-secret"))
	if err == nil {
		t.Fatal("expected error with wrong secret, got nil")
	}
}

// ── parseJWT ──────────────────────────────────────────────────────────────────

func TestParseJWT_EmptyString(t *testing.T) {
	_, err := parseJWT("", testSecret)
	if err == nil {
		t.Fatal("expected error for empty token")
	}
}

func TestParseJWT_GarbageToken(t *testing.T) {
	_, err := parseJWT("not.a.jwt", testSecret)
	if err == nil {
		t.Fatal("expected error for garbage token")
	}
}

func TestParseJWT_WrongSigningMethod(t *testing.T) {
	// RS256 token header (won't have valid sig but wrong method is detected first)
	malformedHeader := "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9"
	_, err := parseJWT(malformedHeader+".e30.abc", testSecret)
	if err == nil {
		t.Fatal("expected error for wrong signing method")
	}
}

// ── publicUser ────────────────────────────────────────────────────────────────

func TestPublicUser_NilReturnsNil(t *testing.T) {
	if publicUser(nil) != nil {
		t.Fatal("expected nil for nil input")
	}
}

func TestPublicUser_ExposesExpectedFields(t *testing.T) {
	u := testUser()
	pub := publicUser(u)
	for _, key := range []string{"id", "email", "provider", "role", "confirmed", "created_at", "updated_at"} {
		if _, ok := pub[key]; !ok {
			t.Errorf("missing expected field %q in publicUser output", key)
		}
	}
}

func TestPublicUser_DoesNotExposePassword(t *testing.T) {
	u := testUser()
	u.Password = "s3cr3t-hash"
	pub := publicUser(u)
	if _, ok := pub["password"]; ok {
		t.Error("publicUser must not expose password field")
	}
}

// ── SignUp validation paths (no DB required) ──────────────────────────────────

func testHandler() *AuthHandler {
	// Store is nil intentionally — only call endpoints that return
	// before reaching the Store (validation-only paths).
	return &AuthHandler{
		JWTSecret: testSecret,
		JWTExpiry: time.Hour,
	}
}

func TestSignUp_BadJSON(t *testing.T) {
	rr := httptest.NewRecorder()
	testHandler().SignUp(rr, newReq(http.MethodPost, "/signup", "{bad json"))
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusBadRequest)
	}
	resp := decodeResponse(t, rr)
	if resp["error"] != "invalid_json" {
		t.Errorf("error code: got %v want invalid_json", resp["error"])
	}
}

func TestSignUp_MissingEmail(t *testing.T) {
	rr := httptest.NewRecorder()
	testHandler().SignUp(rr, newReq(http.MethodPost, "/signup",
		`{"email":"","password":"validpass"}`))
	if rr.Code != http.StatusUnprocessableEntity {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnprocessableEntity)
	}
	resp := decodeResponse(t, rr)
	if resp["error"] != "validation_failed" {
		t.Errorf("error code: got %v want validation_failed", resp["error"])
	}
}

func TestSignUp_MissingPassword(t *testing.T) {
	rr := httptest.NewRecorder()
	testHandler().SignUp(rr, newReq(http.MethodPost, "/signup",
		`{"email":"a@b.com","password":""}`))
	if rr.Code != http.StatusUnprocessableEntity {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnprocessableEntity)
	}
}

func TestSignUp_ShortPassword(t *testing.T) {
	rr := httptest.NewRecorder()
	testHandler().SignUp(rr, newReq(http.MethodPost, "/signup",
		`{"email":"a@b.com","password":"abc"}`))
	if rr.Code != http.StatusUnprocessableEntity {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnprocessableEntity)
	}
	resp := decodeResponse(t, rr)
	if resp["error"] != "password_too_short" {
		t.Errorf("error code: got %v want password_too_short", resp["error"])
	}
}

func TestSignUp_PasswordExactly6Chars_PassesValidation(t *testing.T) {
	// 6 chars should pass the length check (bcrypt call will follow — Store is nil,
	// so this panics if it reaches Store. We only verify the 422 check is not triggered.)
	// We catch a panic here to verify we got past validation.
	defer func() { recover() }()
	rr := httptest.NewRecorder()
	testHandler().SignUp(rr, newReq(http.MethodPost, "/signup",
		`{"email":"a@b.com","password":"abcdef"}`))
	// If we reach here without a 422 the validation passed.
	if rr.Code == http.StatusUnprocessableEntity {
		t.Error("6-char password should pass length validation")
	}
}

// ── SignIn validation paths ───────────────────────────────────────────────────

func TestSignIn_BadJSON(t *testing.T) {
	rr := httptest.NewRecorder()
	testHandler().SignIn(rr, newReq(http.MethodPost, "/signin", "{bad"))
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusBadRequest)
	}
}

// ── SignOut always 204 ────────────────────────────────────────────────────────

func TestSignOut_AlwaysReturns204(t *testing.T) {
	// SignOut with no body should still return 204 and not crash.
	// Store.ConsumeRefreshToken is only called if refresh_token field is non-empty.
	rr := httptest.NewRecorder()
	testHandler().SignOut(rr, newReq(http.MethodPost, "/signout", `{}`))
	if rr.Code != http.StatusNoContent {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusNoContent)
	}
}

func TestSignOut_EmptyBody_Returns204(t *testing.T) {
	rr := httptest.NewRecorder()
	testHandler().SignOut(rr, newReq(http.MethodPost, "/signout", ""))
	if rr.Code != http.StatusNoContent {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusNoContent)
	}
}

// ── RefreshToken validation paths ─────────────────────────────────────────────

func TestRefreshToken_BadJSON(t *testing.T) {
	rr := httptest.NewRecorder()
	testHandler().RefreshToken(rr, newReq(http.MethodPost, "/token/refresh", "{bad"))
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestRefreshToken_MissingToken(t *testing.T) {
	rr := httptest.NewRecorder()
	testHandler().RefreshToken(rr, newReq(http.MethodPost, "/token/refresh",
		`{"refresh_token":""}`))
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusBadRequest)
	}
	resp := decodeResponse(t, rr)
	if resp["error"] != "missing_token" {
		t.Errorf("error code: got %v want missing_token", resp["error"])
	}
}

// ── VerifyToken (pure JWT parsing — no DB) ────────────────────────────────────

func TestVerifyToken_BadJSON(t *testing.T) {
	rr := httptest.NewRecorder()
	testHandler().VerifyToken(rr, newReq(http.MethodPost, "/internal/verify", "{bad"))
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusBadRequest)
	}
}

func TestVerifyToken_InvalidJWT(t *testing.T) {
	rr := httptest.NewRecorder()
	testHandler().VerifyToken(rr, newReq(http.MethodPost, "/internal/verify",
		`{"token":"not.a.jwt"}`))
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
	resp := decodeResponse(t, rr)
	if resp["error"] != "invalid_token" {
		t.Errorf("error code: got %v want invalid_token", resp["error"])
	}
}

func TestVerifyToken_ValidJWT_Returns200(t *testing.T) {
	u := testUser()
	tok, _ := generateAccessToken(u, testSecret, time.Hour)

	body := `{"token":"` + tok + `"}`
	rr := httptest.NewRecorder()
	testHandler().VerifyToken(rr, newReq(http.MethodPost, "/internal/verify", body))

	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d want %d\nbody: %s", rr.Code, http.StatusOK, rr.Body.String())
	}
	resp := decodeResponse(t, rr)
	if resp["sub"] != u.ID.String() {
		t.Errorf("sub: got %v want %v", resp["sub"], u.ID.String())
	}
	if resp["email"] != u.Email {
		t.Errorf("email: got %v want %v", resp["email"], u.Email)
	}
	if resp["role"] != u.Role {
		t.Errorf("role: got %v want %v", resp["role"], u.Role)
	}
}

func TestVerifyToken_WrongSecretFails(t *testing.T) {
	u := testUser()
	// Token signed with a different secret
	tok, _ := generateAccessToken(u, []byte("other-secret"), time.Hour)

	body := `{"token":"` + tok + `"}`
	rr := httptest.NewRecorder()
	testHandler().VerifyToken(rr, newReq(http.MethodPost, "/internal/verify", body))

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
}

// ── GetUser with context ──────────────────────────────────────────────────────

func TestGetUser_MissingAuthContext_ZeroUUID(t *testing.T) {
	// Without JWTMiddleware, userIDFromCtx returns zero UUID.
	// GetUser calls Store.GetUserByID which panics with nil store.
	// This is expected without an integration test environment.
	// We just verify userIDFromCtx returns zero UUID when context is empty.
	ctx := context.Background()
	id := userIDFromCtx(ctx)
	if id != (uuid.UUID{}) {
		t.Errorf("expected zero UUID from empty context, got %v", id)
	}
}

// ── Content-Type header ───────────────────────────────────────────────────────

func TestWriteJSON_SetsContentType(t *testing.T) {
	rr := httptest.NewRecorder()
	writeJSON(rr, http.StatusOK, map[string]string{"key": "value"})
	ct := rr.Header().Get("Content-Type")
	if !strings.HasPrefix(ct, "application/json") {
		t.Errorf("Content-Type: got %q want application/json", ct)
	}
}

func TestWriteError_IncludesErrorAndMessage(t *testing.T) {
	rr := httptest.NewRecorder()
	writeError(rr, http.StatusBadRequest, "test_code", "test message")
	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusBadRequest)
	}
	resp := decodeResponse(t, rr)
	if resp["error"] != "test_code" {
		t.Errorf("error field: got %v want test_code", resp["error"])
	}
	if resp["message"] != "test message" {
		t.Errorf("message field: got %v want 'test message'", resp["message"])
	}
}
