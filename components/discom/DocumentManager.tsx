'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { EmptyState, Badge } from '@/components/ui/primitives'
import { formatDateTime, GOVERNMENT_DOCUMENT_TYPE_LABELS } from '@/lib/format'
import {
  GOVERNMENT_DOCUMENT_TYPES,
  DISCOM_DOCUMENTS_BUCKET,
  MAX_UPLOAD_BYTES,
} from '@/lib/discom/constants'
import type { GovernmentDocumentRow } from '@/lib/discom/dashboard'
import type { CaseOption } from '@/lib/discom/queries'
import type { GovernmentDocumentType } from '@/lib/types'

const MAX_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))

/**
 * The government-document library — the same two-step private-bucket flow the survey
 * and installation modules use. The browser pushes the file into discom-documents at
 * '{org}/{customer}/{file}' (the storage policy re-checks the org from the path),
 * then this records the metadata row and audits it. Every download mints a fresh
 * short-lived signed URL, and each is logged as sensitive access — these are consumer
 * ID proofs and bank passbooks, not public files.
 *
 * A document must attach to a case (net-metering application or subsidy case); the
 * picker carries the customer_id the storage path needs. When the page is opened from
 * a case deep link, `lockedCase` pins it and the picker is hidden.
 */
export function DocumentManager({
  organizationId,
  documents,
  cases,
  lockedCase,
  readOnly,
}: {
  organizationId: string
  documents: GovernmentDocumentRow[]
  cases: CaseOption[]
  lockedCase?: CaseOption
  readOnly: boolean
}) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [docType, setDocType] = useState<GovernmentDocumentType>(GOVERNMENT_DOCUMENT_TYPES[0])
  const [caseKey, setCaseKey] = useState<string>(
    lockedCase ? `${lockedCase.kind}:${lockedCase.id}` : ''
  )
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const selectedCase = lockedCase ?? cases.find((c) => `${c.kind}:${c.id}` === caseKey)

  async function upload() {
    if (!file) return
    if (!selectedCase) {
      setError('Pick the case this document belongs to.')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`That file is larger than ${MAX_MB} MB. Upload a smaller file.`)
      return
    }

    setUploading(true)
    setError(null)

    const supabase = createClient()
    // Path is '{org}/{customer}/{file}': the storage policy reads the org from the
    // first segment to decide whether this user may write here.
    const path = `${organizationId}/${selectedCase.customer_id}/${crypto.randomUUID()}-${file.name}`

    const { error: uploadError } = await supabase.storage
      .from(DISCOM_DOCUMENTS_BUCKET)
      .upload(path, file)

    if (uploadError) {
      setUploading(false)
      setError(uploadError.message)
      return
    }

    const res = await fetch('/api/discom-documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document_type: docType,
        file_path: path,
        file_name: file.name,
        net_metering_application_id:
          selectedCase.kind === 'net_metering' ? selectedCase.id : null,
        subsidy_case_id: selectedCase.kind === 'subsidy' ? selectedCase.id : null,
      }),
    })

    setUploading(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      // Object landed but the row did not — remove the orphan.
      await supabase.storage.from(DISCOM_DOCUMENTS_BUCKET).remove([path])
      setError(body.error ?? 'Could not record the document.')
      return
    }

    setFile(null)
    router.refresh()
  }

  async function open(doc: GovernmentDocumentRow) {
    setOpening(doc.id)
    setError(null)

    const res = await fetch(`/api/discom-documents?documentId=${doc.id}`)
    setOpening(null)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not generate a link.')
      return
    }

    const { url } = await res.json()
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  async function remove(doc: GovernmentDocumentRow) {
    setDeleting(doc.id)
    setError(null)

    const res = await fetch(`/api/discom-documents?documentId=${doc.id}`, { method: 'DELETE' })
    setDeleting(null)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not remove the document.')
      return
    }

    router.refresh()
  }

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-card">
      <div className="border-b border-border-subtle px-5 py-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-brand-slate">
          <FileText className="h-4 w-4 text-text-muted/60" />
          Government documents
        </h2>
        <p className="mt-0.5 text-xs text-text-muted">
          Private bucket. Every view goes through a short-lived signed link and is logged — these
          are personal documents.
        </p>
      </div>

      {!readOnly && (
        <div className="border-b border-border-subtle bg-surface-bg px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {!lockedCase && (
              <div className="sm:col-span-2">
                <label
                  htmlFor="doc-case"
                  className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted"
                >
                  Case
                </label>
                <select
                  id="doc-case"
                  value={caseKey}
                  onChange={(e) => setCaseKey(e.target.value)}
                  className="w-full rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold"
                >
                  <option value="">Select the case…</option>
                  {cases.map((c) => (
                    <option key={`${c.kind}:${c.id}`} value={`${c.kind}:${c.id}`}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label
                htmlFor="doc-type"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted"
              >
                Type
              </label>
              <select
                id="doc-type"
                value={docType}
                onChange={(e) => setDocType(e.target.value as GovernmentDocumentType)}
                className="w-full rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold"
              >
                {GOVERNMENT_DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {GOVERNMENT_DOCUMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="doc-file"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted"
              >
                File
              </label>
              <input
                id="doc-file"
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
            {uploading ? 'Uploading…' : 'Upload document'}
          </button>
        </div>
      )}

      {error && (
        <p className="border-b border-status-danger/15 bg-status-danger/5 px-5 py-2.5 text-xs text-status-danger">
          ⚠ {error}
        </p>
      )}

      {documents.length === 0 ? (
        <EmptyState
          title="No documents yet"
          description={
            readOnly
              ? 'No government documents have been uploaded.'
              : 'Consumer ID proofs, electricity bills, sanction letters and the rest.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-brand-slate">{doc.file_name}</p>
                  <Badge className="bg-surface-bg text-text-muted ring-border-subtle">
                    {GOVERNMENT_DOCUMENT_TYPE_LABELS[doc.document_type as GovernmentDocumentType] ??
                      doc.document_type}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-text-muted">
                  {doc.uploader?.full_name ?? 'Unknown'} · {formatDateTime(doc.created_at)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => open(doc)}
                  disabled={opening === doc.id}
                  className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg disabled:opacity-60"
                >
                  {opening === doc.id ? 'Preparing…' : 'View'}
                </button>
                {!readOnly && (
                  <button
                    onClick={() => remove(doc)}
                    disabled={deleting === doc.id}
                    className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-status-danger hover:text-status-danger disabled:opacity-60"
                  >
                    {deleting === doc.id ? 'Removing…' : 'Remove'}
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
