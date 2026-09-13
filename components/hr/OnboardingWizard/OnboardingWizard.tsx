'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { generateTempPassword } from '@/lib/passwords'
import { CredentialHandover } from '@/components/hr/CredentialHandover'
import { EMPLOYEE_DOCUMENT_TYPES } from '@/lib/hr/constants'
import { EMPLOYEE_DOCUMENT_TYPE_LABELS } from '@/lib/format'
import type { EmployeeDocumentType } from '@/lib/types'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

// Kept in step with onboardEmployeeSchema.profile_photo — the server re-validates the decoded
// bytes against MAX_UPLOAD_BYTES, so this is a fast-fail for the obvious cases only.
const ALLOWED_PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_PHOTO_BYTES = 5 * 1024 * 1024

// Onboarding documents: PDFs or images, capped at MAX_UPLOAD_BYTES (20MB). Fast-fail only;
// the server re-checks the decoded bytes.
const ALLOWED_DOC_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
const MAX_DOC_BYTES = 20 * 1024 * 1024

/** One document the wizard has read to a data URI, ready to send inline with the form. */
type PendingDoc = {
  document_type: EmployeeDocumentType
  file_name: string
  file_data: string
}

type Step = 1 | 2 | 3 | 4

/**
 * Multi-step onboarding wizard (HR lead / CEO). Gathers the employee's details, an optional profile
 * photo, and a WhatsApp number, then posts once to /api/onboarding — which provisions the account
 * (with orphan-cleanup on failure) and generates the ID card in a single server call.
 *
 * WHY THREE STEPS. Identity/role first (the required fields), photo second (optional, and the one
 * step that can be skipped outright), review last so HR confirms before an irreversible provision.
 * The photo is read to a data URI in the browser and sent inline with the form: the storage path
 * is keyed by employee id, which does not exist until the server inserts the row, so it cannot be
 * pre-uploaded the way ordinary documents are.
 */
