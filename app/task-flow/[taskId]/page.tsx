import 'server-only'

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSessionUser } from '@/lib/auth/guards'
import { getTaskFlow } from '@/lib/services/tasks'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { TaskFlowTimeline } from '@/components/shared/TaskFlowTimeline'
import { STATUS_LABELS, STATUS_STYLES } from '@/lib/format'
import type { TaskStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * The journey of one task chain, for whoever is entitled to see it.
 *
 * ONE PAGE FOR EVERY VIEWER, AND RLS DOES THE SCOPING
 * The CEO and the origin department's manager read the whole chain — who
 * raised what, where it travelled, who completed which step. A mid-chain
 * participant gets the slice they are part of: their own node, and the notes
 * on it. Nobody gets anything they could not already see on a board. A task
 * that is invisible or unknown answers with the same branded 404.
 *
 * WHY A STANDALONE PAGE
 * The chain is legible at full width with room for the whole tree — and every
 * surface that shows a task (employee boards, CEO lists, department views)
 * can link here with one route instead of each growing its own journey view.
 */
export default async function TaskFlowPage(props: PageProps<'/task-flow/[taskId]'>) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const { taskId } = await props.params
  const flow = await getTaskFlow(user, taskId)
  if (!flow) notFound()

  const root = flow.nodes.find((node) => node.id === flow.rootId) ?? flow.nodes[0]

  return (
    <main className="min-h-screen bg-surface-bg">
      <div className="mx-auto max-w-3xl space-y-6 p-6 sm:p-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted transition-colors hover:text-brand-slate"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to workspace
        </Link>

        <Card>
          <CardHeader
            title={root.title}
            subtitle={`Original owner: ${root.department_name ?? '—'} · ${flow.nodes.length} step${flow.nodes.length === 1 ? '' : 's'} in this chain`}
          />
          <div className="flex flex-wrap items-center gap-2 px-5 py-4">
            <Badge className={STATUS_STYLES[root.status]}>{STATUS_LABELS[root.status as TaskStatus]}</Badge>
            <span className="text-xs text-text-muted">
              The chain stays owned by the department the task started in, no matter how far the work travels.
            </span>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Task flow"
            subtitle="Who raised what, who it went to, and where each step stands now."
          />
          <div className="p-5">
            {flow.nodes.length <= 1 ? (
              <EmptyState
                title="No delegation yet"
                description="This task has no sub-tasks or forwards. Its chain grows the moment someone working it raises a requirement."
              />
            ) : (
              <TaskFlowTimeline flow={flow} />
            )}
          </div>
        </Card>
      </div>
    </main>
  )
}