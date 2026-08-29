'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Check } from 'lucide-react'
import { Card, CardHeader, Badge } from '@/components/ui/primitives'
import type { BrandProfile } from '@/lib/marketing/creative-types'

/**
 * The one-time brand form the AI Creative feature draws on "mainly".
 *
 * Collapsed by default once filled, because it is set-and-forget: the team fills it once and
 * every later script is grounded in it without opening this again. The badge tells them at a
 * glance whether it is done, since an empty brand profile is the single biggest reason a
 * generated script comes back generic.
 *
 * Every field is optional — a half-filled profile still helps and still saves. No credential
 * anywhere; this is public-facing description of the business.
 */

const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'
const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'

type Field = keyof Omit<
  BrandProfile,
  'id' | 'organization_id' | 'updated_by' | 'updated_by_name' | 'created_at' | 'updated_at'
>

const FIELDS: Array<{ key: Field; label: string; placeholder: string; rows: number }> = [
  { key: 'business_name', label: 'Business name', placeholder: 'Solar Pulse Energy', rows: 1 },
  {
    key: 'what_we_sell',
    label: 'What we sell',
    placeholder: 'Rooftop and commercial solar installations, net-metering, subsidy paperwork…',
    rows: 2,
  },
  {
    key: 'target_audience',
    label: 'Who we sell to',
    placeholder: 'Homeowners and SME factory owners in Gujarat looking to cut power bills…',
    rows: 2,
  },
  {
    key: 'tone_voice',
    label: 'Tone & voice',
    placeholder: 'Warm, plain-spoken, a little cheeky. We explain, we do not lecture.',
    rows: 2,
  },
  {
    key: 'key_offers',
    label: 'Key offers & hooks',
    placeholder: 'Zero-down EMI, 25-year panel warranty, government subsidy handled end to end…',
    rows: 2,
  },
  {
    key: 'seo_keywords',
    label: 'SEO / discovery keywords',
    placeholder: 'solar panel price, rooftop solar subsidy, electricity bill zero, solar EMI…',
    rows: 2,
  },
  {
    key: 'extra_notes',
    label: 'Anything else the AI should always know',
    placeholder: 'We serve Gujarat only. Never promise exact savings figures. MNRE-empanelled.',
    rows: 2,
  },
]

export function BrandProfileForm({
  profile,
  readOnly,
}: {
  profile: BrandProfile | null
  readOnly: boolean
}) {
  const router = useRouter()
  const filled = profile
    ? FIELDS.some((field) => (profile[field.key] ?? '').toString().trim().length > 0)
    : false

  const [open, setOpen] = useState(!filled && !readOnly)
  const [values, setValues] = useState<Record<Field, string>>(() => {
    const seed = {} as Record<Field, string>
    for (const field of FIELDS) seed[field.key] = (profile?.[field.key] ?? '').toString()
    return seed
  })
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setPending(true)
    setError(null)
    setSaved(false)

    const res = await fetch('/api/marketing/brand-profile', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    })
    setPending(false)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not save the brand profile.')
      return
    }
    setSaved(true)
    router.refresh()
  }

  return (
    <Card>
      <CardHeader
        icon={<Building2 className="h-4 w-4" />}
        title="Brand profile"
        subtitle="The AI writes every script and plan from this. Fill it once; refine it whenever your positioning changes."
        action={
          <div className="flex items-center gap-2">
            <Badge className={filled ? 'badge-success' : 'badge-warning'}>
              {filled ? 'Set' : 'Not set'}
            </Badge>
            <button
              onClick={() => setOpen((v) => !v)}
              className="rounded-lg border border-border-subtle px-3 py-1 text-xs font-medium text-text-muted transition-colors hover:border-brand-gold hover:text-brand-gold"
            >
              {open ? 'Hide' : filled ? 'Edit' : 'Fill in'}
            </button>
          </div>
        }
      />

      {open && (
        <div className="space-y-4 px-5 py-4">
          {readOnly && (
            <p className="notice-warning rounded-lg px-3 py-2 text-xs">
              Read-only — the Marketing team maintains the brand profile.
            </p>
          )}
          {FIELDS.map((field) => (
            <div key={field.key}>
              <label htmlFor={`brand-${field.key}`} className={labelClass}>
                {field.label}
              </label>
              {field.rows === 1 ? (
                <input
                  id={`brand-${field.key}`}
                  value={values[field.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  disabled={readOnly}
                  className={inputClass}
                />
              ) : (
                <textarea
                  id={`brand-${field.key}`}
                  value={values[field.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  rows={field.rows}
                  disabled={readOnly}
                  className={inputClass}
                />
              )}
            </div>
          ))}

          {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

          {!readOnly && (
            <div className="flex items-center gap-3">
              <button
                onClick={save}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
              >
                {pending ? 'Saving…' : 'Save brand profile'}
              </button>
              {saved && (
                <span className="inline-flex items-center gap-1 text-xs text-status-success">
                  <Check className="h-3.5 w-3.5" />
                  Saved
                </span>
              )}
              {profile?.updated_by_name && (
                <span className="text-xs text-text-muted">
                  Last updated by {profile.updated_by_name}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
