import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import type { SessionUser } from '@/lib/auth/guards'
import type { CreateTaskInput, UpdateTaskInput, UpdateTaskProgressInput } from '@/lib/validation/schemas'
import type { Task } from '@/lib/types'

export type ActionSource = 'manual' | 'ai'

export class ServiceError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ServiceError'
    this.status = status
  }
}

/**
 * The single task-creation path. Both the manual UI and the AI confirm route
 * call this, so an AI-created task is byte-identical in shape to a hand-created
 * one — only the audit metadata.source differs.
 *
 * Uses the session-bound client, not the service client: RLS must still be the
 * thing that decides whether this insert is allowed.
 */
export async function createTask(
  user: SessionUser,
  input: CreateTaskInput,
  source: ActionSource = 'manual'
): Promise<Task> {
  const supabase = await createSupabaseServerClient()

  const { data: department, error: deptError } = await supabase
    .from('departments')
    .select('id')
    .eq('id', input.assigned_department_id)
    .eq('organization_id', user.organization_id)
    .maybeSingle()

  if (deptError) throw new ServiceError(deptError.message, 500)
  if (!department) throw new ServiceError('Department not found in this organization', 400)

  if (input.assigned_user_id) {
    const { data: assignee } = await supabase
      .from('users')
      .select('id, department_id')
      .eq('id', input.assigned_user_id)
      .eq('organization_id', user.organization_id)
      .maybeSingle()

    if (!assignee) throw new ServiceError('Assignee not found in this organization', 400)
    if (assignee.department_id !== input.assigned_department_id) {
      throw new ServiceError('Assignee does not belong to the selected department', 400)
    }
  }

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      organization_id: user.organization_id,
      title: input.title,
      description: input.description ?? null,
      created_by: user.id,
      assigned_department_id: input.assigned_department_id,
      assigned_user_id: input.assigned_user_id ?? null,
      priority: input.priority,
      due_date: input.due_date ?? null,
      status: 'pending',
      progress_percent: 0,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

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
  if (note || fields.status) {
    await supabase.from('task_updates').insert({
      task_id: taskId,
      updated_by: user.id,
      note: note ?? null,
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
