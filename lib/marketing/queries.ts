import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Lightweight option loaders for the Marketing forms. Each runs under RLS, so a
 * picker only offers what the caller may actually reference — an employee sees their
 * own campaigns and content in the lead-source dropdowns, a lead sees the department's.
 */

const OPTION_CAP = 500

export type CampaignOption = { id: string; name: string; status: string }

/** Campaigns for the lead-handoff origin picker and the "log lead" action on a campaign. */
export async function getCampaignOptions(organizationId: string): Promise<CampaignOption[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('campaigns')
    .select('id, name, status')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(OPTION_CAP)

  return (data ?? []) as unknown as CampaignOption[]
}

export type ContentItemOption = { id: string; title: string; scheduled_date: string }

/** Content items for the lead-handoff "came from this post" origin picker. */
export async function getContentItemOptions(organizationId: string): Promise<ContentItemOption[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('content_calendar_items')
    .select('id, title, scheduled_date')
    .eq('organization_id', organizationId)
    .order('scheduled_date', { ascending: false })
    .limit(OPTION_CAP)

  return (data ?? []) as unknown as ContentItemOption[]
}
