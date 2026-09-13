import 'server-only'

import { randomUUID } from 'node:crypto'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { isDepartmentManager, type SessionUser } from '@/lib/auth/guards'
import type {
  CreateSubTaskInput,
  CreateTaskInput,
  ForwardTaskInput,
  UpdateTaskInput,
  UpdateTaskProgressInput,
} from '@/lib/validation/schemas'
import type { Task, TaskFlow, TaskFlowNode } from '@/lib/types'

export type ActionSource = 'manual' | 'ai'

/** One row of the My Tasks feed: the task plus the names its card renders. */
export type MyTaskRow = Task & {
  department: { name: string } | null
  creator: { full_name: string } | null
}

export class ServiceError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ServiceError'
    this.status = status
  }
}

/**
 * The My Tasks feed, shared by every department's /my-tasks page.
 *
 * TWO SOURCES, ONE LIST. Tasks assigned to the caller personally, PLUS the
 * caller's department's unclaimed tasks (assigned to the department, to no one
 * yet). The second half is what keeps My Tasks in step with the header bell:
 * the bell announces every unclaimed department task ("New task for your
 * team"), and member_view_relevant_tasks (0006) deliberately lets members READ
 * those rows — "nobody owns it yet" is not a leak. Before this, a task lived
 * in the bell alone until the department manager delegated it; in a department
 * with no manager it never reached anyone's screen at all.
 *
 * A plain member sees an unclaimed task read-only here — progressing it is the
 * assignee's action (updateTaskProgress) and delegation is the manager's
 * (updateTask); RLS rejects both for everyone else, and the board hides the
 * Update control accordingly. Filtering on department_id uses the caller's own
 * row, which is the same value auth_department_id() resolves inside RLS, so the
 * app-level set never exceeds what the database would return anyway.
 */
export async function getMyTasks(user: SessionUser): Promise<MyTaskRow[]> {
  const supabase = await createSupabaseServerClient()

  /*
   * PostgREST or-syntax. UUIDs carry no commas, parens, or dots, so the values
   * interpolate safely. A user with no department (the CEO does not visit these
   * pages, but defensiveness is cheap) degrades to the assigned-to-me arm only.
   */
  const filter = user.department_id
    ? `assigned_user_id.eq.${user.id},and(assigned_department_id.eq.${user.department_id},assigned_user_id.is.null)`
    : `assigned_user_id.eq.${user.id}`

  const { data, error } = await supabase
    .from('tasks')
    .select(
      '*, department:departments!tasks_assigned_department_id_fkey(name), creator:users!tasks_created_by_fkey(full_name)'
    )
    .or(filter)
    .neq('status', 'archived')
    .order('due_date', { ascending: true, nullsFirst: false })

  // An RLS change or a bad embed would otherwise arrive as a silently empty
  // board — the exact "tasks only in the bell" failure this query exists to fix.
  if (error) console.error('[tasks] my-tasks query failed', error.message)

  return (data ?? []) as unknown as MyTaskRow[]
}

/**
 * The department's unclaimed tasks — CEO assignments to the caller's department
 * with no named owner. This is the "Tasks awaiting delegation" inbox, fetched
 * for the AwaitingDelegationSection that renders on every /my-tasks page (and
 * mirrors what each module's dashboard already showed its lead).
 *
 * Uses the session-bound client: RLS is the boundary, exactly as for getMyTasks.
 * member_view_relevant_tasks (0006) already lets department members read these
 * rows — "nobody owns it yet" is not a leak — so a manager certainly can. The
 * write stays manager-only via PATCH /api/tasks/[taskId].
 */
