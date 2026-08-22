import 'server-only'

import QRCode from 'qrcode'

/**
 * Renders an opaque token string to a QR PNG data URI, for embedding in the ID card.
 *
 * The input is ALWAYS the qr_tokens.token value — never a user id, email, or URL. The QR carries
 * exactly that string and nothing else; resolution to an identity happens server-side via
 * /api/qr/resolve. Kept tiny (margin 1, medium error correction) so the data URI stays well under
 * the next/og 500KB bundle ceiling when embedded in the card.
 */
export async function tokenToQrDataUri(token: string): Promise<string> {
  return QRCode.toDataURL(token, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 240,
    color: { dark: '#1a2332', light: '#ffffff' },
  })
}
