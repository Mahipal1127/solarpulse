import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card, Badge } from '@/components/ui/primitives'
import { TicketControls } from '@/components/om/ServiceTicketQueue/TicketControls'
import { ServiceReportSection } from '@/components/om/ServiceTicketQueue/ServiceReportSection'
import { getServiceTicketDetail, getOMEmployees } from '@/lib/om/dashboard'
import { OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import {
  formatDateTime,
  daysSince,
  SERVICE_TICKET_STATUS_STYLES,
  SERVICE_TICKET_STATUS_LABELS,
  SERVICE_PRIORITY_STYLES,
  SERVICE_PRIORITY_LABELS,
  SERVICE_TICKET_OPEN_STATUSES,
  formatIssueType,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function ServiceTicketDetailPage(
  props: PageProps<'/om/service/[ticketId]'>
) {
  const user = await requireDepartment(OM_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, OM_DEPARTMENT_SLUG)
  const { ticketId } = await props.params

  const [ticket, roster] = await Promise.all([
    getServiceTicketDetail(ticketId),
    getOMEmployees(user.organization_id),
  ])

  // RLS decides visibility — a ticket the caller cannot see 404s rather than 403s.
  if (!ticket) notFound()

  const open = SERVICE_TICKET_OPEN_STATUSES.includes(ticket.status)
  const hasReport = ticket.reports.length > 0

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <Link href="/om/service" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to service
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-brand-slate">
                {ticket.customer?.name ?? 'Unknown customer'}
              </h1>
              <Badge className={SERVICE_PRIORITY_STYLES[ticket.priority]}>
                {SERVICE_PRIORITY_LABELS[ticket.priority]}
              </Badge>
              <Badge className={SERVICE_TICKET_STATUS_STYLES[ticket.status]}>
                {SERVICE_TICKET_STATUS_LABELS[ticket.status]}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-text-muted">
              {ticket.issue_type ? `${formatIssueType(ticket.issue_type)} · ` : ''}
              Logged {formatDateTime(ticket.created_at)} · {daysSince(ticket.created_at)} days open
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="border-b border-border-subtle px-5 py-4">
            <h2 className="text-sm font-semibold text-brand-slate">Complaint</h2>
          </div>
          <div className="space-y-4 px-5 py-4">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-brand-slate">
              {ticket.description}
            </p>
            {ticket.installation && (
              <p className="text-xs text-text-muted">
                Linked installation:{' '}
                <Link
                  href={`/om/installations/${ticket.installation.id}`}
                  className="text-brand-gold hover:underline"
                >
                  {ticket.installation.address ?? 'View site'}
                </Link>
              </p>
            )}
          </div>
        </Card>

        <Card>
          <div className="border-b border-border-subtle px-5 py-4">
            <h2 className="text-sm font-semibold text-brand-slate">Manage</h2>
          </div>
          <div className="px-5 py-4">
            {readOnly ? (
              <p className="text-xs text-text-muted">
                Only the Operations &amp; Maintenance department can work this ticket.
              </p>
            ) : (
              <TicketControls
                ticketId={ticketId}
                status={ticket.status}
                priority={ticket.priority}
                assignedTo={ticket.assigned_to}
                roster={roster}
                hasReport={hasReport}
              />
            )}
          </div>
        </Card>
      </div>

      <ServiceReportSection
        ticketId={ticketId}
        reports={ticket.reports}
        canResolve={open}
        readOnly={readOnly}
      />
    </div>
  )
}