export async function getTasksAwaitingDelegation(user: SessionUser): Promise<MyTaskRow[]> {
  if (!user.department_id) return []

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('tasks')
    .select(
      '*, department:departments!tasks_assigned_department_id_fkey(name), creator:users!tasks_created_by_fkey(full_name)'
    )
    .eq('organization_id', user.organization_id)
    .eq('assigned_department_id', user.department_id)
    .is('assigned_user_id', null)
    .neq('status', 'archived')
    .order('due_date', { ascending: true, nullsFirst: false })

  // Same silent-empty-board failure mode as getMyTasks: log it loudly.
  if (error) console.error('[tasks] delegation-inbox query failed', error.message)

  return (data ?? []) as unknown as MyTaskRow[]
}

/**
 * The caller's active department members, for the delegation dropdown. The same
 * roster query every module's dashboard runs for its lead before rendering the
 * inbox; centralised here so the /my-tasks section and the dashboards cannot
 * drift apart on who is delegable.
 */
export async function getDelegableDepartmentMembers(
  user: SessionUser
): Promise<{ id: string; full_name: string }[]> {
  if (!user.department_id) return []

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('organization_id', user.organization_id)
    .eq('department_id', user.department_id)
    .eq('is_active', true)
    .order('full_name', { ascending: true })

  if (error) console.error('[tasks] delegation roster query failed', error.message)

  return data ?? []
}

/**
 * The single task-creation path. The CEO module, department managers, employees
 * and the AI confirm route all land here, so a task is byte-identical in shape
 * however it was born — only the audit metadata.source differs.
 *
 * WHO MAY CREATE WHAT (the hierarchy, enforced here because the insert below
 * runs on the service client, past RLS):
 *   * CEO — anywhere in the organisation (today's behaviour, unchanged).
 *   * Manager — anywhere in the organisation: a department head originates work
 *     and hands it to whichever department fulfils it. Their department still
 *     sees the chain, because origin_department_id is copied onto the row and
 *     RLS (0025) shows the origin department its trees.
 *   * Employee — into their OWN department only. Cross-department requests
 *     start as sub-tasks of work they are involved in (createSubTask), which
 *     keeps every cross-department ask traceable to the task that produced it.
 *
 * PRIVILEGED WRITE. RLS's insert tier is CEO-only, and the chain columns
 * (root_task_id = id, origin_department_id = assigned) must be computed
 * server-side — no caller may forge an ownership that was never theirs. So the
 * checks above ARE the access control, and the service client is used only
 * once they pass: the same shape as hireEmployee and forwardTask.
 */
export async function createTask(
  user: SessionUser,
  input: CreateTaskInput,
  source: ActionSource = 'manual'
): Promise<Task> {
  const session = await createSupabaseServerClient()

  const { data: department, error: deptError } = await session
    .from('departments')
    .select('id')
    .eq('id', input.assigned_department_id)
    .eq('organization_id', user.organization_id)
    .maybeSingle()

  if (deptError) throw new ServiceError(deptError.message, 500)
  if (!department) throw new ServiceError('Department not found in this organization', 400)

  const isManager = isDepartmentManager(user)
  if (user.roleName !== 'CEO' && !isManager && input.assigned_department_id !== user.department_id) {
    throw new ServiceError(
      'You can create tasks for your own department. Work for another department starts as a sub-task of a task you are working on.',
      403
    )
  }

  const service = createSupabaseServiceClient()
  const taskId = randomUUID()

  // No assignee on creation — work lands in the department's queue (unclaimed),
  // and the department's manager hands it to a person from there; a department
  // with no manager works it as a shared task.
  const { data, error } = await service
    .from('tasks')
    .insert({
      id: taskId,
      organization_id: user.organization_id,
      title: input.title,
      description: input.description ?? null,
      created_by: user.id,
      assigned_department_id: input.assigned_department_id,
      assigned_user_id: null,
      priority: input.priority,
      due_date: input.due_date ?? null,
      status: 'pending',
      progress_percent: 0,
      root_task_id: taskId,
      origin_department_id: input.assigned_department_id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  // The chain's first event, so the flow page reads as a journey from step one.
  await service.from('task_updates').insert({
    task_id: taskId,
    updated_by: user.id,
    note: 'Task created and assigned.',
    status: 'pending',
  })

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'task.created',
    entityType: 'task',
    entityId: data.id,
    metadata: { source, title: data.title, department_id: data.assigned_department_id },
  })

  return data as Task
}

