import { useState, useEffect, useRef } from 'react'
import { listBuckets, listObjects, uploadObject, deleteObject } from '../lib/api'
import type { StorageBucket, StorageObject } from '../lib/api'

interface StoragePageProps {
  token: string
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '—'
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function formatDate(str?: string): string {
  if (!str) return '—'
  try {
    return new Date(str).toLocaleString()
  } catch {
    return str
  }
}

export default function StoragePage({ token }: StoragePageProps) {
  const [buckets, setBuckets] = useState<StorageBucket[]>([])
  const [bucketsLoading, setBucketsLoading] = useState(false)
  const [bucketsError, setBucketsError] = useState<string | null>(null)

  const [selectedBucket, setSelectedBucket] = useState<string | null>(null)
  const [objects, setObjects] = useState<StorageObject[]>([])
  const [objectsLoading, setObjectsLoading] = useState(false)
  const [objectsError, setObjectsError] = useState<string | null>(null)

  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null)
  const [deletingKey, setDeletingKey] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  async function loadBuckets() {
    setBucketsLoading(true)
    setBucketsError(null)
    const { data, error } = await listBuckets(token)
    if (error) {
      setBucketsError(error)
    } else {
      setBuckets(data ?? [])
    }
    setBucketsLoading(false)
  }

  async function loadObjects(bucket: string) {
    setObjectsLoading(true)
    setObjectsError(null)
    const { data, error } = await listObjects(token, bucket)
    if (error) {
      setObjectsError(error)
    } else {
      setObjects(data ?? [])
    }
    setObjectsLoading(false)
  }

