'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { MATERIAL_CATEGORY_LABELS } from '@/lib/format'
import { MATERIAL_CATEGORIES } from '@/lib/distribution/constants'
import type { Vendor } from '@/lib/types'

/**
 * Mirrors createVendorSchema / updateVendorSchema in browser-native form values:
 * '' for an empty select or optional text, converted to null at submit.
 *
 * is_active is deliberately absent. Deactivating a vendor is a distinct action
 * with its own confirmation on the detail page, not a checkbox someone can clear
 * while editing a phone number.
 */
const schema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(200),
  category: z.string().optional(),
  contact_person: z.string().trim().max(200).optional(),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[+\d\s()-]*$/, 'Phone may only contain digits, spaces, and + ( ) -')
    .optional(),
  email: z.union([z.literal(''), z.string().trim().email('Enter a valid email')]).optional(),
  address: z.string().trim().max(1000).optional(),
  gstin: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(5000).optional(),
})

type FormValues = z.infer<typeof schema>

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'

const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

export function VendorForm({ mode, vendor }: { mode: 'create' | 'edit'; vendor?: Vendor }) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: vendor
      ? {
          name: vendor.name,
          category: vendor.category ?? '',
          contact_person: vendor.contact_person ?? '',
          phone: vendor.phone ?? '',
          email: vendor.email ?? '',
          address: vendor.address ?? '',
          gstin: vendor.gstin ?? '',
          notes: vendor.notes ?? '',
        }
      : {},
  })

  async function onSubmit(values: FormValues) {
    setServerError(null)

    const payload = {
      name: values.name,
      category: values.category || null,
      contact_person: values.contact_person || null,
      phone: values.phone || null,
      email: values.email || null,
      address: values.address || null,
      gstin: values.gstin || null,
      notes: values.notes || null,
    }

    const res = await fetch(mode === 'create' ? '/api/vendors' : `/api/vendors/${vendor!.id}`, {
      method: mode === 'create' ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const body = await res.json()
    if (!res.ok) {
      setServerError(body.error ?? 'Could not save the vendor.')
      return
    }

    router.push(`/distribution/vendors/${body.vendor.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div>
        <label htmlFor="name" className={labelClass}>
          Vendor Name <span className="text-status-danger">*</span>
        </label>
        <input id="name" {...register('name')} className={inputClass} />
        {errors.name && <p className="mt-1 text-xs text-status-danger">{errors.name.message}</p>}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="category" className={labelClass}>
            Supplies
          </label>
          <select id="category" {...register('category')} className={inputClass}>
            <option value="">Not recorded</option>
            {MATERIAL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {MATERIAL_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="gstin" className={labelClass}>
            GSTIN
          </label>
          <input
            id="gstin"
            {...register('gstin')}
            placeholder="22AAAAA0000A1Z5"
            className={inputClass}
          />
          {errors.gstin && <p className="mt-1 text-xs text-status-danger">{errors.gstin.message}</p>}
        </div>

        <div>
          <label htmlFor="contact_person" className={labelClass}>
            Contact Person
          </label>
          <input id="contact_person" {...register('contact_person')} className={inputClass} />
        </div>

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

        <div className="sm:col-span-2">
          <label htmlFor="email" className={labelClass}>
            Email
          </label>
          <input id="email" type="email" {...register('email')} className={inputClass} />
          {errors.email && <p className="mt-1 text-xs text-status-danger">{errors.email.message}</p>}
        </div>
      </div>

      <div>
        <label htmlFor="address" className={labelClass}>
          Address
        </label>
        <textarea id="address" rows={2} {...register('address')} className={inputClass} />
      </div>

      <div>
        <label htmlFor="notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="notes"
          rows={3}
          {...register('notes')}
          placeholder="Payment terms, lead times, quality history."
          className={inputClass}
        />
      </div>

      {serverError && (
        <p className="rounded-lg bg-status-danger/5 px-3 py-2 text-sm text-status-danger">⚠ {serverError}</p>
      )}

      <div className="flex items-center gap-3 border-t border-border-subtle pt-5">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-brand-gold px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60"
        >
          {isSubmitting ? 'Saving…' : mode === 'create' ? 'Add vendor' : 'Save changes'}
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
