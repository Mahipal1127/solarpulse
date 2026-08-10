'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge, EmptyState } from '@/components/ui/primitives'
import { MATERIAL_CATEGORY_LABELS } from '@/lib/format'
import { MATERIAL_CATEGORIES } from '@/lib/distribution/constants'
import type { Vendor } from '@/lib/types'

/**
 * Vendor directory with client-side filters.
 *
 * Filtering here is a display convenience over rows RLS already decided to
 * return — the page query deliberately carries no organization filter of its own.
 *
 * Inactive vendors are hidden by default but reachable through the toggle rather
 * than dropped: they are soft-deleted, so historical purchase orders still point
 * at them and someone will need to find one to reinstate it.
 */
export function VendorList({ vendors, readOnly }: { vendors: Vendor[]; readOnly: boolean }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return vendors.filter((v) => {
      if (!showInactive && !v.is_active) return false
      if (category && v.category !== category) return false
      if (!q) return true
      return (
        v.name.toLowerCase().includes(q) ||
        (v.contact_person ?? '').toLowerCase().includes(q) ||
        (v.phone ?? '').toLowerCase().includes(q) ||
        (v.gstin ?? '').toLowerCase().includes(q)
      )
    })
  }, [vendors, query, category, showInactive])

  const inactiveCount = vendors.filter((v) => !v.is_active).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, contact, phone or GSTIN"
          aria-label="Search vendors"
          className="min-w-56 flex-1 rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none transition-colors focus:border-brand-gold"
        />

        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
          className="rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none transition-colors focus:border-brand-gold"
        >
          <option value="">All categories</option>
          {MATERIAL_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {MATERIAL_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>

        {inactiveCount > 0 && (
          <label className="flex items-center gap-2 text-xs font-medium text-text-muted">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-4 w-4 rounded border-border-subtle text-brand-slate "
            />
            Show inactive ({inactiveCount})
          </label>
        )}

        {!readOnly && (
          <Link
            href="/distribution/vendors/new"
            className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange"
          >
            New vendor
          </Link>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={vendors.length === 0 ? 'No vendors yet' : 'No vendors match these filters'}
          description={
            vendors.length === 0
              ? 'Add the suppliers you raise purchase orders against.'
              : 'Try a different search or category.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-subtle bg-white shadow-sm">
          <table className="min-w-full divide-y divide-border-subtle">
            <thead className="bg-surface-bg">
              <tr>
                <Th>Vendor</Th>
                <Th>Category</Th>
                <Th>Contact</Th>
                <Th>GSTIN</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {filtered.map((vendor) => (
                <tr key={vendor.id} className="transition-colors hover:bg-surface-bg">
                  <td className="px-4 py-3">
                    <Link
                      href={`/distribution/vendors/${vendor.id}`}
                      className="text-sm font-medium text-brand-slate hover:text-brand-slate"
                    >
                      {vendor.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-text-muted">
                    {vendor.category ? MATERIAL_CATEGORY_LABELS[vendor.category] ?? vendor.category : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-muted">
                    {vendor.contact_person || '—'}
                    {vendor.phone && (
                      <span className="mt-0.5 block text-xs text-text-muted/60">{vendor.phone}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-text-muted">{vendor.gstin || '—'}</td>
                  <td className="px-4 py-3">
                    <Badge
                      className={
                        vendor.is_active
                          ? 'bg-status-success/10 text-status-success ring-status-success/25'
                          : 'bg-surface-bg text-text-muted ring-border-subtle'
                      }
                    >
                      {vendor.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
      {children}
    </th>
  )
}
