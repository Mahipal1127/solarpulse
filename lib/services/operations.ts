import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { ServiceError } from '@/lib/services/tasks'
import { assertTransition } from '@/lib/services/transitions'
import { isDepartmentManager } from '@/lib/auth/guards'
import {
  INSTALLATION_TRANSITIONS,
  SERVICE_TICKET_TRANSITIONS,
  AMC_VISIT_TRANSITIONS,
  INSTALLATION_MEDIA_BUCKET,
  SIGNED_URL_TTL_SECONDS,
} from '@/lib/om/constants'
import {
  INSTALLATION_STATUS_LABELS,
  SERVICE_TICKET_STATUS_LABELS,
  AMC_VISIT_STATUS_LABELS,
} from '@/lib/format'
import type { SessionUser } from '@/lib/auth/guards'
import type {
  CreateInstallationInput,
  ConvertDealInput,
  UpdateInstallationInput,
  AddTeamMemberInput,
  ProgressUpdateInput,
  InstallationPhotoMetaInput,
  ChecklistItemCreateInput,
  ChecklistItemUpdateInput,
  FinalInspectionInput,
  CompletionReportInput,
  CreateServiceTicketInput,
  UpdateServiceTicketInput,
  CreateServiceReportInput,
  CreateAmcContractInput,
  UpdateAmcContractInput,
  ScheduleAmcVisitInput,
  UpdateAmcVisitInput,
  CreatePerformanceLogInput,
} from '@/lib/validation/schemas'
import type {
  Installation,
  InstallationTeamMember,
  InstallationProgressUpdate,
  InstallationPhoto,
  InstallationChecklistItem,
  FinalInspection,
  CompletionReport,
  ServiceTicket,
  ServiceTicketStatus,
  ServiceReport,
  AmcContract,
  AmcVisit,
  PerformanceLog,
} from '@/lib/types'

export { ServiceError }

/** Re-exported so a route can tell the caller how long its signed URL lasts. */
export { SIGNED_URL_TTL_SECONDS }

/**
 * The hyphenated slug is load-bearing: migration 0002 seeds this department as
 * 'operations-maintenance' (matching 'marketing-training'), and every RLS helper in
 * 0012 and every requireDepartment guard keys off it. The build spec wrote it with
 * an underscore; that spelling matches nothing in this database.
 */
export const OM_DEPARTMENT_SLUG = 'operations-maintenance'

/**
 * The department-wide tier, matching auth_is_om_lead() in migration 0012.
 *
 * Both names are accepted for the reason spelled out there and in the Technical
 * module: the build spec called this role "O&M Lead", but the '<Department> Manager'
 * convention that auth_is_department_manager() (0006) and isDepartmentManager()
 * (guards.ts) key off requires the seeded role to end in "Manager". The guard has to
 * agree with the policy, so it honours either — but the seeded, working role is
 * 'Operations & Maintenance Manager'.
 */
export const OM_LEAD_ROLE_NAMES = ['Operations & Maintenance Manager', 'O&M Lead']

export function isOMLead(user: SessionUser): boolean {
  return (
    user.departmentSlug === OM_DEPARTMENT_SLUG &&
    (isDepartmentManager(user) || OM_LEAD_ROLE_NAMES.includes(user.roleName))
  )
}

/**
 * O&M records are written by the department only; the CEO reads this module but
 * does not write to it, the same rule Tender/Sales/Technical enforce.
 */
function assertCanWrite(user: SessionUser): void {
  if (user.departmentSlug !== OM_DEPARTMENT_SLUG) {
    throw new ServiceError(
      'Operations & Maintenance records are read-only outside the department',
      403
    )
  }
}

/**
 * The assignee must be an active member of O&M. RLS scopes rows to the org but
 * cannot cheaply express "belongs to the department that owns this table", so the
 * check lives here — and it turns an opaque RLS rejection into a clear 400.
 */
async function assertOMEmployee(
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
  if (department?.slug !== OM_DEPARTMENT_SLUG) {
    throw new ServiceError(
      'Employee is not a member of the Operations & Maintenance department',
      400
    )
  }
}

/**
 * Loads a record the caller can see, letting RLS decide. A row outside the caller's
 * reach is simply not returned, surfacing as the same 404 as a row that does not
 * exist — not leaking the difference is intentional.
 */
