# =============================================================================
# Curtain Makefile
# =============================================================================
# Usage:
#   make dev        – Start all services in dev mode (with hot DB access)
#   make up         – Start production stack
#   make down       – Stop all services
#   make test       – Run all tests (Go + TypeScript)
#   make build      – Build all Docker images
#   make logs       – Tail all service logs
#   make reset-db   – Drop & recreate the DB schema (DESTRUCTIVE)
# =============================================================================

SHELL :=/bin/bash
.DEFAULT_GOAL := help

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT        := $(realpath .)
INFRA       := $(ROOT)/infra
AUTH_DIR    := $(ROOT)/services/auth
REALTIME_DIR:= $(ROOT)/services/realtime
EDGE_DIR    := $(ROOT)/services/edge
SDK_DIR     := $(ROOT)/sdk
DASH_DIR    := $(ROOT)/dashboard

# ── Compose files ─────────────────────────────────────────────────────────────
DEV_COMPOSE  := docker-compose.dev-full.yml
PROD_COMPOSE := docker-compose.yml

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN  := \033[0;32m
YELLOW := \033[0;33m
CYAN   := \033[0;36m
RESET  := \033[0m

# =============================================================================
# Infrastructure
# =============================================================================

.PHONY: up
up: ## Start the full production stack
	@echo -e "$(GREEN)Starting Curtain production stack...$(RESET)"
	@cd $(INFRA) && docker compose -f $(PROD_COMPOSE) up -d
	@echo -e "$(GREEN)Stack is up. Dashboard: https://$$(grep DOMAIN $(INFRA)/.env | cut -d= -f2)$(RESET)"

.PHONY: dev
dev: ## Start full dev stack (all services, dashboard at http://localhost:8080)
	@echo -e "$(YELLOW)Starting Curtain dev stack...$(RESET)"
	@cd $(INFRA) && docker compose -f $(DEV_COMPOSE) up --build -d
	@echo -e "$(GREEN)Dev stack up:$(RESET)"
	@echo -e "  Dashboard:  http://localhost:8080"
	@echo -e "  Auth:       http://localhost:8080/auth/v1"
	@echo -e "  REST API:   http://localhost:8080/rest/v1"
	@echo -e "  Realtime:   ws://localhost:8080/realtime/v1"
	@echo -e "  Edge:       http://localhost:8080/functions/v1"
	@echo -e "  MinIO:      http://localhost:9001 (admin console)"

.PHONY: down
down: ## Stop all services (dev and production)
	@cd $(INFRA) && docker compose -f $(DEV_COMPOSE) down 2>/dev/null || true
	@cd $(INFRA) && docker compose -f $(PROD_COMPOSE) down 2>/dev/null || true

.PHONY: logs
logs: ## Tail logs from all dev services
	@cd $(INFRA) && docker compose -f $(DEV_COMPOSE) logs -f --tail=50

.PHONY: ps
ps: ## Show dev service status
	@cd $(INFRA) && docker compose -f $(DEV_COMPOSE) ps

.PHONY: reset-db
reset-db: ## ⚠ Drop and recreate DB schema (DESTRUCTIVE — dev only)
	@read -p "This will DELETE all data. Are you sure? [y/N] " confirm && \
		[ "$$confirm" = "y" ] || exit 1
	@cd $(INFRA) && docker compose -f $(DEV_COMPOSE) exec -T postgres psql -U curtain curtain -c \
		"DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS storage CASCADE; DROP SCHEMA IF EXISTS edge CASCADE;"
	@cd $(INFRA) && docker compose -f $(DEV_COMPOSE) exec -T postgres psql -U curtain curtain \
		-f /docker-entrypoint-initdb.d/init.sql
	@echo -e "$(GREEN)DB reset complete.$(RESET)"

# =============================================================================
# Building
# =============================================================================

.PHONY: build
build: build-auth build-realtime build-edge build-dashboard ## Build all Docker images

.PHONY: build-auth
build-auth: ## Build auth service Docker image
	@echo -e "$(CYAN)Building auth service...$(RESET)"
	@docker build -t curtain/auth:latest $(AUTH_DIR)

.PHONY: build-realtime
build-realtime: ## Build realtime service Docker image
	@echo -e "$(CYAN)Building realtime service...$(RESET)"
	@docker build -t curtain/realtime:latest $(REALTIME_DIR)

.PHONY: build-edge
build-edge: ## Build edge functions service Docker image
	@echo -e "$(CYAN)Building edge service...$(RESET)"
	@docker build -t curtain/edge:latest $(EDGE_DIR)

.PHONY: build-dashboard
build-dashboard: ## Build dashboard Docker image
	@echo -e "$(CYAN)Building dashboard...$(RESET)"
	@docker build -t curtain/dashboard:latest $(DASH_DIR)

.PHONY: build-go
build-go: ## Verify all Go services compile cleanly
	@echo -e "$(CYAN)Compiling auth service...$(RESET)"
	@cd $(AUTH_DIR) && go build ./...
	@echo -e "$(CYAN)Compiling realtime service...$(RESET)"
	@cd $(REALTIME_DIR) && go build ./...
	@echo -e "$(CYAN)Compiling edge service...$(RESET)"
	@cd $(EDGE_DIR) && go build ./...
	@echo -e "$(GREEN)All Go services compile cleanly.$(RESET)"

# =============================================================================
# Testing
# =============================================================================

.PHONY: test
test: test-auth test-realtime test-edge test-sdk ## Run ALL tests (Go + TypeScript)

.PHONY: test-auth
test-auth: ## Run auth service tests
	@echo -e "$(CYAN)Testing auth service...$(RESET)"
	@cd $(AUTH_DIR) && go test -v -race -count=1 -timeout=60s ./...

.PHONY: test-realtime
test-realtime: ## Run realtime service tests
	@echo -e "$(CYAN)Testing realtime service...$(RESET)"
	@cd $(REALTIME_DIR) && go test -v -race -count=1 -timeout=60s ./...

.PHONY: test-edge
test-edge: ## Run edge service tests
	@echo -e "$(CYAN)Testing edge service...$(RESET)"
	@cd $(EDGE_DIR) && go test -v -race -count=1 -timeout=60s ./...

.PHONY: test-sdk
test-sdk: ## Run TypeScript SDK tests
	@echo -e "$(CYAN)Testing TypeScript SDK...$(RESET)"
	@cd $(SDK_DIR) && npm ci --silent && npm test

.PHONY: test-dashboard
test-dashboard: ## Run dashboard component tests
	@echo -e "$(CYAN)Testing dashboard...$(RESET)"
	@cd $(DASH_DIR) && npm ci --silent && npm test

.PHONY: test-e2e
test-e2e: ## Run end-to-end integration tests (requires running dev stack)
	@echo -e "$(CYAN)Running e2e tests...$(RESET)"
	@bash $(ROOT)/scripts/e2e-test.sh

.PHONY: test-race
test-race: ## Run all Go tests with race detector
	@cd $(AUTH_DIR)     && go test -race -count=1 ./...
	@cd $(REALTIME_DIR) && go test -race -count=1 ./...
	@cd $(EDGE_DIR)     && go test -race -count=1 ./...

# =============================================================================
# Go helpers
# =============================================================================

.PHONY: tidy
tidy: ## Run go mod tidy on all modules
	@cd $(AUTH_DIR)     && go mod tidy
	@cd $(REALTIME_DIR) && go mod tidy
	@cd $(EDGE_DIR)     && go mod tidy

.PHONY: vet
vet: ## Run go vet on all modules
	@cd $(AUTH_DIR)     && go vet ./...
	@cd $(REALTIME_DIR) && go vet ./...
	@cd $(EDGE_DIR)     && go vet ./...

# =============================================================================
# SDK helpers
# =============================================================================

.PHONY: sdk-install
sdk-install: ## Install SDK dependencies
	@cd $(SDK_DIR) && npm ci

.PHONY: sdk-build
sdk-build: ## Build SDK for distribution
	@cd $(SDK_DIR) && npm run build

.PHONY: sdk-publish
sdk-publish: sdk-build ## Publish SDK to npm (requires npm login)
	@cd $(SDK_DIR) && npm publish --access public

# =============================================================================
# Database helpers
# =============================================================================

.PHONY: psql
psql: ## Open a psql shell in the running postgres container
	@cd $(INFRA) && docker compose -f $(DEV_COMPOSE) exec postgres psql -U curtain curtain

.PHONY: pg-dump
pg-dump: ## Dump the database to ./backups/$(date).sql
	@mkdir -p $(ROOT)/backups
	@cd $(INFRA) && docker compose -f $(DEV_COMPOSE) exec -T postgres pg_dump -U curtain curtain \
		> $(ROOT)/backups/backup_$$(date +%Y%m%d_%H%M%S).sql
	@echo -e "$(GREEN)Backup written to backups/$(RESET)"

# =============================================================================
# Setup helpers
# =============================================================================

.PHONY: setup
setup: ## First-time setup: copy .env, check deps
	@echo -e "$(CYAN)Checking dependencies...$(RESET)"
	@command -v docker     >/dev/null || (echo "ERROR: docker not found" && exit 1)
	@command -v go         >/dev/null || (echo "ERROR: go not found (need 1.21+)" && exit 1)
	@command -v node       >/dev/null || (echo "ERROR: node not found (need 20+)" && exit 1)
	@echo -e "$(GREEN)All dependencies present.$(RESET)"
	@test -f $(INFRA)/.env || (cp $(INFRA)/.env.example $(INFRA)/.env && \
		echo -e "$(YELLOW)Created infra/.env — edit it with your secrets before running 'make dev'$(RESET)")

.PHONY: help
help: ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(CYAN)%-20s$(RESET) %s\n", $$1, $$2}'
	@echo ""
	@echo -e "$(YELLOW)Quick start:$(RESET)"
	@echo "  make setup  # check deps + create .env"
	@echo "  make dev    # start dev stack"
	@echo "  make test   # run all tests"
