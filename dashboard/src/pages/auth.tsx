import { useState, useEffect } from 'react'
import { listUsers } from '../lib/api'
import AuthUsers from '../components/AuthUsers'
import type { AuthUser } from '../lib/api'

interface AuthPageProps {
  token: string
}

export default function AuthPage({ token }: AuthPageProps) {
  const [users, setUsers] = useState<AuthUser[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notConfigured, setNotConfigured] = useState(false)

  async function loadUsers() {
    setLoading(true)
    setError(null)
    setNotConfigured(false)

    const { data, error: apiErr } = await listUsers(token)

    if (apiErr) {
      // Friendly fallback for missing endpoint
      if (apiErr.includes('404') || apiErr.toLowerCase().includes('not found')) {
        setNotConfigured(true)
      } else {
        setError(apiErr)
      }
      setLoading(false)
      return
    }

    setUsers(data ?? [])
    setLoading(false)
  }

  useEffect(() => {
    loadUsers()
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: '#e5e5e5' }}>
            Auth
          </h1>
          <p className="text-sm mt-1" style={{ color: '#6b7280' }}>
            Manage users and authentication
          </p>
        </div>
        <button
          onClick={loadUsers}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
          style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a', color: '#e5e5e5' }}
        >
          <svg
            className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Not configured banner */}
      {notConfigured && (
        <div
          className="rounded-xl p-5 text-sm"
          style={{ backgroundColor: '#1a1709', border: '1px solid #713f12', color: '#fed7aa' }}
        >
          <p className="font-semibold mb-1">Admin user list endpoint not yet configured.</p>
          <p style={{ color: '#fdba74' }}>
            Use the{' '}
            <strong>Database</strong> page to query{' '}
            <code
              className="px-1.5 py-0.5 rounded text-xs font-mono"
              style={{ backgroundColor: 'rgba(249,115,22,0.15)', color: '#f97316' }}
            >
              auth.users
            </code>{' '}
            directly, or configure the{' '}
            <code className="px-1.5 py-0.5 rounded text-xs font-mono"
              style={{ backgroundColor: 'rgba(249,115,22,0.15)', color: '#f97316' }}
            >
              /auth/v1/admin/users
            </code>{' '}
            endpoint in your Curtain instance.
          </p>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div
          className="rounded-lg px-4 py-3 text-sm"
          style={{ backgroundColor: '#2a1010', border: '1px solid #7f1d1d', color: '#fca5a5' }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Stats row */}
      {!notConfigured && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Users', value: users.length },
            {
              label: 'Confirmed',
              value: users.filter((u) => u.confirmed_at).length,
            },
            {
              label: 'Unconfirmed',
              value: users.filter((u) => !u.confirmed_at).length,
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl p-4"
              style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}
            >
              <p className="text-2xl font-bold" style={{ color: '#e5e5e5' }}>
                {stat.value}
              </p>
              <p className="text-xs mt-1" style={{ color: '#6b7280' }}>
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Users table */}
      {!notConfigured && (
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid #2a2a2a' }}
        >
          <div
            className="flex items-center px-4 py-3 border-b"
            style={{ backgroundColor: '#1a1a1a', borderColor: '#2a2a2a' }}
          >
            <span className="text-sm font-medium" style={{ color: '#e5e5e5' }}>
              {loading ? 'Loading users…' : `${users.length} user${users.length !== 1 ? 's' : ''}`}
            </span>
          </div>
          <AuthUsers users={users} loading={loading} />
        </div>
      )}
    </div>
  )
}
