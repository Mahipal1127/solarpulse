import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logAction, logSensitiveAccess } from '@/lib/audit/log'
import { ServiceError } from '@/lib/services/tasks'
import { isDepartmentManager } from '@/lib/auth/guards'
import { SIGNED_URL_TTL_SECONDS } from '@/lib/finance/constants'
import type { SessionUser } from '@/lib/auth/guards'
import type {
  CreateInvoiceInput,
  UpdateInvoiceInput,
  RecordReceiptInput,
  CreatePurchaseBillInput,
  UpdatePurchaseBillInput,
  RecordVendorPaymentInput,
  RecordExpenseInput,
  CreateBudgetInput,
  CreateGstFilingInput,
  UpdateGstFilingInput,
  CreateTdsRecordInput,
  UpdateTdsRecordInput,
  CreateLedgerEntryInput,
} from '@/lib/validation/schemas'
import type {
  Invoice,
  PurchaseBill,
  Expense,
  Budget,
  GstFiling,
  TdsRecord,
  LedgerEntry,
  DealInvoiceStatus,
} from '@/lib/types'

export { ServiceError }
export { SIGNED_URL_TTL_SECONDS }

/**
 * Finance & Accounts service layer — the four-tier heart of the module.
 *
 *   Tier 1  CEO            — full access
 *   Tier 2  Finance lead   — full department access (Finance/Accounts Manager or Lead)
 *   Tier 3  Finance exec    — ONLY rows they own; enforced by RLS (0016), not re-derived here
 *   Tier 4  everyone else   — no access at all
 *
 * Unlike HR, EVERY row in this module is financial, so there is no "self reads own row"
 * tier — the exec own-only scope is the ownership column in each table's RLS. The service
 * gates writes on Finance membership (assertFinanceCanWrite) and lead-only actions
 * (budgets, reports, ledger corrections) on assertFinanceLead. Aggregate financial reads
 * (P&L, balance sheet, cash-flow overview) are logged with logSensitiveAccess — even for
 * the CEO — because "money must never appear in a table without a role check, and access
 * to it is logged" is a standing constraint. Most mutations log with logAction.
 *
 * The receipt / vendor-payment / expense writes go through caller-run RPCs (0016) so the
 * money movement and its cash-flow entry land in ONE transaction — a partial write here is
 * a real bookkeeping bug, not a cosmetic one. RLS governs those RPCs because they run as
 * the caller, so a Finance exec can only settle an invoice/bill they own.
 *
 * Purchase ORDERS are Distribution's module (0007) — Finance reads and approves them
 * through the policies 0007 already grants; this service records BILLS against them.
 */

/**
 * The departments this module serves. 0002 seeds 'accounts' as a child of 'finance', and
 * Distribution's auth_is_finance_member() (0007) already treats an Accounts user as Finance
 * for approvals. We mirror that: an Accounts user IS a Finance-module user, because the
 * blueprint's Accounts scope (invoices, bills, ledger, receipts) is this module.
 */
export const FINANCE_DEPARTMENT_SLUGS = ['finance', 'accounts'] as const

/** The primary slug for the layout guard / home route. */
export const FINANCE_DEPARTMENT_SLUG = 'finance'

/**
 * The Finance-lead tier, matching auth_is_finance_lead() in migration 0016. The
 * '<Department> Manager' convention that auth_is_department_manager() (0006) and
 * isDepartmentManager() (guards.ts) key off requires the seeded role to end in "Manager",
 * so the seeded lead role is 'Finance Manager'. 'Accounts Manager' (the child department's
 * lead) and a hand-made 'Finance Lead' are honoured too.
 */
export const FINANCE_LEAD_ROLE_NAMES = ['Finance Manager', 'Accounts Manager', 'Finance Lead']

/** An active member of Finance or its Accounts child. Mirrors auth_is_finance_member() (0007). */
export function isFinanceMember(user: SessionUser): boolean {
  return user.departmentSlug === 'finance' || user.departmentSlug === 'accounts'
}

/** The Finance lead (or CEO-as-lead via the Manager convention). Mirrors auth_is_finance_lead(). */
export function isFinanceLead(user: SessionUser): boolean {
  return (
    isFinanceMember(user) &&
    (isDepartmentManager(user) || FINANCE_LEAD_ROLE_NAMES.includes(user.roleName))
  )
}

/** The CEO reads every module; the CEO role is 'CEO'. */
function isCeo(user: SessionUser): boolean {
  return user.roleName === 'CEO'
}

