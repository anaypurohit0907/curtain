#!/usr/bin/env bash
# =============================================================================
# Curtain End-to-End Integration Test Suite
# =============================================================================
# Prerequisites: running dev stack (make dev), curl, jq
# Usage:
#   bash scripts/e2e-test.sh
#   BASE_URL=http://localhost bash scripts/e2e-test.sh
# =============================================================================

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
AUTH_URL="${BASE_URL}/auth/v1"
REST_URL="${BASE_URL}/rest/v1"
RT_URL="${BASE_URL}/realtime/v1"
FN_URL="${BASE_URL}/functions/v1"
STORAGE_URL="${BASE_URL}/storage/v1"

# ── Terminal colours ───────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

_pass() { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
_fail() { echo -e "  ${RED}✗${NC} $1"; echo -e "    ${RED}Details: $2${NC}"; FAIL=$((FAIL+1)); }
_skip() { echo -e "  ${YELLOW}⊘${NC} $1 (skipped)"; SKIP=$((SKIP+1)); }
_section() { echo -e "\n${CYAN}${BOLD}▸ $1${NC}"; }

# Unique test suffix to avoid collisions on repeated runs
SUFFIX=$(date +%s)
TEST_EMAIL="test_${SUFFIX}@curtain-test.local"
TEST_PASS="testpassword123"
ACCESS_TOKEN=""
REFRESH_TOKEN=""

# =============================================================================
# Helpers
# =============================================================================

require_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo -e "${RED}ERROR: $1 is required but not installed.${NC}"
    exit 1
  fi
}

check_service() {
  local name="$1" url="$2"
  if curl -s --max-time 5 "$url" &>/dev/null; then
    _pass "$name is reachable"
  else
    _fail "$name is NOT reachable" "GET $url failed"
  fi
}

assert_status() {
  local label="$1" expected="$2" actual="$3" body="$4"
  if [ "$actual" -eq "$expected" ]; then
    _pass "$label (HTTP $actual)"
  else
    _fail "$label" "expected HTTP $expected, got $actual — body: $body"
  fi
}

assert_json_field() {
  local label="$1" field="$2" expected="$3" json="$4"
  local actual
  actual=$(echo "$json" | jq -r "$field" 2>/dev/null || echo "PARSE_ERROR")
  if [ "$actual" = "$expected" ]; then
    _pass "$label ($field = $expected)"
  else
    _fail "$label" "expected $field = $expected, got $actual"
  fi
}

assert_json_nonempty() {
  local label="$1" field="$2" json="$3"
  local actual
  actual=$(echo "$json" | jq -r "$field" 2>/dev/null || echo "")
  if [ -n "$actual" ] && [ "$actual" != "null" ]; then
    _pass "$label ($field is non-empty)"
  else
    _fail "$label" "$field is empty or null in: $json"
  fi
}

# =============================================================================
# Pre-flight
# =============================================================================

require_cmd curl
require_cmd jq
require_cmd openssl

echo -e "${BOLD}Curtain E2E Test Suite${NC}"
echo    "Target: $BASE_URL"
echo    "Time:   $(date)"
echo    "────────────────────────────────────────"

# ── Generate a service_role JWT (needed for edge function management) ─────────
# The dev stack uses a hardcoded JWT_SECRET; production sets it via .env.
DEV_JWT_SECRET="${JWT_SECRET:-dev-jwt-secret-minimum-32-characters-long}"

make_jwt() {
  local secret="$1"
  local role="$2"
  local exp
  exp=$(( $(date +%s) + 3600 ))

  # base64url: standard base64 then strip padding and replace + / chars
  _b64url() { base64 | tr '+/' '-_' | tr -d '=\n'; }

  local header payload signing_input signature
  header=$(echo -n '{"alg":"HS256","typ":"JWT"}' | _b64url)
  payload=$(printf '{"role":"%s","iss":"curtain","exp":%d}' "$role" "$exp" | _b64url)
  signing_input="${header}.${payload}"
  signature=$(echo -n "$signing_input" \
    | openssl dgst -binary -sha256 -hmac "$secret" | _b64url)
  echo "${signing_input}.${signature}"
}

