import 'server-only'

import { PDFDocument } from 'pdf-lib'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { HR_DOCUMENTS_BUCKET } from '@/lib/hr/constants'
import { ServiceError } from '@/lib/services/tasks'
import { CARD_WIDTH, CARD_HEIGHT } from '@/components/hr/IDCardPreview/cardLayout'

/**
 * Stitches an employee's stored front + back card PNGs into a single two-page PDF,
 * returned as bytes. Built ON DEMAND rather than stored: the source of truth is the
 * two PNGs, so a regenerate is instantly reflected and there is no third artifact to
 * keep in sync or clean up.
 *
 * ACCESS. Entitlement is decided by a normal RLS read of the employees row through
 * the session client — if the caller can see the card paths, they may have the PDF.
 * This admits the HR lead, the CEO, and the employee viewing their OWN board, and
 * refuses everyone else with a clean 403, without this file re-implementing the four
 * HR visibility tiers. The actual PNG bytes are then pulled on the service client,
 * because hr-documents objects are not world-readable.
 *
 * Each page is exactly one card (620×1000, portrait) at 1:1 — no scaling, so the
 * print matches the on-screen card.
 */
export async function buildCardPdf(employeeId: string): Promise<Uint8Array> {
  const supabase = await createSupabaseServerClient()

  // RLS gate: this returns a row only if the caller is entitled to see this employee.
  const { data: emp } = await supabase
    .from('employees')
    .select('id_card_file_path, id_card_back_file_path')
    .eq('id', employeeId)
    .maybeSingle()

  if (!emp) throw new ServiceError('Employee not found or not visible', 404)
  const frontPath = emp.id_card_file_path as string | null
  const backPath = emp.id_card_back_file_path as string | null
  if (!frontPath) throw new ServiceError('No card has been generated for this employee yet', 404)

  const service = createSupabaseServiceClient()
  const bucket = service.storage.from(HR_DOCUMENTS_BUCKET)

  const front = await downloadPng(bucket, frontPath)
  // A card generated before the two-sided redesign may have no back image; the PDF
  // then has a single page rather than failing.
  const back = backPath ? await downloadPng(bucket, backPath) : null

  const pdf = await PDFDocument.create()
  for (const png of back ? [front, back] : [front]) {
    const image = await pdf.embedPng(png)
    const page = pdf.addPage([CARD_WIDTH, CARD_HEIGHT])
    page.drawImage(image, { x: 0, y: 0, width: CARD_WIDTH, height: CARD_HEIGHT })
  }

  return pdf.save()
}

async function downloadPng(
  bucket: ReturnType<ReturnType<typeof createSupabaseServiceClient>['storage']['from']>,
  path: string
): Promise<Uint8Array> {
  const { data, error } = await bucket.download(path)
  if (error || !data) throw new ServiceError('Could not read a card image', 400)
  return new Uint8Array(await data.arrayBuffer())
}
