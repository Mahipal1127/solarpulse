'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Film } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { EmptyState, Badge } from '@/components/ui/primitives'
import { formatDateTime, CONTENT_ASSET_TYPE_LABELS } from '@/lib/format'
import { CONTENT_ASSET_TYPES, MARKETING_ASSETS_BUCKET, MAX_UPLOAD_BYTES } from '@/lib/marketing/constants'
import type { ContentAsset, ContentAssetType } from '@/lib/types'

const MAX_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))

type AssetRow = ContentAsset & { uploader: { full_name: string } | null }

/**
 * Asset library for a content item — the same two-step private-bucket flow the other
 * modules use. The browser pushes the file into marketing-assets at
 * '{content_calendar_item_id}/{filename}' (the storage policy re-checks ownership
 * through that first segment), then this records the metadata row and audits it. Each
 * download mints a fresh short-lived signed URL. Assets progress raw footage → edited
 * video → final graphic, tracked by asset_type.
 */
export function AssetManager({
  itemId,
  assets,
  readOnly,
}: {
  itemId: string
  assets: AssetRow[]
  readOnly: boolean
}) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [assetType, setAssetType] = useState<ContentAssetType>(CONTENT_ASSET_TYPES[0])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  async function upload() {
    if (!file) return
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`That file is larger than ${MAX_MB} MB. Upload a smaller file.`)
      return
    }

    setUploading(true)
    setError(null)

    const supabase = createClient()
    // Path is '{content_calendar_item_id}/{file}': the storage policy reads the item
    // id from the first segment to decide whether this user may write here.
    const path = `${itemId}/${crypto.randomUUID()}-${file.name}`

    const { error: uploadError } = await supabase.storage
      .from(MARKETING_ASSETS_BUCKET)
      .upload(path, file)

    if (uploadError) {
      setUploading(false)
      setError(uploadError.message)
      return
    }

    const res = await fetch(`/api/content-calendar/${itemId}/assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: path, file_name: file.name, asset_type: assetType }),
    })

    setUploading(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      // Object landed but the row did not — remove the orphan.
      await supabase.storage.from(MARKETING_ASSETS_BUCKET).remove([path])
      setError(body.error ?? 'Could not record the asset.')
      return
    }

    setFile(null)
    router.refresh()
  }

  async function open(asset: AssetRow) {
    setOpening(asset.id)
    setError(null)

    const res = await fetch(`/api/content-calendar/${itemId}/assets?assetId=${asset.id}`)
    setOpening(null)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not generate a link.')
      return
    }

    const { url } = await res.json()
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function remove(asset: AssetRow) {
    setDeleting(asset.id)
    setError(null)

    const res = await fetch(`/api/content-calendar/${itemId}/assets?assetId=${asset.id}`, {
      method: 'DELETE',
    })
    setDeleting(null)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not remove the asset.')
      return
    }
    router.refresh()
  }

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-card">
      <div className="border-b border-border-subtle px-5 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-slate">
          <Film className="h-4 w-4 text-text-muted/60" />
          Assets
        </h2>
        <p className="mt-0.5 text-xs text-text-muted">
          Raw footage, edited videos, graphics and scripts. Private bucket — every view goes through
          a short-lived signed link.
        </p>
      </div>

      {!readOnly && (
        <div className="border-b border-border-subtle bg-surface-bg px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="asset-type"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted"
              >
                Type
              </label>
              <select
                id="asset-type"
                value={assetType}
                onChange={(e) => setAssetType(e.target.value as ContentAssetType)}
                className="w-full rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold"
              >
                {CONTENT_ASSET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CONTENT_ASSET_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="asset-file"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted"
              >
                File
              </label>
              <input
                id="asset-file"
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-text-muted file:ring-1 file:ring-border-subtle"
              />
            </div>
          </div>

          <button
            onClick={upload}
            disabled={!file || uploading}
            className="mt-3 rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-50"
          >
            {uploading ? 'Uploading…' : 'Upload asset'}
          </button>
        </div>
      )}

      {error && (
        <p className="border-b border-status-danger/15 bg-status-danger/5 px-5 py-2.5 text-xs text-status-danger">
          ⚠ {error}
        </p>
      )}

      {assets.length === 0 ? (
        <EmptyState
          title="No assets yet"
          description={readOnly ? 'Nothing has been uploaded.' : 'Footage, edits and graphics land here.'}
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {assets.map((asset) => (
            <li key={asset.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-brand-slate">{asset.file_name}</p>
                  {asset.asset_type && (
                    <Badge className="bg-surface-bg text-text-muted ring-border-subtle">
                      {CONTENT_ASSET_TYPE_LABELS[asset.asset_type] ?? asset.asset_type}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-text-muted">
                  {asset.uploader?.full_name ?? 'Unknown'} · {formatDateTime(asset.created_at)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => open(asset)}
                  disabled={opening === asset.id}
                  className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg disabled:opacity-60"
                >
                  {opening === asset.id ? 'Preparing…' : 'View'}
                </button>
                {!readOnly && (
                  <button
                    onClick={() => remove(asset)}
                    disabled={deleting === asset.id}
                    className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-status-danger hover:text-status-danger disabled:opacity-60"
                  >
                    {deleting === asset.id ? 'Removing…' : 'Remove'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
