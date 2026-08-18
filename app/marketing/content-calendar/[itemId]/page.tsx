import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card, CardHeader, Badge } from '@/components/ui/primitives'
import { ContentStatusControl } from '@/components/marketing/ContentStatusControl'
import { AssetManager } from '@/components/marketing/AssetManager'
import { getContentItemDetail } from '@/lib/marketing/dashboard'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { formatDate, CONTENT_TYPE_LABELS } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * A content item's detail — status progression, caption draft, and the asset library.
 * A "Log lead" link lets an organic post that pulled in an inquiry hand it to Sales,
 * pre-tagged to this item (§3.4 allows the handoff from content, not just campaigns).
 */
export default async function ContentItemDetailPage(
  props: PageProps<'/marketing/content-calendar/[itemId]'>
) {
  const user = await requireDepartment(MARKETING_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)
  const { itemId } = await props.params

  const item = await getContentItemDetail(itemId)
  if (!item) notFound()

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link
          href="/marketing/content-calendar"
          className="text-xs text-text-muted hover:text-brand-slate"
        >
          ← Back to calendar
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-brand-slate">{item.title}</h1>
            <p className="mt-1 flex items-center gap-2 text-sm text-text-muted">
              <Badge className="bg-surface-bg text-text-muted ring-border-subtle">
                {CONTENT_TYPE_LABELS[item.content_type] ?? item.content_type}
              </Badge>
              <span>{item.platform}</span>
              <span>· {formatDate(item.scheduled_date)}</span>
              {item.assignee?.full_name && <span>· {item.assignee.full_name}</span>}
            </p>
          </div>
          {!readOnly && (
            <Link
              href={`/marketing/campaigns/log-lead?content_calendar_item_id=${item.id}`}
              className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm font-medium text-brand-slate transition-colors hover:border-brand-gold hover:text-brand-gold"
            >
              Log lead from this
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <AssetManager itemId={item.id} assets={item.assets} readOnly={readOnly} />
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <ContentStatusControl itemId={item.id} current={item.status} disabled={readOnly} />
          </Card>

          <Card>
            <CardHeader title="Caption draft" />
            <div className="px-5 py-4">
              {item.caption_draft ? (
                <p className="whitespace-pre-wrap text-sm text-brand-slate">{item.caption_draft}</p>
              ) : (
                <p className="text-sm text-text-muted">No caption drafted yet.</p>
              )}
            </div>
          </Card>

          {item.notes && (
            <Card>
              <CardHeader title="Notes" />
              <div className="px-5 py-4">
                <p className="whitespace-pre-wrap text-sm text-brand-slate">{item.notes}</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