/**
 * Operational Finance writes (invoices, bills, receipts, expenses, tax, ledger) — any
 * Finance/Accounts member may perform these; RLS then scopes an exec to their own rows.
 * The CEO reads this module but does not do Finance's data entry, matching every prior
 * module's read-only-for-outsiders rule (the CEO acts through the lead-full RLS tier when
 * they do write).
 */
function assertFinanceCanWrite(user: SessionUser): void {
  if (!isFinanceMember(user) && !isCeo(user)) {
    throw new ServiceError('Finance records are read-only outside the department', 403)
  }
}

/**
 * Lead-only actions: budgets, P&L/balance-sheet reports, ledger entries. Kept to the lead
 * or CEO deliberately — defaulting stricter, per the build prompt (loosening later is easy,
 * tightening after over-exposure is not). RLS in 0016 enforces the same split.
 */
function assertFinanceLead(user: SessionUser): void {
  if (!isFinanceLead(user) && !isCeo(user)) {
    throw new ServiceError('Only the Finance lead or CEO may perform this action', 403)
  }
}

/** numeric(14,2) columns arrive from supabase-js as strings — Number() them for the app. */
function num(v: unknown): number {
  return Number(v ?? 0)
}

function coerceInvoice(row: Record<string, unknown>): Invoice {
  return {
    ...(row as unknown as Invoice),
    amount: num(row.amount),
    gst_amount: num(row.gst_amount),
    total_amount: num(row.total_amount),
  }
}

function coerceBill(row: Record<string, unknown>): PurchaseBill {
  return {
    ...(row as unknown as PurchaseBill),
    amount: num(row.amount),
    gst_amount: num(row.gst_amount),
    total_amount: num(row.total_amount),
  }
}

// ===========================================================================
// Invoices & receipts
// ===========================================================================

/**
 * Creates an invoice. When converting from a closed deal / completed installation, the
 * caller passes deal_closure_id / installation_id and the amount pre-filled from the source
 * (the page reads the source under Finance's cross-department read policy). total_amount is
 * generated by the DB. issued_by is forced to the caller — never client-supplied.
 */
export async function createInvoice(user: SessionUser, input: CreateInvoiceInput): Promise<Invoice> {
  assertFinanceCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('invoices')
    .insert({
      organization_id: user.organization_id,
      customer_id: input.customer_id,
      deal_closure_id: input.deal_closure_id ?? null,
      installation_id: input.installation_id ?? null,
      invoice_number: input.invoice_number,
      invoice_type: input.invoice_type,
      amount: input.amount,
      gst_amount: input.gst_amount,
      status: 'draft',
      due_date: input.due_date ?? null,
      issued_by: user.id,
    })
    .select('*')
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'invoice_created',
    entityType: 'invoice',
    entityId: data.id as string,
    metadata: {
      invoice_number: input.invoice_number,
      amount: input.amount,
      from_deal: input.deal_closure_id ?? null,
      from_installation: input.installation_id ?? null,
    },
  })

  return coerceInvoice(data as Record<string, unknown>)
}

export async function updateInvoice(
  user: SessionUser,
  invoiceId: string,
  input: UpdateInvoiceInput
): Promise<Invoice> {
  assertFinanceCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('invoices')
    .update(input)
    .eq('id', invoiceId)
    .select('*')
    .single()

  if (error) throw new ServiceError(error.message, 400)
  if (!data) throw new ServiceError('Invoice not found', 404)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'invoice_updated',
    entityType: 'invoice',
    entityId: invoiceId,
    metadata: { changed: Object.keys(input) },
  })

  return coerceInvoice(data as Record<string, unknown>)
}

/**
 * Records a customer payment atomically via record_customer_receipt() (0016): the receipt
 * row, the recomputed invoice status (from cumulative receipts vs the generated
 * total_amount), and a matching cash-flow inflow — all in one transaction. The RPC runs as
 * the caller, so RLS admits it only for an invoice the caller can settle. A partial failure
 * (receipt saved but cash flow missed, or status left stale) would be a real bookkeeping
 * bug, which is why it is one transaction, not three client calls.
 */
