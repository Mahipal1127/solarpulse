import 'server-only'

import { requireRole } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { AIChat } from '@/components/ceo/AIChat/AIChat'
import type { AISettingsPublic } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * The CEO's dashboard is a conversation.
 *
 * WHAT USED TO BE HERE
 * Stat cards, four charts, two widgets and the cross-department tiles. All of it now
 * lives on /analytics, which is the page built for reading numbers. Having both meant
 * two surfaces competing to be the overview and neither holding everything: a chart
 * cropped into a dashboard tile is worse than the same chart on an analytics page, and
 * a chat panel boxed at 30rem under six cards is worse than a chat.
 *
 * So each surface does one thing. Ask here; read there.
 *
 * WHY THE GREETING IS COMPUTED SERVER-SIDE
 * It depends on the clock, and a clock read during render is the classic hydration
 * mismatch — the server says "Good evening", the browser re-renders at "Good night",
 * and React discards the markup. Computed here, it is a plain string prop.
 *
 * THE KEY NEVER REACHES THIS FILE
 * Readiness comes from the `ai_settings_public` view, which exposes `has_api_key` as a
 * boolean. The key itself is not selectable here and is never sent to the browser.
 */

/**
 * Asia/Kolkata rather than the server's zone. Every other date in this app is
 * formatted 'en-IN' and money is INR, so the business runs on IST — a greeting derived
 * from a UTC host clock would tell a CEO "good morning" at half past five in the
 * evening.
 */
function greetingFor(fullName: string | null): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      hour12: false,
    }).format(new Date())
  )

  const timeOfDay =
    hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  // First name only. "Good morning, Mahipal Singh Rathore" is a form letter.
  const firstName = fullName?.trim().split(/\s+/)[0]
  return firstName ? `${timeOfDay}, ${firstName}` : timeOfDay
}

export default async function DashboardPage() {
  const user = await requireRole('CEO')
  const supabase = await createSupabaseServerClient()

  // Filtered explicitly rather than left to RLS alone: maybeSingle() errors rather
  // than returning null if more than one row comes back.
  const { data } = await supabase
    .from('ai_settings_public')
    .select('is_enabled, has_api_key, provider, model')
    .eq('organization_id', user.organization_id)
    .maybeSingle()

  const settings = data as Pick<
    AISettingsPublic,
    'is_enabled' | 'has_api_key' | 'provider' | 'model'
  > | null

  const ready = Boolean(settings?.is_enabled && settings?.has_api_key)

  /*
   * Three distinct causes, three distinct sentences. "The assistant is unavailable"
   * would leave the one person who can fix it with no idea which switch to throw.
   */
  const notReadyReason = !settings
    ? 'The assistant has not been set up for this organisation yet.'
    : !settings.has_api_key
      ? 'No provider API key has been added yet.'
      : 'The assistant is currently turned off.'

  return (
    <AIChat
      greeting={greetingFor(user.full_name)}
      ready={ready}
      notReadyReason={notReadyReason}
    />
  )
}
