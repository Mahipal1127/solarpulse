import type { ReactElement } from 'react'

/**
 * The single source of truth for the ID card's visual layout — now a PORTRAIT,
 * TWO-SIDED card that matches the printed SolarPulse template:
 *
 *   FRONT — logo, photo, name, designation, and an ID No / Join Date / Phone /
 *           E-mail detail block, over a company contact footer.
 *   BACK  — logo, the Terms & Conditions, the big attendance QR, same footer.
 *
 * WHY ONE SHARED FILE FOR BOTH SIDES. Each side appears in two places that must look
 * identical: the server-rendered PNG (next/og ImageResponse) and the on-screen
 * preview. Duplicating the layout would let them drift. So each side is a plain
 * inline-styled element used by both.
 *
 * WHY INLINE STYLES + FLEXBOX ONLY. Satori (what ImageResponse runs) supports only
 * flexbox and a subset of CSS — no grid, no className/Tailwind, no external
 * stylesheet. Every style here is an inline flexbox property, and the brand hexes are
 * hardcoded (Satori can't read CSS variables). The values match app/globals.css:
 * gold #f5a623, orange #f7941d, slate #1a2332.
 *
 * WHY DATA-URI ASSETS. The logo, QR and photo all arrive as data URIs (or any src
 * Satori/img accepts), prepared by the caller. Satori embeds them directly; nothing
 * is fetched during render. Keeping asset prep out of here is also what lets the
 * preview component pass browser-friendly URLs for a quick on-screen render.
 */

export const CARD_WIDTH = 620
export const CARD_HEIGHT = 1000

const GOLD = '#f7c948'
const GOLD_DEEP = '#f5a623'
const SLATE = '#1a2332'
const CARD_BG = '#ffffff'
// The soft gray "echo" swoosh that trails the gold curve on the front.
const GRAY_SWOOSH = '#e9eaec'
// A calmer slate for the detail-block labels, sitting a shade lighter than the value.
const LABEL_COLOR = '#2b3444'

/** Shared contact footer content, printed identically on both sides. */
export interface CardFooter {
  address: string | null
  phone: string | null
  email: string | null
}

/**
 * The Solar Pulse footer, used when a field has not been set in Company Details. A
 * card should never render a blank footer just because the org row is missing — the
 * printed template always carries these, and Company Details overrides them.
 */
const DEFAULT_FOOTER: { address: string; phone: string; email: string } = {
  address: 'Behind Central Bank of India, Kheme ka Kua, Pal Road, Jodhpur (Raj.)',
  phone: '+91-97722 22318',
  email: 'solarpulseindia@gmail.com',
}

export interface CardFrontProps {
  fullName: string
  designation: string | null
  employeeCode: string | null
  dateJoined: string | null
  phone: string | null
  email: string | null
  /** SolarPulse logo as a data URI (or any src Satori/img accepts). */
  logoSrc: string
  /** Profile photo as a data URI or URL; null renders an initials tile. */
  photoSrc: string | null
  footer: CardFooter
}

