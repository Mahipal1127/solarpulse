'use client'

import { useState } from 'react'
import { EmptyState } from '@/components/ui/primitives'
import { EMPLOYEE_DOCUMENT_TYPE_LABELS } from '@/lib/format'
import type { EmployeeDocument, EmployeeDocumentType } from '@/lib/types'

/**
 * Lists an employee's documents. File bytes never ship with the page — each row mints a short-lived
 * signed URL on click through /api/employee-documents/[id], which is RLS-gated and logs sensitive
 * types server-side. So a document the caller cannot reach simply fails to open; nothing is
 * pre-exposed. Opening in a new tab (rather than forcing a download) lets the browser preview PDFs
 * and images inline while still respecting the signed URL's TTL.
 */
export function DocumentsTab({ documents }: { documents: EmployeeDocument[] }) {
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function open(id: string) {
    setOpeningId(id)
    setError(null)
    const res = await fetch(`/api/employee-documents/${id}`)
    setOpeningId(null)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not open the document.')
      return
    }
    const { url } = (await res.json()) as { url: string }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  if (documents.length === 0) {
    return <EmptyState title="No documents" description="Uploaded documents appear here." />
  }

  return (
    <div className="space-y-3">
      <div className="divide-y divide-border-subtle">
        {documents.map((doc) => (
          <div key={doc.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-brand-slate">
                {doc.file_name ?? 'Document'}
              </p>
              <p className="mt-0.5 text-xs text-text-muted">
                {EMPLOYEE_DOCUMENT_TYPE_LABELS[doc.document_type as EmployeeDocumentType] ??
                  doc.document_type}
                {doc.created_at ? ` · ${new Date(doc.created_at).toLocaleDateString()}` : ''}
              </p>
            </div>
            <button
              onClick={() => open(doc.id)}
              disabled={openingId !== null}
              className="shrink-0 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-brand-slate transition-colors hover:border-brand-gold disabled:opacity-60"
            >
              {openingId === doc.id ? 'Opening…' : 'Open'}
            </button>
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
    </div>
  )
}
