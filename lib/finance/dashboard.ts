import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logSensitiveAccess } from '@/lib/audit/log'
import { coerceInvoice, coerceBill, coerceFinanceNumber as num } from '@/lib/services/finance'
import type { SessionUser } from '@/lib/auth/guards'
import type {
  Invoice,
  PurchaseBill,
  Expense,
  Budget,
  CashFlowEntry,
  GstFiling,
  TdsRecord,
  LedgerEntry,
} from '@/lib/types'

/**
 * Server-side read helpers for the Finance pages. Every query runs on the session-bound
 * client, so RLS (migration 0016) decides which rows come back — a Finance exec sees only
 * their own, a lead/CEO the whole department. These helpers add no permission logic beyond
 * what the caller's role already grants at the database, EXCEPT the aggregate-report
 * helpers (P&L, balance sheet, cash-flow overview), which additionally logSensitiveAccess
 * and are only ever called from lead/CEO-gated pages — a company-wide financial figure is
 * exactly the "money in a table, access logged" the blueprint protects.
 *
 * Budget spend, P&L, and balance sheet are computed HERE at query time from the underlying
 * rows, never read from a stored total — so they cannot drift.
 */

// --- Option lists ----------------------------------------------------------

export interface CustomerOption {
  id: string
  name: string
}

/** Customers in the org, for the invoice form's customer picker. */
export async function getCustomerOptions(): Promise<CustomerOption[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('customers')
    .select('id, name')
    .order('name', { ascending: true })
  return (data ?? []).map((c) => ({ id: c.id as string, name: c.name as string }))
}

export interface DepartmentOption {
  id: string
  name: string
}

/** Departments in the org, for the budget form's (optional) department picker. */
export async function getDepartmentOptions(organizationId: string): Promise<DepartmentOption[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('departments')
    .select('id, name')
    .eq('organization_id', organizationId)
    .order('name', { ascending: true })
  return (data ?? []).map((d) => ({ id: d.id as string, name: d.name as string }))
}

// --- Invoices --------------------------------------------------------------

export interface InvoiceWithCustomer extends Invoice {
  customer: { name: string } | null
}

export async function getInvoices(): Promise<InvoiceWithCustomer[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('invoices')
    .select('*, customer:customers!invoices_customer_id_fkey(name)')
    .order('created_at', { ascending: false })

  return (data ?? []).map((row) => {
    const cust = row.customer as unknown as { name: string } | null
    return { ...coerceInvoice(row as Record<string, unknown>), customer: cust ? { name: cust.name } : null }
  })
}

export async function getInvoice(invoiceId: string): Promise<InvoiceWithCustomer | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('invoices')
    .select('*, customer:customers!invoices_customer_id_fkey(name)')
    .eq('id', invoiceId)
    .maybeSingle()
  if (!data) return null
  const cust = data.customer as unknown as { name: string } | null
  return { ...coerceInvoice(data as Record<string, unknown>), customer: cust ? { name: cust.name } : null }
}

export interface ReceiptRow {
  id: string
  invoice_id: string
  amount_received: number
  payment_method: string | null
  reference_number: string | null
  received_date: string
  recorded_by: string
  created_at: string
}

export async function getReceiptsForInvoice(invoiceId: string): Promise<ReceiptRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('receipts')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('received_date', { ascending: false })
  return (data ?? []).map((r) => ({
    ...(r as unknown as ReceiptRow),
    amount_received: num(r.amount_received),
  }))
}

// --- Purchase bills --------------------------------------------------------

export async function getPurchaseBills(): Promise<PurchaseBill[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('purchase_bills')
    .select('*')
    .order('created_at', { ascending: false })
  return (data ?? []).map((row) => coerceBill(row as Record<string, unknown>))
}

export async function getPurchaseBill(billId: string): Promise<PurchaseBill | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('purchase_bills').select('*').eq('id', billId).maybeSingle()
  return data ? coerceBill(data as Record<string, unknown>) : null
}

export interface VendorPaymentRow {
  id: string
  purchase_bill_id: string
  amount_paid: number
  payment_method: string | null
  reference_number: string | null
  paid_date: string
  paid_by: string
  created_at: string
}

