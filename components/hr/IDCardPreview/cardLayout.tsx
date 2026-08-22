import type { CSSProperties, ReactElement } from 'react'

/**
 * The single source of truth for the ID card's visual layout.
 *
 * WHY ONE SHARED FUNCTION. The card appears in two places that must look identical: the
 * server-rendered PNG (next/og ImageResponse) and the on-screen preview. Duplicating the layout
 * would let them drift. So this returns a plain inline-styled element used by both.
 *
 * WHY INLINE STYLES + FLEXBOX ONLY. Satori (what ImageResponse runs) supports only flexbox and a
 * subset of CSS — no grid, no className/Tailwind, no external stylesheet. Every style here is an
 * inline flexbox property, and the brand hexes are hardcoded (Satori can't read CSS variables).
 * The values match app/globals.css exactly: gold #f5a623, orange #f7941d, slate #1a2332.
 *
 * WHY DATA-URI ASSETS. The QR arrives as a PNG data URI and the photo as an optional data URI,
 * both prepared by the caller. Satori embeds them directly; nothing is fetched during render, and
 * neither counts against a network round-trip. Keeping asset prep out of here is also what lets
 * the preview page pass a browser-friendly URL when it just wants a quick on-screen render.
 */

export const CARD_WIDTH = 640
export const CARD_HEIGHT = 400

const GOLD = '#f5a623'
const ORANGE = '#f7941d'
const SLATE = '#1a2332'
const MUTED = '#6b7280'
const BORDER = '#e5e7eb'
const CARD_BG = '#ffffff'

export interface CardLayoutProps {
  fullName: string
  designation: string | null
  departmentName: string | null
  employeeCode: string | null
  organizationName: string
  /** Pre-rendered QR as a data URI (or any src Satori/img accepts). */
  qrSrc: string
  /** Profile photo as a data URI or URL; null renders an initials tile. */
  photoSrc: string | null
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

const rootStyle: CSSProperties = {
  width: CARD_WIDTH,
  height: CARD_HEIGHT,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: CARD_BG,
  // Gold used sparingly as an accent, never a fill — a thin top strip is the whole flourish.
  border: `1px solid ${BORDER}`,
  fontFamily: 'Inter, sans-serif',
}

/** The card element. Rendered by both ImageResponse and the preview component. */
export function IdCardLayout({
  fullName,
  designation,
  departmentName,
  employeeCode,
  organizationName,
  qrSrc,
  photoSrc,
}: CardLayoutProps): ReactElement {
  return (
    <div style={rootStyle}>
      {/* Gold/orange accent strip — the one bold brand touch, kept thin. */}
      <div
        style={{
          display: 'flex',
          height: 10,
          width: '100%',
          background: `linear-gradient(90deg, ${GOLD} 0%, ${ORANGE} 100%)`,
        }}
      />

      {/* Company name row */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '20px 28px 0 28px' }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: SLATE, letterSpacing: '-0.01em' }}>
          {organizationName}
        </span>
      </div>

      {/* Body: identity on the left, QR on the right */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          flex: 1,
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 28px 24px 28px',
        }}
      >
        {/* Photo + name/designation */}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
          {photoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoSrc}
              alt=""
              width={120}
              height={120}
              style={{ width: 120, height: 120, borderRadius: 16, objectFit: 'cover' }}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 120,
                height: 120,
                borderRadius: 16,
                backgroundColor: SLATE,
                color: '#ffffff',
                fontSize: 44,
                fontWeight: 700,
              }}
            >
              {initials(fullName)}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 22, maxWidth: 300 }}>
            <span style={{ fontSize: 26, fontWeight: 700, color: SLATE, lineHeight: 1.15 }}>
              {fullName}
            </span>
            {designation ? (
              <span style={{ fontSize: 15, color: MUTED, marginTop: 6 }}>{designation}</span>
            ) : null}
            {departmentName ? (
              <span style={{ fontSize: 14, color: MUTED, marginTop: 2 }}>{departmentName}</span>
            ) : null}
            {employeeCode ? (
              <span style={{ fontSize: 13, color: SLATE, marginTop: 10, fontWeight: 600 }}>
                ID: {employeeCode}
              </span>
            ) : null}
          </div>
        </div>

        {/* QR — encodes the opaque attendance token, nothing else */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrSrc} alt="" width={110} height={110} style={{ width: 110, height: 110 }} />
          <span style={{ fontSize: 10, color: MUTED, marginTop: 6 }}>Scan for attendance</span>
        </div>
      </div>
    </div>
  )
}
