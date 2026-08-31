import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { ServiceError } from '@/lib/services/tasks'
import type { SessionUser } from '@/lib/auth/guards'
import type { CompanyDetailsInput } from '@/lib/validation/schemas'
import type { CompanyDetails } from '@/lib/types'

/**
 * The company contact footer printed on every ID card — one row per organization
 * (0023). Read by anyone in the org; written only by the CEO / HR lead, which RLS
 * enforces (leads_insert/update_company_details). We use the SESSION client
 * throughout so those policies are the access control, exactly as the rest of HR
 * works — no service-client bypass here, because nothing about the footer is secret
 * or needs to escape RLS.
 */

/** The org's footer, or null if it has never been set. */
export async function getCompanyDetails(organizationId: string): Promise<CompanyDetails | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('company_details')
    .select('*')
    .eq('organization_id', organizationId)
    .maybeSingle()
  return (data as CompanyDetails | null) ?? null
}

/** Trim to null: '' and whitespace-only become null so the card renders a clean blank. */
function blankToNull(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Upsert the org's single footer row. RLS decides whether the write is allowed (CEO
 * / HR lead); a refusal surfaces as an empty result, which we translate to a clean
 * 403 rather than a silent no-op.
 */
export async function upsertCompanyDetails(
  user: SessionUser,
  input: CompanyDetailsInput
): Promise<CompanyDetails> {
  const supabase = await createSupabaseServerClient()

  const row = {
    organization_id: user.organization_id,
    address: blankToNull(input.address),
    phone: blankToNull(input.phone),
    email: blankToNull(input.email),
    updated_by: user.id,
  }

  const { data, error } = await supabase
    .from('company_details')
    .upsert(row, { onConflict: 'organization_id' })
    .select('*')
    .maybeSingle()

  if (error) throw new ServiceError(error.message, 400)
  if (!data) throw new ServiceError('Only the CEO or HR lead can edit company details', 403)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'company_details_updated',
    entityType: 'organization',
    entityId: user.organization_id,
    metadata: { fields: Object.keys(row).filter((k) => k !== 'organization_id' && k !== 'updated_by') },
  })

  return data as CompanyDetails
}
