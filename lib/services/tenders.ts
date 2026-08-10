import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { ServiceError } from '@/lib/services/tasks'
import type { SessionUser } from '@/lib/auth/guards'
import type {
  CreateTenderInput,
  UpdateTenderInput,
  CreateBidInput,
  UpdateBidInput,
  CreateDocumentInput,
} from '@/lib/validation/schemas'
import type { Tender, TenderBid, TenderDocument, TenderStatus } from '@/lib/types'

export { ServiceError }

export const TENDER_DEPARTMENT_SLUG = 'tender'

/**
 * Legal forward moves for a tender. Enforced here, in the route handler's call
 * path — the UI only disables invalid options, and a disabled <option> is not a
 * security control.
 *
 * 'cancelled' is reachable from every non-terminal state; won/lost/cancelled are
 * terminal, so a mistaken close-out is corrected by logging a new tender rather
 * than by rewriting history.
 */
const TENDER_TRANSITIONS: Record<TenderStatus, TenderStatus[]> = {
  open: ['preparing_bid', 'submitted', 'cancelled'],
  preparing_bid: ['submitted', 'cancelled'],
  submitted: ['won', 'lost', 'cancelled'],
  won: [],
  lost: [],
  cancelled: [],
}

export function allowedTenderTransitions(from: TenderStatus): TenderStatus[] {
  return TENDER_TRANSITIONS[from] ?? []
}

/** Only members of the tender department may write. CEO access is read-only. */
function assertCanWrite(user: SessionUser): void {
  if (user.departmentSlug !== TENDER_DEPARTMENT_SLUG) {
    throw new ServiceError(
      'Tender records are read-only outside the Tender department',
      403
    )
  }
}

/**
 * The assignee must actually be in the tender department — RLS scopes rows to
 * the org, but it cannot cheaply express "this user belongs to the department
 * that owns this table", so that check lives here.
 */
async function assertTenderEmployee(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  user: SessionUser,
  employeeId: string
): Promise<void> {
  const { data } = await supabase
    .from('users')
    .select('id, is_active, departments(slug)')
    .eq('id', employeeId)
    .eq('organization_id', user.organization_id)
    .maybeSingle()

  if (!data) throw new ServiceError('Assignee not found in this organization', 400)
  if (!data.is_active) throw new ServiceError('Assignee is not an active user', 400)

  const department = data.departments as unknown as { slug: string } | null
  if (department?.slug !== TENDER_DEPARTMENT_SLUG) {
    throw new ServiceError('Assignee is not a member of the Tender department', 400)
  }
}

// ---------------------------------------------------------------------------
// Tenders
// ---------------------------------------------------------------------------

export async function createTender(
  user: SessionUser,
  input: CreateTenderInput
): Promise<Tender> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  if (input.assigned_employee_id) {
    await assertTenderEmployee(supabase, user, input.assigned_employee_id)
  }

  const { data, error } = await supabase
    .from('tenders')
    .insert({
      organization_id: user.organization_id,
      title: input.title,
      issuing_authority: input.issuing_authority ?? null,
      tender_number: input.tender_number ?? null,
      description: input.description ?? null,
      submission_deadline: input.submission_deadline,
      estimated_value: input.estimated_value ?? null,
      assigned_employee_id: input.assigned_employee_id ?? null,
      created_by: user.id,
      status: 'open',
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'tender_created',
    entityType: 'tender',
    entityId: data.id,
    metadata: {
      title: data.title,
      tender_number: data.tender_number,
      submission_deadline: data.submission_deadline,
    },
  })

  return data as Tender
}

