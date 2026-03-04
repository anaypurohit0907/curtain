// =============================================================================
// Curtain JavaScript / TypeScript SDK — public surface
// =============================================================================
//
// Import from 'curtain' to get everything you need:
//
//   import { createClient } from 'curtain'
//   const client = createClient('https://baas.example.com')
//
// =============================================================================

// ── Core client ───────────────────────────────────────────────────────────────
export { createClient, CurtainClient } from './client'

// ── Database ──────────────────────────────────────────────────────────────────
export { QueryBuilder } from './db'

// ── Realtime ──────────────────────────────────────────────────────────────────
export { RealtimeChannel } from './realtime'

// ── Storage ───────────────────────────────────────────────────────────────────
export { StorageBucket } from './storage'

// ── Auth utilities ────────────────────────────────────────────────────────────
export { parseJWT, isTokenExpired } from './auth'

// ── Edge functions ────────────────────────────────────────────────────────────
export { FunctionsClient } from './edge'

// ── Core types ────────────────────────────────────────────────────────────────
export type {
  CurtainConfig,
  User,
  Session,
  ApiResponse,
  ApiError,
} from './types'

// ── Edge function types ───────────────────────────────────────────────────────
export type {
  EdgeFunction,
  InvokeOptions,
  InvokeResult,
} from './edge'

// ── Auth types ────────────────────────────────────────────────────────────────
export type {
  AuthEvent,
  AuthStateChangeCallback,
  SignUpCredentials,
  SignInCredentials,
} from './auth'
