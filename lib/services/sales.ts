import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { ServiceError } from '@/lib/services/tasks'
import { isDepartmentManager, type SessionUser } from '@/lib/auth/guards'
import type {
  CreateLeadInput,
  UpdateLeadInput,
  CreateFollowUpInput,
  UpdateFollowUpInput,
  CreateSiteVisitInput,
  UpdateSiteVisitInput,
  CreateQuotationInput,
  UpdateQuotationInput,
  CreateProposalInput,
  UpdateProposalInput,
  CloseDealInput,
  CreateSalesTargetInput,
} from '@/lib/validation/schemas'
import type {
  Lead,
  LeadStatus,
  FollowUp,
  SiteVisitRequest,
  Quotation,
  Proposal,
  SalesTarget,
} from '@/lib/types'

export { ServiceError }

export const SALES_DEPARTMENT_SLUG = 'sales'
export const SALES_MANAGER_ROLE = 'Sales Manager'

/** A Sales Manager sees and writes the whole department's pipeline. */
export function isSalesManager(user: SessionUser): boolean {
  return user.departmentSlug === SALES_DEPARTMENT_SLUG && isDepartmentManager(user)
}

/**
 * Pipeline data is written by Sales only. The CEO's access to a department
 * module is read-only — the same rule assertCanWrite() enforces in the Tender
 * service. Sales targets are the documented exception (see assertCanSetTargets).
 */
function assertCanWrite(user: SessionUser): void {
  if (user.departmentSlug !== SALES_DEPARTMENT_SLUG) {
    throw new ServiceError('Sales records are read-only outside the Sales department', 403)
  }
}

/**
 * Targets are the one thing the CEO may write here: the build spec puts target
 * creation in "manager/CEO only" hands, and makes them read-only for the
 * executive they belong to.
 */
function assertCanSetTargets(user: SessionUser): void {
  if (user.roleName === 'CEO' || isSalesManager(user)) return
  throw new ServiceError('Only a Sales Manager or the CEO can set sales targets', 403)
}

/**
 * Assigning work to someone else is a manager action. An executive's leads are
 * always their own — enforced here and, independently, by the with-check on
 * sales_exec_own_leads, which rejects any row that would end up assigned
 * elsewhere.
 */
function assertCanAssignTo(user: SessionUser, assignedTo: string | null | undefined): void {
  if (!assignedTo || assignedTo === user.id) return
  if (isSalesManager(user) || user.roleName === 'CEO') return
  throw new ServiceError('Only a Sales Manager can assign records to another employee', 403)
}

/** The assignee has to be an active member of Sales. RLS cannot express this. */
async function assertSalesEmployee(
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

  if (!data) throw new ServiceError('Employee not found in this organization', 400)
  if (!data.is_active) throw new ServiceError('Employee is not active', 400)

  const department = data.departments as unknown as { slug: string } | null
  if (department?.slug !== SALES_DEPARTMENT_SLUG) {
    throw new ServiceError('Employee is not a member of the Sales department', 400)
  }
}

/**
 * Loads a lead the caller can see. RLS does the deciding — an executive simply
 * gets no row for a colleague's lead, which surfaces as the same 404 as a lead
 * that does not exist. Not leaking the difference is intentional.
 */
async function loadVisibleLead(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  leadId: string
): Promise<Pick<Lead, 'id' | 'status' | 'name' | 'assigned_to'>> {
  const { data } = await supabase
    .from('leads')
    .select('id, status, name, assigned_to')
    .eq('id', leadId)
    .maybeSingle()

  if (!data) throw new ServiceError('Lead not found', 404)
  return data as Pick<Lead, 'id' | 'status' | 'name' | 'assigned_to'>
}

/**
 * Pipeline order, used to advance a lead when a quotation or proposal is added.
 * Advancing only ever moves forward: adding a second quotation to a lead already
 * in negotiation must not drag it back to 'quotation_sent'.
 */
const STAGE_RANK: Record<LeadStatus, number> = {
  new: 0,
  contacted: 1,
  site_visit_scheduled: 2,
  quotation_sent: 3,
  proposal_sent: 4,
  negotiation: 5,
  won: 6,
  lost: 6,
}

