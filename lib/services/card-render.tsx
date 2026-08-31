import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ImageResponse } from 'next/og'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { collectCardData, storeCardImages, type StoredCardPaths } from '@/lib/services/id-cards'
import { tokenToQrDataUri } from '@/lib/services/qr'
import { HR_DOCUMENTS_BUCKET } from '@/lib/hr/constants'
import { formatDate } from '@/lib/format'
import { IdCardFront, IdCardBack, CARD_WIDTH, CARD_HEIGHT } from '@/components/hr/IDCardPreview/cardLayout'

/**
 * Renders an employee's two-sided ID card to PNGs (front + back) and stores both,
 * returning their storage paths. This is the one place card generation happens —
 * onboarding and the manual regenerate route both call it, so the "gather data →
 * draw both sides → store" sequence never diverges.
 *
 * It regenerates the IMAGES only; it never rotates the token. collectCardData reuses
 * the existing active token (minting one only if none exists), so a photo-driven
 * regenerate keeps the old QR valid. Token rotation is revokeAndReissueToken's job.
 *
 * The profile photo is embedded as a data URI fetched here (via a short-lived signed
 * URL on the service client), NOT bundled — next/og caps the bundle at 500KB, and a
 * photo is exactly the kind of asset the docs say to fetch at runtime. The logo is a
 * small static file read once from disk and shared by both sides.
 */
export async function generateAndStoreCard(employeeId: string): Promise<StoredCardPaths> {
  const service = createSupabaseServiceClient()

  const data = await collectCardData(service, employeeId)
  const [qrSrc, photoSrc, logoSrc] = await Promise.all([
    tokenToQrDataUri(data.token),
    photoDataUri(service, data.profilePhotoPath),
    logoDataUri(),
  ])

  const frontImage = new ImageResponse(
    (
      <IdCardFront
        fullName={data.fullName}
        designation={data.designation}
        employeeCode={data.employeeCode}
        dateJoined={data.dateJoined ? formatDate(data.dateJoined) : null}
        phone={data.phone}
        email={data.email}
        logoSrc={logoSrc}
        photoSrc={photoSrc}
        footer={data.footer}
      />
    ),
    { width: CARD_WIDTH, height: CARD_HEIGHT }
  )

  const backImage = new ImageResponse(
    <IdCardBack qrSrc={qrSrc} logoSrc={logoSrc} footer={data.footer} />,
    { width: CARD_WIDTH, height: CARD_HEIGHT }
  )

  const [frontPng, backPng] = await Promise.all([
    frontImage.arrayBuffer().then((b) => Buffer.from(b)),
    backImage.arrayBuffer().then((b) => Buffer.from(b)),
  ])

  return storeCardImages(service, employeeId, frontPng, backPng)
}

/** The SolarPulse logo, read once from public/ and embedded so Satori never fetches. */
let logoCache: string | null = null
async function logoDataUri(): Promise<string> {
  if (logoCache) return logoCache
  const file = await readFile(path.join(process.cwd(), 'public', 'logo.png'))
  logoCache = `data:image/png;base64,${file.toString('base64')}`
  return logoCache
}

/**
 * Downloads a stored profile photo and returns it as a data URI Satori can embed, or null if
 * there is no photo (the layout then draws an initials tile). Any failure degrades to null rather
 * than blocking card generation — a missing photo must not stop a card being issued.
 */
async function photoDataUri(
  service: ReturnType<typeof createSupabaseServiceClient>,
  photoPath: string | null
): Promise<string | null> {
  if (!photoPath) return null
  try {
    const { data, error } = await service.storage.from(HR_DOCUMENTS_BUCKET).download(photoPath)
    if (error || !data) return null
    const buffer = Buffer.from(await data.arrayBuffer())
    const contentType = data.type || 'image/jpeg'
    return `data:${contentType};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}