export interface CardBackProps {
  /** Pre-rendered attendance QR as a data URI. */
  qrSrc: string
  logoSrc: string
  footer: CardFooter
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

/**
 * The FRONT background as a single full-card SVG: white base, a soft gray "echo"
 * swoosh, and the gold body whose TOP edge is a diagonal curve (low on the left,
 * rising to the right) and whose BOTTOM edge is a gentle wave leaving a white footer
 * strip. Drawn once as a full 620×1000 image behind the content — Satori has no
 * clip-path, so the curves have to live in SVG rather than CSS.
 */
function frontBackgroundSvg(): string {
  const W = CARD_WIDTH
  const H = CARD_HEIGHT
  // Gold body: curved top (y≈505 left → y≈388 right), gentle wavy bottom (y≈905)
  // above the white footer strip.
  const gold = `M0,505 C160,480 390,372 ${W},388 L${W},905 C${W * 0.66},878 ${W * 0.32},930 0,898 Z`
  // Gray echo: a RIGHT-HEAVY crescent. Its lower edge is the gold's top curve, and
  // its upper edge starts at the SAME left point (0,505) — so the band is zero-width
  // on the left — then rises well above the gold on the right, opening the crescent
  // beside the photo, exactly as in the printed template.
  const gray = `M0,505 C170,468 400,300 ${W},322 L${W},388 C390,372 160,480 0,505 Z`
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="${CARD_BG}"/>` +
    `<path d="${gray}" fill="${GRAY_SWOOSH}"/>` +
    `<path d="${gold}" fill="${GOLD}"/>` +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** Full-card background image for the front. */
function FrontBackground(): ReactElement {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={frontBackgroundSvg()}
      alt=""
      width={CARD_WIDTH}
      height={CARD_HEIGHT}
      style={{ position: 'absolute', top: 0, left: 0, width: CARD_WIDTH, height: CARD_HEIGHT }}
    />
  )
}

/**
 * The BACK background as a single full-card SVG: white base with a flowing two-tone
 * gold wave at the TOP and a mirrored one at the BOTTOM (pale gold behind, brand gold
 * in front — the layered ribbon of the printed template). The middle stays white for
 * the terms and the QR; the footer sits over the bottom gold.
 */
function backBackgroundSvg(): string {
  const W = CARD_WIDTH
  const H = CARD_HEIGHT
  // Top waves: gold fills from the top edge down to a flowing line.
  const topBack = `M0,0 H${W} V138 C${W * 0.68},185 ${W * 0.3},70 0,120 Z`
  const topFront = `M0,0 H${W} V108 C${W * 0.66},158 ${W * 0.32},44 0,92 Z`
  // Bottom waves: mirror of the top, gold fills from a flowing line to the bottom.
  const botBack = `M0,${H} H${W} V${H - 138} C${W * 0.68},${H - 185} ${W * 0.3},${H - 70} 0,${H - 120} Z`
  const botFront = `M0,${H} H${W} V${H - 108} C${W * 0.66},${H - 158} ${W * 0.32},${H - 44} 0,${H - 92} Z`
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="${CARD_BG}"/>` +
    `<path d="${topBack}" fill="${GOLD}" opacity="0.45"/>` +
    `<path d="${topFront}" fill="${GOLD}"/>` +
    `<path d="${botBack}" fill="${GOLD}" opacity="0.45"/>` +
    `<path d="${botFront}" fill="${GOLD}"/>` +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** Full-card background image for the back. */
function BackBackground(): ReactElement {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={backBackgroundSvg()}
      alt=""
      width={CARD_WIDTH}
      height={CARD_HEIGHT}
      style={{ position: 'absolute', top: 0, left: 0, width: CARD_WIDTH, height: CARD_HEIGHT }}
    />
  )
}

/**
 * The three footer marks as SVG data-URI images — a SOLID gold pin, phone, and
 * envelope, matching the printed template. Text glyphs (◉ ✆ ✉) render thin and
 * hollow and vary by font, so the icons are drawn explicitly instead. Each is a
 * 24×24 gold shape on a transparent ground.
 */
function iconUri(paths: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="${GOLD_DEEP}">${paths}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

// Solid map pin with a hollow center.
const PIN_ICON = iconUri(
  '<path d="M12 2C7.6 2 4 5.6 4 10c0 5.2 7 11.5 7.3 11.7.4.4 1 .4 1.4 0C13 21.5 20 15.2 20 10c0-4.4-3.6-8-8-8zm0 11a3 3 0 110-6 3 3 0 010 6z"/>'
)
// Phone handset inside a filled circle.
const PHONE_ICON = iconUri(
  '<circle cx="12" cy="12" r="11"/><path fill="#fff" d="M9 6.2c.3 0 .5.2.6.4l.9 2c.1.3 0 .6-.2.8l-1 .9c.7 1.4 1.8 2.5 3.2 3.2l.9-1c.2-.2.5-.3.8-.2l2 .9c.2.1.4.3.4.6v2c0 .5-.4.9-.9.9C10.9 19.6 4.4 13.1 4.3 6.9c0-.5.4-.9.9-.9z"/>'
)
// Envelope.
const MAIL_ICON = iconUri(
  '<path d="M3 5h18c.6 0 1 .4 1 1v12c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V6c0-.6.4-1 1-1zm9 7L4 6.8V18h16V6.8L12 12z"/>'
)

/** One gold icon + label line in the footer. */
function FooterLine({ icon, text }: { icon: string; text: string }): ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={icon} alt="" width={18} height={18} style={{ width: 18, height: 18 }} />
      <span style={{ fontSize: 13, color: SLATE }}>{text}</span>
    </div>
  )
}