async function advanceLeadStage(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  leadId: string,
  from: LeadStatus,
  to: LeadStatus
): Promise<LeadStatus> {
  // Never reopen a closed lead as a side effect of adding a child record.
  if (from === 'won' || from === 'lost') return from
  if (STAGE_RANK[to] <= STAGE_RANK[from]) return from

  await supabase.from('leads').update({ status: to }).eq('id', leadId)
  return to
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export async function createLead(user: SessionUser, input: CreateLeadInput): Promise<Lead> {
  assertCanWrite(user)
  assertCanAssignTo(user, input.assigned_to)

  const supabase = await createSupabaseServerClient()

  // An executive creating a lead owns it. A manager may hand it to someone else,
  // and keeps it themselves if they name nobody.
  const assignedTo = input.assigned_to ?? user.id
  if (assignedTo !== user.id) await assertSalesEmployee(supabase, user, assignedTo)

  const { data, error } = await supabase
    .from('leads')
    .insert({
      organization_id: user.organization_id,
      name: input.name,
      phone: input.phone ?? null,
      email: input.email || null,
      source: input.source ?? null,
      property_type: input.property_type ?? null,
      estimated_load_kw: input.estimated_load_kw ?? null,
      notes: input.notes ?? null,
      status: 'new',
      assigned_to: assignedTo,
      assigned_by: user.id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'lead_created',
    entityType: 'lead',
    entityId: data.id,
    metadata: { name: data.name, source: data.source, assigned_to: assignedTo },
  })

  return data as Lead
}

export async function updateLead(
  user: SessionUser,
  leadId: string,
  input: UpdateLeadInput
): Promise<Lead> {
  assertCanWrite(user)
  assertCanAssignTo(user, input.assigned_to)

  const supabase = await createSupabaseServerClient()
  const existing = await loadVisibleLead(supabase, leadId)

  if (existing.status === 'won') {
    throw new ServiceError('A won lead cannot be edited — it has a closure record', 400)
  }

  if (input.assigned_to && input.assigned_to !== existing.assigned_to) {
    await assertSalesEmployee(supabase, user, input.assigned_to)
  }

  const { email, ...rest } = input
  const patch = { ...rest, ...(email !== undefined ? { email: email || null } : {}) }

  const { data, error } = await supabase
    .from('leads')
    .update(patch)
    .eq('id', leadId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  const statusChanged = input.status && input.status !== existing.status
  const reassigned = input.assigned_to && input.assigned_to !== existing.assigned_to

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: statusChanged
      ? 'lead_status_changed'
      : reassigned
        ? 'lead_reassigned'
        : 'lead_updated',
    entityType: 'lead',
    entityId: leadId,
    metadata: {
      changed: Object.keys(input),
      ...(statusChanged ? { from_status: existing.status, to_status: input.status } : {}),
      ...(reassigned ? { from_user: existing.assigned_to, to_user: input.assigned_to } : {}),
    },
  })

  return data as Lead
}

/**
 * Soft delete. A lead is marked lost, never removed — the pipeline history and
 * any quotations attached to it stay auditable, matching archiveTask() and
 * cancelTender().
 */
export async function markLeadLost(
  user: SessionUser,
  leadId: string,
  reason?: string
): Promise<Lead> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()
  const existing = await loadVisibleLead(supabase, leadId)

  if (existing.status === 'won') {
    throw new ServiceError('A won lead cannot be marked lost', 400)
  }
  if (existing.status === 'lost') return existing as Lead

  const { data, error } = await supabase
    .from('leads')
    .update({ status: 'lost', ...(reason ? { notes: reason } : {}) })
    .eq('id', leadId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'lead_lost',
    entityType: 'lead',
    entityId: leadId,
    metadata: { from_status: existing.status, reason: reason ?? null },
  })

  return data as Lead
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

export async function createFollowUp(
  user: SessionUser,
  leadId: string,
  input: CreateFollowUpInput
): Promise<FollowUp> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()
  const lead = await loadVisibleLead(supabase, leadId)

  if (lead.status === 'won' || lead.status === 'lost') {
    throw new ServiceError('Cannot schedule a follow-up on a closed lead', 400)
  }

  const { data, error } = await supabase
    .from('follow_ups')
    .insert({
      lead_id: leadId,
      scheduled_for: input.scheduled_for,
      type: input.type,
      notes: input.notes ?? null,
      status: 'pending',
      created_by: user.id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'follow_up_scheduled',
    entityType: 'follow_up',
    entityId: data.id,
    metadata: { lead_id: leadId, type: data.type, scheduled_for: data.scheduled_for },
  })

  return data as FollowUp
}

export async function updateFollowUp(
  user: SessionUser,
  followUpId: string,
  input: UpdateFollowUpInput
): Promise<FollowUp> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('follow_ups')
    .select('id, lead_id, status')
    .eq('id', followUpId)
    .maybeSingle()

  if (!existing) throw new ServiceError('Follow-up not found', 404)
  if (existing.status !== 'pending') {
    throw new ServiceError(`This follow-up is already marked ${existing.status}`, 400)
  }

  const { data, error } = await supabase
    .from('follow_ups')
    .update({
      status: input.status,
      // Stamped server-side so a client clock cannot backdate an activity record.
      completed_at: input.status === 'completed' ? new Date().toISOString() : null,
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    })
    .eq('id', followUpId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: input.status === 'completed' ? 'follow_up_completed' : 'follow_up_missed',
    entityType: 'follow_up',
    entityId: followUpId,
    metadata: { lead_id: existing.lead_id },
  })

  return data as FollowUp
}

