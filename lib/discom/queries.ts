import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Picker data for the DISCOM forms. Every query runs on the session client, so the
 * cross-department read policies added in 0013 (discom_read_installations,
 * discom_read_customers) are what let DISCOM staff see these rows at all — nothing
 * here widens access, it only shapes what the policies already return.
 */

export interface CustomerOption {
  id: string
  name: string
  address: string | null
}

/** Customers in the org, for display fallbacks. */
export async function getCustomerOptions(organizationId: string): Promise<CustomerOption[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('customers')
    .select('id, name, address')
    .eq('organization_id', organizationId)
    .order('name')
    .limit(1000)

  return (data ?? []) as CustomerOption[]
}

/**
 * A case a document can hang off — a net-metering application or a subsidy case —
 * carrying the customer_id the storage path needs ('{org}/{customer}/{file}') and a
 * human label for the picker. RLS decides which come back: a liaison sees only their
 * own cases, so they can only file documents against work they own.
 */
export interface CaseOption {
  kind: 'net_metering' | 'subsidy'
  id: string
  customer_id: string
  label: string
}

export async function getCaseOptions(organizationId: string): Promise<CaseOption[]> {
  const supabase = await createSupabaseServerClient()

  const [{ data: nm }, { data: subsidy }] = await Promise.all([
    supabase
      .from('net_metering_applications')
      .select('id, customer_id, customer:customers(name)')
      .eq('organization_id', organizationId)
      .limit(500),
    supabase
      .from('subsidy_cases')
      .select('id, customer_id, scheme, customer:customers(name)')
      .eq('organization_id', organizationId)
      .limit(500),
  ])

  const nmRows = (nm ?? []) as unknown as Array<{
    id: string
    customer_id: string
    customer: { name: string } | null
  }>
  const subsidyRows = (subsidy ?? []) as unknown as Array<{
    id: string
    customer_id: string
    scheme: string
    customer: { name: string } | null
  }>

  return [
    ...nmRows.map((r) => ({
      kind: 'net_metering' as const,
      id: r.id,
      customer_id: r.customer_id,
      label: `Net metering — ${r.customer?.name ?? 'Unknown'}`,
    })),
    ...subsidyRows.map((r) => ({
      kind: 'subsidy' as const,
      id: r.id,
      customer_id: r.customer_id,
      label: `Subsidy (${r.scheme}) — ${r.customer?.name ?? 'Unknown'}`,
    })),
  ]
}

export interface CompletedInstallationOption {
  id: string
  address: string | null
  completed_date: string | null
  system_size_kw: number | null
  customer: { id: string; name: string } | null
  /** Whether a net-metering application already exists for this install. */
  hasNetMetering: boolean
  /** Whether a subsidy case already exists for this install. */
  hasSubsidy: boolean
}

/**
 * Completed installations, for the net-metering and subsidy creation pickers.
 *
 * Net metering and subsidy work only begins once a site is completed, so this picker
 * only offers completed installs — the same rule the service layer enforces
 * server-side (loadConvertibleInstallation). The hasNetMetering / hasSubsidy flags
 * let the form grey out an install whose paperwork is already started, mirroring the
 * O&M convertible-deal picker's "not yet converted" filter. Those nested reads are
 * subject to RLS (a liaison only sees their own cases), so the flags are exact for a
 * lead/CEO and a safe hint for a liaison — the server still rejects a duplicate via
 * the unique constraint regardless.
 */
export async function getCompletedInstallations(
  organizationId: string
): Promise<CompletedInstallationOption[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('installations')
    .select(
      'id, address, completed_date, system_size_kw, customer:customers(id, name), net_metering_applications(id), subsidy_cases(id)'
    )
    .eq('organization_id', organizationId)
    .eq('status', 'completed')
    .order('completed_date', { ascending: false, nullsFirst: false })
    .limit(500)

  const rows = (data ?? []) as unknown as Array<{
    id: string
    address: string | null
    completed_date: string | null
    system_size_kw: number | null
    customer: { id: string; name: string } | null
    net_metering_applications: Array<{ id: string }>
    subsidy_cases: Array<{ id: string }>
  }>

  return rows.map((r) => ({
    id: r.id,
    address: r.address,
    completed_date: r.completed_date,
    system_size_kw: r.system_size_kw,
    customer: r.customer,
    hasNetMetering: r.net_metering_applications.length > 0,
    hasSubsidy: r.subsidy_cases.length > 0,
  }))
}
