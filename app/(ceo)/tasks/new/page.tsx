import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/primitives'
import { CreateTaskForm } from '@/components/ceo/TaskBoard/CreateTaskForm'
import type { Department } from '@/lib/types'

export default async function NewTaskPage() {
  const user = await requireRole('CEO')
  const supabase = await createSupabaseServerClient()

  const { data: departments } = await supabase
    .from('departments')
    .select('id, name, slug, organization_id, parent_department_id, created_at')
    .eq('organization_id', user.organization_id)
    .order('name')

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <Link href="/tasks" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to tasks
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-brand-slate">Create task</h1>
        <p className="text-sm text-text-muted">
          Assign work to a department. The department can post progress updates against it.
        </p>
      </header>

      <Card className="p-6">
        <CreateTaskForm departments={(departments ?? []) as Department[]} />
      </Card>
    </div>
  )
}