/**
 * The contact footer rows (address, then phone + email), with the gold pin/phone/mail
 * icons. Transparent — the caller decides what it sits on: a white strip on the
 * FRONT, over the bottom gold wave on the BACK. Falls back to the Solar Pulse
 * defaults for any field Company Details has not set, so it is never blank.
 */
function FooterContent({ footer }: { footer: CardFooter }): ReactElement {
  const address = footer.address ?? DEFAULT_FOOTER.address
  const phone = footer.phone ?? DEFAULT_FOOTER.phone
  const email = footer.email ?? DEFAULT_FOOTER.email
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <FooterLine icon={PIN_ICON} text={address} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <FooterLine icon={PHONE_ICON} text={phone} />
        <FooterLine icon={MAIL_ICON} text={email} />
      </div>
    </div>
  )
}

/**
 * FRONT of the card. Distinct from the back:
 *   - Pure white top (no wave) — the SolarPulse logo, then the photo.
 *   - A gold body with a CURVED diagonal top edge (low-left, rising right) and a
 *     soft gray echo swoosh behind it, drawn by frontBackgroundSvg().
 *   - Centered name + designation and the left-aligned, colon-aligned detail rows
 *     sit on the gold.
 *   - A white footer strip at the bottom with the contact block.
 *
 * The curved shapes live in the SVG background; the content is layered over it with
 * absolute positioning (Satori supports position:absolute + top/left), which is the
 * only way to place text precisely against a curve it cannot flow around.
 */
export function IdCardFront({
  fullName,
  designation,
  employeeCode,
  dateJoined,
  phone,
  email,
  logoSrc,
  photoSrc,
  footer,
}: CardFrontProps): ReactElement {
  return (
    <div
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        display: 'flex',
        fontFamily: 'Inter, sans-serif',
        position: 'relative',
      }}
    >
      <FrontBackground />

      {/* Logo, centered on white near the top. */}
      <div
        style={{
          position: 'absolute',
          top: 62,
          left: 0,
          width: CARD_WIDTH,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoSrc} alt="SolarPulse" height={124} style={{ height: 124, objectFit: 'contain' }} />
      </div>

      {/* Photo, centered, straddling the gold curve. */}
      <div
        style={{
          position: 'absolute',
          top: 225,
          left: 0,
          width: CARD_WIDTH,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        {photoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoSrc}
            alt=""
            width={260}
            height={295}
            style={{ width: 260, height: 295, borderRadius: 26, objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 260,
              height: 295,
              borderRadius: 26,
              backgroundColor: SLATE,
              color: '#ffffff',
              fontSize: 96,
              fontWeight: 700,
            }}
          >
            {initials(fullName)}
          </div>
        )}
      </div>

      {/* Name + designation, centered on the gold below the photo. */}
      <div
        style={{
          position: 'absolute',
          top: 545,
          left: 0,
          width: CARD_WIDTH,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 44, fontWeight: 700, color: SLATE, textAlign: 'center' }}>
          {fullName.toUpperCase()}
        </span>
        {designation ? (
          <span style={{ fontSize: 22, color: SLATE, marginTop: 10, letterSpacing: '0.22em' }}>
            {designation.toUpperCase()}
          </span>
        ) : null}
      </div>

      {/* Detail rows, left-aligned on the gold. */}
      <div
        style={{
          position: 'absolute',
          top: 668,
          left: 62,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
        }}
      >
        <DetailRow label="ID No" value={employeeCode} />
        <DetailRow label="Join Date" value={dateJoined} />
        <DetailRow label="Phone" value={phone} />
        <DetailRow label="E-mail" value={email} />
      </div>

      {/* Footer on the white strip at the bottom. */}
      <div style={{ position: 'absolute', bottom: 34, left: 40, display: 'flex' }}>
        <FooterContent footer={footer} />
      </div>
    </div>
  )
}

