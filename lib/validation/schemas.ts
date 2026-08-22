import { z } from 'zod'

export const taskPriority = z.enum(['low', 'medium', 'high', 'urgent'])
export const taskStatus = z.enum(['pending', 'in_progress', 'delayed', 'completed', 'archived'])

export const createTaskSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
  description: z.string().trim().max(5000).optional().nullable(),
  assigned_department_id: z.string().uuid('Select a department'),
  assigned_user_id: z.string().uuid().optional().nullable(),
  priority: taskPriority.default('medium'),
  due_date: z.string().datetime().optional().nullable(),
})

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    assigned_department_id: z.string().uuid().optional(),
    assigned_user_id: z.string().uuid().nullable().optional(),
    priority: taskPriority.optional(),
    status: taskStatus.optional(),
    due_date: z.string().datetime().nullable().optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

/*
 * `progress_percent` is deliberately absent above, and this is a rule rather than
 * an omission.
 *
 * Progress is a report from the person doing the work. Every write to a task
 * appends a task_updates row stamped with `updated_by`, so a CEO or a manager
 * dragging a progress slider authors a progress report in someone else's name —
 * the number stops being evidence and the timeline stops being trustworthy.
 * "60% done" has to mean the assignee said so.
 *
 * Management still has every lever it actually needs: reassign, reprioritise,
 * change the due date, mark something delayed, archive, reopen, and add a note.
 * What it cannot do is claim work happened. Progress arrives through
 * updateTaskProgressSchema below, from the assignee.
 */

/**
 * What a department employee may change on their own task.
 * They cannot reassign, reprioritize, or archive — only move it forward and
 * log progress. This is the only path that may write progress_percent.
 */
export const updateTaskProgressSchema = z
  .object({
    // Subset of task_status that makes sense for a self-update.
    // 'delayed' and 'archived' stay CEO-only.
    status: z.enum(['pending', 'in_progress', 'completed']).optional(),
    progress_percent: z.number().int().min(0).max(100).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.status !== undefined || v.progress_percent !== undefined, {
    message: 'Provide at least a status or progress value',
  })

export type UpdateTaskProgressInput = z.infer<typeof updateTaskProgressSchema>
export type CreateTaskInput = z.infer<typeof createTaskSchema>
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>

// ---------------------------------------------------------------------------
// Sales module
// ---------------------------------------------------------------------------

export const leadStatus = z.enum([
  'new',
  'contacted',
  'site_visit_scheduled',
  'quotation_sent',
  'proposal_sent',
  'negotiation',
  'won',
  'lost',
])

/**
 * Statuses a plain lead update may set. 'won' is deliberately absent: reaching
 * it has to go through POST /api/leads/[leadId]/close, which creates the
 * customer and the deal_closures row in the same transaction. Allowing a bare
 * PATCH to 'won' would let a caller mark a deal closed with no closure record —
 * exactly the partial state the atomicity requirement exists to prevent.
 */
export const leadUpdatableStatus = z.enum([
  'new',
  'contacted',
  'site_visit_scheduled',
  'quotation_sent',
  'proposal_sent',
  'negotiation',
  'lost',
])

export const propertyType = z.enum(['residential', 'commercial', 'industrial'])
export const followUpType = z.enum(['call', 'meeting', 'email', 'site_visit_reminder'])
export const followUpStatus = z.enum(['pending', 'completed', 'missed'])
export const siteVisitStatus = z.enum(['requested', 'scheduled', 'completed', 'cancelled'])
export const quotationStatus = z.enum(['draft', 'sent', 'accepted', 'rejected', 'expired'])
export const proposalStatus = z.enum(['draft', 'sent', 'accepted', 'rejected'])

const optionalPhone = z
  .string()
  .trim()
  .max(20)
  .regex(/^[+\d\s()-]*$/, 'Phone may only contain digits, spaces, and + ( ) -')
  .optional()
  .nullable()

const optionalEmail = z.union([z.literal(''), z.string().trim().email()]).optional().nullable()

export const createLeadSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(200),
  phone: optionalPhone,
  email: optionalEmail,
  source: z.string().trim().max(60).optional().nullable(),
  property_type: propertyType.optional().nullable(),
  estimated_load_kw: z.number().nonnegative().max(100_000).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  // Manager/CEO only. An executive's own assignment is forced to themselves in
  // the service layer, so this field being absent is the normal case for them.
  assigned_to: z.string().uuid().optional().nullable(),
})

export const updateLeadSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    phone: optionalPhone,
    email: optionalEmail,
    source: z.string().trim().max(60).nullable().optional(),
    property_type: propertyType.nullable().optional(),
    estimated_load_kw: z.number().nonnegative().max(100_000).nullable().optional(),
    status: leadUpdatableStatus.optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    assigned_to: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

