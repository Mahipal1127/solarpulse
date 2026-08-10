import { requireUser } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { StatCard } from '@/components/ui/primitives'
import {
  TicketQueue,
  type TicketRow,
  type TicketAssigneeOption,
} from '@/components/technical/ITSupport/TicketQueue'
import { BackupStatusPanel } from '@/components/technical/ITSupport/BackupStatusPanel'
import { TECHNICAL_DEPARTMENT_SLUG, isTechnicalLead } from '@/lib/services/technical'
import type { DataBackupLog } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * IT support: the company's own tools, not anything customer-facing.
 *
 * requireUser() rather than requireDepartment('technical'), and this page is the
 * reason that guard exists. Reporting a broken login is open to everyone in the
 * organization by design — a queue only Technical could write to would be a queue
 * nobody files into. Managing the queue is not open in the same way, and neither is
 * the backup log.
 *
 * Nothing here branches the ticket query by department. RLS returns the whole queue
 * to a Technical member and only their own rows to everyone else, so the two views
 * follow from the policy rather than from a second copy of the rule in application
 * code — which also means a policy regression shows up here instead of being masked.
 */
export default async function ITSupportPage() {
  const user = await requireUser()

  const isTechnical = user.departmentSlug === TECHNICAL_DEPARTMENT_SLUG
  const isCeo = user.roleName === 'CEO'
  const lead = isTechnicalLead(user)

  /**
   * Who may read data_backup_logs: the CEO and the Technical lead, per
   * ceo_read_backup_logs and technical_lead_read_backup_logs. Skipping the query
   * entirely for everyone else rather than firing one that RLS will empty — the
   * result would be indistinguishable from "no backups have ever run", which is a
   * very different and much more alarming thing to show someone.
   */
  const mayReadBackups = isCeo || lead

  const supabase = await createSupabaseServerClient()

  const [{ data: ticketData }, { data: assigneeData }, backupResult] = await Promise.all([
    supabase
      .from('it_support_tickets')
      .select(
        `*,
         raiser:users!it_support_tickets_raised_by_fkey(full_name, departments(name)),
         assignee:users!it_support_tickets_assigned_to_fkey(full_name)`
      )
      .order('created_at', { ascending: false })
      .limit(300),

    // Technical only: this populates the triage dropdown, and a visitor has no
    // triage controls to populate.
    isTechnical
      ? supabase
          .from('users')
          .select('id, full_name')
          .eq('organization_id', user.organization_id)
          .eq('department_id', user.department_id)
          .eq('is_active', true)
          .order('full_name', { ascending: true })
      : Promise.resolve({ data: null }),

    mayReadBackups
      ? supabase
          .from('data_backup_logs')
          .select('*')
          .order('performed_at', { ascending: false })
          .limit(100)
      : Promise.resolve({ data: null }),
  ])

  const tickets = (ticketData ?? []) as unknown as TicketRow[]
  const assignees = (assigneeData ?? []) as TicketAssigneeOption[]
  const backupLogs = (backupResult.data ?? []) as DataBackupLog[]

  const open = tickets.filter((t) => t.status === 'open')
  const inProgress = tickets.filter((t) => t.status === 'in_progress')
  const unassigned = open.filter((t) => t.assigned_to === null)

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-slate">IT Support</h1>
        <p className="mt-1 text-sm text-text-muted">
          {isTechnical
            ? 'Problems with the company’s own tools — this ERP, logins, laptops. Reported by every department, triaged here.'
            : 'The IT problems you reported, and where they stand. Use the Report button in the header above to raise a new one.'}
        </p>
      </div>

      {isTechnical && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Open" value={open.length} />
          <StatCard
            label="Unassigned"
            value={unassigned.length}
            tone={unassigned.length > 0 ? 'warning' : 'default'}
            hint="Nobody has picked these up"
          />
          <StatCard label="In Progress" value={inProgress.length} />
          <StatCard
            label="Resolved"
            value={tickets.filter((t) => t.status === 'resolved').length}
            tone="success"
          />
        </div>
      )}

      {/*
        Two columns only when there is something to put beside the queue. The
        backup panel is the only remaining sidebar occupant and most people cannot
        read it, so a fixed 2/3 grid would leave a third of the page empty for
        everyone else.
      */}
      {mayReadBackups ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <TicketQueue
              tickets={tickets}
              assignees={assignees}
              currentUserId={user.id}
              // The CEO reads this module but does not write to it, so triage is
              // Technical's alone — assertCanWrite() in the service agrees.
              canTriage={isTechnical}
            />
          </div>

          <BackupStatusPanel logs={backupLogs} />
        </div>
      ) : (
        <TicketQueue
          tickets={tickets}
          assignees={assignees}
          currentUserId={user.id}
          canTriage={isTechnical}
        />
      )}
    </div>
  )
}
