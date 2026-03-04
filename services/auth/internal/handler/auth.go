package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"github.com/curtain/curtain/services/auth/internal/model"
	"github.com/curtain/curtain/services/auth/internal/store"
)

// AuthHandler handles all email/password authentication endpoints.
type AuthHandler struct {
	Store     *store.Store
	JWTSecret []byte
	JWTExpiry time.Duration
}

// ── POST /signup ──────────────────────────────────────────────────────────────

func (h *AuthHandler) SignUp(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	if req.Email == "" || req.Password == "" {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed",
			"email and password are required")
		return
	}
	if len(req.Password) < 6 {
		writeError(w, http.StatusUnprocessableEntity, "password_too_short",
			"password must be at least 6 characters")
		return
	}

	// bcrypt cost 12: ~150ms on 1vCPU VPS — acceptable for signup
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "hash_failed", "")
		return
	}

	u := &model.User{
		ID:       uuid.New(),
		Email:    req.Email,
		Password: string(hash),
		Provider: "email",
		Role:     "authenticated",
	}

	if err := h.Store.CreateUser(r.Context(), u); err != nil {
		if errors.Is(err, store.ErrDuplicate) {
			writeError(w, http.StatusConflict, "email_exists",
				"a user with this email already exists")
			return
		}
		writeError(w, http.StatusInternalServerError, "db_error", "")
		return
	}

	h.issueTokenResponse(w, r, u, http.StatusCreated)
}

// ── POST /signin ──────────────────────────────────────────────────────────────

func (h *AuthHandler) SignIn(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	u, err := h.Store.GetUserByEmail(r.Context(), req.Email)
	if err != nil {
		// Uniform error: don't reveal whether email exists
		writeError(w, http.StatusUnauthorized, "invalid_credentials",
			"invalid email or password")
		return
	}

	if u.Provider != "email" || u.Password == "" {
		writeError(w, http.StatusUnauthorized, "oauth_account",
			"this account uses OAuth — sign in with your provider")
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(u.Password), []byte(req.Password)); err != nil {
		writeError(w, http.StatusUnauthorized, "invalid_credentials",
			"invalid email or password")
		return
	}

	h.issueTokenResponse(w, r, u, http.StatusOK)
}

// ── POST /signout ─────────────────────────────────────────────────────────────

func (h *AuthHandler) SignOut(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	// Best-effort decode; signout should not fail the client
	_ = json.NewDecoder(r.Body).Decode(&req)

	if req.RefreshToken != "" {
		_, _ = h.Store.ConsumeRefreshToken(r.Context(), req.RefreshToken)
	}

	w.WriteHeader(http.StatusNoContent)
}

// ── POST /token/refresh ───────────────────────────────────────────────────────

func (h *AuthHandler) RefreshToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.RefreshToken == "" {
		writeError(w, http.StatusBadRequest, "missing_token", "refresh_token is required")
		return
	}

	userID, err := h.Store.ConsumeRefreshToken(r.Context(), req.RefreshToken)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid_refresh_token",
			"refresh token is invalid or expired")
		return
	}

	u, err := h.Store.GetUserByID(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", "")
		return
	}

	h.issueTokenResponse(w, r, u, http.StatusOK)
}

// ── GET /user ─────────────────────────────────────────────────────────────────

func (h *AuthHandler) GetUser(w http.ResponseWriter, r *http.Request) {
	userID := userIDFromCtx(r.Context())
	u, err := h.Store.GetUserByID(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusNotFound, "user_not_found", "")
		return
	}
	writeJSON(w, http.StatusOK, publicUser(u))
}

// ── PUT /user ─────────────────────────────────────────────────────────────────

func (h *AuthHandler) UpdateUser(w http.ResponseWriter, r *http.Request) {
	userID := userIDFromCtx(r.Context())
	var req struct {
		Metadata json.RawMessage `json:"metadata"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Metadata != nil {
		if err := h.Store.UpdateUserMetadata(r.Context(), userID, req.Metadata); err != nil {
			writeError(w, http.StatusInternalServerError, "db_error", "")
			return
		}
	}
	u, _ := h.Store.GetUserByID(r.Context(), userID)
	writeJSON(w, http.StatusOK, publicUser(u))
}

// ── GET /admin/users ──────────────────────────────────────────────────────────

func (h *AuthHandler) ListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.Store.ListUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", "")
		return
	}
	result := make([]map[string]any, 0, len(users))
	for _, u := range users {
		result = append(result, publicUser(u))
	}
	writeJSON(w, http.StatusOK, result)
}

// ── POST /query ───────────────────────────────────────────────────────────────

func (h *AuthHandler) RunQuery(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Query string `json:"query"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Query) == "" {
		writeError(w, http.StatusBadRequest, "empty_query", "query must not be empty")
		return
	}

	result, err := h.Store.ExecuteSQL(r.Context(), req.Query)
	if err != nil {
		writeError(w, http.StatusBadRequest, "query_error", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// ── POST /internal/verify (called by realtime + edge services) ────────────────

func (h *AuthHandler) VerifyToken(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}

	claims, err := parseJWT(req.Token, h.JWTSecret)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid_token", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"sub":   claims["sub"],
		"role":  claims["role"],
		"email": claims["email"],
	})
}

// ── helper: generate token pair and write HTTP response ───────────────────────

func (h *AuthHandler) issueTokenResponse(w http.ResponseWriter, r *http.Request,
	u *model.User, statusCode int) {
	accessToken, err := generateAccessToken(u, h.JWTSecret, h.JWTExpiry)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "token_error", "")
		return
	}

	// Refresh token is an opaque UUID pair (no JWT — simpler rotation)
	refreshToken := uuid.New().String() + "-" + uuid.New().String()
	expiresAt := time.Now().Add(7 * 24 * time.Hour)

	_ = h.Store.SaveRefreshToken(r.Context(), u.ID, refreshToken, expiresAt)

	writeJSON(w, statusCode, map[string]any{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"token_type":    "bearer",
		"expires_in":    int(h.JWTExpiry.Seconds()),
		"user":          publicUser(u),
	})
}

// generateAccessToken creates a signed JWT containing PostgREST-compatible claims.
func generateAccessToken(u *model.User, secret []byte, expiry time.Duration) (string, error) {
	now := time.Now()
	claims := jwt.MapClaims{
		"sub":   u.ID.String(),
		"role":  u.Role,   // PostgREST uses this to set the Postgres role
		"email": u.Email,
		"iss":   "curtain",
		"iat":   now.Unix(),
		"exp":   now.Add(expiry).Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
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

// publicUser strips sensitive fields from a User for API responses.
func publicUser(u *model.User) map[string]any {
	if u == nil {
		return nil
	}
	return map[string]any{
		"id":         u.ID,
		"email":      u.Email,
		"provider":   u.Provider,
		"role":       u.Role,
		"metadata":   json.RawMessage(u.Metadata),
		"confirmed":  u.Confirmed,
		"created_at": u.CreatedAt,
		"updated_at": u.UpdatedAt,
	}
}