export async function getVendorPaymentsForBill(billId: string): Promise<VendorPaymentRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('vendor_payments')
    .select('*')
    .eq('purchase_bill_id', billId)
    .order('paid_date', { ascending: false })
  return (data ?? []).map((r) => ({
    ...(r as unknown as VendorPaymentRow),
    amount_paid: num(r.amount_paid),
  }))
}

/** Distribution purchase orders Finance can see (0007 grants finance_view_purchase_orders),
 *  for the bill form's "against a PO" picker. Read-only reference. */
export interface PoOption {
  id: string
  po_number: string
  vendor_name: string | null
  total_amount: number
}

export async function getPurchaseOrderOptions(): Promise<PoOption[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('purchase_orders')
    .select('id, po_number, total_amount, vendor:vendors!purchase_orders_vendor_id_fkey(name)')
    .order('created_at', { ascending: false })
    .limit(200)
  return (data ?? []).map((r) => {
    const v = r.vendor as unknown as { name: string } | null
    return {
      id: r.id as string,
      po_number: r.po_number as string,
      vendor_name: v?.name ?? null,
      total_amount: num(r.total_amount),
    }
  })
}

/**
 * Distribution purchase orders sitting at 'pending_finance_approval' — the mid-pipeline
 * Finance-approval gate. Distribution raises a PO, it waits here, and Finance signs it off
 * before material dispatches. The approval capability (route + finance_approve_purchase_orders
 * RLS + the enforce_po_approval_authority trigger) is Distribution's (0007); this helper just
 * surfaces the queue inside the Finance module so a Finance user has a discoverable path to it.
 * Read under 0007's finance_view_purchase_orders policy.
 */
export interface PendingPoApproval {
  id: string
  po_number: string
  vendor_name: string | null
  total_amount: number
  expected_delivery_date: string | null
  created_at: string
}

export async function getPendingPurchaseOrderApprovals(): Promise<PendingPoApproval[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('purchase_orders')
    .select(
      'id, po_number, total_amount, expected_delivery_date, created_at, vendor:vendors!purchase_orders_vendor_id_fkey(name)'
    )
    .eq('status', 'pending_finance_approval')
    .order('created_at', { ascending: true })
    .limit(200)
  return (data ?? []).map((r) => {
    const v = r.vendor as unknown as { name: string } | null
    return {
      id: r.id as string,
      po_number: r.po_number as string,
      vendor_name: v?.name ?? null,
      total_amount: num(r.total_amount),
      expected_delivery_date: (r.expected_delivery_date as string | null) ?? null,
      created_at: r.created_at as string,
    }
  })
}

// --- Expenses --------------------------------------------------------------

export async function getExpenses(): Promise<Expense[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('expenses')
    .select('*')
    .order('expense_date', { ascending: false })
  return (data ?? []).map((r) => ({ ...(r as unknown as Expense), amount: num(r.amount) }))
}

// --- Cash flow -------------------------------------------------------------

export async function getCashFlowEntries(days = 90): Promise<CashFlowEntry[]> {
  const supabase = await createSupabaseServerClient()
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const { data } = await supabase
    .from('cash_flow_entries')
    .select('*')
    .gte('entry_date', since)
    .order('entry_date', { ascending: true })
  return (data ?? []).map((r) => ({ ...(r as unknown as CashFlowEntry), amount: num(r.amount) }))
}

export interface CashFlowDay {
  date: string
  inflow: number
  outflow: number
}

