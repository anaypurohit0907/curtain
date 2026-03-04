// src/components/TableBrowser.tsx
// Reusable dark-themed scrollable table component.

const MAX_CELL_LEN = 60

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  const str = String(value)
  if (str.length > MAX_CELL_LEN) {
    return str.slice(0, MAX_CELL_LEN) + '…'
  }
  return str
}

// Detects UUID pattern (8-4-4-4-12)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUUID(value: string): boolean {
  return UUID_RE.test(value)
}

export interface TableBrowserProps {
  columns: string[]
  rows: Record<string, unknown>[]
  loading: boolean
  emptyMessage?: string
}

export default function TableBrowser({
  columns,
  rows,
  loading,
  emptyMessage = 'No rows found',
}: TableBrowserProps) {
  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center py-12 gap-3"
        style={{ backgroundColor: '#0f0f0f' }}
        data-testid="table-loading"
      >
        <div
          className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: '#f97316', borderTopColor: 'transparent' }}
        />
        <span className="text-sm" style={{ color: '#6b7280' }}>
          Loading...
        </span>
      </div>
    )
  }

  if (columns.length === 0 || rows.length === 0) {
    return (
      <div
        className="flex items-center justify-center py-12 text-sm"
        style={{ backgroundColor: '#0f0f0f', color: '#6b7280' }}
        data-testid="table-empty"
      >
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto" style={{ backgroundColor: '#0f0f0f' }}>
      <table
        className="w-full text-sm border-collapse"
        style={{ minWidth: `${columns.length * 140}px` }}
      >
        <thead>
          <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
            {columns.map((col) => (
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
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              style={{
                borderBottom: rowIndex < rows.length - 1 ? '1px solid #2a2a2a' : 'none',
                backgroundColor: rowIndex % 2 === 0 ? '#0f0f0f' : '#121212',
              }}
            >
              {columns.map((col) => {
                const raw = row[col]
                const cellStr = formatCell(raw)
                const isId = typeof raw === 'string' && isUUID(raw)
                const displayVal = isId ? raw.slice(0, 8) + '…' + raw.slice(-4) : cellStr
                const title =
                  typeof raw === 'object' && raw !== null
                    ? JSON.stringify(raw)
                    : String(raw ?? '')

                return (
                  <td
                    key={col}
                    className="px-4 py-2.5 max-w-xs"
                    style={{ color: '#e5e5e5' }}
                    title={title}
                  >
                    <span
                      className={isId ? 'font-mono text-xs' : 'text-sm'}
                      style={isId ? { color: '#f97316' } : undefined}
                    >
                      {displayVal}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