export async function updateTender(
  user: SessionUser,
  tenderId: string,
  input: UpdateTenderInput
): Promise<Tender> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('tenders')
    .select('id, status, title')
    .eq('id', tenderId)
    .maybeSingle()

  if (!existing) throw new ServiceError('Tender not found', 404)

  const currentStatus = existing.status as TenderStatus
  const nextStatus = input.status

  // A status change must be a legal move. Re-stating the current status is a
  // no-op rather than an error, so a form that always posts every field works.
  if (nextStatus && nextStatus !== currentStatus) {
    if (!allowedTenderTransitions(currentStatus).includes(nextStatus)) {
      throw new ServiceError(
        `Cannot move a tender from '${currentStatus}' to '${nextStatus}'`,
        400
      )
    }
  }

  if (input.assigned_employee_id) {
    await assertTenderEmployee(supabase, user, input.assigned_employee_id)
  }

  const { data, error } = await supabase
    .from('tenders')
    .update(input)
    .eq('id', tenderId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: nextStatus && nextStatus !== currentStatus ? 'tender_status_changed' : 'tender_updated',
    entityType: 'tender',
    entityId: tenderId,
    metadata: {
      changed: Object.keys(input),
      ...(nextStatus && nextStatus !== currentStatus
        ? { from_status: currentStatus, to_status: nextStatus }
        : {}),
    },
  })

  return data as Tender
}

/**
 * Soft delete: a tender is cancelled, never removed. Matches archiveTask() —
 * the row and its bid/document history stay auditable.
 */
export async function cancelTender(user: SessionUser, tenderId: string): Promise<Tender> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('tenders')
    .select('id, status')
    .eq('id', tenderId)
    .maybeSingle()

  if (!existing) throw new ServiceError('Tender not found', 404)

  const currentStatus = existing.status as TenderStatus
  if (!allowedTenderTransitions(currentStatus).includes('cancelled')) {
    throw new ServiceError(`A '${currentStatus}' tender cannot be cancelled`, 400)
  }

  const { data, error } = await supabase
    .from('tenders')
    .update({ status: 'cancelled' })
    .eq('id', tenderId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'tender_cancelled',
    entityType: 'tender',
    entityId: tenderId,
    metadata: { from_status: currentStatus },
  })

  return data as Tender
}

// ---------------------------------------------------------------------------
// Bids
// ---------------------------------------------------------------------------

/** submitted_at is stamped by the server the first time a bid leaves draft. */
function submittedStamp(
  status: string | undefined,
  previouslySubmittedAt: string | null
): { submitted_at?: string } {
  if (!status) return {}
  if (previouslySubmittedAt) return {}
  if (status === 'draft') return {}
  return { submitted_at: new Date().toISOString() }
}

export async function createBid(
  user: SessionUser,
  tenderId: string,
  input: CreateBidInput
): Promise<TenderBid> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data: tender } = await supabase
    .from('tenders')
    .select('id, status')
    .eq('id', tenderId)
    .maybeSingle()

  if (!tender) throw new ServiceError('Tender not found', 404)
  if (tender.status === 'cancelled') {
    throw new ServiceError('Cannot add a bid to a cancelled tender', 400)
  }

  if (input.assigned_employee_id) {
    await assertTenderEmployee(supabase, user, input.assigned_employee_id)
  }

  const { data, error } = await supabase
    .from('tender_bids')
    .insert({
      tender_id: tenderId,
      bid_amount: input.bid_amount ?? null,
      bid_status: input.bid_status,
      assigned_employee_id: input.assigned_employee_id ?? null,
      notes: input.notes ?? null,
      ...submittedStamp(input.bid_status, null),
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'tender_bid_created',
    entityType: 'tender_bid',
    entityId: data.id,
    metadata: { tender_id: tenderId, bid_status: data.bid_status, bid_amount: data.bid_amount },
  })

  return data as TenderBid
}