export async function recordReceipt(
  user: SessionUser,
  invoiceId: string,
  input: RecordReceiptInput
): Promise<{ receiptId: string }> {
  assertFinanceCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('record_customer_receipt', {
    p_invoice_id: invoiceId,
    p_amount_received: input.amount_received,
    p_payment_method: input.payment_method ?? null,
    p_reference_number: input.reference_number ?? null,
    p_received_date: input.received_date ?? new Date().toISOString().slice(0, 10),
  })

  if (error) throw new ServiceError(error.message, 400)
  const receiptId = data as unknown as string

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'receipt_recorded',
    entityType: 'receipt',
    entityId: receiptId,
    metadata: { invoice_id: invoiceId, amount_received: input.amount_received },
  })

  return { receiptId }
}

// ===========================================================================
// Purchases — bills + vendor payments (POs are Distribution's, 0007)
// ===========================================================================

export async function createPurchaseBill(
  user: SessionUser,
  input: CreatePurchaseBillInput
): Promise<PurchaseBill> {
  assertFinanceCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('purchase_bills')
    .insert({
      organization_id: user.organization_id,
      purchase_order_id: input.purchase_order_id ?? null,
      vendor_name: input.vendor_name,
      bill_number: input.bill_number ?? null,
      amount: input.amount,
      gst_amount: input.gst_amount,
      due_date: input.due_date ?? null,
      file_path: input.file_path ?? null,
      recorded_by: user.id,
    })
    .select('*')
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'purchase_bill_created',
    entityType: 'purchase_bill',
    entityId: data.id as string,
    metadata: {
      vendor_name: input.vendor_name,
      amount: input.amount,
      purchase_order_id: input.purchase_order_id ?? null,
    },
  })

  return coerceBill(data as Record<string, unknown>)
}

export async function updatePurchaseBill(
  user: SessionUser,
  billId: string,
  input: UpdatePurchaseBillInput
): Promise<PurchaseBill> {
  assertFinanceCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('purchase_bills')
    .update(input)
    .eq('id', billId)
    .select('*')
    .single()

  if (error) throw new ServiceError(error.message, 400)
  if (!data) throw new ServiceError('Purchase bill not found', 404)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'purchase_bill_updated',
    entityType: 'purchase_bill',
    entityId: billId,
    metadata: { changed: Object.keys(input) },
  })

  return coerceBill(data as Record<string, unknown>)
}

/**
 * Records a vendor payment atomically via record_vendor_payment() (0016): the payment row,
 * the recomputed bill status, and a matching cash-flow outflow — one transaction, same
 * rationale as recordReceipt on the payables side.
 */
export async function recordVendorPayment(
  user: SessionUser,
  billId: string,
  input: RecordVendorPaymentInput
): Promise<{ paymentId: string }> {
  assertFinanceCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('record_vendor_payment', {
    p_purchase_bill_id: billId,
    p_amount_paid: input.amount_paid,
    p_payment_method: input.payment_method ?? null,
    p_reference_number: input.reference_number ?? null,
    p_paid_date: input.paid_date ?? new Date().toISOString().slice(0, 10),
  })

  if (error) throw new ServiceError(error.message, 400)
  const paymentId = data as unknown as string

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'vendor_payment_recorded',
    entityType: 'vendor_payment',
    entityId: paymentId,
    metadata: { purchase_bill_id: billId, amount_paid: input.amount_paid },
  })

  return { paymentId }
}

// ===========================================================================
// Expenses
// ===========================================================================

/**
 * Records an expense atomically via record_expense() (0016): the expense row plus a
 * matching cash-flow outflow, one transaction. A 'salary_disbursement' expense carries
 * linked_salary_record_id — a bare audit FK back to HR's salary record. The amount is
 * Finance's OWN figure (entered by Finance), never a cross-read of HR's protected pay: a
 * Finance lead is not an HR lead, and recording that a salary was paid does not require
 * reading anyone's salary row. The salary link is verified server-side only for shape.
 */
export async function recordExpense(user: SessionUser, input: RecordExpenseInput): Promise<{ expenseId: string }> {
  assertFinanceCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('record_expense', {
    p_category: input.category,
    p_amount: input.amount,
    p_description: input.description ?? null,
    p_expense_date: input.expense_date ?? new Date().toISOString().slice(0, 10),
    p_approval_id: input.approval_id ?? null,
    p_linked_salary_record_id: input.linked_salary_record_id ?? null,
  })

  if (error) throw new ServiceError(error.message, 400)
  const expenseId = data as unknown as string

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'expense_recorded',
    entityType: 'expense',
    entityId: expenseId,
    metadata: {
      category: input.category,
      amount: input.amount,
      approval_id: input.approval_id ?? null,
    },
  })

  return { expenseId }
}

