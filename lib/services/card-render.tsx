import 'server-only'

import { ImageResponse } from 'next/og'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { collectCardData, storeCardImage } from '@/lib/services/id-cards'
import { tokenToQrDataUri } from '@/lib/services/qr'
import { HR_DOCUMENTS_BUCKET } from '@/lib/hr/constants'
import { IdCardLayout, CARD_WIDTH, CARD_HEIGHT } from '@/components/hr/IDCardPreview/cardLayout'

/**
 * Renders an employee's ID card to a PNG and stores it, returning the storage path. This is the
 * one place card generation happens — onboarding and the manual regenerate route both call it, so
 * the "gather data → draw → store" sequence never diverges.
 *
 * It regenerates the IMAGE only; it never rotates the token. collectCardData reuses the existing
 * active token (minting one only if none exists), so a photo-driven regenerate keeps the old QR
 * valid. Token rotation is revokeAndReissueToken's job alone.
 *
 * The profile photo is embedded as a data URI fetched here (via a short-lived signed URL on the
 * service client), NOT bundled — next/og caps the bundle at 500KB, and a photo is exactly the
 * kind of asset the docs say to fetch at runtime instead.
 */
export async function generateAndStoreCard(employeeId: string): Promise<string> {
  const service = createSupabaseServiceClient()

  const data = await collectCardData(service, employeeId)
  const qrSrc = await tokenToQrDataUri(data.token)
  const photoSrc = await photoDataUri(service, data.profilePhotoPath)

  const image = new ImageResponse(
    (
      <IdCardLayout
        fullName={data.fullName}
        designation={data.designation}
        departmentName={data.departmentName}
        employeeCode={data.employeeCode}
        organizationName={data.organizationName}
        qrSrc={qrSrc}
        photoSrc={photoSrc}
      />
    ),
    { width: CARD_WIDTH, height: CARD_HEIGHT }
  )

  const png = Buffer.from(await image.arrayBuffer())
  return storeCardImage(service, employeeId, png)
}

/**
 * Downloads a stored profile photo and returns it as a data URI Satori can embed, or null if
 * there is no photo (the layout then draws an initials tile). Any failure degrades to null rather
 * than blocking card generation — a missing photo must not stop a card being issued.
 */
async function photoDataUri(
  service: ReturnType<typeof createSupabaseServiceClient>,
  path: string | null
): Promise<string | null> {
  if (!path) return null
  try {
    const { data, error } = await service.storage.from(HR_DOCUMENTS_BUCKET).download(path)
    if (error || !data) return null
    const buffer = Buffer.from(await data.arrayBuffer())
    const contentType = data.type || 'image/jpeg'
    return `data:${contentType};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}
