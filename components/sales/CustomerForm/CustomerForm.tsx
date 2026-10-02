'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { SalesEmployee } from '@/lib/sales/queries'
import type { Customer } from '@/lib/types'

/**
 * Mirrors createCustomerSchema / updateCustomerSchema in browser-native form
 * values: '' for an empty select or optional text. Conversion to null happens
 * at submit, and '' on an optional field means "clear it".
 *
 * No lead field in either mode, for the same reason neither schema has one: a
 * customer this form writes carries no lead. The customer↔lead link belongs to
 * close_deal(), which writes it together with the closure row.
 */
const schema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(200),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[+\d\s()-]*$/, 'Phone may only contain digits, spaces, and + ( ) -')
    .optional(),
  email: z.union([z.literal(''), z.string().trim().email('Enter a valid email')]).optional(),
  address: z.string().trim().max(1000).optional(),
  assigned_to: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'

const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

export function CustomerForm({
  mode = 'create',
  customer,
  employees = [],
  canAssign = false,
}: {
  mode?: 'create' | 'edit'
  /** Required when mode is 'edit'; the row being changed. */
  customer?: Customer
  /** Sales roster. Only read when canAssign is true. */
  employees?: SalesEmployee[]
  /**
   * Sales Manager only. An executive's customer is always their own — the
   * service layer forces assigned_to to themselves and
   * sales_exec_own_customers' check requires it, so hiding the field here is
   * cosmetic, not the actual control. (For an executive editing their own
   * customer the field is hidden but the value is preserved: their PATCH simply
   * carries no assigned_to, so the owner does not move.)
   */
  canAssign?: boolean
}) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: customer
      ? {
          name: customer.name,
          phone: customer.phone ?? '',
          email: customer.email ?? '',
          address: customer.address ?? '',
          assigned_to: customer.assigned_to ?? '',
        }
      : {},
  })

  async function onSubmit(values: FormValues) {
    setServerError(null)

    const payload: Record<string, unknown> = {
      name: values.name,
      // '' clears the field rather than storing an empty string — the service
      // normalises '' to null for the same reason.
      phone: values.phone || null,
      email: values.email || null,
      address: values.address || null,
    }

    // Only sent when the field was actually rendered. An executive's request
    // carries no assigned_to at all, so on create the service assigns the
    // customer to them, and on edit the current owner is left untouched.
    if (canAssign && values.assigned_to) {
      payload.assigned_to = values.assigned_to
    } else if (canAssign && mode === 'edit' && !values.assigned_to) {
      // A manager who clears the owner field means "unassign", which is a real
      // state this table allows (assigned_to is nullable).
      payload.assigned_to = null
    }

    const editing = mode === 'edit' && customer
    const res = await fetch(editing ? `/api/customers/${customer.id}` : '/api/customers', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setServerError(body.error ?? `Could not ${editing ? 'update' : 'create'} the customer.`)
      return
    }

    router.push(`/sales/customers/${body.customer.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div>
        <label htmlFor="name" className={labelClass}>
          Customer Name <span className="text-status-danger">*</span>
        </label>
        <input id="name" {...register('name')} className={inputClass} />
        {errors.name && <p className="mt-1 text-xs text-status-danger">{errors.name.message}</p>}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="phone" className={labelClass}>
            Phone
          </label>
          <input
            id="phone"
            type="tel"
            {...register('phone')}
            placeholder="+91 98765 43210"
            className={inputClass}
          />
          {errors.phone && <p className="mt-1 text-xs text-status-danger">{errors.phone.message}</p>}
        </div>

        <div>
          <label htmlFor="email" className={labelClass}>
            Email
          </label>
          <input id="email" type="email" {...register('email')} className={inputClass} />
          {errors.email && <p className="mt-1 text-xs text-status-danger">{errors.email.message}</p>}
        </div>

        {canAssign && (
          <div>
            <label htmlFor="assigned_to" className={labelClass}>
              Owned By
            </label>
            <select id="assigned_to" {...register('assigned_to')} className={inputClass}>
              <option value="">
                {mode === 'create' ? 'Assign to me' : 'Unassigned (no owner)'}
              </option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </select>
            {employees.length === 0 && (
              <p className="mt-1 text-xs text-text-muted">
                No other active users in the Sales department yet.
              </p>
            )}
          </div>
        )}
      </div>

      <div>
        <label htmlFor="address" className={labelClass}>
          Address{' '}
          <span className="font-normal normal-case text-text-muted/60">
            (where the system goes, optional)
          </span>
        </label>
        <textarea id="address" rows={3} {...register('address')} className={inputClass} />
        {errors.address && (
          <p className="mt-1 text-xs text-status-danger">{errors.address.message}</p>
        )}
      </div>

      {serverError && (
        <p className="rounded-lg bg-status-danger/5 px-3 py-2 text-sm text-status-danger">
          ⚠ {serverError}
        </p>
      )}

      <div className="flex items-center gap-3 border-t border-border-subtle pt-5">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-brand-gold px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60"
        >
          {isSubmitting ? 'Saving…' : mode === 'create' ? 'Create customer' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-border-subtle px-4 py-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

