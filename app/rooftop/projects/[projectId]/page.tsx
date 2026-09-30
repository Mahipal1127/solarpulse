import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card, CardHeader, Badge } from '@/components/ui/primitives'
import { ProjectStatusControl } from '@/components/rooftop/ProjectStatusControl'
import { AddUpdateForm } from '@/components/rooftop/AddUpdateForm'
import { getRooftopProject, ServiceError, ROOFTOP_DEPARTMENT_SLUG } from '@/lib/services/rooftop'
import {
  formatDateTime,
  ROOFTOP_STATUS_STYLES,
  ROOFTOP_STATUS_LABELS,
  ROOFTOP_UPDATE_KIND_STYLES,
  ROOFTOP_UPDATE_KIND_LABELS,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * One customer site: the customer on one side, the site on the other, the
 * status up top with the moves the server will actually accept, and the
 * site's work log underneath. This page is the module's reason to exist —
 * "what is happening at customer X's site, and who do I call".
 */
export default async function RooftopProjectDetailPage(
  props: PageProps<'/rooftop/projects/[projectId]'>
) {
  const user = await requireDepartment(ROOFTOP_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, ROOFTOP_DEPARTMENT_SLUG)
  const { projectId } = await props.params

  let project, updates
  try {
    ;({ project, updates } = await getRooftopProject(user, projectId))
  } catch (err) {
    if (err instanceof ServiceError && err.status === 404) notFound()
    throw err
  }

  const customer = project.customer

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="truncate text-2xl font-semibold text-brand-slate">
              {customer?.name ?? 'Unknown customer'}
            </h1>
            <Badge className={ROOFTOP_STATUS_STYLES[project.status]}>
              {ROOFTOP_STATUS_LABELS[project.status]}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            {[project.site_address, project.site_city, project.site_state, project.site_pincode]
              .filter(Boolean)
              .join(', ')}
          </p>
        </div>
        <ProjectStatusControl
          projectId={project.id}
          currentStatus={project.status}
          disabled={readOnly}
        />
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Customer" subtitle="Who the site belongs to" />
          <dl className="space-y-3 px-5 py-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">Name</dt>
              <dd className="text-right font-medium text-brand-slate">{customer?.name ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">Phone</dt>
              <dd className="text-right font-medium text-brand-slate">
                {customer?.phone ? (
                  <a href={`tel:${customer.phone}`} className="hover:text-brand-gold">
                    {customer.phone}
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">Email</dt>
              <dd className="text-right font-medium text-brand-slate">
                {customer?.email ? (
                  <a href={`mailto:${customer.email}`} className="hover:text-brand-gold">
                    {customer.email}
                  </a>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="shrink-0 text-text-muted">Customer address</dt>
              <dd className="text-right text-brand-slate">{customer?.address || '—'}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Site" subtitle="Where the work is happening" />
          <dl className="space-y-3 px-5 py-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">Address</dt>
              <dd className="text-right text-brand-slate">{project.site_address}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">City / State</dt>
              <dd className="text-right font-medium text-brand-slate">
                {[project.site_city, project.site_state].filter(Boolean).join(', ') || '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">Pincode</dt>
              <dd className="text-right font-medium text-brand-slate">
                {project.site_pincode || '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">Capacity</dt>
              <dd className="text-right font-medium text-brand-slate">
                {project.capacity_kw != null
                  ? `${Number(project.capacity_kw).toLocaleString('en-IN')} kW`
                  : '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">Go-live</dt>
              <dd className="text-right font-medium text-brand-slate">
                {project.go_live_date ?? '—'}
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      {project.notes && (
        <Card>
          <CardHeader title="Notes" />
          <p className="whitespace-pre-line px-5 py-4 text-sm text-text-muted">{project.notes}</p>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Site log"
          subtitle="What happened here, newest first"
          action={
            <Link
              href="/rooftop/projects"
              className="text-sm font-medium text-brand-gold hover:underline"
            >
              All sites
            </Link>
          }
        />

        {!readOnly && (
          <div className="border-b border-border-subtle px-5 py-4">
            <AddUpdateForm projectId={project.id} />
          </div>
        )}

        {updates.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-text-muted">
            Nothing logged for this site yet.
          </p>
        ) : (
          <ol className="divide-y divide-border-subtle">
            {updates.map((u) => (
              <li key={u.id} className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-brand-slate">
                    {u.author?.full_name ?? 'Unknown'}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge className={ROOFTOP_UPDATE_KIND_STYLES[u.kind]}>
                      {ROOFTOP_UPDATE_KIND_LABELS[u.kind]}
                    </Badge>
                    <span className="text-xs text-text-muted">{formatDateTime(u.created_at)}</span>
                  </div>
                </div>
                <p className="mt-1 whitespace-pre-line text-sm text-text-muted">{u.note}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  )
}

