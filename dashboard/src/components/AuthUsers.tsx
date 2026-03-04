// src/components/AuthUsers.tsx
// Reusable user table for the Auth page.

import type { AuthUser } from '../lib/api'

interface AuthUsersProps {
  users: AuthUser[]
  loading: boolean
}

function ConfirmedBadge({ confirmed }: { confirmed: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
      style={{
        backgroundColor: confirmed ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
        color: confirmed ? '#22c55e' : '#ef4444',
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: confirmed ? '#22c55e' : '#ef4444' }}
      />
      {confirmed ? 'Confirmed' : 'Pending'}
    </span>
  )
}

function formatDate(str?: string | null): string {
  if (!str) return '—'
  try {
    return new Date(str).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return str
  }
}

const COLUMNS = ['ID', 'Email', 'Provider', 'Role', 'Confirmed', 'Created At'] as const

export default function AuthUsers({ users, loading }: AuthUsersProps) {
  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center py-12 gap-3"
        style={{ backgroundColor: '#0f0f0f' }}
      >
        <div
          className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: '#f97316', borderTopColor: 'transparent' }}
        />
        <span className="text-sm" style={{ color: '#6b7280' }}>
          Loading users…
        </span>
      </div>
    )
  }

  if (users.length === 0) {
    return (
      <div
        className="py-12 text-center text-sm"
        style={{ backgroundColor: '#0f0f0f', color: '#6b7280' }}
      >
        0 users
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
            {COLUMNS.map((col) => (
              <th
                key={col}
                className="text-left px-4 py-2.5 font-medium whitespace-nowrap"
                style={{ color: '#6b7280', backgroundColor: '#1a1a1a' }}
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((user, i) => (
            <tr
              key={user.id}
              style={{
                borderBottom: i < users.length - 1 ? '1px solid #2a2a2a' : 'none',
                backgroundColor: i % 2 === 0 ? '#0f0f0f' : '#121212',
              }}
            >
              {/* ID — truncated to 8 chars */}
              <td className="px-4 py-2.5">
                <span
                  className="font-mono text-xs"
                  style={{ color: '#f97316' }}
                  title={user.id}
                >
                  {user.id.slice(0, 8)}
                </span>
              </td>

              {/* Email */}
              <td
                className="px-4 py-2.5 max-w-xs truncate"
                style={{ color: '#e5e5e5' }}
                title={user.email}
              >
                {user.email}
              </td>

              {/* Provider */}
              <td className="px-4 py-2.5">
                <span
                  className="text-xs px-2 py-0.5 rounded"
                  style={{
                    backgroundColor: 'rgba(249,115,22,0.1)',
                    color: '#f97316',
                  }}
                >
                  {user.provider ?? 'email'}
                </span>
              </td>

              {/* Role */}
              <td className="px-4 py-2.5 text-xs" style={{ color: '#6b7280' }}>
                {user.role ?? '—'}
              </td>

              {/* Confirmed */}
              <td className="px-4 py-2.5">
                <ConfirmedBadge confirmed={!!user.confirmed_at} />
              </td>

              {/* Created At */}
              <td className="px-4 py-2.5 text-xs" style={{ color: '#6b7280' }}>
                {formatDate(user.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
