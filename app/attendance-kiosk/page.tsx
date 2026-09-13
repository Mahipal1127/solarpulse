import Link from 'next/link'
import { KioskScanner } from '@/components/kiosk/KioskScanner'

export const dynamic = 'force-static'

/**
 * The QR attendance kiosk — a public, static page for the shared device at the
 * door. No session, no navigation chrome: an employee scans their ID card, the
 * screen shows their photo and name, the machine says the name out loud, and
 * the day's check-in or check-out is recorded (see lib/services/kiosk.ts for
 * the shift rules and the security model).
 *
 * PUBLIC ON PURPOSE. The page renders nothing sensitive — just the scanner and
 * an empty result panel until a card is presented. Every write is gated by the
 * 256-bit card token, exactly as POST /api/qr/resolve reads; where the kiosk
 * device sits beyond a trusted network, set QR_RESOLVE_SECRET and present it
 * as the x-kiosk-secret header from the kiosk's browser (a small userscript or
 * the kiosk's own shell).
 *
 * STATIC. force-static keeps this page as prebuilt HTML: the kiosk device
 * loads it instantly and the only runtime work is the camera and two fetches.
 */
export default function AttendanceKioskPage() {
  return (
    <main className="flex min-h-screen flex-col bg-surface-bg">
      <header className="flex items-center justify-between border-b border-border-subtle bg-surface-card px-6 py-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-brand-slate">Attendance kiosk</h1>
          <p className="text-xs text-text-muted">Scan your ID card to mark in or out</p>
        </div>
        <Link
          href="/login"
          className="text-xs font-medium text-text-muted transition-colors hover:text-brand-slate"
        >
          Staff sign in
        </Link>
      </header>

      <div className="flex flex-1 items-start justify-center px-4 py-8">
        <KioskScanner />
      </div>
    </main>
  )
}