export async function updateTask(
  user: SessionUser,
  taskId: string,
  input: UpdateTaskInput,
  source: ActionSource = 'manual'
): Promise<Task> {
  const supabase = await createSupabaseServerClient()
  const { note, ...fields } = input

  const { data: existing } = await supabase
    .from('tasks')
    .select('id')
    .eq('id', taskId)
    .maybeSingle()

  if (!existing) throw new ServiceError('Task not found', 404)

  const { data, error } = await supabase
    .from('tasks')
    .update(fields)
    .eq('id', taskId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  /*
   * A status change or a note appends to the timeline, so a management action is
   * visible in Live Progress Tracking alongside the assignee's own updates.
   *
   * `progress_percent` is absent on purpose: this row is stamped `updated_by`, and
   * writing progress here would file a progress report in the manager's name on
   * someone else's task. Only updateTaskProgress() — the assignee's own path —
   * writes that number.
   */
  // A reassignment is a handoff — the delegation inbox and the AI both come
  // through here — so it always leaves a note, even when the caller wrote none.
  const handoff =
    fields.assigned_department_id !== undefined || fields.assigned_user_id !== undefined
  if (note || fields.status || handoff) {
    await supabase.from('task_updates').insert({
      task_id: taskId,
      updated_by: user.id,
      note: note ?? (handoff ? 'Task reassigned.' : null),
      status: fields.status ?? null,
    })
  }

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'task.updated',
    entityType: 'task',
    entityId: taskId,
    metadata: { source, changed: Object.keys(fields) },
  })

  return data as Task
}

/**
 * Employee-scoped progress update. Only the direct assignee may call this.
 * Restricted to status/progress/note — employees cannot reassign or reprioritize.
 * RLS (department_update_own_tasks) is the real gate; this is the service-layer
 * enforcement so an employee cannot change another user's task even if they
 * somehow share a department.
 */
export async function updateTaskProgress(
  user: SessionUser,
  taskId: string,
  input: UpdateTaskProgressInput
): Promise<Task> {
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('tasks')
    .select('id, organization_id, assigned_user_id, status')
    .eq('id', taskId)
    .maybeSingle()

  if (!existing) throw new ServiceError('Task not found', 404)
  if (existing.assigned_user_id !== user.id) {
    throw new ServiceError('You can only update tasks assigned directly to you', 403)
  }
  if (existing.status === 'archived') {
    throw new ServiceError('Archived tasks cannot be updated', 400)
  }

  const { note, ...fields } = input

  const { data, error } = await supabase
    .from('tasks')
    .update(fields)
    .eq('id', taskId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await supabase.from('task_updates').insert({
    task_id: taskId,
    updated_by: user.id,
    note: note ?? null,
    progress_percent: fields.progress_percent ?? null,
    status: fields.status ?? null,
  })

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'task.progress_updated',
    entityType: 'task',
    entityId: taskId,
    metadata: { changed: Object.keys(fields), note: note ?? null },
  })

  return data as Task
}

/** Archive is a soft delete. The row is never removed. */
export async function archiveTask(
  user: SessionUser,
  taskId: string,
  source: ActionSource = 'manual'
): Promise<Task> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('tasks')
    .update({ status: 'archived' })
    .eq('id', taskId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)
  if (!data) throw new ServiceError('Task not found', 404)

  await supabase.from('task_updates').insert({
    task_id: taskId,
    updated_by: user.id,
    note: 'Task archived',
    status: 'archived',
  })

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'task.archived',
    entityType: 'task',
    entityId: taskId,
    metadata: { source },
  })

  return data as Task
}

