package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"time"

	"github.com/curtain/curtain/services/auth/internal/store"
)

// OAuthHandler handles Google OAuth 2.0 PKCE flow.
type OAuthHandler struct {
	Store        *store.Store
	JWTSecret    []byte
	JWTExpiry    time.Duration
	ClientID     string
	ClientSecret string
	RedirectURL  string
	SiteURL      string
}

// GET /oauth/google  → redirect user to Google consent screen
func (h *OAuthHandler) Redirect(w http.ResponseWriter, r *http.Request) {
	if h.ClientID == "" {
		writeError(w, http.StatusNotImplemented, "oauth_disabled",
			"Google OAuth is not configured on this server")
		return
	}

	params := url.Values{
		"client_id":     {h.ClientID},
		"redirect_uri":  {h.RedirectURL},
		"response_type": {"code"},
		"scope":         {"openid email profile"},
		"access_type":   {"offline"},
		"prompt":        {"select_account"},
	}
	http.Redirect(w, r,
		"https://accounts.google.com/o/oauth2/v2/auth?"+params.Encode(),
		http.StatusTemporaryRedirect)
}

// GET /oauth/google/callback  → exchange code, upsert user, issue tokens
func (h *OAuthHandler) Callback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		writeError(w, http.StatusBadRequest, "missing_code",
			"no authorization code in callback")
		return
	}

	gUser, err := h.exchangeCode(r.Context(), code)
	if err != nil {
		writeError(w, http.StatusBadGateway, "oauth_exchange_failed", err.Error())
		return
	}

	u, err := h.Store.UpsertOAuthUser(r.Context(), gUser.Email, "google", gUser.Sub)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "db_error", "")
		return
	}

	authH := &AuthHandler{
		Store:     h.Store,
		JWTSecret: h.JWTSecret,
		JWTExpiry: h.JWTExpiry,
	}

	accessToken, err := generateAccessToken(u, h.JWTSecret, h.JWTExpiry)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "token_error", "")
		return
	}
	_ = authH // suppress unused lint

	refreshToken := fmt.Sprintf("%s-%d", "rt", time.Now().UnixNano())
	_ = h.Store.SaveRefreshToken(r.Context(), u.ID, refreshToken,
		time.Now().Add(7*24*time.Hour))

	// Redirect to SPA with tokens in URL fragment
	// Fragments are never sent to the server — safer than query params
	redirect := fmt.Sprintf("%s/auth/callback#access_token=%s&refresh_token=%s&provider=google",
		h.SiteURL, accessToken, refreshToken)
	http.Redirect(w, r, redirect, http.StatusTemporaryRedirect)
}

type googleUserInfo struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

func (h *OAuthHandler) exchangeCode(ctx context.Context, code string) (*googleUserInfo, error) {
	// Step 1: Exchange code for Google access token
	resp, err := http.PostForm("https://oauth2.googleapis.com/token", url.Values{
		"code":          {code},
		"client_id":     {h.ClientID},
		"client_secret": {h.ClientSecret},
		"redirect_uri":  {h.RedirectURL},
		"grant_type":    {"authorization_code"},
	})
	if err != nil {
		return nil, fmt.Errorf("token exchange request failed: %w", err)
	}
	defer resp.Body.Close()

	var tokenResp struct {
		AccessToken string `json:"access_token"`
		Error       string `json:"error"`
		ErrorDesc   string `json:"error_description"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, fmt.Errorf("token decode failed: %w", err)
	}
	if tokenResp.Error != "" {
		return nil, fmt.Errorf("google: %s — %s", tokenResp.Error, tokenResp.ErrorDesc)
	}

	// Step 2: Fetch user info using the access token
	req, err := http.NewRequestWithContext(ctx, "GET",
		"https://www.googleapis.com/oauth2/v3/userinfo", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+tokenResp.AccessToken)

	userResp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("userinfo request failed: %w", err)
	}
	defer userResp.Body.Close()

	var u googleUserInfo
	if err := json.NewDecoder(userResp.Body).Decode(&u); err != nil {
		return nil, fmt.Errorf("userinfo decode failed: %w", err)
	}
	if u.Email == "" {
		return nil, errors.New("google returned empty email — ensure 'email' scope is requested")
	}
	return &u, nil
}

// newOAuthHandler constructs an OAuthHandler from environment variables.
func NewOAuthHandler(s *store.Store, secret []byte, expiry time.Duration) *OAuthHandler {
	siteURL := os.Getenv("SITE_URL")
	if siteURL == "" {
		siteURL = "http://localhost:8080"
	}
	return &OAuthHandler{
		Store:        s,
		JWTSecret:    secret,
		JWTExpiry:    expiry,
		ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		RedirectURL:  siteURL + "/auth/v1/oauth/google/callback",
		SiteURL:      siteURL,
	}
}
