'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { EmptyState } from '@/components/ui/primitives'
import { TEAM_ROLES } from '@/lib/om/constants'
import type { OMEmployee } from '@/lib/om/dashboard'

/** Just the columns the detail query selects — not the full team-member row. */
type TeamRow = {
  id: string
  user_id: string
  role_on_site: string | null
  member: { full_name: string } | null
}

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * The on-site crew. Unlike the rest of the app's single-assignee ownership, an
 * installation is owned by its whole team — team lead plus these members — which is
 * what auth_owns_installation() keys off. Assembling the crew is therefore a write
 * any team member can make (the migration gives them full access to this table
 * gated on ownership), not a lead-only action.
 */
export function TeamSection({
  installationId,
  members,
  teamLeadName,
  roster,
  readOnly,
}: {
  installationId: string
  members: TeamRow[]
  teamLeadName: string | null
  /** O&M roster for the picker. Already-added members are filtered out below. */
  roster: OMEmployee[]
  readOnly: boolean
}) {
  const [adding, setAdding] = useState(false)

  const takenIds = new Set(members.map((m) => m.user_id))
  const available = roster.filter((r) => !takenIds.has(r.id))

  return (
    <div className="rounded-xl border border-border-subtle bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-brand-slate">On-site team</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Lead: {teamLeadName ?? 'Unassigned'} · {members.length} member
            {members.length === 1 ? '' : 's'}
          </p>
        </div>
        {!readOnly && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg bg-brand-gold px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
          >
            + Add member
          </button>
        )}
      </div>

      {adding && (
        <div className="border-b border-border-subtle bg-surface-bg px-5 py-4">
          <AddMemberForm
            installationId={installationId}
            available={available}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {members.length === 0 && !adding ? (
        <EmptyState
          title="No crew assigned yet"
          description={
            readOnly
              ? 'No team members have been added to this installation.'
              : 'Add the electricians and helpers working this site so they can log progress.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {members.map((m) => (
            <MemberRow
              key={m.id}
              installationId={installationId}
              member={m}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function MemberRow({
  installationId,
  member,
  readOnly,
}: {
  installationId: string
  member: TeamRow
  readOnly: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setPending(true)
    setError(null)

    const res = await fetch(
      `/api/installations/${installationId}/team?memberId=${member.id}`,
      { method: 'DELETE' }
    )

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not remove the member.')
      return
    }

    router.refresh()
  }

  return (
    <li className="flex items-center justify-between px-5 py-3">
      <div>
        <p className="text-sm font-medium text-brand-slate">
          {member.member?.full_name ?? 'Unknown user'}
        </p>
        <p className="text-xs text-text-muted">{member.role_on_site ?? 'Role not set'}</p>
        {error && <p className="mt-1 text-xs text-status-danger">⚠ {error}</p>}
      </div>
      {!readOnly && (
        <button
          onClick={remove}
          disabled={pending}
          className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:border-status-danger hover:text-status-danger disabled:opacity-60"
        >
          Remove
        </button>
      )}
    </li>
  )
}

function AddMemberForm({
  installationId,
  available,
  onDone,
  onCancel,
}: {
  installationId: string
  available: OMEmployee[]
  onDone: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!userId) {
      setError('Select someone to add.')
      return
    }

    setPending(true)
    setError(null)

    const res = await fetch(`/api/installations/${installationId}/team`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, role_on_site: role || null }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not add the member.')
      return
    }

    onDone()
    router.refresh()
  }

  if (available.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          Everyone in the department is already on this team.
        </p>
        <button
          onClick={onCancel}
          className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-white"
        >
          Close
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="tm-user" className={labelClass}>
            Team member
          </label>
          <select
            id="tm-user"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className={inputClass}
          >
            <option value="">Select…</option>
            {available.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tm-role" className={labelClass}>
            Role on site
          </label>
          <select
            id="tm-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className={inputClass}
          >
            <option value="">Not set</option>
            {TEAM_ROLES.map((r) => (
              <option key={r} value={r}>
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
        >
          {pending ? 'Adding…' : 'Add to team'}
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