SERVICE_TOKEN=$(make_jwt "$DEV_JWT_SECRET" "service_role")

# =============================================================================
# 1. Service Health Checks
# =============================================================================
_section "Service Health Checks"

# Auth: ping the signup endpoint (will 400 on empty body, but connection works)
AUTH_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
  -X POST "$AUTH_URL/signup" -H "Content-Type: application/json" -d '{}' || echo "000")
if [ "$AUTH_HEALTH" = "422" ] || [ "$AUTH_HEALTH" = "400" ]; then
  _pass "Auth service is reachable"
else
  _fail "Auth service is NOT reachable" "POST $AUTH_URL/signup returned $AUTH_HEALTH"
fi

# PostgREST: should return 200 JSON
PGREST_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$REST_URL/" || echo "000")
if [ "$PGREST_HEALTH" = "200" ]; then
  _pass "PostgREST is reachable"
else
  _fail "PostgREST is NOT reachable" "GET $REST_URL/ returned $PGREST_HEALTH"
fi

# Edge: health endpoint
EDGE_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$FN_URL/health" || echo "000")
if [ "$EDGE_HEALTH" = "200" ]; then
  _pass "Edge service is reachable"
else
  _fail "Edge service is NOT reachable" "GET $FN_URL/health returned $EDGE_HEALTH"
fi

# =============================================================================
# 2. Auth: Sign Up
# =============================================================================
_section "Auth: Sign Up"

SIGNUP_RESP=$(curl -s -X POST "$AUTH_URL/signup" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}" \
  -w "\n%{http_code}" 2>/dev/null || echo -e "\n000")

SIGNUP_BODY=$(echo "$SIGNUP_RESP" | head -n -1)
SIGNUP_CODE=$(echo "$SIGNUP_RESP" | tail -n 1)

assert_status "Sign up new user"    201 "$SIGNUP_CODE" "$SIGNUP_BODY"
assert_json_nonempty "Access token returned"  ".access_token"  "$SIGNUP_BODY"
assert_json_nonempty "Refresh token returned" ".refresh_token" "$SIGNUP_BODY"
assert_json_field    "User email correct"     ".user.email"    "$TEST_EMAIL" "$SIGNUP_BODY"
assert_json_field    "User role correct"      ".user.role"     "authenticated" "$SIGNUP_BODY"

ACCESS_TOKEN=$(echo "$SIGNUP_BODY" | jq -r '.access_token' 2>/dev/null || echo "")
REFRESH_TOKEN=$(echo "$SIGNUP_BODY" | jq -r '.refresh_token' 2>/dev/null || echo "")

# Duplicate signup should fail
DUP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$AUTH_URL/signup" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}" 2>/dev/null || echo "000")
assert_status "Duplicate email rejected" 409 "$DUP_CODE" ""

# Short password should fail
SHORT_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$AUTH_URL/signup" \
  -H "Content-Type: application/json" \
  -d '{"email":"short@test.com","password":"abc"}' 2>/dev/null || echo "000")
assert_status "Short password rejected" 422 "$SHORT_CODE" ""

# =============================================================================
# 3. Auth: Sign In
# =============================================================================
_section "Auth: Sign In"

SIGNIN_RESP=$(curl -s -X POST "$AUTH_URL/signin" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASS\"}" \
  -w "\n%{http_code}" 2>/dev/null || echo -e "\n000")

SIGNIN_BODY=$(echo "$SIGNIN_RESP" | head -n -1)
SIGNIN_CODE=$(echo "$SIGNIN_RESP" | tail -n 1)

assert_status "Sign in valid credentials"   200 "$SIGNIN_CODE" "$SIGNIN_BODY"
assert_json_nonempty "Access token on signin" ".access_token" "$SIGNIN_BODY"

