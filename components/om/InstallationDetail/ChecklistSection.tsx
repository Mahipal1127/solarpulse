'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { EmptyState } from '@/components/ui/primitives'
import { formatDateTime } from '@/lib/format'

type ChecklistRow = {
  id: string
  item: string
  is_checked: boolean
  checked_at: string | null
  checker: { full_name: string } | null
}

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'

/**
 * The quality checklist. A standard list is seeded when an installation is created
 * from a deal (see create_installation_from_deal); crews tick items off and can add
 * site-specific ones. Nothing here gates completion — §3.3 is explicit that the
 * checklist and inspection inform the completion decision but do not hard-block it,
 * so an unfinished checklist shows as a count, not a lock.
 */
export function ChecklistSection({
  installationId,
  items,
  readOnly,
}: {
  installationId: string
  items: ChecklistRow[]
  readOnly: boolean
}) {
  const [adding, setAdding] = useState(false)

  const done = items.filter((i) => i.is_checked).length

  return (
    <div className="rounded-xl border border-border-subtle bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-brand-slate">Quality checklist</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {done} of {items.length} checked
          </p>
        </div>
        {!readOnly && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg border border-border-subtle bg-white px-3.5 py-2 text-sm font-medium text-text-muted transition-colors hover:border-brand-gold hover:text-brand-gold"
          >
            + Add item
          </button>
        )}
      </div>

      {adding && (
        <div className="border-b border-border-subtle bg-surface-bg px-5 py-4">
          <AddItemForm
            installationId={installationId}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {items.length === 0 && !adding ? (
        <EmptyState
          title="No checklist items"
          description={
            readOnly
              ? 'No checklist has been recorded for this installation.'
              : 'Add the quality checks this site needs signed off.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {items.map((item) => (
            <ChecklistItemRow
              key={item.id}
              installationId={installationId}
              item={item}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function ChecklistItemRow({
  installationId,
  item,
  readOnly,
}: {
  installationId: string
  item: ChecklistRow
  readOnly: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    setPending(true)
    setError(null)

    const res = await fetch(
      `/api/installations/${installationId}/checklist?itemId=${item.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_checked: !item.is_checked }),
      }
    )

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not update the item.')
      return
    }

    router.refresh()
  }

  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <input
        type="checkbox"
        checked={item.is_checked}
        onChange={toggle}
        disabled={readOnly || pending}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border-subtle text-brand-gold focus:ring-brand-gold disabled:opacity-60"
      />
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm ${
            item.is_checked ? 'text-text-muted line-through' : 'text-brand-slate'
          }`}
        >
          {item.item}
        </p>
        {item.is_checked && item.checked_at && (
          <p className="mt-0.5 text-xs text-text-muted">
            {item.checker?.full_name ?? 'Unknown'} · {formatDateTime(item.checked_at)}
          </p>
        )}
        {error && <p className="mt-0.5 text-xs text-status-danger">⚠ {error}</p>}
      </div>
    </li>
  )
}

function AddItemForm({
  installationId,
  onDone,
  onCancel,
}: {
  installationId: string
  onDone: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [item, setItem] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (item.trim().length < 2) {
      setError('Describe the item.')
      return
    }

    setPending(true)
    setError(null)

    const res = await fetch(`/api/installations/${installationId}/checklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: item.trim() }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not add the item.')
      return
    }

    onDone()
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <input
        value={item}
        onChange={(e) => setItem(e.target.value)}
        placeholder="e.g. Earthing resistance measured and within spec"
        className={inputClass}
      />
      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
        >
          {pending ? 'Adding…' : 'Add item'}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-white"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