export async function updateBid(
  user: SessionUser,
  bidId: string,
  input: UpdateBidInput
): Promise<TenderBid> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('tender_bids')
    .select('id, tender_id, bid_status, submitted_at')
    .eq('id', bidId)
    .maybeSingle()

  if (!existing) throw new ServiceError('Bid not found', 404)

  if (input.assigned_employee_id) {
    await assertTenderEmployee(supabase, user, input.assigned_employee_id)
  }

  const { data, error } = await supabase
    .from('tender_bids')
    .update({
      ...input,
      ...submittedStamp(input.bid_status, existing.submitted_at),
    })
    .eq('id', bidId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'tender_bid_updated',
    entityType: 'tender_bid',
    entityId: bidId,
    metadata: {
      tender_id: existing.tender_id,
      changed: Object.keys(input),
      ...(input.bid_status && input.bid_status !== existing.bid_status
        ? { from_status: existing.bid_status, to_status: input.bid_status }
        : {}),
    },
  })

  return data as TenderBid
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** How long a download link stays valid. Short enough that a leaked URL dies. */
export const SIGNED_URL_TTL_SECONDS = 300

/**
 * Registers an already-uploaded object. The browser uploads straight to Storage
 * (governed by the bucket policy), then calls this so the row exists and the
 * upload is audited.
 */
export async function recordDocument(
  user: SessionUser,
  tenderId: string,
  input: CreateDocumentInput
): Promise<TenderDocument> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data: tender } = await supabase
    .from('tenders')
    .select('id')
    .eq('id', tenderId)
    .maybeSingle()

  if (!tender) throw new ServiceError('Tender not found', 404)

  // The storage policy keys off the first path segment; a row pointing at
  // another tender's folder would hand out a signed URL the uploader should
  // never have had.
  if (!input.file_path.startsWith(`${tenderId}/`)) {
    throw new ServiceError('File path does not belong to this tender', 400)
  }

  const { data, error } = await supabase
    .from('tender_documents')
    .insert({
      tender_id: tenderId,
      file_path: input.file_path,
      file_name: input.file_name,
      document_type: input.document_type ?? null,
      uploaded_by: user.id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'tender_document_uploaded',
    entityType: 'tender_document',
    entityId: data.id,
    metadata: { tender_id: tenderId, file_name: data.file_name, document_type: data.document_type },
  })

  return data as TenderDocument
}

/**
 * Mints a short-lived signed URL. The bucket is private, so this is the only way
 * to read a document — there is no public link to fall back on. Reading is
 * allowed for the CEO too, hence no assertCanWrite here.
 */
export async function signDocumentDownload(
  user: SessionUser,
  documentId: string
): Promise<{ url: string; fileName: string }> {
  const supabase = await createSupabaseServerClient()

  const { data: document } = await supabase
    .from('tender_documents')
    .select('id, tender_id, file_path, file_name')
    .eq('id', documentId)
    .maybeSingle()

  // RLS already hides other orgs' rows, so "not visible" and "does not exist"
  // are the same 404 to the caller.
  if (!document) throw new ServiceError('Document not found', 404)

  const { data, error } = await supabase.storage
    .from('tender-documents')
    .createSignedUrl(document.file_path, SIGNED_URL_TTL_SECONDS, {
      download: document.file_name,
    })

  if (error || !data) throw new ServiceError(error?.message ?? 'Could not sign the file', 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'tender_document_downloaded',
    entityType: 'tender_document',
    entityId: documentId,
    metadata: { tender_id: document.tender_id, file_name: document.file_name },
  })

  return { url: data.signedUrl, fileName: document.file_name }
}

export async function deleteDocument(user: SessionUser, documentId: string): Promise<void> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data: document } = await supabase
    .from('tender_documents')
    .select('id, tender_id, file_path, file_name')
    .eq('id', documentId)
    .maybeSingle()

  if (!document) throw new ServiceError('Document not found', 404)

  const { error: storageError } = await supabase.storage
    .from('tender-documents')
    .remove([document.file_path])

  // A missing object should not strand the row — drop the row either way, but
  // record what happened.
  if (storageError) {
    console.error('[tender] storage remove failed', document.file_path, storageError.message)
  }

  const { error } = await supabase.from('tender_documents').delete().eq('id', documentId)
  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'tender_document_deleted',
    entityType: 'tender_document',
    entityId: documentId,
    metadata: {
      tender_id: document.tender_id,
      file_name: document.file_name,
      storage_removed: !storageError,
    },
  })
}