async function loadVisible<T>(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  table: string,
  id: string,
  columns: string,
  label: string
): Promise<T> {
  const { data } = await supabase.from(table).select(columns).eq('id', id).maybeSingle()
  if (!data) throw new ServiceError(`${label} not found`, 404)
  return data as T
}

// ---------------------------------------------------------------------------
// Installations
// ---------------------------------------------------------------------------

/**
 * Logs an installation standalone, with no closed deal behind it. Use
 * convertDeal() for the pipeline handoff — it derives the customer, design and
 * size from the closure server-side and seeds the quality checklist, atomically.
 */
export async function createInstallation(
  user: SessionUser,
  input: CreateInstallationInput
): Promise<Installation> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  await assertOMEmployee(supabase, user, input.team_lead_id)

  const { data, error } = await supabase
    .from('installations')
    .insert({
      organization_id: user.organization_id,
      customer_id: input.customer_id,
      design_id: input.design_id ?? null,
      team_lead_id: input.team_lead_id,
      scheduled_start_date: input.scheduled_start_date ?? null,
      system_size_kw: input.system_size_kw ?? null,
      address: input.address ?? null,
      notes: input.notes ?? null,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'installation_created',
    entityType: 'installation',
    entityId: data.id,
    metadata: {
      customer_id: input.customer_id,
      team_lead_id: input.team_lead_id,
      standalone: true,
    },
  })

  return data as Installation
}

/**
 * Converts a Sales deal closure into an installation — the pipeline continuation
 * §3.2 names the module's origination point.
 *
 * One RPC, not a create-then-link chain: create_installation_from_deal() reads the
 * closure's customer, finds the most recent approved design for that lead, inserts
 * the installation with all three linked, and seeds the standard quality checklist,
 * in a single transaction. The customer and design are derived server-side from the
 * closure rather than accepted from the caller, so an installation cannot be quietly
 * attached to a different customer's project.
 */
export async function convertDeal(
  user: SessionUser,
  input: ConvertDealInput
): Promise<Installation> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  await assertOMEmployee(supabase, user, input.team_lead_id)

  const { data: installId, error } = await supabase.rpc('create_installation_from_deal', {
    p_deal_closure_id: input.deal_closure_id,
    p_team_lead_id: input.team_lead_id,
    p_scheduled_start_date: input.scheduled_start_date ?? null,
    p_notes: input.notes ?? null,
  })

  if (error) {
    // Messages from inside the function are caller-facing: "Deal closure not found
    // or not visible", "This deal closure has no customer to install for".
    throw new ServiceError(error.message, 400)
  }

  const installation = await loadVisible<Installation>(
    supabase,
    'installations',
    installId as string,
    '*',
    'Installation'
  )

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'installation_created_from_deal',
    entityType: 'installation',
    entityId: installation.id,
    metadata: {
      deal_closure_id: input.deal_closure_id,
      customer_id: installation.customer_id,
      design_id: installation.design_id,
      team_lead_id: input.team_lead_id,
    },
  })

  return installation
}

export async function updateInstallation(
  user: SessionUser,
  installationId: string,
  input: UpdateInstallationInput
): Promise<Installation> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const existing = await loadVisible<Pick<Installation, 'id' | 'status' | 'team_lead_id'>>(
    supabase,
    'installations',
    installationId,
    'id, status, team_lead_id',
    'Installation'
  )

  if (input.status) {
    assertTransition(
      INSTALLATION_TRANSITIONS,
      existing.status,
      input.status,
      INSTALLATION_STATUS_LABELS
    )
  }

  if (input.team_lead_id && input.team_lead_id !== existing.team_lead_id) {
    await assertOMEmployee(supabase, user, input.team_lead_id)
  }

  // Completing stamps the date if the caller did not supply one, so a finished
  // install always carries when it finished.
  const completing = input.status === 'completed'

  const { data, error } = await supabase
    .from('installations')
    .update({
      ...input,
      ...(completing && !input.completed_date
        ? { completed_date: new Date().toISOString().slice(0, 10) }
        : {}),
    })
    .eq('id', installationId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  const reassigned =
    Boolean(input.team_lead_id) && input.team_lead_id !== existing.team_lead_id

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: reassigned
      ? 'installation_reassigned'
      : input.status
        ? 'installation_status_changed'
        : 'installation_updated',
    entityType: 'installation',
    entityId: installationId,
    metadata: {
      changed: Object.keys(input),
      ...(input.status ? { from_status: existing.status, to_status: input.status } : {}),
      ...(reassigned
        ? { from_lead: existing.team_lead_id, to_lead: input.team_lead_id }
        : {}),
    },
  })

  return data as Installation
}

