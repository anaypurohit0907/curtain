// Shared types for the SDK

export interface CurtainConfig {
  /** Base URL of your Curtain instance, e.g. "https://baas.example.com" */
  url: string
  /** Optional anon key (not yet used but reserved for future project isolation) */
  anonKey?: string
}

export interface User {
  id: string
  email: string
  provider: string
  role: string
  metadata: Record<string, unknown>
  confirmed: boolean
  created_at: string
  updated_at: string
}

export interface Session {
  access_token: string
  refresh_token: string
  token_type: 'bearer'
  expires_in: number
  user: User
}

export interface ApiResponse<T> {
  data: T | null
  error: ApiError | null
}

export interface ApiError {
  error: string
  message: string
}

export type PostgresFilterBuilder<T> = QueryBuilder<T>

// Allow QueryBuilder to be used as a type in the public API
// (we export the class itself from client.ts)
import type { QueryBuilder } from './db'
