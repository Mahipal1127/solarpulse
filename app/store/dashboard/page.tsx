import Link from 'next/link'
import { requireDepartment } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { STORE_DEPARTMENT_SLUG, isStoreLead } from '@/lib/store/constants'
import {
  getStoreDashboardStats,
  getLowStockLevels,
  getRecentMovementsByUser,
  getStoreDepartmentId,
  getStoreEmployees,
  getUnownedStoreTasks,
} from '@/lib/store/dashboard'
import { Card, CardHeader, StatCard, Badge, EmptyState } from '@/components/ui/primitives'
import { MyTaskBoard, type AssignedTask } from '@/components/employee/MyTaskBoard'
import { DepartmentTaskInbox } from '@/components/shared/DepartmentTaskInbox'
import { PulseAIPanel } from '@/components/shared/PulseAIPanel'
import {
  STOCK_MOVEMENT_TYPE_LABELS,
  STOCK_MOVEMENT_TYPE_STYLES,
  formatDateTime,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

const TASK_SELECT =
  '*, department:departments!tasks_assigned_department_id_fkey(name), creator:users!tasks_created_by_fkey(full_name)'

/**
 * The Store home. Low-stock alerts (the operational front line — flag only, never auto-orders),
 * the person's own recent movements and assigned tasks, and a department-wide open-facility
 * count. A lead additionally gets the delegation inbox for Store-wide tasks with no named owner
 * — common here because stock work is often not owned by one person, so the CEO assigns to the
 * department rather than an individual.
 *
 * No My-work/Team toggle: this module's RLS is department-wide, so a lead already sees what an
 * executive sees. The distinction is kept light, matching the access model (0017).
 */
export default async function StoreDashboardPage() {
  const user = await requireDepartment(STORE_DEPARTMENT_SLUG)
  const lead = isStoreLead(user)
  const supabase = await createSupabaseServerClient()

  const [stats, lowStock, myMovements, taskResult] = await Promise.all([
    getStoreDashboardStats(),
    getLowStockLevels(),
    getRecentMovementsByUser(user.id, 6),
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
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">
          Welcome back, {firstName(user.full_name)}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Inventory, stock movements, and the warehouse floor.
        </p>
      </header>

      <PulseAIPanel user={user} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Items tracked" value={stats.totalItems} tone="brand" />
        <StatCard
          label="Low stock"
          value={stats.lowStockCount}
          hint="At or below reorder level"
          tone={stats.lowStockCount > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Open facility issues"
          value={stats.openFacilityIssues}
          tone={stats.openFacilityIssues > 0 ? 'warning' : 'default'}
        />
        <StatCard label="My open tasks" value={myTasks.length} />
      </div>

      <Card>
        <CardHeader
          title="Low stock alerts"
          subtitle="Items at or below their reorder threshold. Flag only — raising a purchase order is a decision, not automatic."
          action={
            <Link
              href="/store/inventory"
              className="text-xs font-medium text-brand-slate hover:text-brand-gold"
            >
              All inventory →
            </Link>
          }
        />
        {lowStock.length === 0 ? (
          <EmptyState
            title="Everything's stocked"
            description="No item is at or below its reorder threshold."
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {lowStock.map((level) => {
              // How far below threshold, to escalate colour: at/near threshold is a warning,
              // out of stock (or negative via corrections) is danger.
              const critical = level.current_quantity <= 0
              return (
                <li
                  key={level.inventory_item_id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/store/inventory/${level.inventory_item_id}`}
                      className="truncate text-sm font-medium text-brand-slate hover:text-brand-gold"
                    >
                      {level.name}
                    </Link>
                    <p className="text-xs text-text-muted">
                      Reorder at {level.reorder_threshold} {level.unit}
                      {level.rack_location ? ` · ${level.rack_location}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-sm font-semibold tabular-nums ${
                        critical ? 'text-status-danger' : 'text-status-warning'
                      }`}
                    >
                      {level.current_quantity} {level.unit}
                    </span>
                    <Badge className={critical ? 'badge-danger' : 'badge-warning'}>
                      {critical ? 'Out of stock' : 'Low'}
                    </Badge>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {lead && <DelegationInbox organizationId={user.organization_id} />}

      <Card>
        <CardHeader
          title="My recent movements"
          subtitle="The stock changes you logged, newest first."
          action={
            <Link
              href="/store/stock-movements"
              className="text-xs font-medium text-brand-slate hover:text-brand-gold"
            >
              Full log →
            </Link>
          }
        />
        {myMovements.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-text-muted">
            You haven&apos;t logged any movements yet.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {myMovements.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-brand-slate">
                    {m.item?.name ?? 'Unknown item'}
                  </p>
                  <p className="text-xs text-text-muted">{formatDateTime(m.created_at)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold tabular-nums text-brand-slate">
                    {m.quantity} {m.item?.unit ?? ''}
                  </span>
                  <Badge className={STOCK_MOVEMENT_TYPE_STYLES[m.movement_type]}>
                    {STOCK_MOVEMENT_TYPE_LABELS[m.movement_type]}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-brand-slate">My assigned tasks</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Assigned by the CEO or your lead. Progress updates save live.
          </p>
        </div>
        <MyTaskBoard initialTasks={myTasks} userId={user.id} />
      </section>
    </div>
  )
}

/** The lead-only delegation inbox — CEO tasks handed to Store without a named owner. */
async function DelegationInbox({ organizationId }: { organizationId: string }) {
  const departmentId = await getStoreDepartmentId(organizationId)
  const [employees, unowned] = await Promise.all([
    getStoreEmployees(organizationId),
    getUnownedStoreTasks(organizationId, departmentId),
  ])
  const inboxTasks = unowned as unknown as AssignedTask[]

  return (
    <Card>
      <CardHeader
        title="Tasks awaiting delegation"
        subtitle="Assigned to Store without a named owner. Delegating moves it to that person's dashboard."
      />
      {inboxTasks.length === 0 ? (
        <EmptyState
          title="Nothing waiting to be delegated"
          description="CEO tasks assigned to Store without a named person land here."
        />
      ) : (
        <DepartmentTaskInbox tasks={inboxTasks} employees={employees} departmentName="Store" />
      )}
    </Card>
  )
}

function firstName(fullName: string): string {
  return fullName.split(' ')[0] || fullName
}