// ===========================================================================
// Budgets — lead-only. Actual spend is computed at query time (see lib/finance/dashboard).
// ===========================================================================

export async function createBudget(user: SessionUser, input: CreateBudgetInput): Promise<Budget> {
  assertFinanceLead(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('budgets')
    .insert({
      organization_id: user.organization_id,
      department_id: input.department_id ?? null,
      period_start: input.period_start,
      period_end: input.period_end,
      allocated_amount: input.allocated_amount,
      approval_id: input.approval_id ?? null,
      created_by: user.id,
    })
    .select('*')
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'budget_created',
    entityType: 'budget',
    entityId: data.id as string,
    metadata: {
      department_id: input.department_id ?? null,
      allocated_amount: input.allocated_amount,
      period: `${input.period_start}..${input.period_end}`,
    },
  })

  return { ...(data as unknown as Budget), allocated_amount: num(data.allocated_amount) }
}

// ===========================================================================
// Tax — GST filings & TDS
// ===========================================================================

/**
 * Pre-sums output GST (from invoices) and input GST (from purchase_bills) for a 'YYYY-MM'
 * period, as the defaults for a new filing. Runs under the caller's RLS, so a lead/CEO sees
 * the whole org and an exec sees their own — the create form is a lead-facing surface, so
 * in practice this is the full-org figure. Returns nulls if nothing in the period.
 */
export async function suggestGstTotals(
  user: SessionUser,
  period: string
): Promise<{ output_gst: number; input_gst: number }> {
  assertFinanceCanWrite(user)
  const supabase = await createSupabaseServerClient()

  // period is 'YYYY-MM'; match created_at/issue rows within that calendar month by due_date
  // proxy is unreliable, so we sum by the month of created_at via a range on the first-of.
  const start = `${period}-01`
  const end = monthEnd(period)

  const [inv, bills] = await Promise.all([
    supabase
      .from('invoices')
      .select('gst_amount, created_at')
      .gte('created_at', `${start}T00:00:00Z`)
      .lte('created_at', `${end}T23:59:59Z`),
    supabase
      .from('purchase_bills')
      .select('gst_amount, created_at')
      .gte('created_at', `${start}T00:00:00Z`)
      .lte('created_at', `${end}T23:59:59Z`),
  ])

  const output_gst = (inv.data ?? []).reduce((s, r) => s + num(r.gst_amount), 0)
  const input_gst = (bills.data ?? []).reduce((s, r) => s + num(r.gst_amount), 0)
  return { output_gst, input_gst }
}

export async function createGstFiling(user: SessionUser, input: CreateGstFilingInput): Promise<GstFiling> {
  assertFinanceCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('gst_filings')
    .insert({
      organization_id: user.organization_id,
      period: input.period,
      output_gst: input.output_gst ?? null,
      input_gst: input.input_gst ?? null,
      prepared_by: user.id,
    })
    .select('*')
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'gst_filing_created',
    entityType: 'gst_filing',
    entityId: data.id as string,
    metadata: { period: input.period },
  })

  return coerceGst(data as Record<string, unknown>)
}

export async function updateGstFiling(
  user: SessionUser,
  filingId: string,
  input: UpdateGstFilingInput
): Promise<GstFiling> {
  assertFinanceCanWrite(user)
  const supabase = await createSupabaseServerClient()

  // Marking a filing 'filed' stamps the date if the caller didn't set one.
  const patch: Record<string, unknown> = { ...input }
  if (input.status === 'filed' && input.filed_date === undefined) {
    patch.filed_date = new Date().toISOString().slice(0, 10)
  }

  const { data, error } = await supabase
    .from('gst_filings')
    .update(patch)
    .eq('id', filingId)
    .select('*')
    .single()

  if (error) throw new ServiceError(error.message, 400)
  if (!data) throw new ServiceError('GST filing not found', 404)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'gst_filing_updated',
    entityType: 'gst_filing',
    entityId: filingId,
    metadata: { changed: Object.keys(input) },
  })

  return coerceGst(data as Record<string, unknown>)
}

function coerceGst(row: Record<string, unknown>): GstFiling {
  return {
    ...(row as unknown as GstFiling),
    output_gst: row.output_gst === null || row.output_gst === undefined ? null : num(row.output_gst),
    input_gst: row.input_gst === null || row.input_gst === undefined ? null : num(row.input_gst),
    net_payable: num(row.net_payable),
  }
}

