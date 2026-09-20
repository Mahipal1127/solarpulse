import Image from 'next/image'
import Link from 'next/link'
import { KioskClock } from '@/components/kiosk/KioskClock'
import { KioskScanner } from '@/components/kiosk/KioskScanner'
import logo from '@/public/logo.png'

export const dynamic = 'force-static'

/**
 * QR Attendance — the public, static page for the shared device at the door.
 * No session, no navigation chrome: an employee scans their ID card, the
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
 * loads it instantly and the only runtime work is the camera, the header
 * clock, and the two fetches a scan makes.
 */
export default function QrAttendancePage() {
  return (
    <main className="flex min-h-screen flex-col bg-surface-bg">
      {/* Three columns so the brand lockup sits dead-centre whatever the
          clock and the sign-in link do at the edges. */}
      <header className="grid grid-cols-[1fr_auto_1fr] items-center border-b border-border-subtle bg-surface-card px-4 py-3 sm:px-6 sm:py-4">
        <div className="justify-self-start">
          <KioskClock />
        </div>
        <div className="flex min-w-0 items-center gap-2.5 justify-self-center sm:gap-3.5">
          {/* The same trimmed lockup the sidebar uses (see SidebarBrand) —
              static-imported so the intrinsic 480x138 ratio drives the
              height; a square tile would crush a wide lockup. `priority`
              because this is the first paint on the door screen. Sized down
              on phones so the centred lockup still fits a 360px screen. */}
          <Image src={logo} alt="SolarPulse" priority className="h-auto w-28 sm:w-44" />
          <span aria-hidden className="hidden h-10 w-px bg-border-subtle sm:block" />
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight text-brand-slate sm:text-lg">QR Attendance</h1>
            <p className="hidden text-xs text-text-muted sm:block">Scan your ID card to mark in or out</p>
          </div>
        </div>
        <div className="justify-self-end">
          <Link
            href="/login"
            className="inline-block rounded-lg border border-border-subtle px-2.5 py-1.5 text-[11px] font-medium text-text-muted transition-colors hover:border-brand-gold/40 hover:text-brand-slate sm:px-3.5 sm:py-2 sm:text-xs"
          >
            Staff sign in
          </Link>
        </div>
      </header>

      <div className="flex flex-1 items-start justify-center px-4 py-8">
        <KioskScanner />
      </div>

      <footer className="border-t border-border-subtle bg-surface-card px-6 py-3 text-center text-[11px] text-text-muted">
        Hold the QR on your card inside the gold frame — the kiosk marks you in or out on its own.
      </footer>
    </main>
  )
}