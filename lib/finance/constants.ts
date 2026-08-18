import type {
  InvoiceType,
  InvoiceStatus,
  PaymentMethod,
  PurchaseBillStatus,
  ExpenseCategory,
  CashFlowSource,
  LedgerAccountCategory,
} from '@/lib/types'

/**
 * Finance domain vocabularies and storage/threshold constants.
 *
 * No 'server-only': these lists feed client pickers (the invoice form, the receipt form,
 * the expense form), so client components import from here. Nothing here is a permission
 * check — RLS (migration 0016) and the service layer own access; the four tiers that gate
 * financial data live there, not in this file. Display labels and badge styles live in
 * lib/format.ts alongside every other module's.
 *
 * `import type` is erased at build, so pulling the status unions in keeps this file
 * client-safe. `as const satisfies` fixes each picker's display order while proving every
 * value is a member of its DB-backed union — a typo is a compile error.
 */

export const INVOICE_TYPES = [
  'advance',
  'milestone',
  'final',
] as const satisfies readonly InvoiceType[]

export const INVOICE_STATUSES = [
  'draft',
  'sent',
  'partially_paid',
  'paid',
  'overdue',
  'cancelled',
] as const satisfies readonly InvoiceStatus[]

/** Statuses a Finance user may set by hand on an invoice. paid / partially_paid are driven
 *  by receipts (record_customer_receipt), never chosen directly; overdue is derived. */
export const INVOICE_SETTABLE_STATUSES = [
  'draft',
  'sent',
  'cancelled',
] as const satisfies readonly InvoiceStatus[]

export const PAYMENT_METHODS = [
  'cash',
  'bank_transfer',
  'cheque',
  'upi',
  'other',
] as const satisfies readonly PaymentMethod[]

export const PURCHASE_BILL_STATUSES = [
  'unpaid',
  'partially_paid',
  'paid',
] as const satisfies readonly PurchaseBillStatus[]

export const EXPENSE_CATEGORIES = [
  'rent',
  'utilities',
  'travel',
  'office_supplies',
  'marketing_spend',
  'salary_disbursement',
  'other',
] as const satisfies readonly ExpenseCategory[]

export const CASH_FLOW_SOURCES = [
  'customer_payment',
  'subsidy_disbursement',
  'vendor_payment',
  'salary',
  'tax_payment',
  'other',
] as const satisfies readonly CashFlowSource[]

export const LEDGER_ACCOUNT_CATEGORIES = [
  'sales',
  'purchases',
  'expenses',
  'salaries',
  'tax',
  'other',
] as const satisfies readonly LedgerAccountCategory[]

// ---------------------------------------------------------------------------
// Approval thresholds
//
// The build prompt was explicit: do NOT invent the threshold at which a purchase or
// expense must route through a CEO approval — it is a client decision. These are labelled
// PLACEHOLDER defaults so the flow is wired and testable; the real numbers are a one-line
// change here once the client confirms them. Below the threshold, an expense is recorded
// directly with no approval_id; at or above it, the UI routes the user to raise an
// approval first and links it.
// ---------------------------------------------------------------------------

/** PLACEHOLDER — confirm with client. Expenses ≥ this need a CEO 'expense' approval. */
export const EXPENSE_APPROVAL_THRESHOLD = 25_000

/** PLACEHOLDER — confirm with client. Budgets are always CEO-approved regardless. */
export const BUDGET_ALWAYS_REQUIRES_APPROVAL = true

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * Private bucket created in migration 0016. Objects live at
 * '{organization_id}/{record_type}/{record_id}/{filename}' — the organization id is the
 * FIRST path segment, so the storage policy gates through the org (CEO + Finance lead +
 * Finance member within their own org). No other department has object access.
 */
export const FINANCE_DOCUMENTS_BUCKET = 'finance-documents'

/** How long a download link stays valid. Short on purpose — a signed URL is a bearer token. */
export const SIGNED_URL_TTL_SECONDS = 300

/** Upload ceiling. Vendor bills / invoice PDFs are scans, so this matches the HR docs cap. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