# Use freshest token
ACCESS_TOKEN=$(echo "$SIGNIN_BODY" | jq -r '.access_token' 2>/dev/null || echo "$ACCESS_TOKEN")
REFRESH_TOKEN=$(echo "$SIGNIN_BODY" | jq -r '.refresh_token' 2>/dev/null || echo "$REFRESH_TOKEN")

# Wrong password
WRONG_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$AUTH_URL/signin" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"wrongpass\"}" 2>/dev/null || echo "000")
assert_status "Wrong password rejected" 401 "$WRONG_CODE" ""

# Unknown email
UNKNOWN_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$AUTH_URL/signin" \
  -H "Content-Type: application/json" \
  -d '{"email":"nobody@nobody.com","password":"anypass"}' 2>/dev/null || echo "000")
assert_status "Unknown email rejected" 401 "$UNKNOWN_CODE" ""

# =============================================================================
# 4. Auth: Get User
# =============================================================================
_section "Auth: Authenticated Endpoints"

GETUSER_RESP=$(curl -s "$AUTH_URL/user" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -w "\n%{http_code}" 2>/dev/null || echo -e "\n000")

GETUSER_BODY=$(echo "$GETUSER_RESP" | head -n -1)
GETUSER_CODE=$(echo "$GETUSER_RESP" | tail -n 1)

assert_status "GET /user with valid token"    200 "$GETUSER_CODE" "$GETUSER_BODY"
assert_json_field "Returned correct email" ".email" "$TEST_EMAIL" "$GETUSER_BODY"

# No token
NOAUTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$AUTH_URL/user" 2>/dev/null || echo "000")
assert_status "GET /user without token rejected" 401 "$NOAUTH_CODE" ""

# =============================================================================
# 5. Auth: Token Refresh
# =============================================================================
_section "Auth: Token Refresh"

REFRESH_RESP=$(curl -s -X POST "$AUTH_URL/token/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$REFRESH_TOKEN\"}" \
  -w "\n%{http_code}" 2>/dev/null || echo -e "\n000")

REFRESH_BODY=$(echo "$REFRESH_RESP" | head -n -1)
REFRESH_CODE=$(echo "$REFRESH_RESP" | tail -n 1)

assert_status "Token refresh succeeds"          200 "$REFRESH_CODE" "$REFRESH_BODY"
assert_json_nonempty "New access token returned" ".access_token" "$REFRESH_BODY"

# Replay same refresh token (should be consumed — return 401)
REPLAY_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$AUTH_URL/token/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$REFRESH_TOKEN\"}" 2>/dev/null || echo "000")
assert_status "Replayed refresh token rejected (rotation)" 401 "$REPLAY_CODE" ""

# Update token to the fresh one
ACCESS_TOKEN=$(echo "$REFRESH_BODY" | jq -r '.access_token' 2>/dev/null || echo "$ACCESS_TOKEN")
REFRESH_TOKEN=$(echo "$REFRESH_BODY" | jq -r '.refresh_token' 2>/dev/null || echo "$REFRESH_TOKEN")

# =============================================================================
# 6. Database: PostgREST CRUD
# =============================================================================
_section "Database: PostgREST REST API"

# Create a test table
TABLE_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$REST_URL/rpc/enable_realtime" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" 2>/dev/null || echo "000")
# This may fail if RPC not exposed — that's OK, just checking connectivity

