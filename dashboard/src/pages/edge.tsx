import { useState, useEffect } from 'react'
import {
  listFunctions,
  createFunction,
  updateFunction,
  deleteFunction,
  invokeFunction,
} from '../lib/api'
import type { EdgeFunction } from '../lib/api'

interface EdgePageProps {
  token: string
}

const STARTER_TEMPLATE = `export async function handler(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({}))
  return new Response(
    JSON.stringify({ message: 'Hello from Curtain!', received: body }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}`

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export default function EdgePage({ token }: EdgePageProps) {
  const [functions, setFunctions] = useState<EdgeFunction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selected, setSelected] = useState<EdgeFunction | null>(null)
  const [editorCode, setEditorCode] = useState(STARTER_TEMPLATE)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const [invoking, setInvoking] = useState(false)
  const [invokeResult, setInvokeResult] = useState<string | null>(null)
  const [invokeError, setInvokeError] = useState<string | null>(null)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function loadFunctions() {
    setLoading(true)
    setError(null)
    const { data, error: apiErr } = await listFunctions(token)
    if (apiErr) {
      setError(apiErr)
    } else {
      setFunctions(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadFunctions()
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelect(fn: EdgeFunction) {
    setSelected(fn)
    setEditorCode(fn.code ?? STARTER_TEMPLATE)
    setSaveError(null)
    setSaveSuccess(false)
    setInvokeResult(null)
    setInvokeError(null)
  }

  async function handleNew() {
    const name = window.prompt('Function name (e.g. "hello-world"):')
    if (!name?.trim()) return

    const slug = slugify(name.trim())
    const { data, error: apiErr } = await createFunction(
      token,
      name.trim(),
      slug,
      STARTER_TEMPLATE,
    )

    if (apiErr) {
      setError(apiErr)
      return
    }

    await loadFunctions()
    if (data) handleSelect(data)
  }

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    const { data, error: apiErr } = await updateFunction(token, selected.id, editorCode)

    if (apiErr) {
      setSaveError(apiErr)
    } else {
      setSaveSuccess(true)
      if (data) {
        setSelected(data)
        setFunctions((prev) => prev.map((f) => (f.id === data.id ? data : f)))
      }
      setTimeout(() => setSaveSuccess(false), 2500)
    }
    setSaving(false)
  }

  async function handleInvoke() {
    if (!selected) return
    setInvoking(true)
    setInvokeResult(null)
    setInvokeError(null)

    const { data, error: apiErr } = await invokeFunction(token, selected.slug, {})

    if (apiErr) {
      setInvokeError(apiErr)
    } else {
      setInvokeResult(JSON.stringify(data, null, 2))
    }
    setInvoking(false)
  }

  async function handleDelete(fn: EdgeFunction) {
    if (!confirm(`Delete function "${fn.name}"?`)) return
    setDeletingId(fn.id)

    const { error: apiErr } = await deleteFunction(token, fn.id)
    if (apiErr) {
      setError(apiErr)
    } else {
      if (selected?.id === fn.id) {
        setSelected(null)
        setEditorCode(STARTER_TEMPLATE)
      }
      await loadFunctions()
    }
    setDeletingId(null)
  }

  return (
    <div className="p-6 space-y-5 h-full flex flex-col" style={{ minHeight: 0 }}>
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: '#e5e5e5' }}>
            Edge Functions
          </h1>
          <p className="text-sm mt-1" style={{ color: '#6b7280' }}>
            Deploy and invoke serverless functions
          </p>
        </div>
        <button
          onClick={handleNew}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ backgroundColor: '#f97316', color: '#ffffff' }}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Function
        </button>
      </div>

      {error && (
        <div
          className="rounded-lg px-4 py-3 text-sm shrink-0"
          style={{ backgroundColor: '#2a1010', border: '1px solid #7f1d1d', color: '#fca5a5' }}
        >
          {error}
        </div>
      )}

      <div className="flex gap-5 flex-1" style={{ minHeight: 0 }}>
        {/* Function list */}
        <div
          className="w-56 shrink-0 rounded-xl overflow-hidden flex flex-col"
          style={{ border: '1px solid #2a2a2a' }}
        >
          <div
            className="px-4 py-3 border-b"
            style={{ backgroundColor: '#1a1a1a', borderColor: '#2a2a2a' }}
          >
            <span className="text-sm font-medium" style={{ color: '#e5e5e5' }}>
              {loading ? 'Loading…' : `${functions.length} function${functions.length !== 1 ? 's' : ''}`}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-6 flex justify-center">
                <div
                  className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
                  style={{ borderColor: '#f97316', borderTopColor: 'transparent' }}
                />
              </div>
            ) : functions.length === 0 ? (
              <div className="p-4 text-xs text-center" style={{ color: '#6b7280' }}>
                No functions yet.
                <br />
                Click "New Function" to create one.
              </div>
            ) : (
              <ul>
                {functions.map((fn, i) => (
                  <li
                    key={fn.id}
                    style={{ borderBottom: i < functions.length - 1 ? '1px solid #2a2a2a' : 'none' }}
                  >
                    <div
                      className="flex items-center justify-between px-3 py-3 cursor-pointer"
                      style={{
                        backgroundColor:
                          selected?.id === fn.id ? 'rgba(249,115,22,0.1)' : 'transparent',
                      }}
                      onClick={() => handleSelect(fn)}
                    >
                      <div className="min-w-0">
                        <p
                          className="text-sm font-medium truncate"
                          style={{ color: selected?.id === fn.id ? '#f97316' : '#e5e5e5' }}
                        >
                          {fn.name}
                        </p>
                        <p className="text-xs truncate mt-0.5" style={{ color: '#6b7280' }}>
                          /{fn.slug}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 ml-2 shrink-0">
                        {/* Active indicator */}
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            backgroundColor: fn.active !== false ? '#22c55e' : '#6b7280',
                          }}
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDelete(fn)
                          }}
                          disabled={deletingId === fn.id}
                          className="text-xs rounded p-0.5 ml-1 disabled:opacity-50"
                          style={{ color: '#6b7280' }}
                          title="Delete function"
                        >
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Editor + invoke panel */}
        <div className="flex-1 flex flex-col gap-4 min-w-0" style={{ minHeight: 0 }}>
          {selected ? (
            <>
              {/* Editor toolbar */}
              <div className="flex items-center justify-between shrink-0">
                <div>
                  <span className="text-sm font-medium" style={{ color: '#e5e5e5' }}>
                    {selected.name}
                  </span>
                  <span className="mx-2 text-xs" style={{ color: '#2a2a2a' }}>/</span>
                  <span className="text-xs font-mono" style={{ color: '#6b7280' }}>
                    {selected.slug}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {saveSuccess && (
                    <span className="text-xs" style={{ color: '#22c55e' }}>
                      Saved!
                    </span>
                  )}
                  {saveError && (
                    <span className="text-xs" style={{ color: '#ef4444' }}>
                      {saveError}
                    </span>
                  )}
                  <button
                    onClick={handleInvoke}
                    disabled={invoking}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-60"
                    style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a', color: '#e5e5e5' }}
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    {invoking ? 'Running…' : 'Invoke'}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-60"
                    style={{ backgroundColor: '#f97316', color: '#ffffff' }}
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                      <polyline points="17 21 17 13 7 13 7 21" />
                      <polyline points="7 3 7 8 15 8" />
                    </svg>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>

              {/* Code editor */}
              <textarea
                value={editorCode}
                onChange={(e) => setEditorCode(e.target.value)}
                spellCheck={false}
                className="flex-1 w-full p-4 rounded-xl text-sm font-mono resize-none"
                style={{
                  backgroundColor: '#1a1a1a',
                  border: '1px solid #2a2a2a',
                  color: '#e5e5e5',
                  outline: 'none',
                  minHeight: '300px',
                  lineHeight: '1.6',
                  tabSize: 2,
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#f97316')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#2a2a2a')}
              />

              {/* Invoke result */}
              {(invokeResult !== null || invokeError !== null) && (
                <div
                  className="rounded-xl overflow-hidden shrink-0"
                  style={{ border: '1px solid #2a2a2a' }}
                >
                  <div
                    className="px-4 py-2 border-b flex items-center justify-between"
                    style={{ backgroundColor: '#1a1a1a', borderColor: '#2a2a2a' }}
                  >
                    <span className="text-xs font-medium" style={{ color: '#e5e5e5' }}>
                      Response
                    </span>
                    <button
                      onClick={() => { setInvokeResult(null); setInvokeError(null) }}
                      className="text-xs"
                      style={{ color: '#6b7280' }}
                    >
                      Clear
                    </button>
                  </div>
                  <pre
                    className="p-4 text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto"
                    style={{
                      backgroundColor: '#0f0f0f',
                      color: invokeError ? '#fca5a5' : '#86efac',
                    }}
                  >
                    {invokeError ?? invokeResult}
                  </pre>
                </div>
              )}
            </>
          ) : (
            <div
              className="flex-1 rounded-xl flex flex-col items-center justify-center gap-3"
              style={{ border: '1px dashed #2a2a2a' }}
            >
              <svg
                className="w-10 h-10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                style={{ color: '#2a2a2a' }}
              >
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              <p className="text-sm" style={{ color: '#6b7280' }}>
                Select a function or create a new one
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
