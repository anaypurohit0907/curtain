// src/components/TableBrowser.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TableBrowser from './TableBrowser'

// ---------------------------------------------------------------------------
// 1. Renders loading state
// ---------------------------------------------------------------------------
describe('TableBrowser loading state', () => {
  it('shows "Loading..." when loading prop is true', () => {
    render(
      <TableBrowser
        columns={[]}
        rows={[]}
        loading={true}
        emptyMessage="Nothing here"
      />,
    )
    expect(screen.getByText('Loading...')).toBeTruthy()
    // The loading spinner container should be present
    const loadingEl = screen.getByTestId('table-loading')
    expect(loadingEl).toBeTruthy()
  })

  it('does NOT show the empty message while loading', () => {
    render(
      <TableBrowser
        columns={[]}
        rows={[]}
        loading={true}
        emptyMessage="Should not appear"
      />,
    )
    const empty = screen.queryByText('Should not appear')
    expect(empty).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2. Renders empty state with custom emptyMessage
// ---------------------------------------------------------------------------
describe('TableBrowser empty state', () => {
  it('shows the default empty message when rows are empty', () => {
    render(
      <TableBrowser
        columns={[]}
        rows={[]}
        loading={false}
      />,
    )
    expect(screen.getByText('No rows found')).toBeTruthy()
  })

  it('shows custom emptyMessage when provided and rows is empty', () => {
    render(
      <TableBrowser
        columns={['id', 'name']}
        rows={[]}
        loading={false}
        emptyMessage='No data in "my_table"'
      />,
    )
    expect(screen.getByText('No data in "my_table"')).toBeTruthy()
  })

  it('renders the data-testid="table-empty" element when empty', () => {
    render(
      <TableBrowser columns={[]} rows={[]} loading={false} emptyMessage="Empty!" />,
    )
    expect(screen.getByTestId('table-empty')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// 3. Renders rows with correct cell values
// ---------------------------------------------------------------------------
describe('TableBrowser rows', () => {
  const columns = ['id', 'name', 'email']
  const rows = [
    { id: '1', name: 'Alice', email: 'alice@example.com' },
    { id: '2', name: 'Bob', email: 'bob@example.com' },
  ]

  it('renders column headers', () => {
    render(<TableBrowser columns={columns} rows={rows} loading={false} />)
    expect(screen.getByText('id')).toBeTruthy()
    expect(screen.getByText('name')).toBeTruthy()
    expect(screen.getByText('email')).toBeTruthy()
  })

  it('renders cell values for each row', () => {
    render(<TableBrowser columns={columns} rows={rows} loading={false} />)
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.getByText('Bob')).toBeTruthy()
    expect(screen.getByText('alice@example.com')).toBeTruthy()
    expect(screen.getByText('bob@example.com')).toBeTruthy()
  })

  it('renders NULL for null values', () => {
    const nullRows = [{ id: '1', name: null, email: 'a@b.com' }]
    render(
      <TableBrowser
        columns={['id', 'name', 'email']}
        rows={nullRows as Record<string, unknown>[]}
        loading={false}
      />,
    )
    expect(screen.getByText('NULL')).toBeTruthy()
  })

  it('renders correct number of data rows', () => {
    const { container } = render(
      <TableBrowser columns={columns} rows={rows} loading={false} />,
    )
    const tableRows = container.querySelectorAll('tbody tr')
    expect(tableRows.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// 4. Truncates long values at 60 characters
// ---------------------------------------------------------------------------
describe('TableBrowser truncation', () => {
  it('truncates cell text exceeding 60 characters with ellipsis', () => {
    const longValue = 'A'.repeat(80)
    const rows = [{ description: longValue }]
    render(
      <TableBrowser
        columns={['description']}
        rows={rows}
        loading={false}
      />,
    )
    // The displayed text should be truncated — 60 chars + '…'
    const expected = 'A'.repeat(60) + '…'
    expect(screen.getByText(expected)).toBeTruthy()
  })

  it('does NOT truncate values that are exactly 60 characters', () => {
    const exactValue = 'B'.repeat(60)
    const rows = [{ col: exactValue }]
    render(
      <TableBrowser columns={['col']} rows={rows} loading={false} />,
    )
    expect(screen.getByText(exactValue)).toBeTruthy()
  })

  it('shows UUID values truncated in monospace (8 leading + 4 trailing chars + ellipsis)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    const rows = [{ id: uuid }]
    render(<TableBrowser columns={['id']} rows={rows} loading={false} />)
    // UUID display: first 8 chars + '…' + last 4 chars
    const displayed = uuid.slice(0, 8) + '…' + uuid.slice(-4)
    expect(screen.getByText(displayed)).toBeTruthy()
  })
})
