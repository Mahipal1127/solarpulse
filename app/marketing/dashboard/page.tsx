import Link from 'next/link'
import { requireDepartment } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, CardHeader, StatCard, Badge } from '@/components/ui/primitives'
import { SEGMENT_TRACK, segmentClass } from '@/components/shared/chrome'
import { MyTaskBoard, type AssignedTask } from '@/components/employee/MyTaskBoard'
import { DepartmentTaskInbox } from '@/components/shared/DepartmentTaskInbox'
import { InsightFeed } from '@/components/marketing/InsightFeed'
import {
  getContentItems,
  getCampaigns,
  getInsights,
  getMarketingEmployees,
  getMarketingDepartmentId,
  getUnownedMarketingTasks,
  type ContentItemRow,
  type CampaignRow,
  type InsightRow,
} from '@/lib/marketing/dashboard'
import { MARKETING_DEPARTMENT_SLUG, isMarketingLead } from '@/lib/services/marketing'
import {
  formatDate,
  isOverdue,
  formatCurrency,
  formatCostPerLead,
  CONTENT_STATUS_STYLES,
  CONTENT_STATUS_LABELS,
  CAMPAIGN_STATUS_STYLES,
  CAMPAIGN_STATUS_LABELS,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

const TASK_SELECT =
  '*, department:departments!tasks_assigned_department_id_fkey(name), creator:users!tasks_created_by_fkey(full_name)'

/** 'YYYY-MM-DD' n days from today, string math to avoid tz drift. */
function isoPlusDays(days: number): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * A Marketing person's day, with the lead's/CEO's department view behind a ?tab=team
 * toggle — the one-page/two-audience shape every module uses.
 *
 * Every "mine" narrowing is a display choice, never a permission: RLS already returned
 * only what each caller may see. An employee filtering to their own content and
 * campaigns is answering "what's on my plate", not hiding a colleague's work.
 */
export default async function MarketingDashboardPage(props: PageProps<'/marketing/dashboard'>) {
  const user = await requireDepartment(MARKETING_DEPARTMENT_SLUG)
  const searchParams = await props.searchParams

  const lead = isMarketingLead(user)
  const seesTeam = lead || user.roleName === 'CEO'
  const tab = asString(searchParams.tab) === 'team' && seesTeam ? 'team' : 'mine'

  const supabase = await createSupabaseServerClient()

  const [content, campaigns, insights, taskResult] = await Promise.all([
    getContentItems(user.organization_id),
    getCampaigns(user.organization_id),
    getInsights(user.organization_id, { limit: 5 }),
    supabase
      .from('tasks')
      .select(TASK_SELECT)
      .eq('assigned_user_id', user.id)
      .neq('status', 'archived')
      .order('due_date', { ascending: true, nullsFirst: false }),
  ])

  const myTasks = (taskResult.data ?? []) as unknown as AssignedTask[]

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">
            {tab === 'team' ? 'Department overview' : `Welcome back, ${firstName(user.full_name)}`}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {tab === 'team'
              ? 'All content, campaigns and insights across Marketing & Training.'
              : 'Your content due, your campaigns and what needs posting today.'}
          </p>
        </div>

        {seesTeam && (
          <div className={SEGMENT_TRACK}>
            <TabLink href="/marketing/dashboard" active={tab === 'mine'} label="My work" />
            <TabLink href="/marketing/dashboard?tab=team" active={tab === 'team'} label="Department" />
          </div>
        )}
      </header>

      {tab === 'team' ? (
        <TeamView
          organizationId={user.organization_id}
          content={content}
          campaigns={campaigns}
          insights={insights}
          canDelegate={lead}
        />
      ) : (
        <MyWork
          userId={user.id}
          content={content}
          campaigns={campaigns}
          insights={insights}
          tasks={myTasks}
        />
      )}
    </div>
  )
}

