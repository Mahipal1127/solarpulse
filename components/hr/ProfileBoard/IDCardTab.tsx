import 'server-only'

import { IDCardPreview } from '@/components/hr/IDCardPreview/IDCardPreview'
import { WhatsAppShareButton } from '@/components/hr/IDCardPreview/WhatsAppShareButton'
import { collectCardData } from '@/lib/services/id-cards'
import { tokenToQrDataUri } from '@/lib/services/qr'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { signHrObject } from '@/lib/hr/profile'
import type { EmployeeProfile } from '@/lib/hr/profile'

/**
 * The ID Card tab, assembled server-side. What it shows depends on whether the viewer may MANAGE
 * cards (HR lead / CEO):
 *
 *  - Managers get the full interactive preview: the LIVE card layout (rendered with the real QR
 *    token fetched here on the service client — the token never reaches the browser as a value,
 *    only baked into the QR image), plus generate / regenerate / revoke controls.
 *  - Everyone else (an HR member, or the employee viewing their own board) sees only the generated
 *    card IMAGE with download + WhatsApp share. They never touch the token, matching the qr_tokens
 *    access tier — the QR is visible only as pixels in a PNG they were already allowed to hold.
 *
 * The photo is signed for inline display in both cases.
 */
export async function IDCardTab({
  profile,
  organizationName,
  canManage,
}: {
  profile: EmployeeProfile
  organizationName: string
  canManage: boolean
}) {
  const photoUrl = await signHrObject(profile.profilePhotoPath)
  const cardImageUrl = await signHrObject(profile.idCardFilePath)

  if (canManage) {
    // Fetch/mint the token and render its QR for the live preview. collectCardData reuses the
    // existing active token (it does not rotate), so merely viewing the board never changes a card.
    const service = createSupabaseServiceClient()
    const data = await collectCardData(service, profile.employeeId)
    const qrSrc = await tokenToQrDataUri(data.token)

    return (
      <IDCardPreview
        employeeId={profile.employeeId}
        fullName={profile.fullName}
        designation={profile.designation}
        departmentName={profile.departmentName}
        employeeCode={profile.employeeCode}
        organizationName={organizationName}
        qrSrc={qrSrc}
        photoSrc={photoUrl}
        cardImageUrl={cardImageUrl}
        generatedAt={profile.idCardGeneratedAt}
        canManage
        whatsappNumber={profile.whatsappNumber}
      />
    )
  }

  // Non-manager view: the generated image only, or a plain notice if none exists yet.
  if (!cardImageUrl) {
    return (
      <p className="text-sm text-text-muted">
        No ID card has been generated yet. Ask HR to generate one.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cardImageUrl}
        alt={`${profile.fullName} ID card`}
        className="w-full max-w-[360px] rounded-2xl border border-border-subtle"
      />
      <div className="flex flex-wrap gap-2">
        <a
          href={cardImageUrl}
          download={`id-card-${profile.employeeCode ?? profile.employeeId}.png`}
          className="rounded-lg border border-border-subtle px-4 py-2 text-sm font-medium text-brand-slate transition-colors hover:border-brand-gold"
        >
          Download card
        </a>
        <WhatsAppShareButton
          fullName={profile.fullName}
          organizationName={organizationName}
          whatsappNumber={profile.whatsappNumber}
          hasCard
        />
      </div>
    </div>
  )
}