/** Daily inflow/outflow series for the cash-flow chart. Aggregate financial read — logged. */
export async function getCashFlowSeries(user: SessionUser, days = 90): Promise<CashFlowDay[]> {
  const entries = await getCashFlowEntries(days)

  await logSensitiveAccess(user.organization_id, user.id, 'cash_flow', null, {
    action: 'cash_flow_overview_viewed',
    days,
    count: entries.length,
  })

  const byDay = new Map<string, CashFlowDay>()
  for (const e of entries) {
    const d = byDay.get(e.entry_date) ?? { date: e.entry_date, inflow: 0, outflow: 0 }
    if (e.entry_type === 'inflow') d.inflow += e.amount
    else d.outflow += e.amount
    byDay.set(e.entry_date, d)
  }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// --- Tax -------------------------------------------------------------------

export async function getGstFilings(): Promise<GstFiling[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('gst_filings').select('*').order('period', { ascending: false })
  return (data ?? []).map((r) => ({
    ...(r as unknown as GstFiling),
    output_gst: r.output_gst === null ? null : num(r.output_gst),
    input_gst: r.input_gst === null ? null : num(r.input_gst),
    net_payable: num(r.net_payable),
  }))
}

export async function getTdsRecords(): Promise<TdsRecord[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('tds_records')
    .select('*')
    .order('deduction_date', { ascending: false })
  return (data ?? []).map((r) => ({
    ...(r as unknown as TdsRecord),
    amount_paid: num(r.amount_paid),
    tds_deducted: num(r.tds_deducted),
  }))
}

// --- Ledger ----------------------------------------------------------------

export async function getLedgerEntries(
  category?: string,
  from?: string,
  to?: string
): Promise<LedgerEntry[]> {
  const supabase = await createSupabaseServerClient()
  let q = supabase.from('ledger_entries').select('*').order('entry_date', { ascending: false })
  if (category) q = q.eq('account_category', category)
  if (from) q = q.gte('entry_date', from)
  if (to) q = q.lte('entry_date', to)
  const { data } = await q
  return (data ?? []).map((r) => ({
    ...(r as unknown as LedgerEntry),
    debit: num(r.debit),
    credit: num(r.credit),
  }))
}

// --- Budgets (query-time spend) --------------------------------------------

export interface BudgetWithSpend extends Budget {
  department_name: string | null
  spent: number
}

/**
 * Budgets with actual spend computed AT QUERY TIME — the sum of expenses + purchase_bills
 * for the budget's department over its period. Never a stored total, so it cannot drift.
 * When a budget is org-wide (department_id null), spend is all expenses/bills in the period.
 */
export async function getBudgetsWithSpend(organizationId: string): Promise<BudgetWithSpend[]> {
  const supabase = await createSupabaseServerClient()

  const { data: budgets } = await supabase
    .from('budgets')
    .select('*, department:departments!budgets_department_id_fkey(name)')
    .eq('organization_id', organizationId)
    .order('period_start', { ascending: false })

  if (!budgets || budgets.length === 0) return []

  // Pull expenses + bills once, then attribute per budget in JS. Expenses carry no
  // department, so department-scoped budgets currently measure org-wide expense spend for
  // the period; purchase_bills likewise. This is the honest v1 behaviour — a department
  // dimension on expenses/bills is a later refinement, flagged rather than faked.
  const results: BudgetWithSpend[] = []
  for (const b of budgets) {
    const start = b.period_start as string
    const end = b.period_end as string

    const [exp, bills] = await Promise.all([
      supabase
        .from('expenses')
        .select('amount')
        .gte('expense_date', start)
        .lte('expense_date', end),
      supabase
        .from('purchase_bills')
        .select('amount, gst_amount')
        .gte('created_at', `${start}T00:00:00Z`)
        .lte('created_at', `${end}T23:59:59Z`),
    ])

    const spent =
      (exp.data ?? []).reduce((s, r) => s + num(r.amount), 0) +
      (bills.data ?? []).reduce((s, r) => s + num(r.amount) + num(r.gst_amount), 0)

    const dept = b.department as unknown as { name: string } | null
    results.push({
      ...(b as unknown as Budget),
      allocated_amount: num(b.allocated_amount),
      department_name: dept?.name ?? null,
      spent,
    })
  }
  return results
}

// --- Outstanding -----------------------------------------------------------

export interface OutstandingInvoice extends InvoiceWithCustomer {
  received: number
  balance: number
}

/** Invoices not yet settled (sent/partially_paid/overdue), with balance still due. */
export async function getOutstandingInvoices(): Promise<OutstandingInvoice[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('invoices')
    .select('*, customer:customers!invoices_customer_id_fkey(name), receipts(amount_received)')
    .in('status', ['sent', 'partially_paid', 'overdue'])
    .order('due_date', { ascending: true, nullsFirst: false })

  return (data ?? []).map((row) => {
    const inv = coerceInvoice(row as Record<string, unknown>)
    const cust = row.customer as unknown as { name: string } | null
    const rec = (row.receipts as unknown as { amount_received: unknown }[] | null) ?? []
    const received = rec.reduce((s, r) => s + num(r.amount_received), 0)
    return {
      ...inv,
      customer: cust ? { name: cust.name } : null,
      received,
      balance: inv.total_amount - received,
    }
  })
}

export interface OutstandingBill extends PurchaseBill {
  paid: number
  balance: number
}

/** Purchase bills not yet fully paid, with balance still due. */
export async function getOutstandingBills(): Promise<OutstandingBill[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('purchase_bills')
    .select('*, vendor_payments(amount_paid)')
    .neq('status', 'paid')
    .order('due_date', { ascending: true, nullsFirst: false })

  return (data ?? []).map((row) => {
    const bill = coerceBill(row as Record<string, unknown>)
    const pays = (row.vendor_payments as unknown as { amount_paid: unknown }[] | null) ?? []
    const paid = pays.reduce((s, r) => s + num(r.amount_paid), 0)
    return { ...bill, paid, balance: bill.total_amount - paid }
  })
}

// --- Pending handoffs (the operationally critical dashboard panel) ---------

export interface PendingHandoff {
  kind: 'deal' | 'installation'
  source_id: string
  customer_name: string | null
  amount: number | null
  reference: string | null
  when: string | null
}

/**
 * Completed work from other departments that has no invoice yet — the direct equivalent of
 * every module's "handoff not yet actioned" panel, and the single most important item on a
 * Finance dashboard. Closed deals (Sales) and completed installations (O&M) that no invoice
 * references. Read under Finance's cross-department read policies (0016). deal_closures has
 * no org column, so its rows are already scoped by auth_lead_in_org via RLS.
 */
export async function getPendingHandoffs(limit = 12): Promise<PendingHandoff[]> {
  const supabase = await createSupabaseServerClient()

  // Which sources are already invoiced?
  const { data: invoiced } = await supabase
    .from('invoices')
    .select('deal_closure_id, installation_id')
  const invoicedDeals = new Set(
    (invoiced ?? []).map((r) => r.deal_closure_id).filter(Boolean) as string[]
  )
  const invoicedInstalls = new Set(
    (invoiced ?? []).map((r) => r.installation_id).filter(Boolean) as string[]
  )

  const [deals, installs] = await Promise.all([
    supabase
      .from('deal_closures')
      .select('id, final_amount, closed_at, customer:customers!deal_closures_customer_id_fkey(name)')
      .order('closed_at', { ascending: false })
      .limit(50),
    supabase
      .from('installations')
      .select('id, completed_date, system_size_kw, customer:customers!installations_customer_id_fkey(name)')
      .eq('status', 'completed')
      .order('completed_date', { ascending: false })
      .limit(50),
  ])

  const out: PendingHandoff[] = []

  for (const d of deals.data ?? []) {
    if (invoicedDeals.has(d.id as string)) continue
    const cust = d.customer as unknown as { name: string } | null
    out.push({
      kind: 'deal',
      source_id: d.id as string,
      customer_name: cust?.name ?? null,
      amount: num(d.final_amount),
      reference: null,
      when: (d.closed_at as string | null) ?? null,
    })
  }

  for (const i of installs.data ?? []) {
    if (invoicedInstalls.has(i.id as string)) continue
    const cust = i.customer as unknown as { name: string } | null
    out.push({
      kind: 'installation',
      source_id: i.id as string,
      customer_name: cust?.name ?? null,
      amount: null,
      reference: i.system_size_kw ? `${num(i.system_size_kw)} kW` : null,
      when: (i.completed_date as string | null) ?? null,
    })
  }

  out.sort((a, b) => (b.when ?? '').localeCompare(a.when ?? ''))
  return out.slice(0, limit)
}

/**
 * The uninvoiced handoffs shaped for the invoice form's conversion picker — same source set
 * as getPendingHandoffs, but carrying customer_id so selecting one pre-fills the customer.
 * (getPendingHandoffs is for display and omits the id.) Read under Finance's cross-department
 * read policies (0016).
 */
export interface InvoiceHandoffOption {
  kind: 'deal' | 'installation'
  source_id: string
  customer_id: string
  customer_name: string | null
  amount: number | null
}

export async function getInvoiceHandoffOptions(limit = 50): Promise<InvoiceHandoffOption[]> {
  const supabase = await createSupabaseServerClient()

  const { data: invoiced } = await supabase
    .from('invoices')
    .select('deal_closure_id, installation_id')
  const invoicedDeals = new Set(
    (invoiced ?? []).map((r) => r.deal_closure_id).filter(Boolean) as string[]
  )
  const invoicedInstalls = new Set(
    (invoiced ?? []).map((r) => r.installation_id).filter(Boolean) as string[]
  )

  const [deals, installs] = await Promise.all([
    supabase
      .from('deal_closures')
      .select('id, customer_id, final_amount, closed_at, customer:customers!deal_closures_customer_id_fkey(name)')
      .order('closed_at', { ascending: false })
      .limit(limit),
    supabase
      .from('installations')
      .select('id, customer_id, completed_date, customer:customers!installations_customer_id_fkey(name)')
      .eq('status', 'completed')
      .order('completed_date', { ascending: false })
      .limit(limit),
  ])

  const out: InvoiceHandoffOption[] = []

  for (const d of deals.data ?? []) {
    if (invoicedDeals.has(d.id as string)) continue
    if (!d.customer_id) continue
    const cust = d.customer as unknown as { name: string } | null
    out.push({
      kind: 'deal',
      source_id: d.id as string,
      customer_id: d.customer_id as string,
      customer_name: cust?.name ?? null,
      amount: num(d.final_amount),
    })
  }

  for (const i of installs.data ?? []) {
    if (invoicedInstalls.has(i.id as string)) continue
    if (!i.customer_id) continue
    const cust = i.customer as unknown as { name: string } | null
    out.push({
      kind: 'installation',
      source_id: i.id as string,
      customer_id: i.customer_id as string,
      customer_name: cust?.name ?? null,
      amount: null,
    })
  }

  return out
}

// --- Reports: P&L and Balance Sheet (lead/CEO only, logged) ----------------

export interface ProfitAndLoss {
  from: string
  to: string
  revenue: number // invoiced amount (excl. GST) in period
  gstCollected: number
  expenses: number // recorded expenses in period
  purchases: number // purchase bill amounts (excl. GST) in period
  gstPaid: number
  netProfit: number
}

/**
 * A simple, clearly-approximate P&L over a period, computed from invoices/expenses/
 * purchase_bills. NOT audit-grade — labelled as such on the page. Aggregate financial read,
 * so it is logged even for the CEO.
 */
export async function getProfitAndLoss(
  user: SessionUser,
  from: string,
  to: string
): Promise<ProfitAndLoss> {
  const supabase = await createSupabaseServerClient()

  const [inv, exp, bills] = await Promise.all([
    supabase
      .from('invoices')
      .select('amount, gst_amount, created_at, status')
      .gte('created_at', `${from}T00:00:00Z`)
      .lte('created_at', `${to}T23:59:59Z`),
    supabase
      .from('expenses')
      .select('amount, expense_date')
      .gte('expense_date', from)
      .lte('expense_date', to),
    supabase
      .from('purchase_bills')
      .select('amount, gst_amount, created_at')
      .gte('created_at', `${from}T00:00:00Z`)
      .lte('created_at', `${to}T23:59:59Z`),
  ])

  // Revenue counts invoices that are not cancelled — issuing is the recognition point here.
  const live = (inv.data ?? []).filter((r) => r.status !== 'cancelled')
  const revenue = live.reduce((s, r) => s + num(r.amount), 0)
  const gstCollected = live.reduce((s, r) => s + num(r.gst_amount), 0)
  const expenses = (exp.data ?? []).reduce((s, r) => s + num(r.amount), 0)
  const purchases = (bills.data ?? []).reduce((s, r) => s + num(r.amount), 0)
  const gstPaid = (bills.data ?? []).reduce((s, r) => s + num(r.gst_amount), 0)

  await logSensitiveAccess(user.organization_id, user.id, 'report', null, {
    action: 'profit_and_loss_viewed',
    period: `${from}..${to}`,
  })

  return {
    from,
    to,
    revenue,
    gstCollected,
    expenses,
    purchases,
    gstPaid,
    netProfit: revenue - expenses - purchases,
  }
}

export interface BalanceSheet {
  receivables: number // outstanding invoice balances
  payables: number // outstanding bill balances
  cashPosition: number // running inflow - outflow, all time
}

/**
 * A snapshot: outstanding receivables, outstanding payables, and cash position (running
 * cash-flow total). Simple and clearly approximate. Aggregate financial read — logged.
 */
export async function getBalanceSheet(user: SessionUser): Promise<BalanceSheet> {
  const supabase = await createSupabaseServerClient()

  const [invRows, billRows, cash] = await Promise.all([
    supabase
      .from('invoices')
      .select('total_amount, status, receipts(amount_received)')
      .in('status', ['sent', 'partially_paid', 'overdue']),
    supabase
      .from('purchase_bills')
      .select('total_amount, status, vendor_payments(amount_paid)')
      .neq('status', 'paid'),
    supabase.from('cash_flow_entries').select('entry_type, amount'),
  ])

  const receivables = (invRows.data ?? []).reduce((s, r) => {
    const rec = (r.receipts as unknown as { amount_received: unknown }[] | null) ?? []
    const received = rec.reduce((a, x) => a + num(x.amount_received), 0)
    return s + (num(r.total_amount) - received)
  }, 0)

  const payables = (billRows.data ?? []).reduce((s, r) => {
    const pays = (r.vendor_payments as unknown as { amount_paid: unknown }[] | null) ?? []
    const paid = pays.reduce((a, x) => a + num(x.amount_paid), 0)
    return s + (num(r.total_amount) - paid)
  }, 0)

  const cashPosition = (cash.data ?? []).reduce(
    (s, r) => s + (r.entry_type === 'inflow' ? num(r.amount) : -num(r.amount)),
    0
  )

  await logSensitiveAccess(user.organization_id, user.id, 'report', null, {
    action: 'balance_sheet_viewed',
  })

  return { receivables, payables, cashPosition }
}

// --- Dashboard stats -------------------------------------------------------

export interface FinanceDashboardStats {
  outstandingReceivable: number
  outstandingPayable: number
  invoicesDue: number
  pendingHandoffs: number
}

export async function getFinanceDashboardStats(): Promise<FinanceDashboardStats> {
  const [outInv, outBill, handoffs] = await Promise.all([
    getOutstandingInvoices(),
    getOutstandingBills(),
    getPendingHandoffs(200),
  ])
  return {
    outstandingReceivable: outInv.reduce((s, r) => s + r.balance, 0),
    outstandingPayable: outBill.reduce((s, r) => s + r.balance, 0),
    invoicesDue: outInv.length,
    pendingHandoffs: handoffs.length,
  }
}

// --- Task queues (mirror the HR dashboard helpers) -------------------------

export async function getFinanceDepartmentId(organizationId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('departments')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('slug', 'finance')
    .maybeSingle()
  return data?.id ?? null
}

export async function getFinanceEmployees(
  organizationId: string
): Promise<{ id: string; full_name: string }[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('users')
    .select('id, full_name, is_active, departments!inner(slug)')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .in('departments.slug', ['finance', 'accounts'])
    .order('full_name')
  return (data ?? []).map((r) => ({ id: r.id as string, full_name: r.full_name as string }))
}

export async function getUnownedFinanceTasks(
  organizationId: string,
  departmentId: string | null
): Promise<unknown[]> {
  if (!departmentId) return []
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from('tasks')
    .select(
      '*, assignee:users!tasks_assigned_user_id_fkey(full_name), creator:users!tasks_created_by_fkey(full_name), department:departments!tasks_assigned_department_id_fkey(name)'
    )
    .eq('organization_id', organizationId)
    .eq('assigned_department_id', departmentId)
    .is('assigned_user_id', null)
    .neq('status', 'archived')
    .order('due_date', { ascending: true, nullsFirst: false })
  return data ?? []
}