// ---------------------------------------------------------------------------
// Site visit requests — Sales' side of the handoff to Technical
// ---------------------------------------------------------------------------

export async function createSiteVisitRequest(
  user: SessionUser,
  leadId: string,
  input: CreateSiteVisitInput
): Promise<SiteVisitRequest> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()
  const lead = await loadVisibleLead(supabase, leadId)

  if (lead.status === 'won' || lead.status === 'lost') {
    throw new ServiceError('Cannot request a site visit for a closed lead', 400)
  }

  const { data, error } = await supabase
    .from('site_visit_requests')
    .insert({
      lead_id: leadId,
      requested_by: user.id,
      preferred_date: input.preferred_date ?? null,
      notes: input.notes ?? null,
      status: 'requested',
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  const newStatus = await advanceLeadStage(
    supabase,
    leadId,
    lead.status,
    'site_visit_scheduled'
  )

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'site_visit_requested',
    entityType: 'site_visit_request',
    entityId: data.id,
    metadata: { lead_id: leadId, preferred_date: data.preferred_date, lead_status: newStatus },
  })

  return data as SiteVisitRequest
}

export async function updateSiteVisitRequest(
  user: SessionUser,
  siteVisitId: string,
  input: UpdateSiteVisitInput
): Promise<SiteVisitRequest> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('site_visit_requests')
    .select('id, lead_id, status')
    .eq('id', siteVisitId)
    .maybeSingle()

  if (!existing) throw new ServiceError('Site visit request not found', 404)

  const { data, error } = await supabase
    .from('site_visit_requests')
    .update(input)
    .eq('id', siteVisitId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'site_visit_updated',
    entityType: 'site_visit_request',
    entityId: siteVisitId,
    metadata: {
      lead_id: existing.lead_id,
      changed: Object.keys(input),
      ...(input.status && input.status !== existing.status
        ? { from_status: existing.status, to_status: input.status }
        : {}),
    },
  })

  return data as SiteVisitRequest
}

// ---------------------------------------------------------------------------
// Quotations
// ---------------------------------------------------------------------------

export async function createQuotation(
  user: SessionUser,
  leadId: string,
  input: CreateQuotationInput
): Promise<Quotation> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()
  const lead = await loadVisibleLead(supabase, leadId)

  if (lead.status === 'won' || lead.status === 'lost') {
    throw new ServiceError('Cannot quote a closed lead', 400)
  }

  const { data, error } = await supabase
    .from('quotations')
    .insert({
      lead_id: leadId,
      quoted_by: user.id,
      system_size_kw: input.system_size_kw ?? null,
      amount: input.amount,
      valid_until: input.valid_until ?? null,
      notes: input.notes ?? null,
      status: 'draft',
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'quotation_created',
    entityType: 'quotation',
    entityId: data.id,
    metadata: { lead_id: leadId, amount: data.amount, system_size_kw: data.system_size_kw },
  })

  return data as Quotation
}

export async function updateQuotation(
  user: SessionUser,
  quotationId: string,
  input: UpdateQuotationInput
): Promise<Quotation> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('quotations')
    .select('id, lead_id, status')
    .eq('id', quotationId)
    .maybeSingle()

  if (!existing) throw new ServiceError('Quotation not found', 404)

  const { data, error } = await supabase
    .from('quotations')
    .update(input)
    .eq('id', quotationId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  // Sending a quotation moves the lead along with it.
  if (input.status === 'sent') {
    const lead = await loadVisibleLead(supabase, existing.lead_id)
    await advanceLeadStage(supabase, existing.lead_id, lead.status, 'quotation_sent')
  }

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'quotation_updated',
    entityType: 'quotation',
    entityId: quotationId,
    metadata: {
      lead_id: existing.lead_id,
      changed: Object.keys(input),
      ...(input.status && input.status !== existing.status
        ? { from_status: existing.status, to_status: input.status }
        : {}),
    },
  })

  return data as Quotation
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export async function createProposal(
  user: SessionUser,
  leadId: string,
  input: CreateProposalInput
): Promise<Proposal> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()
  const lead = await loadVisibleLead(supabase, leadId)

  if (lead.status === 'won' || lead.status === 'lost') {
    throw new ServiceError('Cannot add a proposal to a closed lead', 400)
  }

  // A proposal may cite a quotation, but only one belonging to the same lead.
  if (input.quotation_id) {
    const { data: quotation } = await supabase
      .from('quotations')
      .select('id, lead_id')
      .eq('id', input.quotation_id)
      .maybeSingle()

    if (!quotation) throw new ServiceError('Quotation not found', 400)
    if (quotation.lead_id !== leadId) {
      throw new ServiceError('That quotation belongs to a different lead', 400)
    }
  }

  const { data, error } = await supabase
    .from('proposals')
    .insert({
      lead_id: leadId,
      quotation_id: input.quotation_id ?? null,
      proposed_by: user.id,
      amount: input.amount,
      terms: input.terms ?? null,
      status: 'draft',
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'proposal_created',
    entityType: 'proposal',
    entityId: data.id,
    metadata: { lead_id: leadId, amount: data.amount, quotation_id: data.quotation_id },
  })

  return data as Proposal
}

