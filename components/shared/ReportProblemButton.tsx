'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { LifeBuoy, X, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { IT_ISSUE_TYPES } from '@/lib/technical/constants'
import { IT_ISSUE_TYPE_LABELS } from '@/lib/format'

/**
 * Report an IT problem, from wherever the problem happened.
 *
 * Lives in the module header rather than on a page of its own because a broken
 * login or a screen that will not save is discovered mid-task, and the previous
 * arrangement — a form on /technical/it-support — asked someone to navigate away
 * from the thing that was broken in order to describe it. This is the reason the
 * database lets any authenticated member insert a ticket: the
 * org_member_raise_it_ticket policy is what makes a button in every module's header
 * possible, and this component is the feature that policy was written for.
 *
 * Posts to POST /api/it-support, which is guarded by requireUserOrThrow() rather
 * than a department check. Nothing here decides who may file — raised_by is taken
 * from the session server-side, so a hand-edited request cannot file under someone
 * else's name, and RLS accepts the insert or refuses it.
 *
 * The queue itself is not reachable from here. Triage is Technical's, and the
 * confirmation links a reporter to their own tickets instead — the one page RLS
 * shows them.
 */

/**
 * Mirrors createITTicketSchema on the server. issue_type is a loose string rather
 * than the enum: '' is the legitimate empty state for the select, and validating it
 * as an enum here would reject the blank option before the submit handler can turn
 * it into null.
 */
const schema = z.object({
  issue_type: z.string(),
  description: z.string().trim().min(3, 'Describe the issue').max(5000),
})

type FormValues = z.infer<typeof schema>

/**
 * No focus: ring here — the gold :focus-visible outline in globals.css covers every
 * input in the app, and a second ring on top of it would double up.
 */
const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle bg-surface-card px-3 py-2.5 text-sm text-brand-slate transition-colors focus:border-brand-gold'

const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

export function ReportProblemButton() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      {/*
        Icon only, matching the round icon buttons already in the module headers. With
        no visible label the accessible name has to come from aria-label — without it a
        screen reader announces this as an unnamed button — and `title` gives sighted
        users the same words on hover.

        Neutral grey, not gold: this is passive header chrome that is present on every
        screen, and gold is reserved for the active state and the primary action.
      */}
      <button
        ref={triggerRef}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="Report a problem"
        title="Report a problem"
        className="flex h-9 w-9 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-bg hover:text-brand-slate"
      >
        <LifeBuoy className="h-4 w-4" />
      </button>

      {open && (
        <ReportProblemDialog
          onClose={() => {
            setOpen(false)
            // Focus goes back where it came from, or a keyboard user is left at the
            // top of the document with no idea what they just dismissed.
            triggerRef.current?.focus()
          }}
        />
      )}
    </>
  )
}

/**
 * Exported so a menu item can open it without borrowing the button above.
 *
 * The CEO reaches this from the profile dropdown rather than from an icon in a header,
 * and a dropdown row is a `menuitem` — wrapping the icon button inside one would nest
 * a button in a button and give the row two competing accessible names. The dialog is
 * the reusable part; the trigger is not.
 */
