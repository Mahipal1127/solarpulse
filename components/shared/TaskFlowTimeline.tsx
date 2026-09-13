import { Badge, ProgressBar } from '@/components/ui/primitives'
import {
  formatDate,
  isOverdue,
  STATUS_DOT,
  STATUS_LABELS,
  STATUS_STYLES,
  PRIORITY_LABELS,
  PRIORITY_STYLES,
} from '@/lib/format'
import type { TaskFlow, TaskFlowNode } from '@/lib/types'

/**
 * A task's delegation chain as a vertical timeline.
 *
 * THE SHAPE IT DRAWS
 * Nodes arrive oldest-first and carry parent links; children render indented
 * beneath their parent, so the eye reads the chain the way it happened: the
 * original task, then each requirement raised under it, in order. When RLS
 * hides a mid-chain node from this viewer (a plain member of a downstream
 * department sees only their own node), the orphan renders at root level — the
 * timeline shows the slice of the journey this viewer is entitled to, never a
 * broken page.
 *
 * SHARED BY DESIGN
 * The CEO's task page, the shared /task-flow page and the delegate dialog all
 * render this one component: an employee's slice and the CEO's full journey
 * are the same drawing at different zoom, which is why they can never drift.
 */
export function TaskFlowTimeline({ flow, compact = false }: { flow: TaskFlow; compact?: boolean }) {
  const nodes = flow.nodes

  // Group by parent — but only when the parent is itself visible to this
  // viewer. An orphan (its parent hidden by RLS) stands as its own root.
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const childrenOf = new Map<string | null, TaskFlowNode[]>()
  for (const node of nodes) {
    const key = node.parent_task_id && byId.has(node.parent_task_id) ? node.parent_task_id : null
    const list = childrenOf.get(key) ?? []
    list.push(node)
    childrenOf.set(key, list)
  }

  function renderNode(node: TaskFlowNode, depth: number) {
    const over = isOverdue(node)
    const children = childrenOf.get(node.id) ?? []

    return (
      <li key={node.id} className="relative pl-7">
        <span
          className={`absolute left-0 top-1.5 h-3 w-3 rounded-full border-2 border-white ring-1 ring-border-subtle ${STATUS_DOT[node.status]}`}
        />
        <div
          className={`rounded-xl border bg-white p-4 ${
            over ? 'border-status-danger/25' : 'border-border-subtle'
          }`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-brand-slate">{node.title}</h4>
                {node.parent_task_id && (
                  <Badge className="bg-surface-bg text-text-muted ring-border-subtle">Sub-task</Badge>
                )}
                {over && <Badge className="bg-status-danger/10 text-status-danger ring-status-danger/30">Overdue</Badge>}
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Badge className={STATUS_STYLES[node.status]}>{STATUS_LABELS[node.status]}</Badge>
                <Badge className={PRIORITY_STYLES[node.priority]}>{PRIORITY_LABELS[node.priority]}</Badge>
              </div>

              <p className="mt-2 text-xs text-text-muted">
                With <span className="font-medium text-brand-slate">{node.department_name ?? '—'}</span>
                {node.assignee_name ? ` · ${node.assignee_name}` : ' · unclaimed'}
                {node.creator_name && ` · raised by ${node.creator_name}`}
                {node.due_date && ` · due ${formatDate(node.due_date)}`}
              </p>
            </div>

            <span className="w-10 shrink-0 text-right text-xs font-semibold text-text-muted">
              {node.progress_percent}%
            </span>
          </div>

          {!compact && node.description && (
            <p className="mt-2 text-xs leading-relaxed text-text-muted">{node.description}</p>
          )}

          <div className="mt-2.5">
            <ProgressBar value={node.progress_percent} />
          </div>
        </div>

        {children.length > 0 && (
          <ol className="ml-4 mt-3 space-y-3 border-l border-dashed border-border-subtle pl-4">
            {children.map((child) => renderNode(child, depth + 1))}
          </ol>
        )}
      </li>
    )
  }

  const roots = childrenOf.get(null) ?? []

  return (
    <ol className="space-y-3">
      {roots.map((node) => renderNode(node, 0))}
    </ol>
  )
}