// ---------------------------------------------------------------------------
// Team assignment
// ---------------------------------------------------------------------------

export async function addTeamMember(
  user: SessionUser,
  installationId: string,
  input: AddTeamMemberInput
): Promise<InstallationTeamMember> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  await loadVisible<Pick<Installation, 'id'>>(
    supabase,
    'installations',
    installationId,
    'id',
    'Installation'
  )
  await assertOMEmployee(supabase, user, input.user_id)

  const { data, error } = await supabase
    .from('installation_team_members')
    .insert({
      installation_id: installationId,
      user_id: input.user_id,
      role_on_site: input.role_on_site ?? null,
    })
    .select()
    .single()

  if (error) {
    // 23505 is the (installation_id, user_id) unique constraint.
    if (error.code === '23505') {
      throw new ServiceError('That person is already on this installation team', 409)
    }
    throw new ServiceError(error.message, 400)
  }

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'installation_team_member_added',
    entityType: 'installation',
    entityId: installationId,
    metadata: { user_id: input.user_id, role_on_site: input.role_on_site ?? null },
  })

  return data as InstallationTeamMember
}

export async function removeTeamMember(
  user: SessionUser,
  installationId: string,
  memberId: string
): Promise<void> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const member = await loadVisible<Pick<InstallationTeamMember, 'id' | 'installation_id' | 'user_id'>>(
    supabase,
    'installation_team_members',
    memberId,
    'id, installation_id, user_id',
    'Team member'
  )

  if (member.installation_id !== installationId) {
    throw new ServiceError('That team member does not belong to this installation', 400)
  }

  const { error } = await supabase
    .from('installation_team_members')
    .delete()
    .eq('id', memberId)

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'installation_team_member_removed',
    entityType: 'installation',
    entityId: installationId,
    metadata: { user_id: member.user_id },
  })
}

// ---------------------------------------------------------------------------
// Progress updates (append-only)
// ---------------------------------------------------------------------------

/**
 * Records a progress reading. updated_by is the session user, never the caller's to
 * assign — same rule as task progress: a progress note is a report from the person
 * doing the work, so it is authored in their name.
 */
export async function addProgressUpdate(
  user: SessionUser,
  installationId: string,
  input: ProgressUpdateInput
): Promise<InstallationProgressUpdate> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  await loadVisible<Pick<Installation, 'id'>>(
    supabase,
    'installations',
    installationId,
    'id',
    'Installation'
  )

  const { data, error } = await supabase
    .from('installation_progress_updates')
    .insert({
      installation_id: installationId,
      updated_by: user.id,
      progress_percent: input.progress_percent,
      note: input.note ?? null,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'installation_progress_logged',
    entityType: 'installation',
    entityId: installationId,
    metadata: { progress_percent: input.progress_percent },
  })

  return data as InstallationProgressUpdate
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

/**
 * Records an uploaded photo's metadata. The file itself goes to the private
 * installation-media bucket from the route handler; this row makes it findable.
 * The path must live under this installation's folder, or a signed URL minted from
 * it later would hand out a photo from another site.
 */
export async function addPhoto(
  user: SessionUser,
  installationId: string,
  input: InstallationPhotoMetaInput
): Promise<InstallationPhoto> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  await loadVisible<Pick<Installation, 'id'>>(
    supabase,
    'installations',
    installationId,
    'id',
    'Installation'
  )

  if (!input.file_path.startsWith(`${installationId}/`)) {
    throw new ServiceError('File path does not belong to this installation', 400)
  }

  const { data, error } = await supabase
    .from('installation_photos')
    .insert({
      installation_id: installationId,
      file_path: input.file_path,
      file_name: input.file_name,
      photo_stage: input.photo_stage ?? null,
      uploaded_by: user.id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'installation_photo_uploaded',
    entityType: 'installation',
    entityId: installationId,
    metadata: { photo_stage: input.photo_stage ?? null, file_name: input.file_name },
  })

  return data as InstallationPhoto
}