export function ReportProblemDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const {
    register,
    handleSubmit,
    reset,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { issue_type: '', description: '' },
  })

  // Land the caret in the field they came here to fill in.
  useEffect(() => {
    setFocus('description')
  }, [setFocus])

  // Escape closes. A dialog with no keyboard exit is worse than no dialog.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  /**
   * Keeps Tab inside the panel while it is open. Without this, tabbing walks out
   * into the page behind the backdrop — visually inert, still focusable, and
   * impossible to follow for anyone relying on the focus ring or a screen reader.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !panelRef.current) return

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], select, textarea, input, [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  async function onSubmit(values: FormValues) {
    setServerError(null)

    const res = await fetch('/api/it-support', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        issue_type: values.issue_type || null,
        description: values.description,
      }),
    })

    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setServerError(body.error ?? 'Could not raise the ticket.')
      return
    }

    reset({ issue_type: '', description: '' })
    setSent(true)
    // Refreshes the IT support page underneath if that is where they filed from.
    router.refresh()
  }

  /**
   * Rendered into document.body rather than in place, and this is load-bearing.
   *
   * Originally this fixed the dialog being squashed into the header: both headers
   * carried `backdrop-blur-sm`, and a backdrop-filter makes an element a containing
   * block for its fixed-position descendants — exactly as `transform` and `filter`
   * do — so `fixed inset-0` resolved against the header strip rather than the
   * viewport. The headers are opaque navy now and that blur is gone, but the portal
   * stays, for two reasons that have not:
   *
   *   * the header is still `sticky z-30`, which creates a stacking context of its
   *     own, so inline this z-50 panel could be trapped beneath a later sibling that
   *     out-stacks the header;
   *   * a blur, transform or filter added to any wrapper above this — a hover
   *     animation, a glass effect — silently reintroduces the containing-block bug,
   *     and it presents as a layout mistake rather than as a CSS rule.
   *
   * In document.body there is no ancestor to inherit either problem from. Do not move
   * it back inline.
   *
   * No mounted guard is needed: `open` starts false, so this component only ever
   * renders after a click, which means document always exists by the time we get here.
   */
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-brand-slate/50 p-4 backdrop-blur-sm sm:items-center">
      {/*
        A sibling to the panel rather than a parent, so a click that starts inside
        the form and drifts outside it does not count as a dismissal and throw away
        what someone typed.
      */}
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 my-auto w-full max-w-lg rounded-xl border border-border-subtle bg-surface-card shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div>
            <h2 id={titleId} className="text-sm font-semibold text-brand-slate">
              Report a problem
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Something wrong with the ERP, your login or your laptop. Goes to Technical.
            </p>
          </div>

          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-text-muted transition-colors hover:bg-surface-bg hover:text-brand-slate"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {sent ? (
          <div className="space-y-4 px-5 py-6">
            <p className="badge-success rounded-lg px-3 py-2.5 text-sm">
              Reported. Technical picks it up from here.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/technical/it-support"
                onClick={onClose}
                className="inline-flex items-center gap-1.5 rounded-lg border border-brand-slate px-3 py-2 text-xs font-semibold text-brand-slate transition-colors hover:bg-surface-bg"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Follow your tickets
              </Link>

              <button
                onClick={() => setSent(false)}
                className="rounded-lg px-3 py-2 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg"
              >
                Report another
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 px-5 py-4">
            <div>
              <label htmlFor="report-issue-type" className={labelClass}>
                What kind of problem
              </label>
              <select id="report-issue-type" {...register('issue_type')} className={inputClass}>
                <option value="">Not sure</option>
                {IT_ISSUE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {IT_ISSUE_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="report-description" className={labelClass}>
                What is happening <span className="text-status-danger">*</span>
              </label>
              <textarea
                id="report-description"
                rows={5}
                {...register('description')}
                aria-invalid={errors.description ? true : undefined}
                placeholder="What you were doing, what you expected, and what happened instead. The exact error text helps."
                className={inputClass}
              />
              {errors.description && (
                <p className="mt-1 text-xs text-status-danger">{errors.description.message}</p>
              )}
            </div>

            {serverError && (
              <p className="badge-danger rounded-lg px-3 py-2 text-sm">⚠ {serverError}</p>
            )}

            <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
              >
                Cancel
              </button>
              {/*
                White on gold, matching every other primary button — the design system
                specifies `bg-brand-gold text-white` for primary actions.
                Worth knowing when revisiting: measured, white-on-gold is 2.03:1 and
                does not meet WCAG AA for normal text, where navy-on-gold is 8.53:1.
                The system chose white deliberately, so this is a known tradeoff rather
                than an oversight; if AA becomes a requirement, change it in the design
                system so all primary buttons move together, not just this one.
              */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-gold px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
              >
                <LifeBuoy className="h-4 w-4" />
                {isSubmitting ? 'Reporting…' : 'Report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  )
}
