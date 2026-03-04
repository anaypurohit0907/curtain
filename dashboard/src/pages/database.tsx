import { useCallback, useRef, useState } from 'react'
import TableBrowser from '../components/TableBrowser'
import type { QueryResult } from '../lib/api'
import { executeQuery } from '../lib/api'

interface DatabasePageProps {
  token: string
}

const EXAMPLES = [
  { label: 'List tables', sql: `SELECT table_name, table_schema\nFROM information_schema.tables\nWHERE table_schema NOT IN ('pg_catalog','information_schema')\nORDER BY table_schema, table_name;` },
  { label: 'Create table', sql: `CREATE TABLE public.my_table (\n  id   SERIAL PRIMARY KEY,\n  name TEXT NOT NULL,\n  created_at TIMESTAMPTZ DEFAULT NOW()\n);` },
  { label: 'Insert row', sql: `INSERT INTO public.my_table (name)\nVALUES ('hello world')\nRETURNING *;` },
  { label: 'Drop table', sql: `DROP TABLE IF EXISTS public.my_table;` },
]

export default function DatabasePage({ token }: DatabasePageProps) {
  const [sql, setSql] = useState('SELECT * FROM auth.users LIMIT 10;')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasRun, setHasRun] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const runQuery = useCallback(async (query: string) => {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    setHasRun(true)

    const { data, error: apiErr } = await executeQuery(token, query.trim())

    if (apiErr) {
      setError(apiErr)
    } else {
      setResult(data)
    }

    setLoading(false)
  }, [token])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      runQuery(sql)
    }
  }

  function loadExample(exampleSql: string) {
    setSql(exampleSql)
    setResult(null)
    setError(null)
    setHasRun(false)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const isSelect = result && result.columns.length > 0
  const isDDLDML = result && result.columns.length === 0

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold" style={{ color: '#e5e5e5' }}>
          Database
        </h1>
        <p className="text-sm mt-1" style={{ color: '#6b7280' }}>
          Run SQL queries directly against PostgreSQL
        </p>
      </div>

      {/* Example snippets */}
      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            onClick={() => loadExample(ex.sql)}
            className="px-3 py-1 rounded-md text-xs font-medium transition-colors"
            style={{
              backgroundColor: '#1a1a1a',
              border: '1px solid #2a2a2a',
              color: '#9ca3af',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#f97316'
              e.currentTarget.style.color = '#f97316'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#2a2a2a'
              e.currentTarget.style.color = '#9ca3af'
            }}
          >
            {ex.label}
          </button>
        ))}
      </div>

      {/* SQL editor */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ border: '1px solid #2a2a2a' }}
      >
        {/* Editor toolbar */}
        <div
          className="flex items-center justify-between px-4 py-2.5 border-b"
          style={{ backgroundColor: '#1a1a1a', borderColor: '#2a2a2a' }}
        >
          <span className="text-xs font-mono" style={{ color: '#6b7280' }}>
            SQL Editor
          </span>
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: '#4b5563' }}>
              Ctrl+Enter to run
            </span>
            <button
              onClick={() => runQuery(sql)}
              disabled={loading || !sql.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-semibold transition-opacity disabled:opacity-50"
              style={{ backgroundColor: '#f97316', color: '#ffffff' }}
            >
              {loading ? (
                <>
                  <span
                    className="inline-block w-3 h-3 border-2 border-t-transparent rounded-full animate-spin"
                    style={{ borderColor: '#fff', borderTopColor: 'transparent' }}
                  />
                  Running…
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M2 1l9 5-9 5V1z" />
                  </svg>
                  Run
                </>
              )}
            </button>
          </div>
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          rows={8}
          className="w-full resize-y px-4 py-3 font-mono text-sm leading-relaxed"
          style={{
            backgroundColor: '#0f0f0f',
            color: '#e5e5e5',
            outline: 'none',
            border: 'none',
            minHeight: '160px',
          }}
        />
      </div>

      {/* Error */}
      {error && (
        <div
          className="rounded-lg px-4 py-3 text-sm font-mono"
          style={{ backgroundColor: '#2a1010', border: '1px solid #7f1d1d', color: '#fca5a5' }}
        >
          <strong style={{ color: '#f87171' }}>Error: </strong>{error}
        </div>
      )}

      {/* DDL / DML result */}
      {isDDLDML && !loading && (
        <div
          className="rounded-lg px-4 py-3 flex items-center gap-3 text-sm"
          style={{ backgroundColor: '#0f1f0f', border: '1px solid #14532d', color: '#86efac' }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm3.5 6.5l-4 4a.75.75 0 01-1.06 0l-2-2a.75.75 0 011.06-1.06L7 8.94l3.47-3.47a.75.75 0 011.03 1.03z" />
          </svg>
          <span>
            <strong>{result.command}</strong>
            {result.rowsAffected > 0 && (
              <span style={{ color: '#6ee7b7' }}>
                {' — '}{result.rowsAffected} row{result.rowsAffected !== 1 ? 's' : ''} affected
              </span>
            )}
          </span>
        </div>
      )}

      {/* SELECT result table */}
      {isSelect && !loading && (
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid #2a2a2a' }}
        >
          <div
            className="flex items-center justify-between px-4 py-2.5 border-b"
            style={{ backgroundColor: '#1a1a1a', borderColor: '#2a2a2a' }}
          >
            <span className="text-sm font-medium" style={{ color: '#e5e5e5' }}>
              {result.command}
            </span>
            <span className="text-xs" style={{ color: '#6b7280' }}>
              {result.rows.length} row{result.rows.length !== 1 ? 's' : ''} · {result.columns.length} col{result.columns.length !== 1 ? 's' : ''}
            </span>
          </div>
          <TableBrowser
            columns={result.columns}
            rows={result.rows}
            loading={false}
            emptyMessage="Query returned 0 rows"
          />
        </div>
      )}

      {/* Loading skeleton */}
      {loading && hasRun && (
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: '1px solid #2a2a2a' }}
        >
          <TableBrowser columns={[]} rows={[]} loading={true} />
        </div>
      )}
    </div>
  )
}
