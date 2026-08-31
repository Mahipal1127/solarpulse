'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  IdCardFront,
  IdCardBack,
  CARD_WIDTH,
  CARD_HEIGHT,
  type CardFooter,
} from './cardLayout'
import { WhatsAppShareButton } from './WhatsAppShareButton'

/**
 * The on-screen ID card: the SAME IdCardFront / IdCardBack the server renders to PNG, shown live
 * so HR sees exactly what the generated two-sided card looks like. Each side scales the fixed
 * 620×1000 layout down responsively with a CSS transform (Satori needs fixed sizes, and matching
 * them keeps preview and PNG identical). The logo is loaded from the public URL for the preview;
 * the server bakes it in as a data URI.
 *
 * Below the cards sit the actions the feature supports:
 *  - Download PDF — the real, printable two-page artifact (front + back), built on demand.
 *  - Download the front PNG — a quick shareable image.
 *  - Share via WhatsApp — a wa.me link that pre-fills TEXT ONLY. WhatsApp cannot pre-attach an
 *    image from a link, so the copy says so and tells the sender to attach the downloaded card.
 *
 * Management actions (regenerate after a photo change, revoke+reissue for a lost card) show only
 * when `canManage`. Regenerate is cosmetic and keeps the token; revoke rotates it.
 */

const LOGO_URL = '/logo.png'

export function IDCardPreview({
  employeeId,
  fullName,
  designation,
  employeeCode,
  dateJoined,
  phone,
  email,
  organizationName,
  qrSrc,
  photoSrc,
  footer,
  cardImageUrl,
  generatedAt,
  canManage,
  whatsappNumber,
}: {
  employeeId: string
  fullName: string
  designation: string | null
  employeeCode: string | null
  dateJoined: string | null
  phone: string | null
  email: string | null
  organizationName: string
  /** QR data URI for the LIVE preview. The downloaded PNG has its own embedded QR. */
  qrSrc: string
  photoSrc: string | null
  footer: CardFooter
  /** Signed URL of the generated front PNG, or null if none generated yet. */
  cardImageUrl: string | null
  generatedAt: string | null
  canManage: boolean
  whatsappNumber: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | 'generate' | 'revoke'>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function generate() {
    setBusy('generate')
    setError(null)
    setNotice(null)
    const res = await fetch(`/api/employees/${employeeId}/id-card`, { method: 'POST' })
    setBusy(null)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not generate the card.')
      return
    }
    setNotice('Card regenerated. The QR token is unchanged.')
    router.refresh()
  }

  async function revoke() {
    if (
      !confirm(
        'Revoke this card and issue a new QR token? The current card will stop working for attendance immediately. Use this only if the card was lost or copied.'
      )
    )
      return
    setBusy('revoke')
    setError(null)
    setNotice(null)
    const res = await fetch(`/api/employees/${employeeId}/id-card/revoke`, { method: 'POST' })
    setBusy(null)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not revoke the card.')
      return
    }
    setNotice('Token revoked and a fresh card issued. Re-download and reshare the new card.')
    router.refresh()
  }

  // Scale the fixed layout to fit a ~260px-wide column while preserving the 620×1000 aspect.
  const scale = 260 / CARD_WIDTH

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-6">
        <PreviewSide scale={scale} label="Front">
          <IdCardFront
            fullName={fullName}
            designation={designation}
            employeeCode={employeeCode}
            dateJoined={dateJoined}
            phone={phone}
            email={email}
            logoSrc={LOGO_URL}
            photoSrc={photoSrc}
            footer={footer}
          />
        </PreviewSide>

        <PreviewSide scale={scale} label="Back">
          <IdCardBack qrSrc={qrSrc} logoSrc={LOGO_URL} footer={footer} />
        </PreviewSide>
      </div>

      {generatedAt ? (
        <p className="text-xs text-text-muted">
          Card generated {new Date(generatedAt).toLocaleDateString()}.
        </p>
      ) : (
        <p className="text-xs text-text-muted">
          No card has been generated yet{canManage ? ' — generate one below.' : '.'}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {cardImageUrl && (
          <>
            <a
              href={`/api/employees/${employeeId}/id-card/pdf`}
              className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
            >
              Download PDF
            </a>
            <a
              href={cardImageUrl}
              download={`id-card-${employeeCode ?? employeeId}.png`}
              className="rounded-lg border border-border-subtle px-4 py-2 text-sm font-medium text-brand-slate transition-colors hover:border-brand-gold"
            >
              Download front (PNG)
            </a>
          </>
        )}

        <WhatsAppShareButton
          fullName={fullName}
          organizationName={organizationName}
          whatsappNumber={whatsappNumber}
          hasCard={Boolean(cardImageUrl)}
        />

        {canManage && (
          <button
            onClick={generate}
            disabled={busy !== null}
            className="rounded-lg border border-border-subtle px-4 py-2 text-sm font-medium text-brand-slate transition-colors hover:border-brand-gold disabled:opacity-60"
          >
            {busy === 'generate' ? 'Generating…' : cardImageUrl ? 'Regenerate' : 'Generate card'}
          </button>
        )}

        {canManage && cardImageUrl && (
          <button
            onClick={revoke}
            disabled={busy !== null}
            className="rounded-lg border border-status-danger/30 px-4 py-2 text-sm font-medium text-status-danger transition-colors hover:bg-status-danger/5 disabled:opacity-60"
          >
            {busy === 'revoke' ? 'Revoking…' : 'Revoke & reissue'}
          </button>
        )}
      </div>

      {canManage && (
        <p className="text-xs text-text-muted">
          Regenerate keeps the same QR (use it after a photo change). Revoke &amp; reissue rotates
          the QR token and invalidates the old card — use it only if a card was lost or copied.
        </p>
      )}

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
      {notice && <p className="text-xs text-status-success">✓ {notice}</p>}
    </div>
  )
}

/** One scaled card side with a small caption. */
function PreviewSide({
  scale,
  label,
  children,
}: {
  scale: number
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div
        className="relative overflow-hidden rounded-2xl border border-border-subtle"
        style={{ width: CARD_WIDTH * scale, height: CARD_HEIGHT * scale }}
      >
        <div
          style={{
            width: CARD_WIDTH,
            height: CARD_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {children}
        </div>
      </div>
      <p className="text-center text-xs font-medium text-text-muted">{label}</p>
    </div>
  )
}