export function OnboardingWizard({
  roles,
  users,
  prefill,
}: {
  roles: { id: string; name: string; department_name: string | null }[]
  users: { id: string; full_name: string }[]
  /** Optional details carried over from a hired candidate's "Onboard" shortcut. */
  prefill?: { fullName?: string; email?: string; phone?: string; designation?: string }
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)

  const [fullName, setFullName] = useState(prefill?.fullName ?? '')
  const [email, setEmail] = useState(prefill?.email ?? '')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState(prefill?.phone ?? '')
  const [whatsapp, setWhatsapp] = useState('')
  const [roleId, setRoleId] = useState('')
  const [designation, setDesignation] = useState(prefill?.designation ?? '')
  const [employeeCode, setEmployeeCode] = useState('')
  const [dateJoined, setDateJoined] = useState('')
  const [reportingTo, setReportingTo] = useState('')
  const [emergency, setEmergency] = useState('')
  // Optional starting salary. When set, the server creates the first payroll record and notifies
  // Finance to arrange disbursement (the amount stays with HR/CEO). Kept as a string for the input;
  // parsed to a number on submit.
  const [baseSalary, setBaseSalary] = useState('')

  const [photoData, setPhotoData] = useState<string | null>(null)
  const [photoName, setPhotoName] = useState<string | null>(null)

  const [docs, setDocs] = useState<PendingDoc[]>([])
  const [docType, setDocType] = useState<EmployeeDocumentType>('id_proof')

  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Synchronous submit guard — see submit() for why useState alone is not enough.
  const submittingRef = useRef(false)
  // Set once provisioning succeeds. It replaces the whole wizard body rather than redirecting
  // straight to the profile board: the password is never persisted, so navigating away before HR
  // has read it would lose it for good.
  const [handover, setHandover] = useState<{
    employeeId: string | null
    name: string
    email: string
    password: string
  } | null>(null)

  function validateStep1(): boolean {
    if (fullName.trim().length < 2) {
      setError('Enter the full name.')
      return false
    }
    if (!email.trim()) {
      setError('Enter an email.')
      return false
    }
    // Mirrors createEmployeeSchema.password, which onboardEmployeeSchema extends.
    if (password.length < 8) {
      setError('Set a password of at least 8 characters.')
      return false
    }
    if (!roleId) {
      setError('Select a role.')
      return false
    }
    setError(null)
    return true
  }

  function onPhotoChange(file: File | null) {
    setError(null)
    if (!file) {
      setPhotoData(null)
      setPhotoName(null)
      return
    }
    if (!ALLOWED_PHOTO_TYPES.includes(file.type)) {
      setError('Photo must be a PNG, JPEG, or WebP image.')
      return
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError('Photo must be 5MB or smaller.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setPhotoData(typeof reader.result === 'string' ? reader.result : null)
      setPhotoName(file.name)
    }
    reader.onerror = () => setError('Could not read that image. Try another file.')
    reader.readAsDataURL(file)
  }

  function onDocChange(file: File | null) {
    setError(null)
    if (!file) return
    if (!ALLOWED_DOC_TYPES.includes(file.type)) {
      setError('Document must be a PDF, PNG, JPEG, or WebP.')
      return
    }
    if (file.size > MAX_DOC_BYTES) {
      setError('Document must be 20MB or smaller.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') return
      setDocs((prev) => [
        ...prev,
        { document_type: docType, file_name: file.name, file_data: reader.result as string },
      ])
    }
    reader.onerror = () => setError('Could not read that file. Try another.')
    reader.readAsDataURL(file)
  }

  function removeDoc(index: number) {
    setDocs((prev) => prev.filter((_, i) => i !== index))
  }

  async function submit() {
    // Re-entrancy guard. setPending(true) only disables the button after React re-renders,
    // so a fast double-click can fire two POSTs before the disabled state lands — and two
    // concurrent requests carrying the same expired session race each other's token refresh
    // (one rotates the refresh token, the other is rejected as already-used). One submit at
    // a time, always.
    if (submittingRef.current) return
    submittingRef.current = true
    setPending(true)
    setError(null)

    /*
     * SESSION KEEPALIVE, DETERMINISTIC. This page creates no browser Supabase client, so
     * nothing refreshes the session while HR fills the form — and the proxy refreshes on
     * page navigations only, never on this POST. A form filled for longer than the access
     * token's lifetime (the default is one hour) would otherwise submit with an expired
     * token and fail the route's guard with 401 "Not authenticated" — one button away from
     * done, with the whole form's data on screen. getSession() goes through the auth
     * client's load-session path, which refreshes an expired token and rewrites the auth
     * cookies BEFORE the fetch below runs. Best-effort: a failed refresh is ignored here
     * and the server-side retry in getSessionUser() is the second net.
     */
    await createClient().auth.getSession().catch(() => { })

    const res = await fetch('/api/onboarding', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: fullName.trim(),
        email: email.trim(),
        password,
        phone: phone.trim() || null,
        whatsapp_number: whatsapp.trim() || null,
        role_id: roleId,
        designation: designation.trim() || null,
        employee_code: employeeCode.trim() || null,
        date_joined: dateJoined || null,
        reporting_to: reportingTo || null,
        emergency_contact: emergency.trim() || null,
        profile_photo: photoData,
        documents: docs.length > 0 ? docs : undefined,
        // Omit entirely when blank so the schema's optional applies; a number otherwise.
        base_salary: baseSalary.trim() ? Number(baseSalary) : undefined,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    submittingRef.current = false

    if (!res.ok) {
      setError(body.error ?? 'Could not complete onboarding.')
      return
    }

    // Show the credentials before going anywhere. The employee is provisioned and the card is
    // generated; the profile board is one click away in the handover panel. Redirecting here
    // instead would discard the one copy of the password that exists.
    setHandover({
      employeeId: (body.employee?.id as string | undefined) ?? null,
      name: fullName.trim(),
      email: email.trim(),
      password,
    })
    router.refresh()
  }

  if (handover) {
    return (
      <CredentialHandover
        name={handover.name}
        email={handover.email}
        password={handover.password}
      >
        {handover.employeeId && (
          <button
            type="button"
            onClick={() => router.push(`/hr/employees/${handover.employeeId}`)}
            className="rounded-lg bg-brand-gold px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-orange"
          >
            Open profile board →
          </button>
        )}
      </CredentialHandover>
    )
  }

  return (
    <div className="space-y-6">
      <Stepper step={step} />

      {step === 1 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="w-name" label="Full name">
              <input id="w-name" value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
            </Field>
            <Field id="w-email" label="Email (login id)">
              <input id="w-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
            </Field>
            <Field id="w-password" label="Password">
              <div className="flex gap-2">
                {/* Shown in the clear on purpose — HR is assigning a credential to hand over, not
                    typing their own, and a masked field just hides transcription mistakes. */}
                <input
                  id="w-password"
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="off"
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={() => setPassword(generateTempPassword())}
                  className="shrink-0 rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-brand-slate transition-colors hover:border-brand-gold"
                >
                  Generate
                </button>
              </div>
            </Field>
            <Field id="w-role" label="Role">
              <select id="w-role" value={roleId} onChange={(e) => setRoleId(e.target.value)} className={inputClass}>
                <option value="">Select…</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.department_name ? ` · ${r.department_name}` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="w-desig" label="Designation">
              <input id="w-desig" value={designation} onChange={(e) => setDesignation(e.target.value)} className={inputClass} />
            </Field>
            <Field id="w-code" label="Employee code">
              <input id="w-code" value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} className={inputClass} />
            </Field>
            <Field id="w-phone" label="Phone">
              <input id="w-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
            </Field>
            <Field id="w-whatsapp" label="WhatsApp number">
              <input id="w-whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className={inputClass} placeholder="For sharing the ID card" />
            </Field>
            <Field id="w-joined" label="Date joined">
              <input id="w-joined" type="date" value={dateJoined} onChange={(e) => setDateJoined(e.target.value)} className={inputClass} />
            </Field>
            <Field id="w-report" label="Reports to">
              <select id="w-report" value={reportingTo} onChange={(e) => setReportingTo(e.target.value)} className={inputClass}>
                <option value="">—</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="w-salary" label="Starting salary (optional)">
              <input
                id="w-salary"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={baseSalary}
                onChange={(e) => setBaseSalary(e.target.value)}
                placeholder="Monthly base — visible to HR/CEO only"
                className={inputClass}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field id="w-emergency" label="Emergency contact">
                <input id="w-emergency" value={emergency} onChange={(e) => setEmergency(e.target.value)} className={inputClass} />
              </Field>
            </div>
          </div>

          {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

          <div className="flex justify-end">
            <button
              onClick={() => validateStep1() && setStep(2)}
              className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
            >
              Next: photo
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            {photoData ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoData} alt="Preview" className="h-24 w-24 rounded-2xl object-cover" />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-surface-bg text-xs text-text-muted">
                No photo
              </div>
            )}
            <div>
              <label htmlFor="w-photo" className={labelClass}>
                Profile photo (optional)
              </label>
              <input
                id="w-photo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => onPhotoChange(e.target.files?.[0] ?? null)}
                className="text-sm"
              />
              {photoName && <p className="mt-1 text-xs text-text-muted">{photoName}</p>}
              <p className="mt-1 text-xs text-text-muted">
                PNG, JPEG, or WebP up to 5MB. The card shows initials if you skip this.
              </p>
            </div>
          </div>

          {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

          <div className="flex justify-between">
            <button
              onClick={() => setStep(1)}
              className="rounded-lg border border-border-subtle px-4 py-2.5 text-sm font-medium text-brand-slate transition-colors hover:border-brand-gold"
            >
              Back
            </button>
            <button
              onClick={() => setStep(3)}
              className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
            >
              Next: documents
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div>
            <p className="text-sm text-text-muted">
              Attach the new hire&apos;s paperwork — ID proof, address proof, offer letter, and so
              on. Optional; you can also add these later from the profile board.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="w-doctype" className={labelClass}>
                Document type
              </label>
              <select
                id="w-doctype"
                value={docType}
                onChange={(e) => setDocType(e.target.value as EmployeeDocumentType)}
                className={inputClass}
              >
                {EMPLOYEE_DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {EMPLOYEE_DOCUMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="w-docfile" className={labelClass}>
                File (PDF or image)
              </label>
              {/* Reset value after each pick so choosing the same filename twice still fires. */}
              <input
                id="w-docfile"
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  onDocChange(e.target.files?.[0] ?? null)
                  e.target.value = ''
                }}
                className="text-sm"
              />
            </div>
          </div>

          {docs.length > 0 && (
            <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
              {docs.map((d, i) => (
                <li key={`${d.file_name}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-brand-slate">{d.file_name}</p>
                    <p className="text-xs text-text-muted">
                      {EMPLOYEE_DOCUMENT_TYPE_LABELS[d.document_type]}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeDoc(i)}
                    className="shrink-0 rounded-lg border border-border-subtle px-2.5 py-1 text-xs font-medium text-status-danger transition-colors hover:bg-status-danger/5"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-text-muted">
            PDF, PNG, JPEG, or WebP up to 20MB each.
          </p>

          {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

          <div className="flex justify-between">
            <button
              onClick={() => setStep(2)}
              className="rounded-lg border border-border-subtle px-4 py-2.5 text-sm font-medium text-brand-slate transition-colors hover:border-brand-gold"
            >
              Back
            </button>
            <button
              onClick={() => setStep(4)}
              className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
            >
              Next: review
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border-subtle bg-surface-bg px-4 py-3 text-sm">
            <Review label="Name" value={fullName} />
            <Review label="Login" value={email} />
            <Review label="Password" value={password} />
            <Review label="Role" value={roles.find((r) => r.id === roleId)?.name ?? '—'} />
            <Review label="Designation" value={designation || '—'} />
            <Review label="Employee code" value={employeeCode || '—'} />
            <Review label="WhatsApp" value={whatsapp || '—'} />
            <Review label="Photo" value={photoName ?? 'None (initials on card)'} />
            <Review
              label="Documents"
              value={docs.length === 0 ? 'None' : `${docs.length} attached`}
            />
            <Review
              label="Starting salary"
              value={
                baseSalary.trim()
                  ? `${baseSalary.trim()} — payroll record + Finance notified`
                  : 'Not set (add later on payroll)'
              }
            />
          </div>

          <p className="text-xs text-text-muted">
            This creates the login, employee record, and ID card together. No email is sent — the
            credentials appear on the next screen for you to hand over, and the password is not
            recoverable afterwards.
          </p>

          {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

          <div className="flex justify-between">
            <button
              onClick={() => setStep(3)}
              disabled={pending}
              className="rounded-lg border border-border-subtle px-4 py-2.5 text-sm font-medium text-brand-slate transition-colors hover:border-brand-gold disabled:opacity-60"
            >
              Back
            </button>
            <button
              onClick={submit}
              disabled={pending}
              className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
            >
              {pending ? 'Onboarding…' : 'Onboard & generate card'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Stepper({ step }: { step: Step }) {
  const labels = ['Details', 'Photo', 'Documents', 'Review']
  return (
    <div className="flex items-center gap-2">
      {labels.map((label, i) => {
        const n = (i + 1) as Step
        const active = n === step
        const done = n < step
        return (
          <div key={label} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${active
                  ? 'bg-brand-gold text-white'
                  : done
                    ? 'bg-brand-slate text-white'
                    : 'bg-surface-bg text-text-muted'
                }`}
            >
              {n}
            </span>
            <span className={`text-xs ${active ? 'font-semibold text-brand-slate' : 'text-text-muted'}`}>
              {label}
            </span>
            {i < labels.length - 1 && <span className="mx-1 h-px w-6 bg-border-subtle" />}
          </div>
        )
      })}
    </div>
  )
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
    </div>
  )
}

function Review({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <span className="text-text-muted">{label}</span>
      <span className="font-medium text-brand-slate">{value}</span>
    </div>
  )
}