export async function signPhotoDownload(
  user: SessionUser,
  photoId: string
): Promise<{ url: string; fileName: string }> {
  const supabase = await createSupabaseServerClient()

  const photo = await loadVisible<
    Pick<InstallationPhoto, 'id' | 'installation_id' | 'file_path' | 'file_name'>
  >(supabase, 'installation_photos', photoId, 'id, installation_id, file_path, file_name', 'Photo')

  const { data, error } = await supabase.storage
    .from(INSTALLATION_MEDIA_BUCKET)
    .createSignedUrl(photo.file_path, SIGNED_URL_TTL_SECONDS, { download: photo.file_name })

  if (error || !data) throw new ServiceError(error?.message ?? 'Could not sign the file', 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'installation_photo_downloaded',
    entityType: 'installation',
    entityId: photo.installation_id,
    metadata: { file_name: photo.file_name },
  })

  return { url: data.signedUrl, fileName: photo.file_name }
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

/** Adds an ad-hoc checklist item on top of the seeded default list. */
export async function addChecklistItem(
  user: SessionUser,
  installationId: string,
  input: ChecklistItemCreateInput
): Promise<InstallationChecklistItem> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  await loadVisible<Pick<Installation, 'id'>>(
    supabase,
    'installations',
    installationId,
    'id',
    'Installation'
  )

  const { data, error } = await supabase
    .from('installation_checklists')
    .insert({ installation_id: installationId, item: input.item })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'checklist_item_added',
    entityType: 'installation',
    entityId: installationId,
    metadata: { item: input.item },
  })

  return data as InstallationChecklistItem
}

/**
 * Ticks or un-ticks a checklist item. checked_by/checked_at are stamped
 * server-side from the session and the clock, and cleared when un-ticked — a check
 * mark has to record who actually made it, not who last edited the row.
 */
export async function setChecklistItemChecked(
  user: SessionUser,
  itemId: string,
  input: ChecklistItemUpdateInput
): Promise<InstallationChecklistItem> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const existing = await loadVisible<Pick<InstallationChecklistItem, 'id' | 'installation_id'>>(
    supabase,
    'installation_checklists',
    itemId,
    'id, installation_id',
    'Checklist item'
  )

  const { data, error } = await supabase
    .from('installation_checklists')
    .update({
      is_checked: input.is_checked,
      checked_by: input.is_checked ? user.id : null,
      checked_at: input.is_checked ? new Date().toISOString() : null,
    })
    .eq('id', itemId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: input.is_checked ? 'checklist_item_checked' : 'checklist_item_unchecked',
    entityType: 'installation',
    entityId: existing.installation_id,
    metadata: { checklist_item_id: itemId },
  })

  return data as InstallationChecklistItem
}

// ---------------------------------------------------------------------------
// Final inspection
// ---------------------------------------------------------------------------

/**
 * Records a final inspection result. inspected_by is the session user.
 *
 * §3.3 asks for a peer-check — typically a different technician than the installer —
 * but is explicit that v1 does NOT hard-block completion on it, so this neither
 * checks the inspector against the installer nor gates the installation status. The
 * dashboard surfaces "inspection outstanding" instead; enforcing a separate-inspector
 * rule is a policy the client would need to opt into.
 */
export async function recordInspection(
  user: SessionUser,
  installationId: string,
  input: FinalInspectionInput
): Promise<FinalInspection> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  await loadVisible<Pick<Installation, 'id'>>(
    supabase,
    'installations',
    installationId,
    'id',
    'Installation'
  )

  const { data, error } = await supabase
    .from('final_inspections')
    .insert({
      installation_id: installationId,
      inspected_by: user.id,
      result: input.result,
      notes: input.notes ?? null,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'final_inspection_recorded',
    entityType: 'installation',
    entityId: installationId,
    metadata: { result: input.result },
  })

  return data as FinalInspection
}

// ---------------------------------------------------------------------------
// Completion report
// ---------------------------------------------------------------------------