export async function updateProposal(
  user: SessionUser,
  proposalId: string,
  input: UpdateProposalInput
): Promise<Proposal> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data: existing } = await supabase
    .from('proposals')
    .select('id, lead_id, status')
    .eq('id', proposalId)
    .maybeSingle()

  if (!existing) throw new ServiceError('Proposal not found', 404)

  if (input.quotation_id) {
    const { data: quotation } = await supabase
      .from('quotations')
      .select('id, lead_id')
      .eq('id', input.quotation_id)
      .maybeSingle()

    if (!quotation) throw new ServiceError('Quotation not found', 400)
    if (quotation.lead_id !== existing.lead_id) {
      throw new ServiceError('That quotation belongs to a different lead', 400)
    }
  }

  const { data, error } = await supabase
    .from('proposals')
    .update(input)
    .eq('id', proposalId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  if (input.status === 'sent' || input.status === 'accepted') {
    const lead = await loadVisibleLead(supabase, existing.lead_id)
    await advanceLeadStage(
      supabase,
      existing.lead_id,
      lead.status,
      input.status === 'accepted' ? 'negotiation' : 'proposal_sent'
    )
  }

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'proposal_updated',
    entityType: 'proposal',
    entityId: proposalId,
    metadata: {
      lead_id: existing.lead_id,
      changed: Object.keys(input),
      ...(input.status && input.status !== existing.status
        ? { from_status: existing.status, to_status: input.status }
        : {}),
    },
  })

  return data as Proposal
}

// ---------------------------------------------------------------------------
// Deal closure
// ---------------------------------------------------------------------------

/**
 * Closes a deal through the close_deal() Postgres function, which creates the
 * customer, writes the deal_closures row, and flips the lead to 'won' inside one
 * statement.
 *
 * This has to be a single database call. Three sequential client calls could
 * fail between steps and leave a closure with no customer, or a lead marked won
 * with no closure record — the exact partial state the acceptance criteria
 * forbid. The function is not security definer, so every write inside it is
 * still checked against the caller's RLS.
 */
export async function closeDeal(
  user: SessionUser,
  leadId: string,
  input: CloseDealInput
): Promise<{ closureId: string }> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('close_deal', {
    p_lead_id: leadId,
    p_final_amount: input.final_amount,
    p_proposal_id: input.proposal_id ?? null,
    p_address: input.address ?? null,
  })

  if (error) {
    // Postgres raise messages are already caller-facing here ("Lead is already
    // closed as won", "Proposal does not belong to this lead").
    throw new ServiceError(error.message, 400)
  }

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'deal_closed',
    entityType: 'deal_closure',
    entityId: data as string,
    metadata: {
      lead_id: leadId,
      final_amount: input.final_amount,
      proposal_id: input.proposal_id ?? null,
    },
  })

  return { closureId: data as string }
}

// ---------------------------------------------------------------------------
// Sales targets
// ---------------------------------------------------------------------------

export async function createSalesTarget(
  user: SessionUser,
  input: CreateSalesTargetInput
): Promise<SalesTarget> {
  assertCanSetTargets(user)
  const supabase = await createSupabaseServerClient()

  await assertSalesEmployee(supabase, user, input.user_id)

  const { data, error } = await supabase
    .from('sales_targets')
    .insert({
      organization_id: user.organization_id,
      user_id: input.user_id,
      period_start: input.period_start,
      period_end: input.period_end,
      target_amount: input.target_amount,
      target_deals: input.target_deals ?? null,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    // 23505 = unique_violation. The unique (user_id, period_start, period_end)
    // constraint is what stops two competing targets for one period.
    if (error.code === '23505') {
      throw new ServiceError('This employee already has a target for that period', 409)
    }
    throw new ServiceError(error.message, 400)
  }

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'sales_target_created',
    entityType: 'sales_target',
    entityId: data.id,
    metadata: {
      user_id: input.user_id,
      period_start: input.period_start,
      period_end: input.period_end,
      target_amount: input.target_amount,
    },
  })

  return data as SalesTarget
}