// ---------------------------------------------------------------------------
// Delegation — sub-tasks, forwarding, and the flow map (0025)
//
// Every write below runs on the service client AFTER an explicit involvement
// check, mirroring how hireEmployee and the ID-card service work: the check IS
// the access control. RLS still governs every read, and the in-place update
// policies (0022) are untouched — only these two moves, which carry invariants
// RLS cannot express (an immutable origin, a copied chain link), take the
// privileged path.
// ---------------------------------------------------------------------------

/**
 * The ways a caller may be involved in a task — the gate for both delegation
 * writes. Mirrors the read policy's participant branches (0022/0025): the
 * assignee, the creator, the owning department's manager, or — for an
 * unclaimed task in a department without a manager — any member of that
 * department, who shares the work by construction.
 */
function isInvolvedInTask(
  user: SessionUser,
  task: { assigned_department_id: string; assigned_user_id: string | null; created_by: string }
): boolean {
  return (
    task.assigned_user_id === user.id ||
    task.created_by === user.id ||
    (isDepartmentManager(user) && task.assigned_department_id === user.department_id) ||
    (task.assigned_department_id === user.department_id && task.assigned_user_id === null)
  )
}

interface AssignmentTarget {
  assigned_department_id: string
  assigned_user_id: string | null
}

/**
 * Resolves "department, or person" onto concrete columns. A person named
 * without a department takes their department with them — every task row
 * carries assigned_department_id (NOT NULL, 0001), and the target's department
 * is what the chain's ownership questions are asked against. Service-client
 * reads, because the delegator must be able to hand work to any active member
 * of the organisation, not only to people their own RLS row can see.
 */
async function resolveAssignmentTarget(
  service: ReturnType<typeof createSupabaseServiceClient>,
  organizationId: string,
  input: { assigned_department_id?: string; assigned_user_id?: string }
): Promise<AssignmentTarget> {
  if (input.assigned_user_id) {
    const { data: target } = await service
      .from('users')
      .select('id, department_id, is_active')
      .eq('id', input.assigned_user_id)
      .eq('organization_id', organizationId)
      .maybeSingle()

    if (!target || !target.is_active) {
      throw new ServiceError('That person is not an active member of this organisation', 400)
    }
    if (!target.department_id) {
      throw new ServiceError('That person has no department to receive the task', 400)
    }
    return { assigned_department_id: target.department_id, assigned_user_id: target.id }
  }

  const { data: dept } = await service
    .from('departments')
    .select('id')
    .eq('id', input.assigned_department_id as string)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!dept) throw new ServiceError('Department not found in this organization', 400)
  return { assigned_department_id: input.assigned_department_id as string, assigned_user_id: null }
}

/** Human-readable target for the handoff notes the flow timeline renders. */
async function describeTarget(
  service: ReturnType<typeof createSupabaseServiceClient>,
  target: AssignmentTarget
): Promise<string> {
  if (target.assigned_user_id) {
    const { data: person } = await service
      .from('users')
      .select('full_name')
      .eq('id', target.assigned_user_id)
      .maybeSingle()
    return person?.full_name ?? 'a team member'
  }
  const { data: dept } = await service
    .from('departments')
    .select('name')
    .eq('id', target.assigned_department_id)
    .maybeSingle()
  return dept?.name ?? 'a department'
}

/**
 * Spins a sub-task off an existing task — the "I discovered we need one more
 * panel" move. The child inherits the parent's root and origin, so no matter
 * how many departments it travels through, it stays inside the original chain:
 * the origin department's manager and the CEO can follow it, and the parent's
 * own history records that the requirement was raised.
 *
 * INVOLVEMENT: the caller must be working the parent — its assignee, its
 * owning department's manager, its creator, or a member of a managerless
 * department it sits unclaimed in. Anyone can SEE a task; only its people can
 * split it.
 */
