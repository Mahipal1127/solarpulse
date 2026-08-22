'use client'

/**
 * One-click WhatsApp share via a wa.me link.
 *
 * THE HONEST LIMITATION. WhatsApp's click-to-chat / wa.me interface can pre-fill message TEXT only
 * — there is no way for a link to pre-attach an image. So this does exactly what the platform
 * allows: it opens a chat (to whatsappNumber if we have one, else the contact picker) with a
 * ready-to-send message, and the message itself tells the sender to attach the card they
 * downloaded. The button label and helper copy say this plainly rather than implying the image
 * rides along — building the WhatsApp Business API image-push automation is explicitly out of
 * scope for v1.
 */
export function WhatsAppShareButton({
  fullName,
  organizationName,
  whatsappNumber,
  hasCard,
}: {
  fullName: string
  organizationName: string
  whatsappNumber: string | null
  hasCard: boolean
}) {
  const message = `Hi ${fullName}, here is your ${organizationName} employee ID card. (Please attach the card image you downloaded to this chat.)`

  // wa.me wants digits only; strip spaces, +, and punctuation. With no number, the bare wa.me
  // link opens WhatsApp's contact picker so the sender chooses the recipient.
  const digits = (whatsappNumber ?? '').replace(/\D/g, '')
  const href = digits
    ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={
        hasCard
          ? 'Opens WhatsApp with a pre-filled message. Attach the downloaded card image before sending — links cannot pre-attach it.'
          : 'Generate and download the card first, then attach it in WhatsApp.'
      }
      className="rounded-lg border border-[#25D366]/40 px-4 py-2 text-sm font-medium text-[#128C7E] transition-colors hover:bg-[#25D366]/10"
    >
      Share via WhatsApp
    </a>
  )
}
