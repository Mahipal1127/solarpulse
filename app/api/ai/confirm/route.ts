import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { requireRoleOrThrow } from '@/lib/auth/guards'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { errorResponse } from '@/lib/api/responses'
import { createTask, updateTask, archiveTask } from '@/lib/services/tasks'
import { aiTurnSchema } from '@/lib/ai/proposalSchema'
import { z } from 'zod'
import type { TaskStatus, TaskPriority } from '@/lib/types'

const confirmSchema = z.object({
  commandId: z.string().uuid(),
})

export async function POST(req: NextRequest) {
  try {
    const user = await requireRoleOrThrow('CEO')
    const body = await req.json()
    const parsed = confirmSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'commandId is required' }, { status: 400 })
    }

    const { commandId } = parsed.data
    const service = createSupabaseServiceClient()

    // Read the proposal from the database — not from the client. This is the
    // core of the security model: the client can only say "confirm command X",
    // it cannot alter what was proposed.
    const { data: command, error: fetchErr } = await service
      .from('ai_command_log')
      .select('id, organization_id, status, proposed_action')
      .eq('id', commandId)
      .eq('organization_id', user.organization_id)
      .single()

    if (fetchErr || !command) {
      return NextResponse.json({ error: 'Command not found' }, { status: 404 })
    }
    if (command.status !== 'proposed') {
      return NextResponse.json({ error: 'Command has already been acted on' }, { status: 409 })
    }

    const turn = aiTurnSchema.safeParse(command.proposed_action)
    if (!turn.success || turn.data.kind !== 'proposed_action') {
      return NextResponse.json({ error: 'Stored command is not a proposal' }, { status: 422 })
    }

    const { action, payload } = turn.data
    let result: Record<string, unknown> = {}

    // Resolve names to IDs using the session-bound client (RLS still applies)
    const supabase = await createSupabaseServerClient()

    if (action === 'create_task') {
      const { data: deptRow } = await supabase
        .from('departments')
        .select('id')
        .eq('organization_id', user.organization_id)
        .ilike('name', payload.department_name ?? '')
        .maybeSingle()

      if (!deptRow) {
        return NextResponse.json(
          { error: `Department "${payload.department_name}" not found` },
          { status: 422 }
        )
      }

      let assigneeId: string | null = null
      if (payload.assignee_name) {
        const { data: assigneeRow } = await supabase
          .from('users')
          .select('id')
          .eq('organization_id', user.organization_id)
          .ilike('full_name', payload.assignee_name)
          .maybeSingle()
        assigneeId = assigneeRow?.id ?? null
      }

      const task = await createTask(
        user,
        {
          title: payload.title ?? 'AI-created task',
          description: payload.description ?? null,
          assigned_department_id: deptRow.id,
          assigned_user_id: assigneeId,
          priority: (payload.priority as TaskPriority) ?? 'medium',
          due_date: payload.due_date ?? null,
        },
        'ai'
      )
      result = { task }
    } else if (action === 'update_task') {
      const { data: taskRow } = await supabase
        .from('tasks')
        .select('id')
        .eq('organization_id', user.organization_id)
        .ilike('title', payload.task_title ?? '')
        .neq('status', 'archived')
        .maybeSingle()

      if (!taskRow) {
        return NextResponse.json(
          { error: `Task "${payload.task_title}" not found` },
          { status: 422 }
        )
      }

      const updates: Record<string, unknown> = {}
      if (payload.status) updates.status = payload.status as TaskStatus
      if (payload.note) updates.note = payload.note

      const task = await updateTask(user, taskRow.id, updates as Parameters<typeof updateTask>[2], 'ai')
      result = { task }
    } else if (action === 'archive_task') {
      const { data: taskRow } = await supabase
        .from('tasks')
        .select('id')
        .eq('organization_id', user.organization_id)
        .ilike('title', payload.task_title ?? '')
        .neq('status', 'archived')
        .maybeSingle()

      if (!taskRow) {
        return NextResponse.json(
          { error: `Task "${payload.task_title}" not found` },
          { status: 422 }
        )
      }

      const task = await archiveTask(user, taskRow.id, 'ai')
      result = { task }
    }

    // Mark the command as executed
    await service
      .from('ai_command_log')
      .update({ status: 'executed', confirmed_at: new Date().toISOString() })
      .eq('id', commandId)

    await logAction({
      organizationId: user.organization_id,
      userId: user.id,
      action: 'ai.command_confirmed',
      entityType: 'ai_command_log',
      entityId: commandId,
      metadata: { action },
    })

    return NextResponse.json({ ok: true, action, result })
  } catch (err) {
    return errorResponse(err)
  }
}