export const createFollowUpSchema = z.object({
  scheduled_for: z.string().datetime(),
  type: followUpType.default('call'),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export const updateFollowUpSchema = z.object({
  // Only completed/missed are settable — 'pending' is the initial state, and
  // being *overdue* is derived from scheduled_for, never stored.
  status: z.enum(['completed', 'missed']),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export const createSiteVisitSchema = z.object({
  preferred_date: z.string().datetime().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export const updateSiteVisitSchema = z
  .object({
    status: siteVisitStatus.optional(),
    preferred_date: z.string().datetime().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

export const createQuotationSchema = z.object({
  system_size_kw: z.number().nonnegative().max(100_000).optional().nullable(),
  amount: z.number().nonnegative('Amount cannot be negative').max(1e12),
  valid_until: z.string().date().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export const updateQuotationSchema = z
  .object({
    system_size_kw: z.number().nonnegative().max(100_000).nullable().optional(),
    amount: z.number().nonnegative().max(1e12).optional(),
    valid_until: z.string().date().nullable().optional(),
    status: quotationStatus.optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

export const createProposalSchema = z.object({
  quotation_id: z.string().uuid().optional().nullable(),
  amount: z.number().nonnegative('Amount cannot be negative').max(1e12),
  terms: z.string().trim().max(10_000).optional().nullable(),
})

export const updateProposalSchema = z
  .object({
    quotation_id: z.string().uuid().nullable().optional(),
    amount: z.number().nonnegative().max(1e12).optional(),
    terms: z.string().trim().max(10_000).nullable().optional(),
    status: proposalStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

export const closeDealSchema = z.object({
  final_amount: z.number().nonnegative('Final amount cannot be negative').max(1e12),
  proposal_id: z.string().uuid().optional().nullable(),
  // Captured at closing time: a lead has no address field, a customer does.
  address: z.string().trim().max(1000).optional().nullable(),
})

export const createSalesTargetSchema = z
  .object({
    user_id: z.string().uuid('Select an employee'),
    period_start: z.string().date(),
    period_end: z.string().date(),
    target_amount: z.number().positive('Target must be greater than zero').max(1e12),
    target_deals: z.number().int().positive().max(10_000).optional().nullable(),
  })
  .refine((v) => new Date(v.period_end) >= new Date(v.period_start), {
    message: 'Period end must be on or after period start',
    path: ['period_end'],
  })

export type CreateLeadInput = z.infer<typeof createLeadSchema>
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>
export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>
export type UpdateFollowUpInput = z.infer<typeof updateFollowUpSchema>
export type CreateSiteVisitInput = z.infer<typeof createSiteVisitSchema>
export type UpdateSiteVisitInput = z.infer<typeof updateSiteVisitSchema>
export type CreateQuotationInput = z.infer<typeof createQuotationSchema>
export type UpdateQuotationInput = z.infer<typeof updateQuotationSchema>
export type CreateProposalInput = z.infer<typeof createProposalSchema>
export type UpdateProposalInput = z.infer<typeof updateProposalSchema>
export type CloseDealInput = z.infer<typeof closeDealSchema>
export type CreateSalesTargetInput = z.infer<typeof createSalesTargetSchema>

export const approvalDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(2000).optional(),
})

export type ApprovalDecisionInput = z.infer<typeof approvalDecisionSchema>

// ---------------------------------------------------------------------------
// Tender module
// ---------------------------------------------------------------------------

export const tenderStatus = z.enum([
  'open',
  'preparing_bid',
  'submitted',
  'won',
  'lost',
  'cancelled',
])

export const tenderBidStatus = z.enum(['draft', 'submitted', 'under_review', 'won', 'lost'])

export const createTenderSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(300),
  issuing_authority: z.string().trim().max(300).optional().nullable(),
  tender_number: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(5000).optional().nullable(),
  // A tender being logged now must still be biddable — the deadline has to be
  // ahead of us. Edit allows a past date, since a tender may be logged
  // retroactively after the fact.
  submission_deadline: z
    .string()
    .datetime()
    .refine((v) => new Date(v).getTime() > Date.now(), {
      message: 'Submission deadline must be in the future',
    }),
  estimated_value: z.number().nonnegative().max(1e12).optional().nullable(),
  assigned_employee_id: z.string().uuid().optional().nullable(),
})

export const updateTenderSchema = z
  .object({
    title: z.string().trim().min(3).max(300).optional(),
    issuing_authority: z.string().trim().max(300).nullable().optional(),
    tender_number: z.string().trim().max(120).nullable().optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    submission_deadline: z.string().datetime().optional(),
    estimated_value: z.number().nonnegative().max(1e12).nullable().optional(),
    assigned_employee_id: z.string().uuid().nullable().optional(),
    status: tenderStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

export const createBidSchema = z.object({
  bid_amount: z.number().nonnegative().max(1e12).optional().nullable(),
  bid_status: tenderBidStatus.default('draft'),
  assigned_employee_id: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
})

export const updateBidSchema = z
  .object({
    bid_amount: z.number().nonnegative().max(1e12).nullable().optional(),
    bid_status: tenderBidStatus.optional(),
    assigned_employee_id: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

export const createDocumentSchema = z.object({
  file_path: z.string().trim().min(1).max(1000),
  file_name: z.string().trim().min(1).max(300),
  document_type: z.string().trim().max(60).optional().nullable(),
})

export type CreateTenderInput = z.infer<typeof createTenderSchema>
export type UpdateTenderInput = z.infer<typeof updateTenderSchema>
export type CreateBidInput = z.infer<typeof createBidSchema>
export type UpdateBidInput = z.infer<typeof updateBidSchema>
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>

// ---------------------------------------------------------------------------
// Distribution module
// ---------------------------------------------------------------------------

export const purchaseOrderStatus = z.enum([
  'draft',
  'pending_finance_approval',
  'approved',
  'ordered',
  'partially_received',
  'received',
  'cancelled',
])

/**
 * The statuses Distribution may set through the ordinary PATCH endpoint.
 *
 * 'approved' is absent by design, not by omission: approving is Finance's
 * transition and lives at POST /api/purchase-orders/[poId]/approve. Leaving it
 * out here means a hand-crafted PATCH body cannot reach 'approved' even before
 * the service layer's transition check runs — one fewer way to skip the gate.
 */
export const purchaseOrderDistributionStatus = z.enum([
  'draft',
  'pending_finance_approval',
  'ordered',
  'partially_received',
  'received',
  'cancelled',
])

export const dispatchStatus = z.enum([
  'preparing',
  'in_transit',
  'delivered',
  'delayed',
  'cancelled',
])

/**
 * 'dispatched' is not settable by hand. An allocation reaches it only through
 * create_dispatch_from_allocations(), which sets linked_dispatch_id in the same
 * statement — a manual flip would leave the plan record claiming a dispatch that
 * does not exist.
 */
export const allocationUpdatableStatus = z.enum(['returned', 'cancelled'])

export const materialReturnStatus = z.enum(['pending', 'received_by_store', 'rejected'])
export const materialCondition = z.enum(['good', 'damaged', 'unusable'])

/**
 * Category and unit are free text in the database, validated loosely here, with
 * the canonical picker lists in lib/distribution/constants.ts — the same
 * arrangement as leads.source and LEAD_SOURCES. Adding a material category is a
 * constants edit, not a migration.
 */
const optionalCategory = z.string().trim().max(60).optional().nullable()
const materialUnit = z.string().trim().min(1).max(30).default('nos')

/** numeric(12,2) in the database, and the check constraint requires it positive. */
const materialQuantity = z
  .number()
  .positive('Quantity must be greater than zero')
  .max(1_000_000_000)

// Vendors -------------------------------------------------------------------

export const createVendorSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(200),
  category: optionalCategory,
  contact_person: z.string().trim().max(200).optional().nullable(),
  phone: optionalPhone,
  email: optionalEmail,
  address: z.string().trim().max(1000).optional().nullable(),
  gstin: z.string().trim().max(20).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
})

export const updateVendorSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    category: optionalCategory,
    contact_person: z.string().trim().max(200).nullable().optional(),
    phone: optionalPhone,
    email: optionalEmail,
    address: z.string().trim().max(1000).nullable().optional(),
    gstin: z.string().trim().max(20).nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    // Deactivation is the only "delete" this module has — a vendor with PO
    // history is never removed. Settable both ways so one can be reinstated.
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

// Purchase orders -----------------------------------------------------------

export const purchaseOrderItemSchema = z.object({
  item_name: z.string().trim().min(1, 'Item name is required').max(300),
  category: optionalCategory,
  quantity: materialQuantity,
  unit: materialUnit,
  unit_price: z.number().nonnegative('Unit price cannot be negative').max(1e12),
})

export const createPurchaseOrderSchema = z.object({
  vendor_id: z.string().uuid('Select a vendor'),
  expected_delivery_date: z.string().date().optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  // A PO with no lines would have a total_amount of zero and nothing to order.
  items: z.array(purchaseOrderItemSchema).min(1, 'Add at least one line item'),
  /**
   * Submit for Finance approval immediately instead of saving a draft. Either way
   * the PO starts before the approval gate — this only chooses which side of
   * 'draft' -> 'pending_finance_approval' it lands on.
   */
  submit_for_approval: z.boolean().default(false),
})

export const updatePurchaseOrderSchema = z
  .object({
    vendor_id: z.string().uuid().optional(),
    expected_delivery_date: z.string().date().nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    status: purchaseOrderDistributionStatus.optional(),
    /**
     * Replaces the whole line-item set. Only accepted while the PO is still a
     * draft — once Finance has been asked to approve an amount, the lines behind
     * that amount are frozen (enforced in the service layer). total_amount is
     * never accepted from the client at all; the database trigger owns it.
     */
    items: z.array(purchaseOrderItemSchema).min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

export const approvePurchaseOrderSchema = z.object({
  note: z.string().trim().max(2000).optional(),
})

// Material allocations ------------------------------------------------------

export const allocationItemSchema = z.object({
  item_name: z.string().trim().min(1, 'Item name is required').max(300),
  category: optionalCategory,
  quantity: materialQuantity,
  unit: materialUnit,
})

/**
 * Allocations are planned per project, so this creates several rows at once —
 * one per item — for a single lead. The board then groups them back by lead.
 */
export const createAllocationSchema = z.object({
  lead_id: z.string().uuid('Select a project'),
  items: z.array(allocationItemSchema).min(1, 'Add at least one item'),
})

export const updateAllocationSchema = z.object({
  status: allocationUpdatableStatus,
})

// Dispatches ---------------------------------------------------------------

export const dispatchItemSchema = allocationItemSchema

export const createDispatchSchema = z
  .object({
    // Nullable: an internal or inter-warehouse move has no customer project.
    lead_id: z.string().uuid().optional().nullable(),
    /**
     * Allocations to fulfil with this dispatch. The route hands these to
     * create_dispatch_from_allocations(), which copies them into dispatch items
     * and flips them to 'dispatched' in one transaction.
     */
    allocation_ids: z.array(z.string().uuid()).default([]),
    /** Ad-hoc lines, for material that was never planned as an allocation. */
    items: z.array(dispatchItemSchema).default([]),
    vehicle_details: z.string().trim().max(300).optional().nullable(),
    driver_contact: optionalPhone,
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .refine((v) => v.allocation_ids.length > 0 || v.items.length > 0, {
    message: 'Select at least one allocation or add an item',
    path: ['items'],
  })
  .refine((v) => v.allocation_ids.length === 0 || Boolean(v.lead_id), {
    message: 'A dispatch drawn from allocations needs the project they belong to',
    path: ['lead_id'],
  })

export const updateDispatchSchema = z
  .object({
    status: dispatchStatus.optional(),
    vehicle_details: z.string().trim().max(300).nullable().optional(),
    driver_contact: optionalPhone,
    delivery_notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

// Material returns ---------------------------------------------------------

export const createReturnSchema = z.object({
  dispatch_id: z.string().uuid().optional().nullable(),
  lead_id: z.string().uuid().optional().nullable(),
  item_name: z.string().trim().min(1, 'Item name is required').max(300),
  category: optionalCategory,
  quantity: materialQuantity,
  unit: materialUnit,
  reason: z.string().trim().max(60).optional().nullable(),
  condition: materialCondition.default('good'),
})

export const updateReturnSchema = z.object({
  // 'pending' is the initial state and not settable back to.
  status: z.enum(['received_by_store', 'rejected']),
})

export type CreateVendorInput = z.infer<typeof createVendorSchema>
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>
export type PurchaseOrderItemInput = z.infer<typeof purchaseOrderItemSchema>
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>
export type UpdatePurchaseOrderInput = z.infer<typeof updatePurchaseOrderSchema>
export type ApprovePurchaseOrderInput = z.infer<typeof approvePurchaseOrderSchema>
export type AllocationItemInput = z.infer<typeof allocationItemSchema>
export type CreateAllocationInput = z.infer<typeof createAllocationSchema>
export type UpdateAllocationInput = z.infer<typeof updateAllocationSchema>
export type CreateDispatchInput = z.infer<typeof createDispatchSchema>
export type UpdateDispatchInput = z.infer<typeof updateDispatchSchema>
export type CreateReturnInput = z.infer<typeof createReturnSchema>
export type UpdateReturnInput = z.infer<typeof updateReturnSchema>

// ---------------------------------------------------------------------------
// Technical module
// ---------------------------------------------------------------------------

export const surveyStatus = z.enum(['assigned', 'in_progress', 'completed', 'cancelled'])

/**
 * 'assigned' is omitted: it is the state a survey is born in, and
 * SURVEY_TRANSITIONS has no edge back to it. Leaving it out of the PATCH
 * vocabulary means a hand-crafted body cannot even ask.
 */
export const surveyUpdatableStatus = z.enum(['in_progress', 'completed', 'cancelled'])

export const designStatus = z.enum(['draft', 'under_review', 'approved', 'sent_to_sales'])
export const itTicketStatus = z.enum(['open', 'in_progress', 'resolved', 'closed'])
export const itIssueType = z.enum([
  'erp_bug',
  'software_access',
  'hardware',
  'data_backup',
  'other',
])

/**
 * Real coordinate bounds, not just "is a number". A transposed lat/long pair is
 * the classic geolocation bug, and a latitude of 145 is unambiguously wrong rather
 * than merely improbable.
 */
const latitude = z.number().min(-90, 'Latitude must be between -90 and 90').max(90)
const longitude = z.number().min(-180, 'Longitude must be between -180 and 180').max(180)

/** Non-negative measurement, rejecting the NaN that an empty numeric input yields. */
const positiveMeasure = z
  .number()
  .finite('Enter a valid number')
  .positive('Must be greater than zero')

/**
 * The structured form behind site_surveys.roof_measurements. Every field optional:
 * a surveyor may record area without shading notes, or vice versa, and the column
 * is jsonb precisely so partial records are legal.
 *
 * Unknown keys are stripped rather than rejected, which is zod's default — the
 * blob is meant to be extensible, so an older client sending a field this build
 * does not know about should not fail the whole save.
 */
export const roofMeasurementsSchema = z.object({
  usable_area_sqft: positiveMeasure.optional(),
  shading_notes: z.string().trim().max(2000).optional(),
  orientation: z.string().trim().max(60).optional(),
  tilt_degrees: z.number().min(0, 'Tilt cannot be negative').max(90).optional(),
})

export const createSurveySchema = z.object({
  // Both nullable: a standalone survey has no Sales request and may have no lead.
  site_visit_request_id: z.string().uuid().optional().nullable(),
  lead_id: z.string().uuid().optional().nullable(),
  assigned_engineer_id: z.string().uuid('Assign an engineer'),
  scheduled_date: z.string().datetime().optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
  is_drone_survey: z.boolean().default(false),
})

/**
 * Converting Sales' site visit request into a survey. Separate from
 * createSurveySchema because the request id is required here and the lead comes
 * from the request rather than the caller — create_survey_from_visit_request()
 * reads it server-side, so a client cannot attach the survey to a different lead.
 */
export const convertVisitRequestSchema = z.object({
  site_visit_request_id: z.string().uuid('Select a site visit request'),
  assigned_engineer_id: z.string().uuid('Assign an engineer'),
  scheduled_date: z.string().datetime().optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
})

export const updateSurveySchema = z
  .object({
    assigned_engineer_id: z.string().uuid().optional(),
    scheduled_date: z.string().datetime().nullable().optional(),
    status: surveyUpdatableStatus.optional(),
    roof_measurements: roofMeasurementsSchema.nullable().optional(),
    gps_latitude: latitude.nullable().optional(),
    gps_longitude: longitude.nullable().optional(),
    electricity_bill_avg_units: positiveMeasure.nullable().optional(),
    is_drone_survey: z.boolean().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })
  /**
   * A coordinate is a pair or it is nothing. Half of one is not a location, and
   * storing a lone latitude would put a pin on the prime meridian.
   */
  .refine(
    (v) => {
      const lat = v.gps_latitude
      const lng = v.gps_longitude
      if (lat === undefined && lng === undefined) return true
      const latSet = lat !== undefined && lat !== null
      const lngSet = lng !== undefined && lng !== null
      // Both cleared together is fine; both set together is fine.
      return latSet === lngSet
    },
    {
      message: 'Latitude and longitude must be set or cleared together',
      path: ['gps_latitude'],
    }
  )

export const surveyPhotoMetaSchema = z.object({
  file_path: z.string().trim().min(1).max(500),
  file_name: z.string().trim().min(1).max(300),
  // Free text, matching the column: the blueprint's list of types is open-ended.
  photo_type: z.string().trim().max(60).optional().nullable(),
})

export const electricityBillSchema = z.object({
  file_path: z.string().trim().min(1).max(500),
  /** The figure read off the bill. Optional — the file alone is still useful. */
  avg_units: positiveMeasure.optional().nullable(),
})

// Designs -------------------------------------------------------------------

export const boqLineSchema = z.object({
  item: z.string().trim().min(1, 'Item is required').max(300),
  qty: positiveMeasure,
  unit: z.string().trim().min(1, 'Unit is required').max(30),
})

export const createDesignSchema = z.object({
  system_size_kw: positiveMeasure.optional().nullable(),
  panel_count: z.number().int('Must be a whole number').positive().optional().nullable(),
  panel_wattage: positiveMeasure.optional().nullable(),
  inverter_spec: z.string().trim().max(1000).optional().nullable(),
  boq_data: z.array(boqLineSchema).optional().nullable(),
})

export const updateDesignSchema = z
  .object({
    system_size_kw: positiveMeasure.nullable().optional(),
    panel_count: z.number().int().positive().nullable().optional(),
    panel_wattage: positiveMeasure.nullable().optional(),
    inverter_spec: z.string().trim().max(1000).nullable().optional(),
    boq_data: z.array(boqLineSchema).nullable().optional(),
    status: designStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

/** Which slot an uploaded design document fills. */
export const designFileSchema = z.object({
  kind: z.enum(['layout', 'sld']),
  file_path: z.string().trim().min(1).max(500),
})

// Generation reports --------------------------------------------------------

/**
 * Month keys spelled out rather than z.record(z.number()), so a typo'd key is
 * rejected instead of silently stored as a month that no reader will ever look up.
 * Every month optional: an engineer may record only the annual figure.
 */
export const monthlyGenerationSchema = z.object({
  jan: positiveMeasure.optional(),
  feb: positiveMeasure.optional(),
  mar: positiveMeasure.optional(),
  apr: positiveMeasure.optional(),
  may: positiveMeasure.optional(),
  jun: positiveMeasure.optional(),
  jul: positiveMeasure.optional(),
  aug: positiveMeasure.optional(),
  sep: positiveMeasure.optional(),
  oct: positiveMeasure.optional(),
  nov: positiveMeasure.optional(),
  dec: positiveMeasure.optional(),
})

export const createGenerationReportSchema = z
  .object({
    estimated_annual_generation_kwh: positiveMeasure.optional().nullable(),
    estimated_monthly_generation_kwh: monthlyGenerationSchema.optional().nullable(),
    /** Set when the figures came from PVsyst/PVWatts and the output was uploaded. */
    report_file_path: z.string().trim().max(500).optional().nullable(),
  })
  /**
   * A report with no annual figure, no monthly breakdown and no file is an empty
   * record. Nothing here computes generation, so if the engineer supplied no
   * numbers there is nothing to save.
   */
  .refine(
    (v) =>
      v.estimated_annual_generation_kwh != null ||
      (v.estimated_monthly_generation_kwh != null &&
        Object.keys(v.estimated_monthly_generation_kwh).length > 0) ||
      Boolean(v.report_file_path),
    {
      message: 'Record an annual figure, a monthly breakdown, or attach a report file',
      path: ['estimated_annual_generation_kwh'],
    }
  )

// IT support ---------------------------------------------------------------

export const createITTicketSchema = z.object({
  issue_type: itIssueType.optional().nullable(),
  description: z.string().trim().min(3, 'Describe the issue').max(5000),
})

export const updateITTicketSchema = z
  .object({
    status: itTicketStatus.optional(),
    assigned_to: z.string().uuid().nullable().optional(),
    issue_type: itIssueType.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

export type RoofMeasurementsInput = z.infer<typeof roofMeasurementsSchema>
export type CreateSurveyInput = z.infer<typeof createSurveySchema>
export type ConvertVisitRequestInput = z.infer<typeof convertVisitRequestSchema>
export type UpdateSurveyInput = z.infer<typeof updateSurveySchema>
export type SurveyPhotoMetaInput = z.infer<typeof surveyPhotoMetaSchema>
export type ElectricityBillInput = z.infer<typeof electricityBillSchema>
export type BOQLineInput = z.infer<typeof boqLineSchema>
export type CreateDesignInput = z.infer<typeof createDesignSchema>
export type UpdateDesignInput = z.infer<typeof updateDesignSchema>
export type DesignFileInput = z.infer<typeof designFileSchema>
export type MonthlyGenerationInput = z.infer<typeof monthlyGenerationSchema>
export type CreateGenerationReportInput = z.infer<typeof createGenerationReportSchema>
export type CreateITTicketInput = z.infer<typeof createITTicketSchema>
export type UpdateITTicketInput = z.infer<typeof updateITTicketSchema>

// ---------------------------------------------------------------------------
// Operations & Maintenance module
//
// 'expiring_soon'/'expired' (AMC) and 'missed' (visit) are intentionally NOT in
// these enums: they are computed at read time from a date, never set through the
// API, matching the stored enums in migration 0012.
// ---------------------------------------------------------------------------

export const installationStatus = z.enum([
  'assigned',
  'in_progress',
  'completed',
  'on_hold',
  'cancelled',
])

/** Status a technician/lead may set through the ordinary update endpoint. */
export const installationUpdatableStatus = z.enum([
  'assigned',
  'in_progress',
  'completed',
  'on_hold',
  'cancelled',
])

export const inspectionResult = z.enum(['passed', 'passed_with_notes', 'failed'])
export const serviceTicketStatus = z.enum(['open', 'assigned', 'in_progress', 'resolved', 'closed'])
export const servicePriority = z.enum(['low', 'medium', 'high', 'urgent'])
export const amcStatus = z.enum(['active', 'cancelled'])
export const amcVisitStatus = z.enum(['scheduled', 'completed', 'rescheduled'])

/** kWh, kW and money share a non-negative, bounded numeric shape. */
const nonNegativeAmount = z.number().nonnegative().max(1e12)
const optionalDate = z.string().date().optional().nullable()

// Installations -------------------------------------------------------------

/**
 * Creating an installation standalone (no deal behind it). The conversion flow
 * §3.2 uses convertDealSchema instead — it derives customer/design/size from the
 * closure server-side rather than trusting the client to name them.
 */
export const createInstallationSchema = z.object({
  customer_id: z.string().uuid('Select a customer'),
  team_lead_id: z.string().uuid('Assign a team lead'),
  design_id: z.string().uuid().optional().nullable(),
  scheduled_start_date: optionalDate,
  system_size_kw: nonNegativeAmount.optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
})

/** The deal-closure conversion: the only field the caller supplies beyond the deal. */
export const convertDealSchema = z.object({
  deal_closure_id: z.string().uuid('Select a closed deal'),
  team_lead_id: z.string().uuid('Assign a team lead'),
  scheduled_start_date: optionalDate,
  notes: z.string().trim().max(5000).optional().nullable(),
})

export const updateInstallationSchema = z
  .object({
    team_lead_id: z.string().uuid().optional(),
    status: installationUpdatableStatus.optional(),
    scheduled_start_date: optionalDate,
    actual_start_date: optionalDate,
    completed_date: optionalDate,
    system_size_kw: nonNegativeAmount.nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

export const addTeamMemberSchema = z.object({
  user_id: z.string().uuid('Select a team member'),
  role_on_site: z.string().trim().max(60).optional().nullable(),
})

export const progressUpdateSchema = z.object({
  progress_percent: z.number().int().min(0).max(100),
  note: z.string().trim().max(2000).optional().nullable(),
})

export const installationPhotoMetaSchema = z.object({
  file_path: z.string().trim().min(1).max(1000),
  file_name: z.string().trim().min(1).max(300),
  photo_stage: z.string().trim().max(60).optional().nullable(),
})

export const checklistItemCreateSchema = z.object({
  item: z.string().trim().min(2, 'Describe the item').max(300),
})

export const checklistItemUpdateSchema = z.object({
  is_checked: z.boolean(),
})

export const finalInspectionSchema = z.object({
  result: inspectionResult,
  notes: z.string().trim().max(5000).optional().nullable(),
})

export const completionReportSchema = z.object({
  summary: z.string().trim().min(10, 'Summarise the completed work').max(5000),
  actual_system_size_kw: nonNegativeAmount.optional().nullable(),
  report_file_path: z.string().trim().max(1000).optional().nullable(),
})

// Service tickets -----------------------------------------------------------

export const createServiceTicketSchema = z.object({
  customer_id: z.string().uuid('Select a customer'),
  installation_id: z.string().uuid().optional().nullable(),
  issue_type: z.string().trim().max(60).optional().nullable(),
  description: z.string().trim().min(5, 'Describe the complaint').max(5000),
  priority: servicePriority.default('medium'),
})

export const updateServiceTicketSchema = z
  .object({
    status: serviceTicketStatus.optional(),
    priority: servicePriority.optional(),
    assigned_to: z.string().uuid().nullable().optional(),
    issue_type: z.string().trim().max(60).nullable().optional(),
    installation_id: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

export const createServiceReportSchema = z.object({
  work_done: z.string().trim().min(5, 'Describe the work done').max(5000),
  parts_used: z.string().trim().max(2000).optional().nullable(),
  /** Marking the report resolved is what lets the ticket move to 'resolved'. */
  resolved: z.boolean().default(false),
})

// AMC -----------------------------------------------------------------------

export const createAmcContractSchema = z
  .object({
    customer_id: z.string().uuid('Select a customer'),
    installation_id: z.string().uuid().optional().nullable(),
    start_date: z.string().date(),
    end_date: z.string().date(),
    visit_frequency: z.string().trim().max(30).optional().nullable(),
    amount: nonNegativeAmount.optional().nullable(),
    assigned_to: z.string().uuid().optional().nullable(),
  })
  .refine((v) => new Date(v.end_date) >= new Date(v.start_date), {
    message: 'End date must be on or after the start date',
    path: ['end_date'],
  })

export const updateAmcContractSchema = z
  .object({
    end_date: z.string().date().optional(),
    visit_frequency: z.string().trim().max(30).nullable().optional(),
    amount: nonNegativeAmount.nullable().optional(),
    status: amcStatus.optional(),
    assigned_to: z.string().uuid().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

export const scheduleAmcVisitSchema = z.object({
  scheduled_date: z.string().date(),
  performed_by: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export const updateAmcVisitSchema = z
  .object({
    status: amcVisitStatus.optional(),
    scheduled_date: z.string().date().optional(),
    completed_date: optionalDate,
    performed_by: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

// Performance logs ----------------------------------------------------------

export const createPerformanceLogSchema = z.object({
  log_date: z.string().date(),
  generation_kwh: nonNegativeAmount.optional().nullable(),
  issue_flag: z.boolean().default(false),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export type CreateInstallationInput = z.infer<typeof createInstallationSchema>
export type ConvertDealInput = z.infer<typeof convertDealSchema>
export type UpdateInstallationInput = z.infer<typeof updateInstallationSchema>
export type AddTeamMemberInput = z.infer<typeof addTeamMemberSchema>
export type ProgressUpdateInput = z.infer<typeof progressUpdateSchema>
export type InstallationPhotoMetaInput = z.infer<typeof installationPhotoMetaSchema>
export type ChecklistItemCreateInput = z.infer<typeof checklistItemCreateSchema>
export type ChecklistItemUpdateInput = z.infer<typeof checklistItemUpdateSchema>
export type FinalInspectionInput = z.infer<typeof finalInspectionSchema>
export type CompletionReportInput = z.infer<typeof completionReportSchema>
export type CreateServiceTicketInput = z.infer<typeof createServiceTicketSchema>
export type UpdateServiceTicketInput = z.infer<typeof updateServiceTicketSchema>
export type CreateServiceReportInput = z.infer<typeof createServiceReportSchema>
export type CreateAmcContractInput = z.infer<typeof createAmcContractSchema>
export type UpdateAmcContractInput = z.infer<typeof updateAmcContractSchema>
export type ScheduleAmcVisitInput = z.infer<typeof scheduleAmcVisitSchema>
export type UpdateAmcVisitInput = z.infer<typeof updateAmcVisitSchema>
export type CreatePerformanceLogInput = z.infer<typeof createPerformanceLogSchema>

// ---------------------------------------------------------------------------
// DISCOM module
//
// Status is deliberately ABSENT from the create/update schemas below. A status
// change is not an ordinary field edit here: it must append a *_status_history
// row, so it travels through the dedicated /status endpoint (netMeteringStatusChange
// / subsidyStatusChange) instead. The plain update path rejecting a status field is
// what makes the staleness dashboard's history trustworthy — a status that could be
// edited in place would leave no aging trail. The service layer enforces the same.
// ---------------------------------------------------------------------------

export const netMeteringStatus = z.enum([
  'not_started',
  'documents_pending',
  'submitted',
  'under_review',
  'query_raised',
  'approved',
  'rejected',
])

export const subsidyStatus = z.enum([
  'not_started',
  'documents_pending',
  'applied',
  'under_review',
  'query_raised',
  'sanctioned',
  'disbursed',
  'rejected',
])

export const governmentDocumentType = z.enum([
  'consumer_id_proof',
  'electricity_bill',
  'address_proof',
  'bank_passbook',
  'sanction_letter',
  'completion_certificate',
  'other',
])

// Net metering --------------------------------------------------------------

/**
 * Creating a net-metering application from a completed installation — the O&M →
 * DISCOM handoff. installation_id is the only link the caller supplies; the service
 * layer derives customer_id from the installation server-side, so an application
 * cannot be attached to a different customer's site than the one being metered.
 */
export const createNetMeteringSchema = z.object({
  installation_id: z.string().uuid('Select a completed installation'),
  assigned_to: z.string().uuid('Assign a liaison executive'),
  discom_name: z.string().trim().max(200).optional().nullable(),
  consumer_number: z.string().trim().max(100).optional().nullable(),
  application_number: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
})

/** No status field — see the module note above. Status moves via /status only. */
export const updateNetMeteringSchema = z
  .object({
    assigned_to: z.string().uuid().optional(),
    discom_name: z.string().trim().max(200).nullable().optional(),
    consumer_number: z.string().trim().max(100).nullable().optional(),
    application_number: z.string().trim().max(100).nullable().optional(),
    submitted_date: optionalDate,
    approved_date: optionalDate,
    rejection_reason: z.string().trim().max(2000).nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

export const netMeteringStatusChangeSchema = z.object({
  status: netMeteringStatus,
  note: z.string().trim().max(2000).optional().nullable(),
})

// Subsidy -------------------------------------------------------------------

export const createSubsidySchema = z.object({
  installation_id: z.string().uuid('Select a completed installation'),
  assigned_to: z.string().uuid('Assign a liaison executive'),
  scheme: z.string().trim().max(100).optional(),
  application_reference: z.string().trim().max(100).optional().nullable(),
  eligible_subsidy_amount: nonNegativeAmount.optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
})

/** No status field — see the module note above. Status moves via /status only. */
export const updateSubsidySchema = z
  .object({
    assigned_to: z.string().uuid().optional(),
    scheme: z.string().trim().max(100).optional(),
    application_reference: z.string().trim().max(100).nullable().optional(),
    eligible_subsidy_amount: nonNegativeAmount.nullable().optional(),
    applied_date: optionalDate,
    disbursed_date: optionalDate,
    disbursed_amount: nonNegativeAmount.nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

export const subsidyStatusChangeSchema = z.object({
  status: subsidyStatus,
  note: z.string().trim().max(2000).optional().nullable(),
})

// Government documents ------------------------------------------------------

/**
 * Records an already-uploaded government document. At least one parent link must be
 * present — a document tied to nothing is unreachable, and the DB check mirrors this.
 * The service layer verifies file_path sits under the caller's org folder.
 */
export const createGovernmentDocumentSchema = z
  .object({
    installation_id: z.string().uuid().optional().nullable(),
    net_metering_application_id: z.string().uuid().optional().nullable(),
    subsidy_case_id: z.string().uuid().optional().nullable(),
    document_type: governmentDocumentType.default('other'),
    file_path: z.string().trim().min(1).max(1000),
    file_name: z.string().trim().min(1).max(300),
  })
  .refine(
    (v) =>
      Boolean(v.installation_id) ||
      Boolean(v.net_metering_application_id) ||
      Boolean(v.subsidy_case_id),
    { message: 'Attach the document to an installation, application or subsidy case' }
  )

// Consumer verification -----------------------------------------------------

export const createConsumerVerificationSchema = z.object({
  installation_id: z.string().uuid('Select a completed installation'),
  consumer_number_verified: z.boolean().default(false),
  identity_verified: z.boolean().default(false),
  address_verified: z.boolean().default(false),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export type CreateNetMeteringInput = z.infer<typeof createNetMeteringSchema>
export type UpdateNetMeteringInput = z.infer<typeof updateNetMeteringSchema>
export type NetMeteringStatusChangeInput = z.infer<typeof netMeteringStatusChangeSchema>
export type CreateSubsidyInput = z.infer<typeof createSubsidySchema>
export type UpdateSubsidyInput = z.infer<typeof updateSubsidySchema>
export type SubsidyStatusChangeInput = z.infer<typeof subsidyStatusChangeSchema>
export type CreateGovernmentDocumentInput = z.infer<typeof createGovernmentDocumentSchema>
export type CreateConsumerVerificationInput = z.infer<typeof createConsumerVerificationSchema>

// ---------------------------------------------------------------------------
// Marketing & Training module
//
// Unlike DISCOM, status here IS an ordinary editable field: content and campaigns
// have no *_status_history table and no aging clock, so a status change is a plain
// column edit and lives in the update schemas. The lead-handoff schema is the one to
// read closely — it feeds the create_marketing_lead RPC that writes into Sales.
// ---------------------------------------------------------------------------

export const contentType = z.enum(['reel', 'post', 'story', 'ad_creative'])
export const contentStatus = z.enum(['planned', 'in_production', 'ready', 'posted', 'skipped'])
export const contentAssetType = z.enum([
  'raw_footage',
  'edited_video',
  'graphic',
  'script',
  'thumbnail',
])
export const campaignObjective = z.enum(['lead_generation', 'brand_awareness', 'website_traffic'])
export const campaignPlatform = z.enum(['instagram', 'facebook', 'google', 'other'])
export const campaignStatus = z.enum(['planning', 'active', 'paused', 'completed'])

// Content calendar ----------------------------------------------------------

export const createContentItemSchema = z.object({
  title: z.string().trim().min(1, 'Give the item a title').max(300),
  content_type: contentType,
  platform: z.string().trim().min(1).max(60).default('instagram'),
  scheduled_date: z.string().date(),
  assigned_to: z.string().uuid('Assign someone to produce it'),
  caption_draft: z.string().trim().max(5000).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
})

export const updateContentItemSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    content_type: contentType.optional(),
    platform: z.string().trim().min(1).max(60).optional(),
    scheduled_date: optionalDate,
    status: contentStatus.optional(),
    assigned_to: z.string().uuid().optional(),
    caption_draft: z.string().trim().max(5000).nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

/** Records an already-uploaded asset. Path is verified against the item's org server-side. */
export const createContentAssetSchema = z.object({
  content_calendar_item_id: z.string().uuid(),
  file_path: z.string().trim().min(1).max(1000),
  file_name: z.string().trim().min(1).max(300),
  asset_type: contentAssetType.optional().nullable(),
})

// Campaigns -----------------------------------------------------------------

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1, 'Name the campaign').max(200),
  objective: campaignObjective.optional().nullable(),
  platform: campaignPlatform.optional().nullable(),
  start_date: optionalDate,
  end_date: optionalDate,
  budget_amount: nonNegativeAmount.optional().nullable(),
  managed_by: z.string().uuid('Assign a campaign manager'),
})

export const updateCampaignSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    objective: campaignObjective.nullable().optional(),
    platform: campaignPlatform.nullable().optional(),
    status: campaignStatus.optional(),
    start_date: optionalDate,
    end_date: optionalDate,
    budget_amount: nonNegativeAmount.nullable().optional(),
    // Spend is logged periodically as it comes in from the ad platform (no live sync).
    amount_spent: nonNegativeAmount.optional(),
    managed_by: z.string().uuid().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

// Lead generation handoff ---------------------------------------------------

/**
 * The Marketing → Sales handoff (§3.4). Feeds create_marketing_lead, which in one
 * transaction inserts an unassigned inbound Sales lead, the lead_sources trace row,
 * and bumps the campaign counter. Only name is required — a lead captured off an
 * organic reel may have nothing but a phone number yet. campaign_id and
 * content_calendar_item_id are the two optional origins; at least tracing one is
 * encouraged but not forced (a walk-in referral has neither).
 */
export const createMarketingLeadSchema = z.object({
  name: z.string().trim().min(1, 'The lead needs a name').max(200),
  phone: z.string().trim().max(30).optional().nullable(),
  source_detail: z.string().trim().max(60).optional().nullable(),
  campaign_id: z.string().uuid().optional().nullable(),
  content_calendar_item_id: z.string().uuid().optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
})

export type CreateContentItemInput = z.infer<typeof createContentItemSchema>
export type UpdateContentItemInput = z.infer<typeof updateContentItemSchema>
export type CreateContentAssetInput = z.infer<typeof createContentAssetSchema>
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>
export type CreateMarketingLeadInput = z.infer<typeof createMarketingLeadSchema>

// ---------------------------------------------------------------------------
// HR module
//
// The most sensitive module. The write vocabularies here are the second line of
// defence — RLS in migration 0015 is the first, and the service layer's role checks
// the third. A few deliberate omissions worth calling out (each mirrors a pattern
// already used above):
//
//   * salary net_payable is NEVER accepted from the client — it is a generated column
//     (base + bonus + incentives - deductions). The schema simply has no field for it,
//     so a hand-crafted body cannot set it.
//   * An exit does not travel through an ordinary create; it runs the
//     process_employee_exit() RPC (record + status flip + account deactivation, all in
//     one txn). processExitSchema is only the caller-supplied inputs.
//   * A leave request likewise runs submit_leave_request() (leave row + linked approval
//     row). The employee_id is forced to the caller's own row server-side; this schema
//     never carries it.
//   * employment_status is absent from the employee update schema — it moves only via
//     the onboarding default ('active') and the exit RPC ('exited'), never a bare PATCH.
// ---------------------------------------------------------------------------

export const candidateStatus = z.enum([
  'applied',
  'screening',
  'interview_scheduled',
  'offered',
  'hired',
  'rejected',
])
export const candidateSource = z.enum(['referral', 'job_portal', 'walk_in', 'other'])
export const interviewRound = z.enum(['screening', 'technical', 'final'])
export const interviewResult = z.enum(['pending', 'passed', 'failed'])
export const employeeDocumentType = z.enum([
  'id_proof',
  'address_proof',
  'offer_letter',
  'contract',
  'exit_letter',
  'other',
])
export const exitType = z.enum(['resignation', 'termination', 'end_of_contract'])
export const attendanceStatus = z.enum(['present', 'absent', 'half_day', 'on_leave', 'holiday'])
export const leaveType = z.enum(['casual', 'sick', 'earned', 'unpaid'])
export const salaryStatus = z.enum(['draft', 'finalized', 'paid'])
export const kpiStatus = z.enum(['in_progress', 'met', 'not_met'])

// numeric(14,2) money in this module. Salaries can be larger than a single project's
// line item, so the ceiling is generous; still bounded to reject a garbage overflow.
const salaryAmount = z.number().nonnegative('Amount cannot be negative').max(1e10)

// Recruitment ---------------------------------------------------------------

export const createCandidateSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(200),
  phone: optionalPhone,
  email: optionalEmail,
  applied_for_department_id: z.string().uuid().optional().nullable(),
  applied_for_role: z.string().trim().max(120).optional().nullable(),
  source: candidateSource.optional().nullable(),
  status: candidateStatus.default('applied'),
})

export const updateCandidateSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    phone: optionalPhone,
    email: optionalEmail,
    applied_for_department_id: z.string().uuid().nullable().optional(),
    applied_for_role: z.string().trim().max(120).nullable().optional(),
    source: candidateSource.nullable().optional(),
    status: candidateStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

export const createInterviewSchema = z.object({
  candidate_id: z.string().uuid('Select a candidate'),
  scheduled_date: z.string().datetime().optional().nullable(),
  interviewer_id: z.string().uuid().optional().nullable(),
  round: interviewRound.optional().nullable(),
})

export const updateInterviewSchema = z
  .object({
    scheduled_date: z.string().datetime().nullable().optional(),
    interviewer_id: z.string().uuid().nullable().optional(),
    round: interviewRound.nullable().optional(),
    result: interviewResult.optional(),
    feedback: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

// Employee management -------------------------------------------------------

/**
 * Onboarding a new employee. This creates the users row + the employees row together
 * (see hireEmployee in the service layer). role_id places them in a department; the
 * employee-specific fields fill the extended employees table (0015).
 */
export const createEmployeeSchema = z.object({
  full_name: z.string().trim().min(2, 'Name must be at least 2 characters').max(200),
  email: z.string().trim().email('Enter a valid email'),
  /**
   * The login password HR assigns and hands to the new employee. Email is the login id, so this is
   * the other half of the credentials. OPTIONAL: when absent the service generates one nobody ever
   * sees, which leaves the account reachable only through a password reset — the old behaviour, kept
   * so existing callers do not change meaning. Deliberately NOT trimmed: trimming would silently
   * hand over a password different from the one typed. 8-character floor matches
   * changePasswordSchema and the login form. Passed straight to Supabase auth — never written to our
   * tables, and never included in audit-log metadata.
   */
  password: z.string().min(8, 'Password must be at least 8 characters').max(200).optional(),
  phone: optionalPhone,
  role_id: z.string().uuid('Select a role'),
  designation: z.string().trim().max(120).optional().nullable(),
  employee_code: z.string().trim().max(40).optional().nullable(),
  date_joined: z.string().date().optional().nullable(),
  reporting_to: z.string().uuid().optional().nullable(),
  emergency_contact: z.string().trim().max(120).optional().nullable(),
})

/**
 * The onboarding wizard's payload. Extends the create-employee fields with a WhatsApp number for
 * card sharing and an OPTIONAL profile photo sent inline as a data URI.
 *
 * WHY THE PHOTO IS INLINE. Every HR object lives at '{employee_id}/...', and the employee id does
 * not exist until the row is inserted — so the browser cannot pre-upload to the final path the way
 * the document flow does. The wizard therefore sends the photo bytes with the rest of the form and
 * the server uploads them once the employee exists, inside the same rollback scope. Capped so a
 * base64 string cannot bloat the request; the real image-size limit is enforced on the decoded
 * bytes server-side against MAX_UPLOAD_BYTES.
 */
export const onboardEmployeeSchema = createEmployeeSchema.extend({
  whatsapp_number: optionalPhone,
  // A data URI: 'data:image/{png|jpeg|webp};base64,....'. Optional — a card renders an initials
  // tile without one. ~7MB of base64 ≈ ~5MB decoded, comfortably above a headshot.
  profile_photo: z
    .string()
    .regex(/^data:image\/(png|jpe?g|webp);base64,/, 'Photo must be a PNG, JPEG, or WebP image')
    .max(7_000_000, 'Photo is too large')
    .optional()
    .nullable(),
})

/**
 * First-login (or any) password change. Only the new password is needed: the caller is already
 * authenticated (an active Supabase session), so we are not re-verifying the temporary one — the
 * point of the forced change is to replace a password HR handed over, and the session cookie is
 * the proof of identity. 8-char floor matches the login form's own rule.
 */
/**
 * The scanned-token payload for /api/qr/resolve. The token is the opaque qr_tokens.token value the
 * QR encodes — a long hex string. Bounded so a junk body is rejected before any DB lookup; the
 * lookup itself treats any non-matching value as "not found".
 */
export const resolveTokenSchema = z.object({
  token: z.string().trim().min(16, 'Invalid token').max(256),
})

export const changePasswordSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters').max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  })

/** employment_status is intentionally absent — see the module note above. */
export const updateEmployeeSchema = z
  .object({
    designation: z.string().trim().max(120).nullable().optional(),
    employee_code: z.string().trim().max(40).nullable().optional(),
    phone: optionalPhone,
    date_joined: z.string().date().nullable().optional(),
    reporting_to: z.string().uuid().nullable().optional(),
    emergency_contact: z.string().trim().max(120).nullable().optional(),
    role_id: z.string().uuid().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

/** Caller-supplied inputs to process_employee_exit(). The employee_id is a route param. */
export const processExitSchema = z.object({
  exit_date: z.string().date(),
  exit_type: exitType.optional().nullable(),
  reason: z.string().trim().max(2000).optional().nullable(),
  notes: z.string().trim().max(5000).optional().nullable(),
})

/** Records an already-uploaded employee document. Path verified against the employee server-side. */
export const createEmployeeDocumentSchema = z.object({
  document_type: employeeDocumentType,
  file_path: z.string().trim().min(1).max(1000),
  file_name: z.string().trim().min(1).max(300),
})

// Attendance ----------------------------------------------------------------

/**
 * HR marking attendance for an employee (or correcting a record). Self check-in/out is
 * a separate, bodyless path — see the my-attendance routes — because it stamps now()
 * server-side and needs no client-chosen time.
 */
export const markAttendanceSchema = z.object({
  employee_id: z.string().uuid('Select an employee'),
  date: z.string().date(),
  status: attendanceStatus.default('present'),
  check_in: z.string().datetime().optional().nullable(),
  check_out: z.string().datetime().optional().nullable(),
})

// Leave ---------------------------------------------------------------------

/**
 * A leave request from any employee. Feeds submit_leave_request(), which also creates
 * the linked approvals row. employee_id is derived from the caller server-side, so it
 * is not part of the body. The end >= start guard mirrors the RPC's own check.
 */
export const submitLeaveSchema = z
  .object({
    leave_type: leaveType,
    start_date: z.string().date(),
    end_date: z.string().date(),
    reason: z.string().trim().max(2000).optional().nullable(),
  })
  .refine((v) => new Date(v.end_date) >= new Date(v.start_date), {
    message: 'Leave end date must be on or after the start date',
    path: ['end_date'],
  })

// Payroll -------------------------------------------------------------------

/**
 * A salary record for one employee for one month. net_payable is absent by design — the
 * database generates it. effective_month is any date in the target month; the service
 * layer normalises it to the first of the month to satisfy the unique(employee, month).
 */
export const createSalaryRecordSchema = z.object({
  employee_id: z.string().uuid('Select an employee'),
  effective_month: z.string().date(),
  base_salary: salaryAmount,
  bonus: salaryAmount.default(0),
  incentives: salaryAmount.default(0),
  deductions: salaryAmount.default(0),
  status: salaryStatus.default('draft'),
})

export const updateSalaryRecordSchema = z
  .object({
    base_salary: salaryAmount.optional(),
    bonus: salaryAmount.optional(),
    incentives: salaryAmount.optional(),
    deductions: salaryAmount.optional(),
    status: salaryStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

// Performance ---------------------------------------------------------------

export const createKpiSchema = z
  .object({
    employee_id: z.string().uuid('Select an employee'),
    period_start: z.string().date(),
    period_end: z.string().date(),
    kpi_description: z.string().trim().min(3, 'Describe the KPI').max(2000),
    target_value: z.string().trim().max(200).optional().nullable(),
    actual_value: z.string().trim().max(200).optional().nullable(),
    status: kpiStatus.default('in_progress'),
  })
  .refine((v) => new Date(v.period_end) >= new Date(v.period_start), {
    message: 'Period end must be on or after period start',
    path: ['period_end'],
  })

export const updateKpiSchema = z
  .object({
    kpi_description: z.string().trim().min(3).max(2000).optional(),
    target_value: z.string().trim().max(200).nullable().optional(),
    actual_value: z.string().trim().max(200).nullable().optional(),
    status: kpiStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

export const createAppraisalSchema = z.object({
  employee_id: z.string().uuid('Select an employee'),
  review_period: z.string().trim().min(2, 'Name the review period').max(60),
  rating: z.string().trim().max(60).optional().nullable(),
  strengths: z.string().trim().max(5000).optional().nullable(),
  areas_of_improvement: z.string().trim().max(5000).optional().nullable(),
})

export type CreateCandidateInput = z.infer<typeof createCandidateSchema>
export type UpdateCandidateInput = z.infer<typeof updateCandidateSchema>
export type CreateInterviewInput = z.infer<typeof createInterviewSchema>
export type UpdateInterviewInput = z.infer<typeof updateInterviewSchema>
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>
export type OnboardEmployeeInput = z.infer<typeof onboardEmployeeSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type ResolveTokenInput = z.infer<typeof resolveTokenSchema>
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>
export type ProcessExitInput = z.infer<typeof processExitSchema>
export type CreateEmployeeDocumentInput = z.infer<typeof createEmployeeDocumentSchema>
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>
export type SubmitLeaveInput = z.infer<typeof submitLeaveSchema>
export type CreateSalaryRecordInput = z.infer<typeof createSalaryRecordSchema>
export type UpdateSalaryRecordInput = z.infer<typeof updateSalaryRecordSchema>
export type CreateKpiInput = z.infer<typeof createKpiSchema>
export type UpdateKpiInput = z.infer<typeof updateKpiSchema>
export type CreateAppraisalInput = z.infer<typeof createAppraisalSchema>

// ---------------------------------------------------------------------------
// Finance & Accounts module
//
// Same defence-in-depth stance as HR: these write vocabularies are the second line, RLS
// (0016) is the first, the service layer's role checks the third. Deliberate omissions,
// each mirroring a pattern already used above:
//
//   * total_amount (invoices, purchase_bills) and net_payable (gst_filings) are GENERATED
//     columns — the schemas have no field for them, so a hand-crafted body cannot set them.
//   * A receipt / vendor payment / expense does NOT travel through a bare insert — each
//     runs a one-transaction RPC (record_customer_receipt / record_vendor_payment /
//     record_expense) that also writes cash flow and recomputes status. These schemas are
//     only the caller-supplied inputs; the invoice/bill id is a route param where relevant.
//   * invoices.status is not freely settable — paid/partially_paid come from receipts and
//     overdue is derived, so the create schema fixes 'draft' and updates allow only the
//     hand-settable subset (draft/sent/cancelled).
//   * Purchase ORDERS are Distribution's module (0007); there is no PO schema here. Finance
//     records bills against an existing PO id or standalone.
// ---------------------------------------------------------------------------

export const invoiceType = z.enum(['advance', 'milestone', 'final'])
export const invoiceSettableStatus = z.enum(['draft', 'sent', 'cancelled'])
export const paymentMethod = z.enum(['cash', 'bank_transfer', 'cheque', 'upi', 'other'])
export const purchaseBillStatus = z.enum(['unpaid', 'partially_paid', 'paid'])
export const expenseCategory = z.enum([
  'rent',
  'utilities',
  'travel',
  'office_supplies',
  'marketing_spend',
  'salary_disbursement',
  'other',
])
export const gstFilingStatus = z.enum(['draft', 'filed'])
export const ledgerAccountCategory = z.enum([
  'sales',
  'purchases',
  'expenses',
  'salaries',
  'tax',
  'other',
])

// numeric(14,2) money in this module. A single invoice or budget can be large (a full
// installation, a quarterly departmental budget), so the ceiling is generous but bounded.
const financeAmount = z.number().nonnegative('Amount cannot be negative').max(1e12)
const positiveFinanceAmount = z.number().positive('Amount must be greater than zero').max(1e12)

// Invoices ------------------------------------------------------------------

/**
 * A new invoice. Usually converted from a closed deal and/or completed installation
 * (deal_closure_id / installation_id pre-filled from the source); both optional for a
 * standalone or advance invoice. total_amount is generated; status starts at 'draft'.
 */
export const createInvoiceSchema = z.object({
  customer_id: z.string().uuid('Select a customer'),
  deal_closure_id: z.string().uuid().optional().nullable(),
  installation_id: z.string().uuid().optional().nullable(),
  invoice_number: z.string().trim().min(1, 'Invoice number is required').max(60),
  invoice_type: invoiceType.default('final'),
  amount: positiveFinanceAmount,
  gst_amount: financeAmount.default(0),
  due_date: optionalDate,
})

export const updateInvoiceSchema = z
  .object({
    invoice_type: invoiceType.optional(),
    amount: positiveFinanceAmount.optional(),
    gst_amount: financeAmount.optional(),
    due_date: z.string().date().nullable().optional(),
    // Only the hand-settable subset — paid/partially_paid/overdue are system-driven.
    status: invoiceSettableStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

/**
 * Recording a customer payment against an invoice. Feeds record_customer_receipt(), which
 * inserts the receipt, recomputes invoice status, and writes a cash-flow inflow — one txn.
 * invoice_id is a route param, not part of the body.
 */
export const recordReceiptSchema = z.object({
  amount_received: positiveFinanceAmount,
  payment_method: paymentMethod.optional().nullable(),
  reference_number: z.string().trim().max(120).optional().nullable(),
  received_date: optionalDate,
})

// Purchases (bills + vendor payments; POs live in Distribution) ---------------

/**
 * A vendor bill, against an existing Distribution purchase order (purchase_order_id) or
 * standalone. total_amount is generated. file_path points at an already-uploaded object in
 * the finance-documents bucket, verified server-side.
 */
export const createPurchaseBillSchema = z.object({
  purchase_order_id: z.string().uuid().optional().nullable(),
  vendor_name: z.string().trim().min(1, 'Vendor name is required').max(200),
  bill_number: z.string().trim().max(60).optional().nullable(),
  amount: positiveFinanceAmount,
  gst_amount: financeAmount.default(0),
  due_date: optionalDate,
  file_path: z.string().trim().max(1000).optional().nullable(),
})

export const updatePurchaseBillSchema = z
  .object({
    vendor_name: z.string().trim().min(1).max(200).optional(),
    bill_number: z.string().trim().max(60).nullable().optional(),
    amount: positiveFinanceAmount.optional(),
    gst_amount: financeAmount.optional(),
    due_date: z.string().date().nullable().optional(),
    file_path: z.string().trim().max(1000).nullable().optional(),
    // status is system-driven by record_vendor_payment; not hand-settable here.
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

/**
 * Recording a vendor payment against a bill. Feeds record_vendor_payment(): payment +
 * bill-status recompute + cash-flow outflow, one txn. purchase_bill_id is a route param.
 */
export const recordVendorPaymentSchema = z.object({
  amount_paid: positiveFinanceAmount,
  payment_method: paymentMethod.optional().nullable(),
  reference_number: z.string().trim().max(120).optional().nullable(),
  paid_date: optionalDate,
})

// Expenses ------------------------------------------------------------------

/**
 * An expense. Feeds record_expense(), which also writes the matching cash-flow outflow.
 * approval_id links a CEO 'expense' approval when the amount crosses the (client-confirmed)
 * threshold. linked_salary_record_id ties a 'salary_disbursement' expense back to HR's
 * salary record — a bare audit FK; the amount is Finance's own figure, no salary read.
 */
export const recordExpenseSchema = z.object({
  category: expenseCategory,
  description: z.string().trim().max(2000).optional().nullable(),
  amount: positiveFinanceAmount,
  expense_date: optionalDate,
  approval_id: z.string().uuid().optional().nullable(),
  linked_salary_record_id: z.string().uuid().optional().nullable(),
})

// Budgets -------------------------------------------------------------------

/**
 * A budget for a department (or org-wide when department_id is null) over a period. Actual
 * spend is computed at query time, never stored, so there is no "spent" field here.
 */
export const createBudgetSchema = z
  .object({
    department_id: z.string().uuid().optional().nullable(),
    period_start: z.string().date(),
    period_end: z.string().date(),
    allocated_amount: positiveFinanceAmount,
    approval_id: z.string().uuid().optional().nullable(),
  })
  .refine((v) => new Date(v.period_end) >= new Date(v.period_start), {
    message: 'Period end must be on or after period start',
    path: ['period_end'],
  })

// Tax — GST & TDS -----------------------------------------------------------

/**
 * A GST filing period. output_gst / input_gst are pre-summed from invoices / purchase_bills
 * server-side as defaults but remain adjustable before 'filed' (real filing has nuances
 * this system doesn't model). net_payable is generated (output - input).
 */
export const createGstFilingSchema = z.object({
  period: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/, "Period must be a month like '2026-07'"),
  output_gst: financeAmount.optional().nullable(),
  input_gst: financeAmount.optional().nullable(),
})

export const updateGstFilingSchema = z
  .object({
    output_gst: financeAmount.nullable().optional(),
    input_gst: financeAmount.nullable().optional(),
    status: gstFilingStatus.optional(),
    filed_date: z.string().date().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

/** A TDS deduction record. deposited flips true once the amount is deposited with the govt. */
export const createTdsRecordSchema = z.object({
  deductee_name: z.string().trim().min(1, 'Deductee name is required').max(200),
  section: z.string().trim().max(20).optional().nullable(),
  amount_paid: positiveFinanceAmount,
  tds_deducted: financeAmount,
  deduction_date: z.string().date(),
})

export const updateTdsRecordSchema = z
  .object({
    deposited: z.boolean().optional(),
    deposited_date: z.string().date().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

// Ledger --------------------------------------------------------------------

/**
 * A ledger entry — a category-tagged debit or credit, optionally linked to the source
 * record. Exactly one of debit/credit should be non-zero for a normal entry; the refine
 * enforces that at least one is positive so an all-zero row can't be saved.
 */
export const createLedgerEntrySchema = z
  .object({
    account_category: ledgerAccountCategory,
    description: z.string().trim().min(1, 'Description is required').max(2000),
    debit: financeAmount.default(0),
    credit: financeAmount.default(0),
    entry_date: optionalDate,
    linked_invoice_id: z.string().uuid().optional().nullable(),
    linked_purchase_bill_id: z.string().uuid().optional().nullable(),
    linked_expense_id: z.string().uuid().optional().nullable(),
  })
  .refine((v) => v.debit > 0 || v.credit > 0, {
    message: 'Enter a debit or a credit amount',
    path: ['debit'],
  })

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>
export type RecordReceiptInput = z.infer<typeof recordReceiptSchema>
export type CreatePurchaseBillInput = z.infer<typeof createPurchaseBillSchema>
export type UpdatePurchaseBillInput = z.infer<typeof updatePurchaseBillSchema>
export type RecordVendorPaymentInput = z.infer<typeof recordVendorPaymentSchema>
export type RecordExpenseInput = z.infer<typeof recordExpenseSchema>
export type CreateBudgetInput = z.infer<typeof createBudgetSchema>
export type CreateGstFilingInput = z.infer<typeof createGstFilingSchema>
export type UpdateGstFilingInput = z.infer<typeof updateGstFilingSchema>
export type CreateTdsRecordInput = z.infer<typeof createTdsRecordSchema>
export type UpdateTdsRecordInput = z.infer<typeof updateTdsRecordSchema>
export type CreateLedgerEntryInput = z.infer<typeof createLedgerEntrySchema>

// ===========================================================================
// Store department (migration 0017)
// ===========================================================================

export const inventoryCategory = z.enum([
  'solar_panel',
  'inverter',
  'structure',
  'cable',
  'accessory',
  'tool',
])

/** Movement types loggable via the plain movement form. 'damaged' is excluded — it has its
 * own endpoint (record_damaged_stock) so the damage-detail row is written in the same txn. */
export const loggableMovementType = z.enum([
  'stock_in',
  'stock_out',
  'material_issue',
  'material_return',
  'adjustment',
])

export const movementReferenceType = z.enum([
  'purchase_order',
  'installation',
  'task',
  'manual',
  'other',
])

export const dealerRelationshipStatus = z.enum(['prospective', 'active', 'inactive'])
export const facilityStatus = z.enum(['open', 'in_progress', 'resolved'])

const stockQuantity = z.number().max(1e9)
const positiveStockQuantity = z
  .number()
  .positive('Quantity must be greater than zero')
  .max(1e9)

// Inventory items -----------------------------------------------------------

export const createInventoryItemSchema = z.object({
  name: z.string().trim().min(1, 'Item name is required').max(200),
  category: inventoryCategory,
  sku: z.string().trim().max(80).optional().nullable(),
  unit: z.string().trim().min(1).max(20).default('pcs'),
  reorder_threshold: z.number().nonnegative('Threshold cannot be negative').max(1e9).optional().nullable(),
  rack_location: z.string().trim().max(80).optional().nullable(),
})

/** Never includes a quantity field: stock only ever moves through a stock_movements insert. */
export const updateInventoryItemSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    category: inventoryCategory.optional(),
    sku: z.string().trim().max(80).nullable().optional(),
    unit: z.string().trim().min(1).max(20).optional(),
    reorder_threshold: z.number().nonnegative().max(1e9).nullable().optional(),
    rack_location: z.string().trim().max(80).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

// Stock movements -----------------------------------------------------------

/**
 * Logging a movement is the only way stock quantity ever changes. quantity must be positive
 * for every real movement; an 'adjustment' (a manual correction) may be negative but never
 * zero — the refine enforces exactly that, mirroring the DB check constraint (0017).
 */
export const createStockMovementSchema = z
  .object({
    inventory_item_id: z.string().uuid('Select an item'),
    movement_type: loggableMovementType,
    quantity: stockQuantity,
    reference_type: movementReferenceType.optional().nullable(),
    installation_id: z.string().uuid().optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
  })
  .refine((v) => v.quantity !== 0, { message: 'Quantity cannot be zero', path: ['quantity'] })
  .refine((v) => v.movement_type === 'adjustment' || v.quantity > 0, {
    message: 'Quantity must be greater than zero',
    path: ['quantity'],
  })

/** Damaged stock: quantity is always positive (it decrements), reason/photo optional. */
export const recordDamagedStockSchema = z.object({
  inventory_item_id: z.string().uuid('Select an item'),
  quantity: positiveStockQuantity,
  reason: z.string().trim().max(2000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  photo_file_path: z.string().trim().max(500).optional().nullable(),
})

// Dealers -------------------------------------------------------------------

export const createDealerSchema = z.object({
  name: z.string().trim().min(1, 'Dealer name is required').max(200),
  contact_person: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  location: z.string().trim().max(200).optional().nullable(),
  relationship_status: dealerRelationshipStatus.default('prospective'),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export const updateDealerSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    contact_person: z.string().trim().max(200).nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    location: z.string().trim().max(200).nullable().optional(),
    relationship_status: dealerRelationshipStatus.optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

// Market survey -------------------------------------------------------------

export const createMarketSurveyNoteSchema = z.object({
  area: z.string().trim().min(1, 'Area is required').max(200),
  observations: z.string().trim().min(1, 'Enter your observations').max(5000),
  survey_date: optionalDate,
})

// Facility ------------------------------------------------------------------

export const createFacilityLogSchema = z.object({
  issue: z.string().trim().min(1, 'Describe the issue').max(2000),
})

/** Only the status moves; resolving stamps resolved_by/resolved_at server-side. */
export const updateFacilityLogSchema = z.object({
  status: facilityStatus,
})

export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>
export type UpdateInventoryItemInput = z.infer<typeof updateInventoryItemSchema>
export type CreateStockMovementInput = z.infer<typeof createStockMovementSchema>
export type RecordDamagedStockInput = z.infer<typeof recordDamagedStockSchema>
export type CreateDealerInput = z.infer<typeof createDealerSchema>
export type UpdateDealerInput = z.infer<typeof updateDealerSchema>
export type CreateMarketSurveyNoteInput = z.infer<typeof createMarketSurveyNoteSchema>
export type CreateFacilityLogInput = z.infer<typeof createFacilityLogSchema>
export type UpdateFacilityLogInput = z.infer<typeof updateFacilityLogSchema>
