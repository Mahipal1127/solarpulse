'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { EmptyState, Badge } from '@/components/ui/primitives'
import { formatDateTime, formatPhotoStage } from '@/lib/format'
import { PHOTO_STAGES, INSTALLATION_MEDIA_BUCKET, MAX_UPLOAD_BYTES } from '@/lib/om/constants'

type PhotoRow = {
  id: string
  file_name: string
  photo_stage: string | null
  created_at: string
}

/** 25 MB in the words someone reads in an error message. */
const MAX_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))

/**
 * Site photos, the same two-step private-bucket flow the survey module uses. The
 * browser pushes the object into installation-media — where the storage policy
 * re-checks ownership through the folder name, which must start with the
 * installation id — then this records the row and audits it. Every view mints a
 * fresh short-lived signed URL; there is no public URL, because these are
 * photographs of a customer's property.
 */
export function PhotoSection({
  installationId,
  photos,
  readOnly,
}: {
  installationId: string
  photos: PhotoRow[]
  readOnly: boolean
}) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [stage, setStage] = useState<string>(PHOTO_STAGES[0])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)

  async function upload() {
    if (!file) return

    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`That file is larger than ${MAX_MB} MB. Compress it or upload a smaller image.`)
      return
    }

    setUploading(true)
    setError(null)

    const supabase = createClient()
    // First segment must be the installation id: the storage policy reads it out of
    // the path to decide whether this user may write here at all.
    const path = `${installationId}/${crypto.randomUUID()}-${file.name}`

    const { error: uploadError } = await supabase.storage
      .from(INSTALLATION_MEDIA_BUCKET)
      .upload(path, file)

    if (uploadError) {
      setUploading(false)
      setError(uploadError.message)
      return
    }

    const res = await fetch(`/api/installations/${installationId}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: path, file_name: file.name, photo_stage: stage }),
    })

    setUploading(false)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      // The object landed but the row did not — remove it rather than leaving an
      // orphan no page will ever show.
      await supabase.storage.from(INSTALLATION_MEDIA_BUCKET).remove([path])
      setError(body.error ?? 'Could not record the photo.')
      return
    }

    setFile(null)
    router.refresh()
  }

  async function open(photo: PhotoRow) {
    setOpening(photo.id)
    setError(null)

    const res = await fetch(`/api/installations/${installationId}/photos?photoId=${photo.id}`)
    setOpening(null)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not generate a link.')
      return
    }

    const { url } = await res.json()
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="rounded-xl border border-border-subtle bg-white shadow-sm">
      <div className="border-b border-border-subtle px-5 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-slate">
          <Camera className="h-4 w-4 text-text-muted/60" />
          Site photos
        </h2>
        <p className="mt-0.5 text-xs text-text-muted">
          Private bucket. Every view goes through a short-lived signed link — these are
          photographs of a customer&apos;s property.
        </p>
      </div>

      {!readOnly && (
        <div className="border-b border-border-subtle bg-surface-bg px-5 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <label
                htmlFor="inst-photo-file"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted"
              >
                Photo
              </label>
              <input
                id="inst-photo-file"
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-text-muted file:ring-1 file:ring-border-subtle"
              />
            </div>

            <div>
              <label
                htmlFor="inst-photo-stage"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted"
              >
                Stage
              </label>
              <select
                id="inst-photo-stage"
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                className="rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold"
              >
                {PHOTO_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {formatPhotoStage(s)}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={upload}
              disabled={!file || uploading}
              className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-50"
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="border-b border-status-danger/15 bg-status-danger/5 px-5 py-2.5 text-xs text-status-danger">
          ⚠ {error}
        </p>
      )}

      {photos.length === 0 ? (
        <EmptyState
          title="No photos yet"
          description={
            readOnly
              ? 'The crew has not uploaded any photos for this installation.'
              : 'Before, during and after shots — panel mounting, wiring, the finished array.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {photos.map((photo) => (
            <li key={photo.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-brand-slate">
                    {photo.file_name}
                  </p>
                  <Badge className="bg-surface-bg text-text-muted ring-border-subtle">
                    {formatPhotoStage(photo.photo_stage)}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-text-muted">{formatDateTime(photo.created_at)}</p>
              </div>

              <button
                onClick={() => open(photo)}
                disabled={opening === photo.id}
                className="shrink-0 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg disabled:opacity-60"
              >
                {opening === photo.id ? 'Preparing…' : 'View'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