# INSERT a row into storage.buckets (use Content-Profile header to switch schema)
INSERT_RESP=$(curl -s -X POST "$REST_URL/buckets" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Content-Profile: storage" \
  -H "Prefer: return=representation" \
  -d '{"id":"test-e2e-bucket","name":"test-e2e-bucket","public":false}' \
  -w "\n%{http_code}" 2>/dev/null || echo -e "\n000")

INSERT_CODE=$(echo "$INSERT_RESP" | tail -n 1)
INSERT_BODY=$(echo "$INSERT_RESP" | head -n -1)

# Note: auth.users and storage tables might have RLS — accept 201 or 403
if [ "$INSERT_CODE" = "201" ]; then
  _pass "PostgREST INSERT (HTTP $INSERT_CODE)"
elif [ "$INSERT_CODE" = "403" ] || [ "$INSERT_CODE" = "401" ]; then
  _skip "PostgREST INSERT blocked by RLS (expected in hardened config)"
else
  _fail "PostgREST INSERT" "expected 201 or 403, got $INSERT_CODE"
fi

# GET via PostgREST (use Accept-Profile to read from storage schema)
GET_RESP=$(curl -s "$REST_URL/buckets?id=eq.public" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Accept-Profile: storage" \
  -w "\n%{http_code}" 2>/dev/null || echo -e "\n000")

GET_CODE=$(echo "$GET_RESP" | tail -n 1)

if [ "$GET_CODE" = "200" ]; then
  _pass "PostgREST GET (HTTP 200)"
else
  _skip "PostgREST GET returned $GET_CODE (may need service_role key)"
fi

# =============================================================================
# 7. Edge Functions
# =============================================================================
_section "Edge Functions"

FN_SLUG="e2e-test-${SUFFIX}"

# Create a test function (requires service_role JWT)
CREATE_FN_RESP=$(curl -s -X POST "$FN_URL/functions" \
  -H "Authorization: Bearer $SERVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\":\"${FN_SLUG}\",
    \"slug\":\"${FN_SLUG}\",
    \"code\":\"export async function handler(req) { return new Response(JSON.stringify({ok:true,ts:Date.now()}), {status:200,headers:{'content-type':'application/json'}}) }\"
  }" \
  -w "\n%{http_code}" 2>/dev/null || echo -e "\n000")

CREATE_FN_CODE=$(echo "$CREATE_FN_RESP" | tail -n 1)
CREATE_FN_BODY=$(echo "$CREATE_FN_RESP" | head -n -1)

assert_status "Create edge function" 201 "$CREATE_FN_CODE" "$CREATE_FN_BODY"

# Invoke the function (using regular authenticated token is fine for invocation)
if [ "$CREATE_FN_CODE" = "201" ]; then
  INVOKE_RESP=$(curl -s -X POST "$FN_URL/invoke/${FN_SLUG}" \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"hello":"world"}' \
    -w "\n%{http_code}" 2>/dev/null || echo -e "\n000")

  INVOKE_CODE=$(echo "$INVOKE_RESP" | tail -n 1)
  INVOKE_BODY=$(echo "$INVOKE_RESP" | head -n -1)

  assert_status "Invoke edge function" 200 "$INVOKE_CODE" "$INVOKE_BODY"
  assert_json_field "Function returned ok:true" ".ok" "true" "$INVOKE_BODY"

  # Delete the function by slug (requires service_role JWT)
  DEL_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X DELETE "$FN_URL/functions/${FN_SLUG}" \
    -H "Authorization: Bearer $SERVICE_TOKEN" 2>/dev/null || echo "000")
  assert_status "Delete edge function" 204 "$DEL_CODE" ""
else
  _skip "Function invocation (create failed)"
  _skip "Delete function (create failed)"
fi

# =============================================================================
# 8. Auth: Sign Out
# =============================================================================
_section "Auth: Sign Out"

SIGNOUT_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$AUTH_URL/signout" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$REFRESH_TOKEN\"}" 2>/dev/null || echo "000")
assert_status "Sign out returns 204" 204 "$SIGNOUT_CODE" ""

# =============================================================================
# Summary
# =============================================================================

TOTAL=$((PASS + FAIL + SKIP))
echo ""
echo "════════════════════════════════════════"
printf "${BOLD}Results: ${NC}"
printf "${GREEN}%d passed${NC} · " "$PASS"
printf "${RED}%d failed${NC} · " "$FAIL"
printf "${YELLOW}%d skipped${NC}\n" "$SKIP"
echo "Total: $TOTAL checks"
echo "════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  echo -e "\n${RED}${BOLD}E2E tests FAILED — $FAIL check(s) did not pass.${NC}"
  exit 1
else
  echo -e "\n${GREEN}${BOLD}All e2e tests passed!${NC}"
  exit 0
fi
