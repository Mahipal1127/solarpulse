import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  APPLICATION_RECIPIENT_LABELS,
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_STYLES,
  formatDate,
} from '@/lib/format'
import { ApplicationStatusControl } from '@/components/shared/ApplicationStatusControl'
import type { ApplicationWithEmployee } from '@/lib/services/applications'

/**
 * The HR / CEO inbox of free-text applications. Server component — it renders the rows the
 * addressed side is allowed to see (the service already filtered by recipient and RLS
 * scoped by org), and mounts the client status control per row. `showRecipient` adds the
 * recipient column when both an HR and a CEO copy could appear ('both'); a single-audience
 * inbox can hide it.
 */
export function ApplicationsInbox({
  applications,
  showRecipient = true,
}: {
  applications: ApplicationWithEmployee[]
  showRecipient?: boolean
}) {
  if (applications.length === 0) {
    return (
      <EmptyState
        title="No applications"
        description="Applications employees send here will appear in this list."
      />
    )
  }

  return (
    <div className="divide-y divide-border-subtle">
      {applications.map((a) => (
        <div key={a.id} className="px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-brand-slate">{a.subject}</span>
                <Badge className={APPLICATION_STATUS_STYLES[a.status]}>
                  {APPLICATION_STATUS_LABELS[a.status]}
                </Badge>
                {showRecipient && (
                  <span className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
                    → {APPLICATION_RECIPIENT_LABELS[a.recipient]}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-text-muted">
                {a.employee?.full_name ?? '—'} · {formatDate(a.created_at)}
              </p>
            </div>
            <ApplicationStatusControl applicationId={a.id} status={a.status} />
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm text-brand-slate">{a.body}</p>
        </div>
      ))}
    </div>
  )
}