/**
 * Submits the completion report. Per §3.2 this does NOT auto-transition the
 * installation to 'completed' — marking it complete is a deliberate separate step
 * (updateInstallation), the same manual-handoff philosophy Technical uses. The UI
 * prompts for it after the report is filed.
 */
export async function submitCompletionReport(
  user: SessionUser,
  installationId: string,
  input: CompletionReportInput
): Promise<CompletionReport> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  await loadVisible<Pick<Installation, 'id'>>(
    supabase,
    'installations',
    installationId,
    'id',
    'Installation'
  )

  if (input.report_file_path && !input.report_file_path.startsWith(`${installationId}/`)) {
    throw new ServiceError('Report file path does not belong to this installation', 400)
  }

  const { data, error } = await supabase
    .from('completion_reports')
    .insert({
      installation_id: installationId,
      submitted_by: user.id,
      summary: input.summary,
      actual_system_size_kw: input.actual_system_size_kw ?? null,
      report_file_path: input.report_file_path ?? null,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'completion_report_submitted',
    entityType: 'installation',
    entityId: installationId,
    metadata: { has_file: Boolean(input.report_file_path) },
  })

  return data as CompletionReport
}

// ---------------------------------------------------------------------------
// Service tickets
// ---------------------------------------------------------------------------

/**
 * Logs a complaint. raised_by is the staff member filing it (phone/WhatsApp relay),
 * not the customer — there is no customer-facing portal in v1.
 */
export async function createServiceTicket(
  user: SessionUser,
  input: CreateServiceTicketInput
): Promise<ServiceTicket> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('service_tickets')
    .insert({
      organization_id: user.organization_id,
      customer_id: input.customer_id,
      installation_id: input.installation_id ?? null,
      raised_by: user.id,
      issue_type: input.issue_type ?? null,
      description: input.description,
      priority: input.priority,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'service_ticket_created',
    entityType: 'service_ticket',
    entityId: data.id,
    metadata: {
      customer_id: input.customer_id,
      priority: input.priority,
      issue_type: input.issue_type ?? null,
    },
  })

  return data as ServiceTicket
}

/**
 * Updates a ticket — reassigning, reprioritising, or moving its status.
 *
 * THE REPORT GATE (§3.4): a ticket may not reach 'resolved' unless at least one
 * service_reports row exists for it. A transition table cannot see that, so the
 * check is here, and it runs after the transition check so an illegal move is still
 * rejected first. Assigning also stamps status 'assigned' when a still-'open' ticket
 * gets an owner, so the queue reflects that it has been picked up.
 */
export async function updateServiceTicket(
  user: SessionUser,
  ticketId: string,
  input: UpdateServiceTicketInput
): Promise<ServiceTicket> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const existing = await loadVisible<Pick<ServiceTicket, 'id' | 'status' | 'assigned_to'>>(
    supabase,
    'service_tickets',
    ticketId,
    'id, status, assigned_to',
    'Service ticket'
  )

  if (input.status) {
    assertTransition(
      SERVICE_TICKET_TRANSITIONS,
      existing.status,
      input.status,
      SERVICE_TICKET_STATUS_LABELS
    )
  }

  if (input.assigned_to) {
    await assertOMEmployee(supabase, user, input.assigned_to)
  }

  if (input.status === 'resolved') {
    const { count } = await supabase
      .from('service_reports')
      .select('id', { count: 'exact', head: true })
      .eq('service_ticket_id', ticketId)

    if (!count || count === 0) {
      throw new ServiceError(
        'Log a service report describing the work done before resolving this ticket',
        400
      )
    }
  }

  // Picking up an open ticket by assigning it moves it to 'assigned' unless the
  // caller set an explicit status. A ticket with an owner still reading "open"
  // looks unclaimed in the queue.
  const autoAssign =
    !input.status && input.assigned_to && existing.status === 'open'
      ? { status: 'assigned' as ServiceTicketStatus }
      : {}

  const { data, error } = await supabase
    .from('service_tickets')
    .update({ ...input, ...autoAssign })
    .eq('id', ticketId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  const effectiveStatus = input.status ?? autoAssign.status
  const reassigned = Boolean(input.assigned_to) && input.assigned_to !== existing.assigned_to

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: reassigned
      ? 'service_ticket_assigned'
      : effectiveStatus
        ? 'service_ticket_status_changed'
        : 'service_ticket_updated',
    entityType: 'service_ticket',
    entityId: ticketId,
    metadata: {
      changed: Object.keys(input),
      ...(effectiveStatus ? { from_status: existing.status, to_status: effectiveStatus } : {}),
      ...(reassigned ? { from_assignee: existing.assigned_to, to_assignee: input.assigned_to } : {}),
    },
  })

  return data as ServiceTicket
}