/** The personal view — §3.1. Also a lead's "My work" tab. */
function MyWork({
  userId,
  content,
  campaigns,
  insights,
  tasks,
}: {
  userId: string
  content: ContentItemRow[]
  campaigns: CampaignRow[]
  insights: InsightRow[]
  tasks: AssignedTask[]
}) {
  const weekEnd = isoPlusDays(7)

  const myContent = content.filter((c) => c.assigned_to === userId)
  // Next 7 days (or already overdue and unsettled), soonest first — the daily reminder.
  const dueSoon = myContent
    .filter((c) => c.scheduled_date <= weekEnd)
    .filter((c) => c.needsAttention || c.scheduled_date >= isoPlusDays(0))
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
  const needsAttention = myContent.filter((c) => c.needsAttention)

  const myCampaigns = campaigns.filter((c) => c.managed_by === userId)
  const spend = myCampaigns.reduce((sum, c) => sum + c.amount_spent, 0)
  const leads = myCampaigns.reduce((sum, c) => sum + c.leads_generated, 0)

  const openTasks = tasks.filter((t) => t.status !== 'completed').length
  const overdueTasks = tasks.filter(isOverdue).length

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Due to Post"
          value={needsAttention.length}
          tone={needsAttention.length > 0 ? 'warning' : 'default'}
          hint={needsAttention.length > 0 ? 'Scheduled and not yet posted' : 'All caught up'}
        />
        <StatCard label="My Campaigns" value={myCampaigns.length} hint={`${formatCurrency(spend)} spent`} />
        <StatCard
          label="Leads Generated"
          value={leads}
          tone="brand"
          hint={formatCostPerLead(spend, leads)}
        />
        <StatCard
          label="My Tasks"
          value={openTasks}
          tone={overdueTasks > 0 ? 'warning' : 'default'}
          hint={overdueTasks > 0 ? `${overdueTasks} past due` : 'Assigned by the CEO'}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="My content this week"
            subtitle="Scheduled in the next 7 days. Items due and not yet posted are flagged."
            action={
              <Link
                href="/marketing/content-calendar"
                className="text-xs font-medium text-brand-slate hover:text-brand-gold"
              >
                Calendar →
              </Link>
            }
          />
          <ContentMiniList items={dueSoon} emptyText="Nothing of yours is due in the next 7 days." />
        </Card>

        <Card>
          <CardHeader
            title="My campaigns"
            subtitle="Cost per lead updates as spend and leads come in"
            action={
              <Link
                href="/marketing/campaigns"
                className="text-xs font-medium text-brand-slate hover:text-brand-gold"
              >
                All →
              </Link>
            }
          />
          <CampaignMiniList items={myCampaigns} emptyText="No campaigns assigned to you." />
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Recent AI insights"
          subtitle="From the AI Marketing Officer. Acknowledge the ones you've actioned."
          action={
            <Link
              href="/marketing/insights"
              className="text-xs font-medium text-brand-slate hover:text-brand-gold"
            >
              All →
            </Link>
          }
        />
        <div className="px-5 py-4">
          <InsightFeed insights={insights} />
        </div>
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-brand-slate">My assigned tasks</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Assigned by the CEO. Progress updates save live and are visible to them immediately.
          </p>
        </div>
        <MyTaskBoard initialTasks={tasks} userId={userId} />
      </section>
    </>
  )
}