/**
 * One "label  : value" line in the gold identity panel. The label column is fixed so
 * every colon lines up, matching the printed template.
 */
function DetailRow({ label, value }: { label: string; value: string | null }): ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'baseline' }}>
      <span style={{ fontSize: 21, color: LABEL_COLOR, width: 150 }}>{label}</span>
      <span style={{ fontSize: 21, color: SLATE, fontWeight: 600 }}>{`: ${value ?? '—'}`}</span>
    </div>
  )
}

/**
 * BACK of the card. White body with a two-tone gold wave top and bottom (drawn by
 * backBackgroundSvg), holding, top-to-bottom:
 *   - the SolarPulse logo, centered on white below the top wave;
 *   - the attendance QR, centered in a white rounded box with a gold border;
 *   - a bold left-aligned TERMS & CONDITIONS heading and its six bullet lines;
 *   - the contact footer, sitting OVER the bottom gold wave (unlike the front, whose
 *     footer is on a white strip).
 *
 * Laid out with the background as one absolute layer and ALL content (logo → QR →
 * terms) in a SECOND absolute layer stacked over it, plus the absolute footer. Nothing
 * sits in the root's normal flow: Satori does not reliably pull a `position: absolute`
 * element out of a flex column, so a full-card background used as a flex sibling
 * consumes the column's height and pushes the in-flow content off the card. Keeping
 * every layer absolute (as the front does) renders identically in Satori and the
 * browser.
 */
export function IdCardBack({ qrSrc, logoSrc, footer }: CardBackProps): ReactElement {
  return (
    <div
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        display: 'flex',
        fontFamily: 'Inter, sans-serif',
        position: 'relative',
      }}
    >
      <BackBackground />

      {/* All content, as one absolute layer over the background: logo → QR → terms. */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {/* Logo, centered on white below the top wave. */}
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 84 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoSrc} alt="SolarPulse" height={68} style={{ height: 68, objectFit: 'contain' }} />
        </div>

        {/* Attendance QR in a gold-bordered white box, centered, directly under the logo. */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 28 }}>
          <div
            style={{
              display: 'flex',
              padding: 16,
              borderRadius: 18,
              backgroundColor: CARD_BG,
              border: `4px solid ${GOLD}`,
              boxShadow: '0 8px 22px rgba(26,35,50,0.12)',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} alt="" width={224} height={224} style={{ width: 224, height: 224 }} />
          </div>
        </div>

        {/* Terms & Conditions, below the QR. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignSelf: 'stretch',
            padding: '30px 44px 0 44px',
          }}
        >
          <span style={{ fontSize: 27, fontWeight: 700, color: SLATE, letterSpacing: '0.01em' }}>
            TERMS &amp; CONDITIONS
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 14 }}>
            {TERMS.map((term) => (
              <div key={term} style={{ display: 'flex', flexDirection: 'row', alignItems: 'flex-start' }}>
                <span style={{ fontSize: 15, color: GOLD_DEEP, marginRight: 10, lineHeight: 1.35, fontWeight: 700 }}>•</span>
                <span style={{ fontSize: 15, color: SLATE, lineHeight: 1.35 }}>{term}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer, over the bottom gold wave. */}
      <div style={{ position: 'absolute', bottom: 36, left: 40, display: 'flex' }}>
        <FooterContent footer={footer} />
      </div>
    </div>
  )
}

/**
 * The card's terms. Fixed brand copy from the printed template — not per-employee
 * data, so it lives here rather than in the database.
 */
const TERMS: readonly string[] = [
  'This card is the property of Solar Pulse India.',
  'This card is non-transferable and must be carried by the authorized employee.',
  'This card must be surrendered upon request or termination of employment.',
  'If found, please return this card to the company at the address mentioned below.',
  'Any unauthorized use, alteration, or misuse of this card is strictly prohibited.',
  'The company reserves the right to deactivate or withdraw this card when required.',
]
