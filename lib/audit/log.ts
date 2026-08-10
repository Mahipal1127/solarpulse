import 'server-only'

import { headers } from 'next/headers'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

export interface LogActionInput {
  organizationId: string
  /** null for system/AI-initiated actions */
  userId: string | null
  action: string
  entityType: string
  entityId?: string | null
  metadata?: Record<string, unknown>
}

async function clientIp(): Promise<string | null> {
  try {
    const h = await headers()
    const forwarded = h.get('x-forwarded-for')
    return forwarded?.split(',')[0]?.trim() ?? h.get('x-real-ip')
  } catch {
    return null
  }
}

/**
 * Writes an audit row. Uses the service-role client because no role has insert
 * rights on audit_logs — the log must not be forgeable or suppressible from the
 * browser.
 *
 * Never throws: a failed audit write must not roll back the action the caller
 * already performed, but it must be visible in the server logs.
 */
export async function logAction(input: LogActionInput): Promise<void> {
  try {
    const supabase = createSupabaseServiceClient()
    const { error } = await supabase.from('audit_logs').insert({
      organization_id: input.organizationId,
      user_id: input.userId,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      metadata: input.metadata ?? {},
      ip_address: await clientIp(),
    })
    if (error) console.error('[audit] insert failed', input.action, error.message)
  } catch (err) {
    console.error('[audit] insert threw', input.action, err)
  }
}

/**
 * Salary and personal-document reads are logged even for the CEO, per the
 * security blueprint.
 */
export async function logSensitiveAccess(
  organizationId: string,
  userId: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await logAction({
    organizationId,
    userId,
    action: 'sensitive_data.viewed',
    entityType,
    entityId,
    metadata: { ...metadata, sensitive: true },
  })
}
