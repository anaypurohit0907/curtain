import type { ApiResponse } from '../types'

// =============================================================================
// StorageBucket — file upload/download via MinIO S3-compatible API
// =============================================================================

export interface UploadOptions {
  contentType?: string
  cacheControl?: string
  upsert?: boolean
}

export interface FileObject {
  name:       string
  size:       number
  mime_type:  string
  created_at: string
}

export class StorageBucket {
  constructor(
    private baseURL: string,
    private bucket:  string,
    private token:   string | null,
  ) {}

  /**
   * Upload a file to the bucket.
   *
   * @example
   * const input = document.querySelector<HTMLInputElement>('input[type=file]')!
   * const file  = input.files![0]
   * const { data, error } = await client.storage.from('avatars').upload('user/pic.jpg', file)
   */
  async upload(
    path: string,
    fileBody: File | Blob | ArrayBuffer | string,
    options?: UploadOptions,
  ): Promise<ApiResponse<{ path: string; url: string }>> {
    const method = options?.upsert ? 'PUT' : 'POST'
    const hdrs: Record<string, string> = {}

    if (this.token) hdrs['Authorization'] = `Bearer ${this.token}`
    if (options?.contentType) hdrs['Content-Type'] = options.contentType
    if (options?.cacheControl) hdrs['Cache-Control'] = `max-age=${options.cacheControl}`

    try {
      const res = await fetch(
        `${this.baseURL}/storage/v1/${this.bucket}/${path}`,
        { method, headers: hdrs, body: fileBody as BodyInit },
      )

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'upload_failed' }))
        return { data: null, error: err }
      }

      return {
        data: {
          path,
          url: this.getPublicUrl(path).data.publicUrl,
        },
        error: null,
      }
    } catch (e) {
      return { data: null, error: { error: 'network_error', message: String(e) } }
    }
  }

  /**
   * Download a file from the bucket.
   */
  async download(path: string): Promise<ApiResponse<Blob>> {
    const hdrs: Record<string, string> = {}
    if (this.token) hdrs['Authorization'] = `Bearer ${this.token}`

    try {
      const res = await fetch(
        `${this.baseURL}/storage/v1/${this.bucket}/${path}`,
        { headers: hdrs },
      )
      if (!res.ok) {
        return { data: null, error: { error: 'download_failed', message: res.statusText } }
      }
      return { data: await res.blob(), error: null }
    } catch (e) {
      return { data: null, error: { error: 'network_error', message: String(e) } }
    }
  }

  /**
   * Get the public URL for a file (works for public buckets without auth).
   */
  getPublicUrl(path: string): { data: { publicUrl: string } } {
    return {
      data: {
        publicUrl: `${this.baseURL}/storage/v1/${this.bucket}/${path}`,
      },
    }
  }

  /**
   * Remove a file from the bucket.
   */
  async remove(paths: string[]): Promise<ApiResponse<null>> {
    const hdrs: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.token) hdrs['Authorization'] = `Bearer ${this.token}`

    // MinIO DELETE: delete one at a time (or use multi-object delete in S3 XML format)
    const errors = []
    for (const path of paths) {
      const res = await fetch(
        `${this.baseURL}/storage/v1/${this.bucket}/${path}`,
        { method: 'DELETE', headers: hdrs },
      )
      if (!res.ok) errors.push(path)
    }

    if (errors.length > 0) {
      return {
        data: null,
        error: { error: 'delete_partial', message: `failed to delete: ${errors.join(', ')}` },
      }
    }
    return { data: null, error: null }
  }
}
