import Link from 'next/link'
import { requireDepartment } from '@/lib/auth/guards'
import { STORE_DEPARTMENT_SLUG } from '@/lib/store/constants'
import { getMarketSurveyNotes } from '@/lib/store/dashboard'
import { Card, CardHeader } from '@/components/ui/primitives'
import { MarketSurveyList } from '@/components/store/MarketSurveyList/MarketSurveyList'

export const dynamic = 'force-dynamic'

/** Market-survey field log — lightweight area observations. */
export default async function MarketSurveyPage() {
  await requireDepartment(STORE_DEPARTMENT_SLUG)
  const notes = await getMarketSurveyNotes()

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">Market survey</h1>
          <p className="mt-1 text-sm text-text-muted">
            Observations from the field, newest first.
          </p>
        </div>
        <Link
          href="/store/market-survey/new"
          className="shrink-0 rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-orange"
        >
          Add note
        </Link>
      </header>

      <Card>
        <CardHeader title="Survey notes" subtitle={`${notes.length} logged`} />
        <MarketSurveyList notes={notes} />
      </Card>
    </div>
  )
}
