import { FormEvent, useEffect, useState } from 'react'
import { clearToken, getStoredToken, saveToken, signIn, signOut } from './lib/api'
import AuthPage from './pages/auth'
import DatabasePage from './pages/database'
import EdgePage from './pages/edge'
import StoragePage from './pages/storage'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Page = 'database' | 'auth' | 'storage' | 'functions' | 'settings'

// ---------------------------------------------------------------------------
// Inline SVG icons (no icon-lib dependency)
// ---------------------------------------------------------------------------

function IconDatabase({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v4c0 1.657 4.03 3 9 3s9-1.343 9-3V5" />
      <path d="M3 9v4c0 1.657 4.03 3 9 3s9-1.343 9-3V9" />
      <path d="M3 13v4c0 1.657 4.03 3 9 3s9-1.343 9-3v-4" />
    </svg>
  )
}

function IconLock({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function IconFolder({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function IconBolt({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  )
}

function IconSettings({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function IconLogOut({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// LoginPage
// ---------------------------------------------------------------------------

interface LoginPageProps {
  onLogin: (token: string) => void
}

function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data, error: apiErr } = await signIn(email, password)

    if (apiErr || !data?.access_token) {
      setError(apiErr ?? 'No access token returned')
      setLoading(false)
      return
    }

    saveToken(data.access_token)
    onLogin(data.access_token)
    setLoading(false)
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: '#0f0f0f' }}
    >
      {/* Subtle grid background */}
      <div
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, #f97316 0, #f97316 1px, transparent 1px, transparent 60px), repeating-linear-gradient(90deg, #f97316 0, #f97316 1px, transparent 1px, transparent 60px)',
        }}
      />

      <div
        className="relative w-full max-w-md mx-4 p-8 rounded-2xl"
        style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}
      >
        {/* Logo area */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="text-3xl font-bold tracking-tight" style={{ color: '#e5e5e5' }}>
              India
            </span>
            <span className="text-3xl font-bold tracking-tight" style={{ color: '#f97316' }}>
              BaaS
            </span>
          </div>
          <p className="text-sm" style={{ color: '#6b7280' }}>
            Self-Hosted BaaS &middot; Made in India 🇮🇳
          </p>
        </div>

        {/* Error banner */}
        {error && (
          <div
            className="mb-4 p-3 rounded-lg text-sm"
            style={{ backgroundColor: '#2a1010', border: '1px solid #7f1d1d', color: '#fca5a5' }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: '#6b7280' }}>
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@example.com"
              className="w-full px-3 py-2.5 rounded-lg text-sm outline-none focus:ring-2"
              style={{
                backgroundColor: '#0f0f0f',
                border: '1px solid #2a2a2a',
                color: '#e5e5e5',
                outline: 'none',
              }}
              onFocus={(e) => (e.target.style.borderColor = '#f97316')}
              onBlur={(e) => (e.target.style.borderColor = '#2a2a2a')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: '#6b7280' }}>
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2.5 rounded-lg text-sm"
              style={{
                backgroundColor: '#0f0f0f',
                border: '1px solid #2a2a2a',
                color: '#e5e5e5',
                outline: 'none',
              }}
              onFocus={(e) => (e.target.style.borderColor = '#f97316')}
              onBlur={(e) => (e.target.style.borderColor = '#2a2a2a')}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg font-semibold text-sm transition-opacity disabled:opacity-60"
            style={{ backgroundColor: '#f97316', color: '#ffffff' }}
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs" style={{ color: '#6b7280' }}>
          Curtain · Self-Hosted BaaS · Made in India 🇮🇳
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SettingsPage (inline — simple, no dedicated file needed)
// ---------------------------------------------------------------------------

function SettingsPage({ token }: { token: string }) {
  const apiUrl = (import.meta.env.VITE_API_URL as string) || 'http://localhost'
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold" style={{ color: '#e5e5e5' }}>
        Settings
      </h1>
      <div
        className="rounded-xl p-5 space-y-4"
        style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}
      >
        <h2 className="font-medium" style={{ color: '#e5e5e5' }}>
          Connection
        </h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span style={{ color: '#6b7280' }}>API URL</span>
            <span className="font-mono" style={{ color: '#f97316' }}>
              {apiUrl}
            </span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: '#6b7280' }}>Token (first 20 chars)</span>
            <span className="font-mono text-xs" style={{ color: '#e5e5e5' }}>
              {token.slice(0, 20)}…
            </span>
          </div>
        </div>
      </div>

      <div
        className="rounded-xl p-5"
        style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a' }}
      >
        <h2 className="font-medium mb-3" style={{ color: '#e5e5e5' }}>
          About
        </h2>
        <p className="text-sm" style={{ color: '#6b7280' }}>
          Curtain is a self-hosted Backend-as-a-Service stack inspired by Supabase, built and
          maintained with ❤️ in India. This dashboard communicates directly with your Curtain
          instance via plain HTTP calls to the REST gateway.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sidebar nav item
// ---------------------------------------------------------------------------

interface NavItemProps {
  icon: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}

function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left"
      style={{
        backgroundColor: active ? 'rgba(249,115,22,0.12)' : 'transparent',
        color: active ? '#f97316' : '#6b7280',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(255,255,255,0.04)'
          ;(e.currentTarget as HTMLButtonElement).style.color = '#e5e5e5'
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
          ;(e.currentTarget as HTMLButtonElement).style.color = '#6b7280'
        }
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Dashboard shell
// ---------------------------------------------------------------------------

interface DashboardProps {
  token: string
  onSignOut: () => void
}

function Dashboard({ token, onSignOut }: DashboardProps) {
  const [page, setPage] = useState<Page>('database')

  async function handleSignOut() {
    await signOut()
    clearToken()
    onSignOut()
  }

  function renderPage() {
    switch (page) {
      case 'database':
        return <DatabasePage token={token} />
      case 'auth':
        return <AuthPage token={token} />
      case 'storage':
        return <StoragePage token={token} />
      case 'functions':
        return <EdgePage token={token} />
      case 'settings':
        return <SettingsPage token={token} />
      default:
        return null
    }
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: '#0f0f0f' }}>
      {/* Sidebar */}
      <aside
        className="flex flex-col w-56 shrink-0 h-full border-r"
        style={{ backgroundColor: '#0f0f0f', borderColor: '#2a2a2a' }}
      >
        {/* Logo */}
        <div
          className="flex items-center gap-2 px-4 py-4 border-b"
          style={{ borderColor: '#2a2a2a' }}
        >
          <span className="text-lg font-bold" style={{ color: '#e5e5e5' }}>
            India
          </span>
          <span className="text-lg font-bold" style={{ color: '#f97316' }}>
            BaaS
          </span>
        </div>

        {/* Nav items */}
        <nav className="flex-1 p-3 space-y-1">
          <NavItem
            icon={<IconDatabase />}
            label="Database"
            active={page === 'database'}
            onClick={() => setPage('database')}
          />
          <NavItem
            icon={<IconLock />}
            label="Auth"
            active={page === 'auth'}
            onClick={() => setPage('auth')}
          />
          <NavItem
            icon={<IconFolder />}
            label="Storage"
            active={page === 'storage'}
            onClick={() => setPage('storage')}
          />
          <NavItem
            icon={<IconBolt />}
            label="Functions"
            active={page === 'functions'}
            onClick={() => setPage('functions')}
          />
        </nav>

        {/* Bottom section */}
        <div className="p-3 border-t space-y-1" style={{ borderColor: '#2a2a2a' }}>
          <NavItem
            icon={<IconSettings />}
            label="Settings"
            active={page === 'settings'}
            onClick={() => setPage('settings')}
          />
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left"
            style={{ color: '#6b7280' }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.backgroundColor =
                'rgba(255,255,255,0.04)'
              ;(e.currentTarget as HTMLButtonElement).style.color = '#e5e5e5'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
              ;(e.currentTarget as HTMLButtonElement).style.color = '#6b7280'
            }}
          >
            <IconLogOut />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header
          className="flex items-center justify-between px-6 py-3 border-b shrink-0"
          style={{ backgroundColor: '#0f0f0f', borderColor: '#2a2a2a' }}
        >
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold" style={{ color: '#e5e5e5' }}>
              Curtain
            </h1>
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: '#f97316' }}
            />
            <span className="text-xs" style={{ color: '#6b7280' }}>
              Self-Hosted
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: '#22c55e' }}
            />
            <span className="text-xs" style={{ color: '#6b7280' }}>
              Connected
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">{renderPage()}</main>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root App
// ---------------------------------------------------------------------------

export default function App() {
  const [token, setToken] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  // On mount: check localStorage for existing session
  useEffect(() => {
    const stored = getStoredToken()
    if (stored) {
      setToken(stored)
    }
    setReady(true)
  }, [])

  if (!ready) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: '#0f0f0f' }}
      >
        <div
          className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: '#f97316', borderTopColor: 'transparent' }}
        />
      </div>
    )
  }

  if (!token) {
    return <LoginPage onLogin={(t) => setToken(t)} />
  }

  return (
    <Dashboard
      token={token}
      onSignOut={() => {
        setToken(null)
      }}
    />
  )
}
