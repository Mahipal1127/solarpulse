'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'

/**
 * Opens a report's attachment through a short-lived signed URL.
 *
 * A client component because the link cannot be rendered server-side: minting it is a
 * POST that audits the access, and a URL baked into the HTML would be a bearer token
 * sitting in the page for its whole five-minute life whether or not anyone clicked it.
 *
 * EmployeeReportBoard has its own copy of this call rather than using this component,
 * because there the failure belongs in the form's shared error banner. Here the button is
 * alone on the row and owns its own message.
 */
export function ReportAttachmentButton({
  reportId,
  fileName,
}: {
  reportId: string
  fileName: string | null
}) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function open() {
    setOpening(true)
    setError(null)

    const res = await fetch(`/api/employee-reports/${reportId}/attachment`, { method: 'POST' })
    setOpening(false)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not open that attachment.')
      return
    }

    const { url } = await res.json()
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={open}
        disabled={opening}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-slate hover:underline disabled:opacity-60"
      >
        <Download className="h-3.5 w-3.5" />
        {opening ? 'Opening…' : fileName ?? 'Attachment'}
      </button>
      {error && <span className="text-xs text-status-danger">{error}</span>}
    </span>
  )
}
