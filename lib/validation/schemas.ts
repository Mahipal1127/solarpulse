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
    progress_percent: z.number().int().min(0).max(100).optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

/**
 * What a department employee may change on their own task.
 * They cannot reassign, reprioritize, or archive — only move it forward and
 * log progress. The CEO PATCH route accepts the full updateTaskSchema.
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
