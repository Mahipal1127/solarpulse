'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { generateTempPassword } from '@/lib/passwords'
import { CredentialHandover } from '@/components/hr/CredentialHandover'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

// Kept in step with onboardEmployeeSchema.profile_photo — the server re-validates the decoded
// bytes against MAX_UPLOAD_BYTES, so this is a fast-fail for the obvious cases only.
const ALLOWED_PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_PHOTO_BYTES = 5 * 1024 * 1024

type Step = 1 | 2 | 3

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
}: {
  roles: { id: string; name: string; department_name: string | null }[]
  users: { id: string; full_name: string }[]
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [roleId, setRoleId] = useState('')
  const [designation, setDesignation] = useState('')
  const [employeeCode, setEmployeeCode] = useState('')
  const [dateJoined, setDateJoined] = useState('')
  const [reportingTo, setReportingTo] = useState('')
  const [emergency, setEmergency] = useState('')

  const [photoData, setPhotoData] = useState<string | null>(null)
  const [photoName, setPhotoName] = useState<string | null>(null)

  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  async function submit() {
    setPending(true)
    setError(null)

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
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)

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
              Next: review
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
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
          </div>

          <p className="text-xs text-text-muted">
            This creates the login, employee record, and ID card together. No email is sent — the
            credentials appear on the next screen for you to hand over, and the password is not
            recoverable afterwards.
          </p>

          {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

          <div className="flex justify-between">
            <button
              onClick={() => setStep(2)}
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
  const labels = ['Details', 'Photo', 'Review']
  return (
    <div className="flex items-center gap-2">
      {labels.map((label, i) => {
        const n = (i + 1) as Step
        const active = n === step
        const done = n < step
        return (
          <div key={label} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                active
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
