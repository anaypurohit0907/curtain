package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/curtain/curtain/services/auth/internal/model"
)

// nextHandler is a simple downstream handler that records whether it was called.
func nextHandler(called *bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*called = true
		w.WriteHeader(http.StatusOK)
	})
}

// ── JWTMiddleware ─────────────────────────────────────────────────────────────

func TestJWTMiddleware_MissingHeader(t *testing.T) {
	called := false
	mw := JWTMiddleware(testSecret)(nextHandler(&called))

	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/user", nil))

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
	if called {
		t.Error("next handler must not be called when auth header is missing")
	}
	resp := decodeResponse(t, rr)
	if resp["error"] != "missing_token" {
		t.Errorf("error code: got %v want missing_token", resp["error"])
	}
}

func TestJWTMiddleware_InvalidFormat_NoSpace(t *testing.T) {
	called := false
	mw := JWTMiddleware(testSecret)(nextHandler(&called))

	r := httptest.NewRequest(http.MethodGet, "/user", nil)
	r.Header.Set("Authorization", "tokenWithoutBearerPrefix")

	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, r)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
	if called {
		t.Error("next handler must not be called with invalid header format")
	}
}

func TestJWTMiddleware_WrongScheme(t *testing.T) {
	called := false
	mw := JWTMiddleware(testSecret)(nextHandler(&called))

	r := httptest.NewRequest(http.MethodGet, "/user", nil)
	r.Header.Set("Authorization", "Basic dXNlcjpwYXNz")

	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, r)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
	resp := decodeResponse(t, rr)
	if resp["error"] != "invalid_token_format" {
		t.Errorf("error code: got %v want invalid_token_format", resp["error"])
	}
}

func TestJWTMiddleware_InvalidToken(t *testing.T) {
	called := false
	mw := JWTMiddleware(testSecret)(nextHandler(&called))

	r := httptest.NewRequest(http.MethodGet, "/user", nil)
	r.Header.Set("Authorization", "Bearer this.is.garbage")

	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, r)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
	if called {
		t.Error("next handler must not be called with invalid token")
	}
}

func TestJWTMiddleware_ExpiredToken(t *testing.T) {
	called := false
	mw := JWTMiddleware(testSecret)(nextHandler(&called))

	u := testUser()
	// Negative duration means immediately expired
	tok, err := generateAccessToken(u, testSecret, -time.Second)
	if err != nil {
		t.Fatalf("generating token: %v", err)
	}

	r := httptest.NewRequest(http.MethodGet, "/user", nil)
	r.Header.Set("Authorization", "Bearer "+tok)

	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, r)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d (expired token should be rejected)",
			rr.Code, http.StatusUnauthorized)
	}
	if called {
		t.Error("next handler must not be called with expired token")
	}
}

func TestJWTMiddleware_ValidToken_CallsNext(t *testing.T) {
	called := false
	mw := JWTMiddleware(testSecret)(nextHandler(&called))

	u := &model.User{
		ID:    uuid.MustParse("22222222-2222-2222-2222-222222222222"),
		Email: "valid@example.com",
		Role:  "authenticated",
	}
	tok, err := generateAccessToken(u, testSecret, time.Hour)
	if err != nil {
		t.Fatalf("generating token: %v", err)
	}

	r := httptest.NewRequest(http.MethodGet, "/user", nil)
	r.Header.Set("Authorization", "Bearer "+tok)

	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, r)

	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusOK)
	}
	if !called {
		t.Error("next handler should have been called with valid token")
	}
}

func TestJWTMiddleware_InjectedUserID(t *testing.T) {
	expectedID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	var gotID uuid.UUID

	capture := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotID = userIDFromCtx(r.Context())
		w.WriteHeader(http.StatusOK)
	})
	mw := JWTMiddleware(testSecret)(capture)

	u := &model.User{
		ID:    expectedID,
		Email: "ctx@example.com",
		Role:  "authenticated",
	}
	tok, _ := generateAccessToken(u, testSecret, time.Hour)

	r := httptest.NewRequest(http.MethodGet, "/user", nil)
	r.Header.Set("Authorization", "Bearer "+tok)

	mw.ServeHTTP(httptest.NewRecorder(), r)

	if gotID != expectedID {
		t.Errorf("userID in context: got %v want %v", gotID, expectedID)
	}
}

func TestJWTMiddleware_BearerCaseInsensitive(t *testing.T) {
	// RFC 6750 does not mandate case; test lowercase "bearer"
	called := false
	mw := JWTMiddleware(testSecret)(nextHandler(&called))

	u := testUser()
	tok, _ := generateAccessToken(u, testSecret, time.Hour)

	r := httptest.NewRequest(http.MethodGet, "/user", nil)
	r.Header.Set("Authorization", "bearer "+tok)

	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, r)

	if rr.Code != http.StatusOK {
		t.Errorf("status: got %d want %d (bearer lowercase should work)", rr.Code, http.StatusOK)
	}
	if !called {
		t.Error("next handler should have been called with lowercase bearer")
	}
}

func TestJWTMiddleware_WrongSigningSecret(t *testing.T) {
	called := false
	mw := JWTMiddleware(testSecret)(nextHandler(&called))

	u := testUser()
	tok, _ := generateAccessToken(u, []byte("different-secret"), time.Hour)

	r := httptest.NewRequest(http.MethodGet, "/user", nil)
	r.Header.Set("Authorization", "Bearer "+tok)

	rr := httptest.NewRecorder()
	mw.ServeHTTP(rr, r)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("status: got %d want %d", rr.Code, http.StatusUnauthorized)
	}
	if called {
		t.Error("next handler must not be called when token signature is wrong")
	}
}

// ── parseAndValidateJWT ───────────────────────────────────────────────────────

func TestParseAndValidateJWT_ValidToken(t *testing.T) {
	u := testUser()
	tok, _ := generateAccessToken(u, testSecret, time.Hour)

	claims, err := parseAndValidateJWT(tok, testSecret)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if claims["sub"] != u.ID.String() {
		t.Errorf("sub: got %v want %v", claims["sub"], u.ID.String())
	}
}

func TestParseAndValidateJWT_EmptyToken(t *testing.T) {
	_, err := parseAndValidateJWT("", testSecret)
	if err == nil {
		t.Fatal("expected error for empty token")
	}
}

func TestParseAndValidateJWT_TamperedToken(t *testing.T) {
	u := testUser()
	tok, _ := generateAccessToken(u, testSecret, time.Hour)

	// Flip the last char of the signature
	tampered := tok[:len(tok)-1] + "X"
	_, err := parseAndValidateJWT(tampered, testSecret)
	if err == nil {
		t.Fatal("expected error for tampered token")
	}
}
