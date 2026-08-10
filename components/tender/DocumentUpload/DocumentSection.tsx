'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { EmptyState, Badge } from '@/components/ui/primitives'
import { formatDateTime, DOCUMENT_TYPE_LABELS } from '@/lib/format'
import type { TenderDocument } from '@/lib/types'

export type DocumentRow = TenderDocument & { uploader: { full_name: string } | null }

const DOCUMENT_TYPES = ['submitted_tender', 'supporting_doc', 'award_letter', 'other'] as const

export function DocumentSection({
  tenderId,
  documents,
  readOnly,
}: {
  tenderId: string
  documents: DocumentRow[]
  readOnly: boolean
}) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [documentType, setDocumentType] = useState<string>('submitted_tender')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<DocumentRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  /**
   * Two steps: the browser pushes the object into the private bucket (allowed by
   * the storage policy, which re-checks the tender's org through the folder
   * name), then the route handler records the row and writes the audit entry.
   */
  async function upload() {
    if (!file) return
    setUploading(true)
    setError(null)

    const supabase = createClient()
    const path = `${tenderId}/${crypto.randomUUID()}-${file.name}`

    const { error: uploadError } = await supabase.storage
      .from('tender-documents')
      .upload(path, file)

    if (uploadError) {
      setUploading(false)
      setError(uploadError.message)
      return
    }

    const res = await fetch(`/api/tenders/${tenderId}/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: path, file_name: file.name, document_type: documentType }),
    })

    setUploading(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      // The object landed but the row did not — remove it rather than leaving an
      // orphan no page will ever show.
      await supabase.storage.from('tender-documents').remove([path])
      setError(body.error ?? 'Could not record the document.')
      return
    }

    setFile(null)
    router.refresh()
  }

  /** Mints a fresh short-lived signed URL per click; nothing is cached. */
  async function download(document: DocumentRow) {
    setDownloading(document.id)
    setError(null)

    const res = await fetch(`/api/documents/${document.id}`)
    setDownloading(null)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not generate a download link.')
      return
    }

    const { url } = await res.json()
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function remove() {
    if (!confirmDelete) return
    setDeleting(true)
    setError(null)

    const res = await fetch(`/api/documents/${confirmDelete.id}`, { method: 'DELETE' })

    setDeleting(false)
    setConfirmDelete(null)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not delete the document.')
      return
    }
    router.refresh()
  }

  return (
    <div className="rounded-xl border border-border-subtle bg-white shadow-sm">
      <div className="border-b border-border-subtle px-5 py-4">
        <h2 className="text-sm font-semibold text-brand-slate">Documents</h2>
        <p className="mt-0.5 text-xs text-text-muted">
          Stored in a private bucket. Downloads use short-lived signed links.
        </p>
      </div>

      {!readOnly && (
        <div className="border-b border-border-subtle bg-surface-bg px-5 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <label
                htmlFor="tender-document-file"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted"
              >
                File
              </label>
              <input
                id="tender-document-file"
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-text-muted file:ring-1 file:ring-border-subtle"
              />
            </div>

            <div>
              <label
                htmlFor="tender-document-type"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted"
              >
                Type
              </label>
              <select
                id="tender-document-type"
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                className="rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold"
              >
                {DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {DOCUMENT_TYPE_LABELS[t]}
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

      {documents.length === 0 ? (
        <EmptyState
          title="No documents uploaded"
          description={
            readOnly
              ? 'The Tender department has not uploaded any documents for this tender.'
              : 'Upload the submitted tender, supporting documents, or an award letter.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-brand-slate">{doc.file_name}</p>
                  {doc.document_type && (
                    <Badge className="bg-surface-bg text-text-muted ring-border-subtle">
                      {DOCUMENT_TYPE_LABELS[doc.document_type] ?? doc.document_type}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-text-muted">
                  {doc.uploader?.full_name ?? 'Unknown'} · {formatDateTime(doc.created_at)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => download(doc)}
                  disabled={downloading === doc.id}
                  className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg disabled:opacity-60"
                >
                  {downloading === doc.id ? 'Preparing…' : 'Download'}
                </button>
                {!readOnly && (
                  <button
                    onClick={() => setConfirmDelete(doc)}
                    className="rounded-lg border border-status-danger/25 px-3 py-1.5 text-xs font-medium text-status-danger transition-colors hover:bg-status-danger/5"
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-slate/50 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
            <h3 className="text-sm font-semibold text-brand-slate">Delete this document?</h3>
            <p className="mt-2 text-sm text-text-muted">
              {confirmDelete.file_name} will be removed from storage. This cannot be undone — the
              deletion itself stays in the audit log.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text-muted hover:bg-surface-bg"
              >
                Cancel
              </button>
              <button
                onClick={remove}
                disabled={deleting}
                className="rounded-lg bg-status-danger px-3 py-1.5 text-sm font-medium text-white hover:bg-status-danger disabled:opacity-60"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