export async function createSubTask(
  user: SessionUser,
  parentId: string,
  input: CreateSubTaskInput,
  source: ActionSource = 'manual'
): Promise<Task> {
  const session = await createSupabaseServerClient()

  // Read through the caller's session first: RLS decides whether they can even
  // see the parent. The privileged write below must never resurrect a parent
  // the caller was never shown.
  const { data: parent } = await session
    .from('tasks')
    .select(
      'id, organization_id, root_task_id, origin_department_id, assigned_department_id, assigned_user_id, created_by, status'
    )
    .eq('id', parentId)
    .maybeSingle()

  if (!parent) throw new ServiceError('Task not found', 404)
  if (parent.status === 'archived') {
    throw new ServiceError('Archived tasks cannot spawn sub-tasks', 400)
  }
  if (!isInvolvedInTask(user, parent)) {
    throw new ServiceError('You can only delegate from tasks assigned to you or created by you', 403)
  }

  const service = createSupabaseServiceClient()
  const target = await resolveAssignmentTarget(service, user.organization_id, input)
  const targetName = await describeTarget(service, target)

  const subTaskId = randomUUID()
  const { data, error } = await service
    .from('tasks')
    .insert({
      id: subTaskId,
      organization_id: user.organization_id,
      title: input.title,
      description: input.description ?? null,
      created_by: user.id,
      assigned_department_id: target.assigned_department_id,
      assigned_user_id: target.assigned_user_id,
      priority: input.priority,
      due_date: input.due_date ?? null,
      status: 'pending',
      progress_percent: 0,
      parent_task_id: parent.id,
      root_task_id: parent.root_task_id ?? parent.id,
      origin_department_id: parent.origin_department_id ?? parent.assigned_department_id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  // Handoff note on the parent + first event on the child. The flow page and
  // the CEO's task timeline both read these, so the spin-off is visible from
  // both directions without any extra join.
  await service.from('task_updates').insert({
    task_id: parent.id,
    updated_by: user.id,
    note: `Requirement raised: "${input.title}" — sent to ${targetName}.`,
  })
  await service.from('task_updates').insert({
    task_id: subTaskId,
    updated_by: user.id,
    note: `Sub-task created from the parent task; assigned to ${targetName}.`,
    status: 'pending',
  })

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'task.subtask_created',
    entityType: 'task',
    entityId: subTaskId,
    metadata: {
      source,
      parent_id: parent.id,
      target_department: target.assigned_department_id,
      assigned_user: target.assigned_user_id,
    },
  })

  return data as Task
}

/**
 * Moves an open task onward — the assignee (or the owning/origin department's
 * manager, or the person who raised it) hands it to another employee or
 * department when they discover they cannot complete it themselves.
 *
 * WHAT MOVES AND WHAT DOES NOT. Only the execution pointer moves:
 * assigned_department_id and assigned_user_id. parent_task_id, root_task_id and
 * origin_department_id are untouched, so the chain's ownership never drifts —
 * a task forwarded from Distribution to Technical is still Distribution's
 * requirement, visible on Distribution's journey and invisible to anyone
 * except Technical's own people.
 *
 * Every forward leaves a handoff note in the task's own history, which is what
 * the flow timeline renders as the "who delegated to whom, and why" step.
 */