/**
 * Files a service report against a ticket. This is what unlocks resolving the
 * ticket (see updateServiceTicket). If the report itself is marked resolved, the
 * ticket is advanced to 'resolved' in the same call as a convenience — the report
 * is the evidence the resolution requires, so filing it and closing out are one
 * action from the engineer's point of view.
 */
export async function addServiceReport(
  user: SessionUser,
  ticketId: string,
  input: CreateServiceReportInput
): Promise<{ report: ServiceReport; ticket: ServiceTicket | null }> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const ticket = await loadVisible<Pick<ServiceTicket, 'id' | 'status'>>(
    supabase,
    'service_tickets',
    ticketId,
    'id, status',
    'Service ticket'
  )

  const { data, error } = await supabase
    .from('service_reports')
    .insert({
      service_ticket_id: ticketId,
      reported_by: user.id,
      work_done: input.work_done,
      parts_used: input.parts_used ?? null,
      resolved: input.resolved,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'service_report_logged',
    entityType: 'service_ticket',
    entityId: ticketId,
    metadata: { resolved: input.resolved, parts_used: Boolean(input.parts_used) },
  })

  // Only advance if the report resolves it and the ticket is on a status from which
  // 'resolved' is legal. Otherwise leave the status alone — the report stands on its
  // own and the ticket can be resolved later once it is in an appropriate state.
  let updatedTicket: ServiceTicket | null = null
  if (
    input.resolved &&
    ticket.status !== 'resolved' &&
    ticket.status !== 'closed' &&
    (SERVICE_TICKET_TRANSITIONS[ticket.status] ?? []).includes('resolved')
  ) {
    const { data: t, error: tErr } = await supabase
      .from('service_tickets')
      .update({ status: 'resolved' })
      .eq('id', ticketId)
      .select()
      .single()

    if (tErr) throw new ServiceError(tErr.message, 400)
    updatedTicket = t as ServiceTicket

    await logAction({
      organizationId: user.organization_id,
      userId: user.id,
      action: 'service_ticket_status_changed',
      entityType: 'service_ticket',
      entityId: ticketId,
      metadata: { from_status: ticket.status, to_status: 'resolved', via: 'service_report' },
    })
  }

  return { report: data as ServiceReport, ticket: updatedTicket }
}

// ---------------------------------------------------------------------------
// AMC contracts & visits
// ---------------------------------------------------------------------------

export async function createAmcContract(
  user: SessionUser,
  input: CreateAmcContractInput
): Promise<AmcContract> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  if (input.assigned_to) {
    await assertOMEmployee(supabase, user, input.assigned_to)
  }

  const { data, error } = await supabase
    .from('amc_contracts')
    .insert({
      organization_id: user.organization_id,
      customer_id: input.customer_id,
      installation_id: input.installation_id ?? null,
      start_date: input.start_date,
      end_date: input.end_date,
      visit_frequency: input.visit_frequency ?? null,
      amount: input.amount ?? null,
      assigned_to: input.assigned_to ?? null,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'amc_contract_created',
    entityType: 'amc_contract',
    entityId: data.id,
    metadata: {
      customer_id: input.customer_id,
      end_date: input.end_date,
      visit_frequency: input.visit_frequency ?? null,
    },
  })

  return data as AmcContract
}

export async function updateAmcContract(
  user: SessionUser,
  contractId: string,
  input: UpdateAmcContractInput
): Promise<AmcContract> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const existing = await loadVisible<Pick<AmcContract, 'id' | 'status' | 'start_date' | 'end_date'>>(
    supabase,
    'amc_contracts',
    contractId,
    'id, status, start_date, end_date',
    'AMC contract'
  )

  // end_date can be edited (a renewal extends it) but never before the start.
  if (input.end_date && new Date(input.end_date) < new Date(existing.start_date)) {
    throw new ServiceError('End date must be on or after the start date', 400)
  }

  if (input.assigned_to) {
    await assertOMEmployee(supabase, user, input.assigned_to)
  }

  const { data, error } = await supabase
    .from('amc_contracts')
    .update(input)
    .eq('id', contractId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'amc_contract_updated',
    entityType: 'amc_contract',
    entityId: contractId,
    metadata: {
      changed: Object.keys(input),
      ...(input.status && input.status !== existing.status
        ? { from_status: existing.status, to_status: input.status }
        : {}),
    },
  })

  return data as AmcContract
}

