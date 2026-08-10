'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { DESIGN_FILES_BUCKET, MAX_UPLOAD_BYTES } from '@/lib/technical/constants'
import type { Design } from '@/lib/types'

const MAX_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))

type FileKind = 'layout' | 'sld'

const SLOTS: { kind: FileKind; title: string; hint: string }[] = [
  {
    kind: 'layout',
    title: 'Solar layout',
    hint: 'Panel arrangement on the roof, as exported from whatever tool drew it.',
  },
  {
    kind: 'sld',
    title: 'Single line diagram',
    hint: 'Electrical schematic — panels through inverter to the board.',
  },
]

/**
 * The design's two documents.
 *
 * Uploads and downloads, deliberately. There is no in-browser CAD or layout editor
 * here and none is planned: a layout is drawn in the tool the engineer already uses,
 * and this records the output so Sales, the CEO and the installer are all looking at
 * the same file. Nothing parses the drawing.
 *
 * One file per slot, so a re-upload replaces rather than accumulates.
 */
export function DesignFileSection({
  design,
  readOnly,
}: {
  design: Design
  readOnly: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState<FileKind | null>(null)
  const [busy, setBusy] = useState<FileKind | null>(null)
  const [opening, setOpening] = useState<FileKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [files, setFiles] = useState<Partial<Record<FileKind, File | null>>>({})

  const pathFor = (kind: FileKind) =>
    kind === 'layout' ? design.layout_file_path : design.sld_file_path

  async function upload(kind: FileKind) {
    const file = files[kind]
    if (!file) return

    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`That file is larger than ${MAX_MB} MB.`)
      return
    }

    setBusy(kind)
    setError(null)

    const supabase = createClient()
    // First segment must be the design id: the storage policy reads it out of the
    // path to decide whether this user may write here at all.
    const path = `${design.id}/${crypto.randomUUID()}-${file.name}`
    const existing = pathFor(kind)

    const { error: uploadError } = await supabase.storage
      .from(DESIGN_FILES_BUCKET)
      .upload(path, file)

    if (uploadError) {
      setBusy(null)
      setError(uploadError.message)
      return
    }

    const res = await fetch(`/api/designs/${design.id}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, file_path: path }),
    })

    setBusy(null)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      // The object landed but nothing points at it — remove it rather than leaving
      // an orphan no page will ever show.
      await supabase.storage.from(DESIGN_FILES_BUCKET).remove([path])
      setError(body.error ?? 'Could not attach the file.')
      return
    }

    // The slot holds one path, so nothing references the old object now.
    // Best-effort: the record is already correct and a failure here should not read
    // as a failed upload.
    if (existing && existing !== path) {
      await supabase.storage.from(DESIGN_FILES_BUCKET).remove([existing])
    }

    setFiles((prev) => ({ ...prev, [kind]: null }))
    setPending(null)
    router.refresh()
  }

  /** Mints a fresh short-lived signed URL per click. The bucket is private. */
  async function open(kind: FileKind) {
    setOpening(kind)
    setError(null)

    const res = await fetch(`/api/designs/${design.id}/files?kind=${kind}`)
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
          <FileUp className="h-4 w-4 text-text-muted/60" />
          Design documents
        </h2>
        <p className="mt-0.5 text-xs text-text-muted">
          Drawn in your own CAD tool and stored here. Private bucket, short-lived signed links.
        </p>
      </div>

      {error && (
        <p className="border-b border-status-danger/15 bg-status-danger/5 px-5 py-2.5 text-xs text-status-danger">
          ⚠ {error}
        </p>
      )}

      <ul className="divide-y divide-border-subtle">
        {SLOTS.map((slot) => {
          const attached = pathFor(slot.kind)
          const isPending = pending === slot.kind

          return (
            <li key={slot.kind} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-brand-slate">{slot.title}</p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {attached ? 'Attached' : slot.hint}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {attached && (
                    <button
                      onClick={() => open(slot.kind)}
                      disabled={opening === slot.kind}
                      className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg disabled:opacity-60"
                    >
                      {opening === slot.kind ? 'Preparing…' : 'View'}
                    </button>
                  )}
                  {!readOnly && !isPending && (
                    <button
                      onClick={() => setPending(slot.kind)}
                      className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg"
                    >
                      {attached ? 'Replace' : 'Upload'}
                    </button>
                  )}
                </div>
              </div>

              {!readOnly && isPending && (
                <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg bg-surface-bg px-4 py-3">
                  <div className="min-w-48 flex-1">
                    <label
                      htmlFor={`design-file-${slot.kind}`}
                      className="mb-1 block text-xs text-text-muted"
                    >
                      File (PDF, DWG or image)
                    </label>
                    <input
                      id={`design-file-${slot.kind}`}
                      type="file"
                      onChange={(e) =>
                        setFiles((prev) => ({ ...prev, [slot.kind]: e.target.files?.[0] ?? null }))
                      }
                      className="block w-full text-sm text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-text-muted file:ring-1 file:ring-border-subtle"
                    />
                  </div>

                  <button
                    onClick={() => upload(slot.kind)}
                    disabled={!files[slot.kind] || busy === slot.kind}
                    className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-50"
                  >
                    {busy === slot.kind ? 'Uploading…' : attached ? 'Replace' : 'Upload'}
                  </button>
                  <button
                    onClick={() => {
                      setPending(null)
                      setFiles((prev) => ({ ...prev, [slot.kind]: null }))
                    }}
                    className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-white"
                  >
                    Cancel
                  </button>

                  {attached && (
                    <p className="w-full text-xs text-status-warning">
                      Replacing removes the current file — a slot holds one document, and the old
                      one would otherwise sit in storage with nothing pointing at it.
                    </p>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