  useEffect(() => {
    loadBuckets()
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleBucketClick(name: string) {
    setSelectedBucket(name)
    setObjects([])
    setUploadError(null)
    setUploadSuccess(null)
    loadObjects(name)
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !selectedBucket) return

    setUploadError(null)
    setUploadSuccess(null)

    const { error } = await uploadObject(token, selectedBucket, file.name, file)
    if (error) {
      setUploadError(error)
    } else {
      setUploadSuccess(`"${file.name}" uploaded successfully`)
      loadObjects(selectedBucket)
    }

    // Reset the file input
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleDelete(key: string) {
    if (!selectedBucket) return
    if (!confirm(`Delete "${key}"?`)) return

    setDeletingKey(key)
    const { error } = await deleteObject(token, selectedBucket, key)
    if (error) {
      setObjectsError(error)
    } else {
      loadObjects(selectedBucket)
    }
    setDeletingKey(null)
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: '#e5e5e5' }}>
            Storage
          </h1>
          <p className="text-sm mt-1" style={{ color: '#6b7280' }}>
            MinIO S3-compatible object storage
          </p>
        </div>
        <button
          onClick={loadBuckets}
          disabled={bucketsLoading}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
          style={{ backgroundColor: '#1a1a1a', border: '1px solid #2a2a2a', color: '#e5e5e5' }}
        >
          <svg
            className={`w-4 h-4 ${bucketsLoading ? 'animate-spin' : ''}`}
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

      {bucketsError && (
        <div
          className="rounded-lg px-4 py-3 text-sm"
          style={{ backgroundColor: '#2a1010', border: '1px solid #7f1d1d', color: '#fca5a5' }}
        >
          <strong>Error loading buckets:</strong> {bucketsError}
        </div>
      )}

      <div className="grid grid-cols-12 gap-5">
        {/* Bucket list */}
        <div className="col-span-4">
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: '1px solid #2a2a2a' }}
          >
            <div
              className="px-4 py-3 border-b"
              style={{ backgroundColor: '#1a1a1a', borderColor: '#2a2a2a' }}
            >
              <span className="text-sm font-medium" style={{ color: '#e5e5e5' }}>
                Buckets
              </span>
            </div>

            {bucketsLoading ? (
              <div className="p-6 flex justify-center">
                <div
                  className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
                  style={{ borderColor: '#f97316', borderTopColor: 'transparent' }}
                />
              </div>
            ) : buckets.length === 0 ? (
              <div className="p-6 text-center text-sm" style={{ color: '#6b7280' }}>
                No buckets found
              </div>
            ) : (
              <ul>
                {buckets.map((bucket, i) => (
                  <li key={bucket.Name}>
                    <button
                      onClick={() => handleBucketClick(bucket.Name)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left text-sm transition-colors"
                      style={{
                        backgroundColor:
                          selectedBucket === bucket.Name
                            ? 'rgba(249,115,22,0.1)'
                            : i % 2 === 0
                            ? '#1a1a1a'
                            : 'transparent',
                        color:
                          selectedBucket === bucket.Name ? '#f97316' : '#e5e5e5',
                        borderBottom: i < buckets.length - 1 ? '1px solid #2a2a2a' : 'none',
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <svg
                          className="w-4 h-4 shrink-0"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          style={{ color: '#6b7280' }}
                        >
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                        <span className="truncate font-medium">{bucket.Name}</span>
                      </div>
                      {bucket.public !== undefined && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded shrink-0"
                          style={{
                            backgroundColor: bucket.public
                              ? 'rgba(34,197,94,0.15)'
                              : 'rgba(107,114,128,0.15)',
                            color: bucket.public ? '#22c55e' : '#6b7280',
                          }}
                        >
                          {bucket.public ? 'public' : 'private'}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Object browser */}
        <div className="col-span-8">
          {selectedBucket ? (
            <div
              className="rounded-xl overflow-hidden"
              style={{ border: '1px solid #2a2a2a' }}
            >
              {/* Objects header */}
              <div
                className="flex items-center justify-between px-4 py-3 border-b"
                style={{ backgroundColor: '#1a1a1a', borderColor: '#2a2a2a' }}
              >
                <span className="text-sm font-medium" style={{ color: '#e5e5e5' }}>
                  {selectedBucket}
                  {!objectsLoading && (
                    <span className="ml-2 text-xs" style={{ color: '#6b7280' }}>
                      {objects.length} object{objects.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </span>

                {/* Upload button */}
                <label
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors"
                  style={{ backgroundColor: '#f97316', color: '#ffffff' }}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  Upload
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </label>
              </div>

              {/* Upload feedback */}
              {uploadError && (
                <div
                  className="px-4 py-2 text-xs"
                  style={{ backgroundColor: '#2a1010', color: '#fca5a5', borderBottom: '1px solid #7f1d1d' }}
                >
                  Upload error: {uploadError}
                </div>
              )}
              {uploadSuccess && (
                <div
                  className="px-4 py-2 text-xs"
                  style={{ backgroundColor: '#0a2010', color: '#86efac', borderBottom: '1px solid #14532d' }}
                >
                  {uploadSuccess}
                </div>
              )}

              {objectsError && (
                <div
                  className="px-4 py-2 text-xs"
                  style={{ backgroundColor: '#2a1010', color: '#fca5a5', borderBottom: '1px solid #7f1d1d' }}
                >
                  {objectsError}
                </div>
              )}

              {objectsLoading ? (
                <div className="p-8 flex justify-center">
                  <div
                    className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin"
                    style={{ borderColor: '#f97316', borderTopColor: 'transparent' }}
                  />
                </div>
              ) : objects.length === 0 ? (
                <div className="p-8 text-center text-sm" style={{ color: '#6b7280' }}>
                  Bucket is empty
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                        {['Name', 'Size', 'Last Modified', ''].map((col) => (
                          <th
                            key={col}
                            className="text-left px-4 py-2 font-medium"
                            style={{ color: '#6b7280', backgroundColor: '#1a1a1a' }}
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {objects.map((obj, i) => (
                        <tr
                          key={obj.Key}
                          style={{
                            borderBottom: i < objects.length - 1 ? '1px solid #2a2a2a' : 'none',
                            backgroundColor: i % 2 === 0 ? '#0f0f0f' : '#1a1a1a',
                          }}
                        >
                          <td
                            className="px-4 py-2.5 font-mono text-xs max-w-xs truncate"
                            style={{ color: '#e5e5e5' }}
                            title={obj.Key}
                          >
                            {obj.Key}
                          </td>
                          <td className="px-4 py-2.5 text-xs" style={{ color: '#6b7280' }}>
                            {formatBytes(obj.Size)}
                          </td>
                          <td className="px-4 py-2.5 text-xs" style={{ color: '#6b7280' }}>
                            {formatDate(obj.LastModified)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              onClick={() => handleDelete(obj.Key)}
                              disabled={deletingKey === obj.Key}
                              className="text-xs px-2 py-1 rounded transition-colors disabled:opacity-60"
                              style={{
                                color: '#ef4444',
                                backgroundColor: 'rgba(239,68,68,0.1)',
                              }}
                            >
                              {deletingKey === obj.Key ? '…' : 'Delete'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div
              className="h-48 rounded-xl flex items-center justify-center"
              style={{ border: '1px dashed #2a2a2a' }}
            >
              <p className="text-sm" style={{ color: '#6b7280' }}>
                Select a bucket to browse objects
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