export async function createTdsRecord(user: SessionUser, input: CreateTdsRecordInput): Promise<TdsRecord> {
  assertFinanceCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('tds_records')
    .insert({
      organization_id: user.organization_id,
      deductee_name: input.deductee_name,
      section: input.section ?? null,
      amount_paid: input.amount_paid,
      tds_deducted: input.tds_deducted,
      deduction_date: input.deduction_date,
      recorded_by: user.id,
    })
    .select('*')
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'tds_record_created',
    entityType: 'tds_record',
    entityId: data.id as string,
    metadata: { deductee_name: input.deductee_name, tds_deducted: input.tds_deducted },
  })

  return { ...(data as unknown as TdsRecord), amount_paid: num(data.amount_paid), tds_deducted: num(data.tds_deducted) }
}

export async function updateTdsRecord(
  user: SessionUser,
  tdsId: string,
  input: UpdateTdsRecordInput
): Promise<TdsRecord> {
  assertFinanceCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const patch: Record<string, unknown> = { ...input }
  if (input.deposited === true && input.deposited_date === undefined) {
    patch.deposited_date = new Date().toISOString().slice(0, 10)
  }

  const { data, error } = await supabase
    .from('tds_records')
    .update(patch)
    .eq('id', tdsId)
    .select('*')
    .single()

  if (error) throw new ServiceError(error.message, 400)
  if (!data) throw new ServiceError('TDS record not found', 404)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'tds_record_updated',
    entityType: 'tds_record',
    entityId: tdsId,
    metadata: { changed: Object.keys(input) },
  })

  return { ...(data as unknown as TdsRecord), amount_paid: num(data.amount_paid), tds_deducted: num(data.tds_deducted) }
}

// ===========================================================================
// Ledger — lead-only manual entries (most entries arrive via linked records)
// ===========================================================================

export async function createLedgerEntry(
  user: SessionUser,
  input: CreateLedgerEntryInput
): Promise<LedgerEntry> {
  assertFinanceLead(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('ledger_entries')
    .insert({
      organization_id: user.organization_id,
      account_category: input.account_category,
      description: input.description,
      debit: input.debit,
      credit: input.credit,
      entry_date: input.entry_date ?? new Date().toISOString().slice(0, 10),
      linked_invoice_id: input.linked_invoice_id ?? null,
      linked_purchase_bill_id: input.linked_purchase_bill_id ?? null,
      linked_expense_id: input.linked_expense_id ?? null,
      recorded_by: user.id,
    })
    .select('*')
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'ledger_entry_created',
    entityType: 'ledger_entry',
    entityId: data.id as string,
    metadata: { account_category: input.account_category, debit: input.debit, credit: input.credit },
  })

  return {
    ...(data as unknown as LedgerEntry),
    debit: num(data.debit),
    credit: num(data.credit),
  }
}

// ===========================================================================
// Narrow cross-department exception: a Sales user checks their own deal's invoice status.
// Calls get_invoice_status_for_deal() (0016), which enforces deal ownership internally.
// This is the ONLY Finance data any non-Finance user can reach, and only these five fields.
// ===========================================================================

export async function getDealInvoiceStatus(
  user: SessionUser,
  dealClosureId: string
): Promise<DealInvoiceStatus[]> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('get_invoice_status_for_deal', {
    p_deal_closure_id: dealClosureId,
  })

  if (error) throw new ServiceError(error.message, error.message.includes('insufficient_privilege') ? 403 : 400)

  // A narrow read across the department boundary — log it so the exception stays auditable.
  await logSensitiveAccess(user.organization_id, user.id, 'invoice', null, {
    action: 'deal_invoice_status_checked',
    deal_closure_id: dealClosureId,
    count: (data ?? []).length,
  })

  return (data ?? []).map((r: Record<string, unknown>) => ({
    invoice_id: r.invoice_id as string,
    invoice_number: r.invoice_number as string,
    status: r.status as DealInvoiceStatus['status'],
    total_amount: num(r.total_amount),
    due_date: (r.due_date as string | null) ?? null,
  }))
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Last calendar day of a 'YYYY-MM' period, as 'YYYY-MM-DD'. */
function monthEnd(period: string): string {
  const [y, m] = period.split('-').map(Number)
  // Day 0 of the next month is the last day of this one; build in UTC to avoid tz drift.
  const d = new Date(Date.UTC(y, m, 0))
  return d.toISOString().slice(0, 10)
}

// Expose the coercers for the read-helper module (lib/finance/dashboard.ts).
export { coerceInvoice, coerceBill, num as coerceFinanceNumber }
export type { Expense }