/** The lead's and CEO's view — the department, and work waiting to be handed out. */
async function TeamView({
  organizationId,
  content,
  campaigns,
  insights,
  canDelegate,
}: {
  organizationId: string
  content: ContentItemRow[]
  campaigns: CampaignRow[]
  insights: InsightRow[]
  canDelegate: boolean
}) {
  const departmentId = await getMarketingDepartmentId(organizationId)

  const [employees, unownedTasks] = await Promise.all([
    getMarketingEmployees(organizationId),
    getUnownedMarketingTasks(organizationId, departmentId),
  ])

  const inboxTasks = unownedTasks as unknown as AssignedTask[]

  const needsAttention = content.filter((c) => c.needsAttention)
  const activeCampaigns = campaigns.filter((c) => c.status === 'active')
  const spend = campaigns.reduce((sum, c) => sum + c.amount_spent, 0)
  const leads = campaigns.reduce((sum, c) => sum + c.leads_generated, 0)

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Content Due"
          value={needsAttention.length}
          tone={needsAttention.length > 0 ? 'warning' : 'default'}
          hint="Scheduled, not yet posted"
        />
        <StatCard label="Active Campaigns" value={activeCampaigns.length} hint={`${formatCurrency(spend)} spent`} />
        <StatCard
          label="Leads Generated"
          value={leads}
          tone="brand"
          hint={formatCostPerLead(spend, leads)}
        />
        <StatCard
          label="Awaiting Delegation"
          value={inboxTasks.length}
          tone={inboxTasks.length > 0 ? 'warning' : 'default'}
          hint="CEO tasks with no owner"
        />
      </div>

      {canDelegate && (
        <Card>
          <CardHeader
            title="Tasks awaiting delegation"
            subtitle="Assigned to Marketing & Training without a named owner. Delegating moves it to that person's dashboard."
          />
          <DepartmentTaskInbox
            tasks={inboxTasks}
            employees={employees}
            departmentName="Marketing & Training"
          />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Content needing attention"
            subtitle="Due and not yet posted, across the department"
            action={
              <Link
                href="/marketing/content-calendar"
                className="text-xs font-medium text-brand-slate hover:text-brand-gold"
              >
                Calendar →
              </Link>
            }
          />
          <ContentMiniList
            items={needsAttention}
            emptyText="Nothing overdue — the calendar is on track."
          />
        </Card>

        <Card>
          <CardHeader
            title="Active campaigns"
            subtitle="Running now, with cost per lead"
            action={
              <Link
                href="/marketing/campaigns"
                className="text-xs font-medium text-brand-slate hover:text-brand-gold"
              >
                All →
              </Link>
            }
          />
          <CampaignMiniList items={activeCampaigns} emptyText="No active campaigns right now." />
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Recent AI insights"
          subtitle="From the AI Marketing Officer"
          action={
            <Link
              href="/marketing/insights"
              className="text-xs font-medium text-brand-slate hover:text-brand-gold"
            >
              All →
            </Link>
          }
        />
        <div className="px-5 py-4">
          <InsightFeed insights={insights} />
        </div>
      </Card>
    </>
  )
}

function ContentMiniList({ items, emptyText }: { items: ContentItemRow[]; emptyText: string }) {
  if (items.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-text-muted">{emptyText}</p>
  }
  return (
    <ul className="divide-y divide-border-subtle">
      {items.slice(0, 6).map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0 flex-1">
            <Link
              href={`/marketing/content-calendar/${c.id}`}
              className="block truncate text-sm font-medium text-brand-slate hover:text-brand-gold"
            >
              {c.title}
            </Link>
            <p className="text-xs text-text-muted">
              {formatDate(c.scheduled_date)}
              {c.needsAttention && <span className="ml-1 text-status-warning">· due</span>}
            </p>
          </div>
          <Badge className={CONTENT_STATUS_STYLES[c.status]}>{CONTENT_STATUS_LABELS[c.status]}</Badge>
        </li>
      ))}
    </ul>
  )
}

function CampaignMiniList({ items, emptyText }: { items: CampaignRow[]; emptyText: string }) {
  if (items.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-text-muted">{emptyText}</p>
  }
  return (
    <ul className="divide-y divide-border-subtle">
      {items.slice(0, 6).map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0 flex-1">
            <Link
              href={`/marketing/campaigns/${c.id}`}
              className="block truncate text-sm font-medium text-brand-slate hover:text-brand-gold"
            >
              {c.name}
            </Link>
            <p className="text-xs text-text-muted">
              {formatCostPerLead(c.amount_spent, c.leads_generated)} · {c.leads_generated} leads
            </p>
          </div>
          <Badge className={CAMPAIGN_STATUS_STYLES[c.status]}>{CAMPAIGN_STATUS_LABELS[c.status]}</Badge>
        </li>
      ))}
    </ul>
  )
}

function TabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={segmentClass(active)}>
      {label}
    </Link>
  )
}

function firstName(fullName: string): string {
  return fullName.split(' ')[0] || fullName
}

function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