/**
 * Schedules the next visit for a contract. Per §3.5 v1 has no recurrence engine —
 * the lead schedules the next visit manually after each completes.
 */
export async function scheduleAmcVisit(
  user: SessionUser,
  contractId: string,
  input: ScheduleAmcVisitInput
): Promise<AmcVisit> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  await loadVisible<Pick<AmcContract, 'id'>>(
    supabase,
    'amc_contracts',
    contractId,
    'id',
    'AMC contract'
  )

  if (input.performed_by) {
    await assertOMEmployee(supabase, user, input.performed_by)
  }

  const { data, error } = await supabase
    .from('amc_visits')
    .insert({
      amc_contract_id: contractId,
      scheduled_date: input.scheduled_date,
      performed_by: input.performed_by ?? null,
      notes: input.notes ?? null,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'amc_visit_scheduled',
    entityType: 'amc_contract',
    entityId: contractId,
    metadata: { scheduled_date: input.scheduled_date, amc_visit_id: data.id },
  })

  return data as AmcVisit
}

/**
 * Updates a visit — completing it, or rescheduling. Completing stamps completed_date
 * if none was supplied. 'missed' is never accepted (it is derived from a passed
 * date), which the transition table also enforces.
 */
export async function updateAmcVisit(
  user: SessionUser,
  visitId: string,
  input: UpdateAmcVisitInput
): Promise<AmcVisit> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const existing = await loadVisible<Pick<AmcVisit, 'id' | 'amc_contract_id' | 'status'>>(
    supabase,
    'amc_visits',
    visitId,
    'id, amc_contract_id, status',
    'AMC visit'
  )

  if (input.status) {
    assertTransition(AMC_VISIT_TRANSITIONS, existing.status, input.status, AMC_VISIT_STATUS_LABELS)
  }

  if (input.performed_by) {
    await assertOMEmployee(supabase, user, input.performed_by)
  }

  const completing = input.status === 'completed'

  const { data, error } = await supabase
    .from('amc_visits')
    .update({
      ...input,
      ...(completing && !input.completed_date
        ? { completed_date: new Date().toISOString().slice(0, 10) }
        : {}),
    })
    .eq('id', visitId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: input.status ? 'amc_visit_status_changed' : 'amc_visit_updated',
    entityType: 'amc_contract',
    entityId: existing.amc_contract_id,
    metadata: {
      amc_visit_id: visitId,
      changed: Object.keys(input),
      ...(input.status ? { from_status: existing.status, to_status: input.status } : {}),
    },
  })

  return data as AmcVisit
}

// ---------------------------------------------------------------------------
// Performance logs (append-only)
// ---------------------------------------------------------------------------

/**
 * Records a manual generation reading. Explicitly not a telemetry pipeline — the
 * figure comes from a customer-reported meter or an app screenshot. An issue_flag
 * reading surfaces on the lead's team dashboard as something to follow up.
 */
export async function addPerformanceLog(
  user: SessionUser,
  installationId: string,
  input: CreatePerformanceLogInput
): Promise<PerformanceLog> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  await loadVisible<Pick<Installation, 'id'>>(
    supabase,
    'installations',
    installationId,
    'id',
    'Installation'
  )

  const { data, error } = await supabase
    .from('performance_logs')
    .insert({
      installation_id: installationId,
      logged_by: user.id,
      log_date: input.log_date,
      generation_kwh: input.generation_kwh ?? null,
      issue_flag: input.issue_flag,
      notes: input.notes ?? null,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'performance_log_recorded',
    entityType: 'installation',
    entityId: installationId,
    metadata: { log_date: input.log_date, issue_flag: input.issue_flag },
  })

  return data as PerformanceLog
}