export async function forwardTask(
  user: SessionUser,
  taskId: string,
  input: ForwardTaskInput,
  source: ActionSource = 'manual'
): Promise<Task> {
  const session = await createSupabaseServerClient()

  const { data: task } = await session
    .from('tasks')
    .select('id, organization_id, status, assigned_department_id, assigned_user_id, created_by')
    .eq('id', taskId)
    .maybeSingle()

  if (!task) throw new ServiceError('Task not found', 404)
  if (task.status === 'completed' || task.status === 'archived') {
    throw new ServiceError('Completed tasks cannot be forwarded', 400)
  }
  if (!isInvolvedInTask(user, task)) {
    throw new ServiceError('You can only forward tasks assigned to you or created by you', 403)
  }

  const service = createSupabaseServiceClient()
  const target = await resolveAssignmentTarget(service, user.organization_id, input)

  if (
    target.assigned_department_id === task.assigned_department_id &&
    (target.assigned_user_id ?? null) === (task.assigned_user_id ?? null)
  ) {
    throw new ServiceError('The task is already assigned there', 400)
  }

  const { data, error } = await service
    .from('tasks')
    .update({
      assigned_department_id: target.assigned_department_id,
      assigned_user_id: target.assigned_user_id,
    })
    .eq('id', task.id)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  const targetName = await describeTarget(service, target)
  await service.from('task_updates').insert({
    task_id: task.id,
    updated_by: user.id,
    note: input.note ? `Forwarded to ${targetName} — ${input.note}` : `Forwarded to ${targetName}.`,
  })

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'task.forwarded',
    entityType: 'task',
    entityId: task.id,
    metadata: {
      source,
      from_department: task.assigned_department_id,
      to_department: target.assigned_department_id,
      assigned_user: target.assigned_user_id,
    },
  })

  return data as Task
}

/**
 * The chain behind a task: the root plus every visible descendant, oldest
 * first. The entry read goes through the caller's session — if RLS hides the
 * requested node, the caller has no business reading this chain at all (null).
 * The tree query is equally RLS-bound, so what comes back is exactly the slice
 * of the journey this viewer is entitled to: the CEO and the origin
 * department's manager see the whole chain, a mid-chain participant sees their
 * own node(s), a creator sees what they raised.
 */
export async function getTaskFlow(user: SessionUser, taskId: string): Promise<TaskFlow | null> {
  const supabase = await createSupabaseServerClient()

  const { data: entry } = await supabase.from('tasks').select('id, root_task_id').eq('id', taskId).maybeSingle()
  if (!entry) return null

  const rootId = entry.root_task_id ?? entry.id

  const { data: rows, error } = await supabase
    .from('tasks')
    .select(
      '*, department:departments!tasks_assigned_department_id_fkey(name), assignee:users!tasks_assigned_user_id_fkey(full_name), creator:users!tasks_created_by_fkey(full_name)'
    )
    .eq('root_task_id', rootId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('[tasks] flow query failed', error.message)
    return null
  }

  return { rootId, nodes: (rows ?? []) as unknown as TaskFlowNode[] }
}

export interface DelegationTargets {
  departments: { id: string; name: string }[]
  /**
   * Active people across the organisation with their department, so the
   * delegate dialog can offer "a person in department X". Names only — the
   * company directory, not HR data: no salary, no contact details.
   */
  people: { id: string; full_name: string; department_id: string | null; department_name: string | null }[]
  /**
   * Whether the caller may point a top-level task at any department (CEO and
   * managers can; an employee's own top-level creations land in their own
   * department — cross-department asks go through sub-tasks).
   */
  canAssignAnyDepartment: boolean
  ownDepartmentId: string | null
}

/**
 * The addressing book for delegation: every department and every active
 * person in the organisation. Privileged read, because a delegator must be
 * able to hand work to anyone — but the payload is deliberately thin: ids,
 * names, department names. Nothing an ID card doesn't already show.
 */
export async function getDelegationTargets(user: SessionUser): Promise<DelegationTargets> {
  const service = createSupabaseServiceClient()

  const [departmentsRes, peopleRes] = await Promise.all([
    service
      .from('departments')
      .select('id, name')
      .eq('organization_id', user.organization_id)
      .order('name', { ascending: true }),
    service
      .from('users')
      .select('id, full_name, department_id, departments(name)')
      .eq('organization_id', user.organization_id)
      .eq('is_active', true)
      .order('full_name', { ascending: true }),
  ])

  return {
    departments: (departmentsRes.data ?? []) as { id: string; name: string }[],
    people: (peopleRes.data ?? []) as unknown as DelegationTargets['people'],
    canAssignAnyDepartment: user.roleName === 'CEO' || isDepartmentManager(user),
    ownDepartmentId: user.department_id,
  }
}
