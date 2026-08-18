-- Solar Pulse OS
-- 0016 — Finance & Accounts department module
--
-- Structurally unlike every prior module. Finance appears TWICE in the company workflow
-- (mid-pipeline "Finance Approval" before dispatch, and end-pipeline "Finance & Accounts"
-- for final billing) and its core job is RECONCILING data other departments already
-- created, not originating most of it. So most Finance tables REFERENCE existing records
-- rather than duplicate their numbers:
--
--   * a closed deal (Sales deal_closures.final_amount) → an invoice
--   * a completed installation (O&M) → final billing
--   * a disbursed subsidy (DISCOM subsidy_cases.disbursed_amount) → reconciliation
--   * a salary record (HR salary_records.net_payable) → a salary_disbursement expense
--   * a budget/purchase/expense approval (CEO approvals) → Finance is requester/implementer
--
-- ACCESS CONTROL — same elevated caution as HR. Full company financials (P&L, cash flow,
-- outstanding, salary-linked entries) are as sensitive as HR salary data and get the same
-- FOUR-TIER pattern:
--
--   CEO full  /  Finance lead (Finance Manager) full  /  Finance executive: ONLY rows they
--   created or process (own-only, keyed on the natural ownership column)  /  NO other
--   department's regular staff gets ANY access to Finance tables, not even read-only.
--
-- A Sales Executive must NOT be able to query invoices/cash_flow_entries even though their
-- own closed deals generated some of those invoices. The one legitimate cross-department
-- need — "has my customer paid?" — is served by a single narrow SECURITY DEFINER function
-- (get_invoice_status_for_deal) that returns status/amount/due-date for invoices on deals
-- the caller owns, NOT by widening any table's RLS.
--
-- KEY FACTS this migration is built on (verified against the migrations that actually ran,
-- not the build prompt's assumptions):
--   * deal_closures has NO organization_id. Org scoping goes through the lead via the
--     existing auth_lead_in_org(lead_id) helper (0005). The deal amount is final_amount.
--     A deal_closures row's EXISTENCE is the "closed" fact — there is no status column.
--   * installations (O&M) has organization_id; "complete" = status = 'completed'.
--   * subsidy_cases (DISCOM) has organization_id and disbursed_amount; "disbursed" =
--     status = 'disbursed'.
--   * salary_records (HR) has NO organization_id (scoped via auth_employee_org()), and its
--     RLS is the stricter CEO+HR-lead+self tier. A FINANCE lead is NOT an HR lead, so this
--     migration deliberately does NOT widen salary_records access. expenses.linked_salary_
--     record_id is a bare audit FK; the expense amount is Finance's own figure, entered by
--     Finance, never a cross-read of protected pay. Recording that a salary was paid does
--     not require reading anyone's salary row.
--   * approvals (0001) type is the enum approval_type ('budget','purchase','leave',
--     'expense') — Finance uses budget/expense, both already valid, no ALTER TYPE.
--     approvals has NO source-FK, so budgets/expenses carry an approval_id back-link,
--     exactly like leave_requests did in 0015. (Purchase approvals belong to Distribution's
--     PO flow, 0007, not to a Finance table.)
--   * The Finance department (slug 'finance', name 'Finance') and its 'Finance Executive'
--     role are already seeded in 0002. This migration must NOT re-insert the department; it
--     adds the 'Finance Manager' lead role + permissions. 'Finance Manager' ends in
--     "Manager" so auth_is_department_manager() (0006) / isDepartmentManager() (guards.ts)
--     accept it for CEO task delegation; auth_is_finance_lead() below also honours
--     'Finance Lead'.
--   * purchase_bills in the build prompt lacked organization_id but can be standalone (no
--     PO). Without an org column a PO-less bill cannot be org-scoped, so this migration
--     ADDS organization_id to purchase_bills. Child tables that reference a single parent
--     (receipts→invoices, vendor_payments→purchase_bills) scope through that parent.
--   * Budget "spend against allocation", P&L, and Balance Sheet are COMPUTED AT QUERY TIME
--     in lib/services/finance.ts under RLS — not stored totals (which drift) and not DB
--     views (whose security_invoker semantics are a footgun with RLS). No view is created.

-- ---------------------------------------------------------------------------
-- Tables
--
-- Statuses stay text with a documented value list rather than enums — the same choice the
-- recent modules made, so a stage can be renamed without a type migration.
-- Money is numeric(14,2). total_amount / net_payable are GENERATED so they can never drift
-- from their parts and are never recalculated client-side.
-- ---------------------------------------------------------------------------

-- Sales invoices. Usually converted from a closed deal (deal_closure_id) and/or a completed
-- installation (installation_id); both nullable for standalone/advance invoices.
create table invoices (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id     uuid not null references customers(id),
  deal_closure_id uuid references deal_closures(id) on delete set null,
  installation_id uuid references installations(id) on delete set null,
  invoice_number  text not null unique,
  invoice_type    text not null default 'final',   -- 'advance' | 'milestone' | 'final'
  amount          numeric(14, 2) not null,
  gst_amount      numeric(14, 2) not null default 0,
  total_amount    numeric(14, 2) generated always as (amount + gst_amount) stored,
  -- 'draft' | 'sent' | 'partially_paid' | 'paid' | 'overdue' | 'cancelled'
  status          text not null default 'draft',
  due_date        date,
  issued_by       uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index invoices_org_status_idx on invoices (organization_id, status);
create index invoices_issued_by_idx   on invoices (issued_by);
create index invoices_customer_idx     on invoices (customer_id);
create index invoices_deal_idx         on invoices (deal_closure_id);
create index invoices_installation_idx on invoices (installation_id);

-- Receipts (customer payments) against an invoice. Recording one updates invoices.status
-- and inserts a matching cash_flow_entries inflow row — in ONE transaction, in the route
-- handler, not a trigger (kept visible/debuggable). Scoped through the parent invoice.
create table receipts (
  id               uuid primary key default gen_random_uuid(),
  invoice_id       uuid not null references invoices(id) on delete cascade,
  amount_received  numeric(14, 2) not null,
  payment_method   text,   -- 'cash' | 'bank_transfer' | 'cheque' | 'upi' | 'other'
  reference_number text,
  received_date    date not null default current_date,
  recorded_by      uuid not null references users(id),
  created_at       timestamptz not null default now()
);

create index receipts_invoice_idx     on receipts (invoice_id);
create index receipts_recorded_by_idx  on receipts (recorded_by);

-- NOTE — Finance does NOT own purchase_orders. Distribution's migration 0007 already
-- creates a full purchase_orders system (purchase_orders + purchase_order_items + vendors,
-- with next_document_number() PO numbering and the Finance-approval gate baked in:
-- status enum purchase_order_status includes 'pending_finance_approval', and 0007 already
-- grants Finance finance_view_purchase_orders + finance_approve_purchase_orders). Creating
-- a second purchase_orders here would both fail to migrate ("relation already exists") and
-- violate this module's core principle — reference existing records, don't duplicate them.
-- So PO creation/approval stays in Distribution; Finance READS those POs (its policies
-- already permit it) and links purchase_bills to them. This corrects the build prompt's
-- placeholder ("vendor records once Distribution ships") now that Distribution has shipped.

-- Purchase bills, against a Distribution PO or standalone (a bill often arrives without a
-- formal PO). organization_id is added here (see header note) so standalone bills are still
-- org-scoped. purchase_order_id is a real FK to Distribution's purchase_orders.
create table purchase_bills (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  purchase_order_id uuid references purchase_orders(id) on delete set null,  -- Distribution's (0007)
  vendor_name       text not null,
  bill_number       text,
  amount            numeric(14, 2) not null,
  gst_amount        numeric(14, 2) not null default 0,
  total_amount      numeric(14, 2) generated always as (amount + gst_amount) stored,
  status            text not null default 'unpaid',  -- 'unpaid' | 'partially_paid' | 'paid'
  due_date          date,
  file_path         text,   -- finance-documents bucket
  recorded_by       uuid not null references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index purchase_bills_org_status_idx on purchase_bills (organization_id, status);
create index purchase_bills_recorded_by_idx  on purchase_bills (recorded_by);
create index purchase_bills_po_idx           on purchase_bills (purchase_order_id);

-- Vendor payments against a bill. Same one-transaction pattern as receipts: updates
-- purchase_bills.status and inserts a cash_flow_entries outflow row together. Scoped
-- through the parent bill.
create table vendor_payments (
  id               uuid primary key default gen_random_uuid(),
  purchase_bill_id uuid not null references purchase_bills(id) on delete cascade,
  amount_paid      numeric(14, 2) not null,
  payment_method   text,
  reference_number text,
  paid_date        date not null default current_date,
  paid_by          uuid not null references users(id),
  created_at       timestamptz not null default now()
);

create index vendor_payments_bill_idx     on vendor_payments (purchase_bill_id);
create index vendor_payments_paid_by_idx   on vendor_payments (paid_by);

-- Expenses. Category-tagged log. Above a client-confirmed threshold, links to a CEO
-- approvals row (type 'expense'); routine sub-threshold expenses have no approval.
-- category = 'salary_disbursement' links to HR's salary_records via linked_salary_record_id
-- (a bare audit FK — see header note; the amount is Finance's own, no salary read).
create table expenses (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references organizations(id) on delete cascade,
  -- 'rent' | 'utilities' | 'travel' | 'office_supplies' | 'marketing_spend'
  --  | 'salary_disbursement' | 'other'
  category                 text not null,
  description              text,
  amount                   numeric(14, 2) not null,
  expense_date             date not null default current_date,
  approval_id              uuid references approvals(id) on delete set null,
  linked_salary_record_id  uuid references salary_records(id) on delete set null,
  recorded_by              uuid not null references users(id),
  created_at               timestamptz not null default now()
);

create index expenses_org_category_idx on expenses (organization_id, category);
create index expenses_recorded_by_idx   on expenses (recorded_by);
create index expenses_date_idx          on expenses (expense_date);

-- Budgets per department (or org-wide when department_id is null) per period. Actual spend
-- against a budget is computed at query time (sum of expenses + purchase_bills for that
-- department/date-range), never stored here — see header note.
create table budgets (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  department_id    uuid references departments(id) on delete set null,
  period_start     date not null,
  period_end       date not null,
  allocated_amount numeric(14, 2) not null,
  approval_id      uuid references approvals(id) on delete set null,
  created_by       uuid not null references users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index budgets_org_period_idx on budgets (organization_id, period_start, period_end);
create index budgets_department_idx   on budgets (department_id);

-- Cash flow. The actual "Cash Flow" feature. Most rows are created automatically alongside
-- their source (a receipt insert also inserts a matching inflow, in the same transaction);
-- rows with no linked_* id are genuinely standalone cash movements (rent, utilities).
create table cash_flow_entries (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references organizations(id) on delete cascade,
  entry_type              text not null,   -- 'inflow' | 'outflow'
  -- 'customer_payment' | 'subsidy_disbursement' | 'vendor_payment' | 'salary'
  --  | 'tax_payment' | 'other'
  source                  text not null,
  amount                  numeric(14, 2) not null,
  entry_date              date not null default current_date,
  linked_receipt_id       uuid references receipts(id) on delete set null,
  linked_vendor_payment_id uuid references vendor_payments(id) on delete set null,
  linked_expense_id       uuid references expenses(id) on delete set null,
  notes                   text,
  recorded_by             uuid not null references users(id),
  created_at              timestamptz not null default now()
);

create index cash_flow_org_date_idx on cash_flow_entries (organization_id, entry_date);
create index cash_flow_type_idx       on cash_flow_entries (organization_id, entry_type);

-- GST filings. output_gst/input_gst are pre-summed from invoices/purchase_bills for the
-- period as defaults, then adjustable before 'filed' (real filing has nuances this system
-- doesn't model). net_payable is generated. This records figures a human files; it does not
-- file to any government portal.
create table gst_filings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  period          text not null,   -- e.g. '2026-07' (monthly)
  output_gst      numeric(14, 2),  -- GST collected (from invoices)
  input_gst       numeric(14, 2),  -- GST paid (from purchase_bills)
  net_payable     numeric(14, 2) generated always as
                    (coalesce(output_gst, 0) - coalesce(input_gst, 0)) stored,
  status          text not null default 'draft',   -- 'draft' | 'filed'
  filed_date      date,
  prepared_by     uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, period)
);

create index gst_filings_org_period_idx on gst_filings (organization_id, period);

-- TDS records. Simple log of deductions, with a deposited flag staff toggle once the
-- deducted amount is deposited with the government. section is free text for v1.
create table tds_records (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  deductee_name   text not null,
  section         text,   -- '194C', '194J', ... free text
  amount_paid     numeric(14, 2) not null,
  tds_deducted    numeric(14, 2) not null,
  deduction_date  date not null,
  deposited       boolean not null default false,
  deposited_date  date,
  recorded_by     uuid not null references users(id),
  created_at      timestamptz not null default now()
);

create index tds_records_org_idx      on tds_records (organization_id, deduction_date);
create index tds_records_deposited_idx on tds_records (organization_id, deposited);

-- Ledger. A category-tagged transaction log, NOT a chart-of-accounts double-entry engine.
-- P&L and Balance Sheet compute over this plus invoices/purchase_bills/expenses.
create table ledger_entries (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations(id) on delete cascade,
  -- 'sales' | 'purchases' | 'expenses' | 'salaries' | 'tax' | 'other'
  account_category       text not null,
  description            text not null,
  debit                  numeric(14, 2) not null default 0,
  credit                 numeric(14, 2) not null default 0,
  entry_date             date not null default current_date,
  linked_invoice_id      uuid references invoices(id) on delete set null,
  linked_purchase_bill_id uuid references purchase_bills(id) on delete set null,
  linked_expense_id      uuid references expenses(id) on delete set null,
  recorded_by            uuid not null references users(id),
  created_at             timestamptz not null default now()
);

create index ledger_org_category_idx on ledger_entries (organization_id, account_category);
create index ledger_date_idx          on ledger_entries (organization_id, entry_date);

-- ---------------------------------------------------------------------------
-- updated_at triggers, reusing set_updated_at() from 0001. Only tables with a mutable
-- lifecycle carry updated_at; receipts, vendor_payments, expenses, cash_flow_entries,
-- tds_records, ledger_entries are append-only facts.
-- ---------------------------------------------------------------------------

create trigger invoices_set_updated_at
  before update on invoices
  for each row execute function set_updated_at();

create trigger purchase_bills_set_updated_at
  before update on purchase_bills
  for each row execute function set_updated_at();

create trigger budgets_set_updated_at
  before update on budgets
  for each row execute function set_updated_at();

create trigger gst_filings_set_updated_at
  before update on gst_filings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helpers, mirroring auth_is_hr_member()/auth_is_hr_lead() from 0015.
-- ---------------------------------------------------------------------------

-- auth_is_finance_member() is ALREADY defined in Distribution's 0007 and deliberately
-- spans BOTH the 'finance' department and its 'accounts' child (0002 seeds Accounts as a
-- child of Finance: "an Accounts user is Finance for approval purposes"). We do NOT
-- redefine it here — a create-or-replace would silently narrow it and break Distribution's
-- PO-approval flow for Accounts users. This module reuses 0007's definition as-is, which is
-- also correct for Finance: the blueprint's Accounts scope (invoices, bills, ledger,
-- receipts) is this module, so an Accounts user IS a Finance-module user.

-- The Finance lead tier. Spans finance + accounts (mirroring auth_is_finance_member's
-- scope) and honours 'Finance Manager'/'Accounts Manager' (seeded roles ending in
-- "Manager", so CEO delegation guards accept them) plus a hand-made 'Finance Lead' —
-- same belt-and-suspenders as auth_is_hr_lead().
create or replace function auth_is_finance_lead()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join roles r on r.id = u.role_id
    join departments d on d.id = u.department_id
    left join departments parent on parent.id = d.parent_department_id
    where u.id = auth.uid() and u.is_active
      and (d.slug in ('finance', 'accounts') or parent.slug = 'finance')
      and r.name in ('Finance Manager', 'Accounts Manager', 'Finance Lead')
  );
$$;

-- ===========================================================================
-- RLS — FOUR-TIER strict pattern for every Finance table.
--
--   Tier 1  CEO            — full access (auth_is_ceo)
--   Tier 2  Finance lead   — full department access (auth_is_finance_lead)
--   Tier 3  Finance exec   — ONLY rows they own (the natural ownership column). This is
--                            the stricter HR-style tier, NOT the looser "any member sees
--                            the shared queue" Sales pattern, because company financials
--                            are sensitive at the department level, not just per-record.
--                            Defaulting to own-only per the build prompt: loosening later
--                            is easy, tightening after over-exposure is not.
--   Tier 4  everyone else  — NO policy. No other department gets any access. The one
--                            legitimate cross-department read is the narrow
--                            get_invoice_status_for_deal() function below.
-- ===========================================================================

-- --- invoices -------------------------------------------------------------
alter table invoices enable row level security;

create policy "ceo_full_access_invoices" on invoices
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "finance_lead_full_access_invoices" on invoices
  for all
  using (auth_is_finance_lead() and organization_id = auth_org_id())
  with check (auth_is_finance_lead() and organization_id = auth_org_id());

create policy "finance_exec_own_invoices" on invoices
  for all
  using (auth_is_finance_member() and organization_id = auth_org_id() and issued_by = auth.uid())
  with check (auth_is_finance_member() and organization_id = auth_org_id() and issued_by = auth.uid());

-- --- receipts (scoped through the parent invoice) -------------------------
alter table receipts enable row level security;

create policy "ceo_full_access_receipts" on receipts
  for all
  using (auth_is_ceo() and exists (
    select 1 from invoices i where i.id = receipts.invoice_id and i.organization_id = auth_org_id()))
  with check (auth_is_ceo() and exists (
    select 1 from invoices i where i.id = receipts.invoice_id and i.organization_id = auth_org_id()));

create policy "finance_lead_full_access_receipts" on receipts
  for all
  using (auth_is_finance_lead() and exists (
    select 1 from invoices i where i.id = receipts.invoice_id and i.organization_id = auth_org_id()))
  with check (auth_is_finance_lead() and exists (
    select 1 from invoices i where i.id = receipts.invoice_id and i.organization_id = auth_org_id()));

-- A Finance exec records/reads receipts they recorded, or receipts on an invoice they own.
create policy "finance_exec_own_receipts" on receipts
  for all
  using (
    auth_is_finance_member()
    and (
      recorded_by = auth.uid()
      or exists (select 1 from invoices i
                 where i.id = receipts.invoice_id
                   and i.organization_id = auth_org_id()
                   and i.issued_by = auth.uid())
    )
  )
  with check (
    auth_is_finance_member()
    and recorded_by = auth.uid()
    and exists (select 1 from invoices i
                where i.id = receipts.invoice_id and i.organization_id = auth_org_id())
  );

-- Purchase orders themselves are Distribution's (0007) — Finance already has read +
-- approve policies there (finance_view_purchase_orders, finance_approve_purchase_orders).
-- Nothing to add here; Finance's own payables data starts at purchase_bills.

-- --- purchase_bills -------------------------------------------------------
alter table purchase_bills enable row level security;

create policy "ceo_full_access_purchase_bills" on purchase_bills
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "finance_lead_full_access_purchase_bills" on purchase_bills
  for all
  using (auth_is_finance_lead() and organization_id = auth_org_id())
  with check (auth_is_finance_lead() and organization_id = auth_org_id());

create policy "finance_exec_own_purchase_bills" on purchase_bills
  for all
  using (auth_is_finance_member() and organization_id = auth_org_id() and recorded_by = auth.uid())
  with check (auth_is_finance_member() and organization_id = auth_org_id() and recorded_by = auth.uid());

-- --- vendor_payments (scoped through the parent bill) ---------------------
alter table vendor_payments enable row level security;

create policy "ceo_full_access_vendor_payments" on vendor_payments
  for all
  using (auth_is_ceo() and exists (
    select 1 from purchase_bills b where b.id = vendor_payments.purchase_bill_id and b.organization_id = auth_org_id()))
  with check (auth_is_ceo() and exists (
    select 1 from purchase_bills b where b.id = vendor_payments.purchase_bill_id and b.organization_id = auth_org_id()));

create policy "finance_lead_full_access_vendor_payments" on vendor_payments
  for all
  using (auth_is_finance_lead() and exists (
    select 1 from purchase_bills b where b.id = vendor_payments.purchase_bill_id and b.organization_id = auth_org_id()))
  with check (auth_is_finance_lead() and exists (
    select 1 from purchase_bills b where b.id = vendor_payments.purchase_bill_id and b.organization_id = auth_org_id()));

create policy "finance_exec_own_vendor_payments" on vendor_payments
  for all
  using (
    auth_is_finance_member()
    and (
      paid_by = auth.uid()
      or exists (select 1 from purchase_bills b
                 where b.id = vendor_payments.purchase_bill_id
                   and b.organization_id = auth_org_id()
                   and b.recorded_by = auth.uid())
    )
  )
  with check (
    auth_is_finance_member()
    and paid_by = auth.uid()
    and exists (select 1 from purchase_bills b
                where b.id = vendor_payments.purchase_bill_id and b.organization_id = auth_org_id())
  );

-- --- expenses -------------------------------------------------------------
alter table expenses enable row level security;

create policy "ceo_full_access_expenses" on expenses
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "finance_lead_full_access_expenses" on expenses
  for all
  using (auth_is_finance_lead() and organization_id = auth_org_id())
  with check (auth_is_finance_lead() and organization_id = auth_org_id());

create policy "finance_exec_own_expenses" on expenses
  for all
  using (auth_is_finance_member() and organization_id = auth_org_id() and recorded_by = auth.uid())
  with check (auth_is_finance_member() and organization_id = auth_org_id() and recorded_by = auth.uid());

-- --- budgets --------------------------------------------------------------
alter table budgets enable row level security;

create policy "ceo_full_access_budgets" on budgets
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "finance_lead_full_access_budgets" on budgets
  for all
  using (auth_is_finance_lead() and organization_id = auth_org_id())
  with check (auth_is_finance_lead() and organization_id = auth_org_id());

create policy "finance_exec_own_budgets" on budgets
  for all
  using (auth_is_finance_member() and organization_id = auth_org_id() and created_by = auth.uid())
  with check (auth_is_finance_member() and organization_id = auth_org_id() and created_by = auth.uid());

-- --- cash_flow_entries ----------------------------------------------------
alter table cash_flow_entries enable row level security;

create policy "ceo_full_access_cash_flow" on cash_flow_entries
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "finance_lead_full_access_cash_flow" on cash_flow_entries
  for all
  using (auth_is_finance_lead() and organization_id = auth_org_id())
  with check (auth_is_finance_lead() and organization_id = auth_org_id());

create policy "finance_exec_own_cash_flow" on cash_flow_entries
  for all
  using (auth_is_finance_member() and organization_id = auth_org_id() and recorded_by = auth.uid())
  with check (auth_is_finance_member() and organization_id = auth_org_id() and recorded_by = auth.uid());

-- --- gst_filings ----------------------------------------------------------
alter table gst_filings enable row level security;

create policy "ceo_full_access_gst_filings" on gst_filings
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "finance_lead_full_access_gst_filings" on gst_filings
  for all
  using (auth_is_finance_lead() and organization_id = auth_org_id())
  with check (auth_is_finance_lead() and organization_id = auth_org_id());

create policy "finance_exec_own_gst_filings" on gst_filings
  for all
  using (auth_is_finance_member() and organization_id = auth_org_id() and prepared_by = auth.uid())
  with check (auth_is_finance_member() and organization_id = auth_org_id() and prepared_by = auth.uid());

-- --- tds_records ----------------------------------------------------------
alter table tds_records enable row level security;

create policy "ceo_full_access_tds_records" on tds_records
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "finance_lead_full_access_tds_records" on tds_records
  for all
  using (auth_is_finance_lead() and organization_id = auth_org_id())
  with check (auth_is_finance_lead() and organization_id = auth_org_id());

create policy "finance_exec_own_tds_records" on tds_records
  for all
  using (auth_is_finance_member() and organization_id = auth_org_id() and recorded_by = auth.uid())
  with check (auth_is_finance_member() and organization_id = auth_org_id() and recorded_by = auth.uid());

-- --- ledger_entries -------------------------------------------------------
alter table ledger_entries enable row level security;

create policy "ceo_full_access_ledger" on ledger_entries
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "finance_lead_full_access_ledger" on ledger_entries
  for all
  using (auth_is_finance_lead() and organization_id = auth_org_id())
  with check (auth_is_finance_lead() and organization_id = auth_org_id());

create policy "finance_exec_own_ledger" on ledger_entries
  for all
  using (auth_is_finance_member() and organization_id = auth_org_id() and recorded_by = auth.uid())
  with check (auth_is_finance_member() and organization_id = auth_org_id() and recorded_by = auth.uid());

-- ===========================================================================
-- Cross-department READ policies (additive, on OTHER modules' tables).
--
-- Finance's job is reconciling data other departments created, so Finance staff need to
-- READ the source records: closed deals and completed installations to raise invoices
-- against, and disbursed subsidies to reconcile. These are additive SELECT policies on
-- those tables — they do NOT touch the owning module's write policies, and they do NOT
-- grant any other department access to Finance's tables (that stays closed).
-- ===========================================================================

-- deal_closures has no organization_id; scope through the lead (auth_lead_in_org, 0005).
create policy "finance_read_deal_closures" on deal_closures
  for select
  using ((auth_is_finance_member() or auth_is_finance_lead()) and auth_lead_in_org(lead_id));

-- installations carry organization_id directly.
create policy "finance_read_installations" on installations
  for select
  using ((auth_is_finance_member() or auth_is_finance_lead()) and organization_id = auth_org_id());

-- subsidy_cases carry organization_id directly; Finance reconciles disbursed subsidy.
create policy "finance_read_subsidy_cases" on subsidy_cases
  for select
  using ((auth_is_finance_member() or auth_is_finance_lead()) and organization_id = auth_org_id());

-- ===========================================================================
-- Narrow cross-department exception: get_invoice_status_for_deal().
--
-- A Sales Executive needs "has my customer paid?" for their OWN deal, without any general
-- Finance access. This SECURITY DEFINER function returns only status/amount/due-date for
-- invoices linked to a deal the caller owns in Sales — it reveals nothing else and does
-- NOT widen the invoices RLS. Ownership = the caller closed the deal (deal_closures.
-- closed_by) or owns the underlying lead's customer relationship. We check closed_by and
-- lead-in-org so a Sales user cannot probe arbitrary deal ids for financial data.
-- ===========================================================================

create or replace function get_invoice_status_for_deal(p_deal_closure_id uuid)
returns table (
  invoice_id     uuid,
  invoice_number text,
  status         text,
  total_amount   numeric,
  due_date       date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owns boolean;
begin
  -- The caller must own this deal: they closed it, or its lead is in their org AND assigned
  -- to them. deal_closures has no org column, so we join to the lead for org + assignment.
  select exists (
    select 1
    from deal_closures dc
    join leads l on l.id = dc.lead_id
    where dc.id = p_deal_closure_id
      and l.organization_id = auth_org_id()
      and (dc.closed_by = auth.uid() or l.assigned_to = auth.uid())
  ) into v_owns;

  if not v_owns then
    raise exception 'You may only check invoice status for your own deal'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select i.id, i.invoice_number, i.status, i.total_amount, i.due_date
    from invoices i
    where i.deal_closure_id = p_deal_closure_id;
end;
$$;

revoke execute on function get_invoice_status_for_deal(uuid) from anon;

-- ===========================================================================
-- record_customer_receipt(): atomic receipt. Insert the receipt, recompute the invoice
-- status from the cumulative receipts vs total_amount, and insert a matching
-- cash_flow_entries inflow row — all in ONE transaction. A partial failure here (receipt
-- recorded but cash flow not updated, or status left stale) is a real bookkeeping bug.
--
-- NOT security definer: it runs as the caller, so the receipt insert, the invoice update,
-- and the cash_flow insert all pass the caller's own RLS (finance_exec_own_* /
-- finance_lead_* / ceo_*). A Finance exec can only do this for an invoice they own; a lead
-- for any. status is derived server-side from total_amount (a generated column), never
-- trusted from the client.
-- ===========================================================================

create or replace function record_customer_receipt(
  p_invoice_id       uuid,
  p_amount_received  numeric,
  p_payment_method   text default null,
  p_reference_number text default null,
  p_received_date    date default current_date
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_receipt_id uuid := gen_random_uuid();
  v_total      numeric(14, 2);
  v_paid       numeric(14, 2);
  v_new_status text;
begin
  if p_amount_received is null or p_amount_received <= 0 then
    raise exception 'Receipt amount must be positive';
  end if;

  -- Reading the invoice under the caller's RLS: if they cannot see it, it is not theirs.
  select total_amount into v_total from invoices where id = p_invoice_id;
  if v_total is null then
    raise exception 'Invoice not found or not visible to you'
      using errcode = 'no_data_found';
  end if;

  insert into receipts (id, invoice_id, amount_received, payment_method, reference_number, received_date, recorded_by)
  values (v_receipt_id, p_invoice_id, p_amount_received, p_payment_method, p_reference_number, p_received_date, auth.uid());

  select coalesce(sum(amount_received), 0) into v_paid from receipts where invoice_id = p_invoice_id;

  v_new_status := case
    when v_paid >= v_total then 'paid'
    when v_paid > 0        then 'partially_paid'
    else 'sent'
  end;

  update invoices set status = v_new_status, updated_at = now()
   where id = p_invoice_id;

  insert into cash_flow_entries (organization_id, entry_type, source, amount, entry_date, linked_receipt_id, recorded_by)
  select i.organization_id, 'inflow', 'customer_payment', p_amount_received, p_received_date, v_receipt_id, auth.uid()
  from invoices i where i.id = p_invoice_id;

  return v_receipt_id;
end;
$$;

revoke execute on function record_customer_receipt(uuid, numeric, text, text, date) from anon;

-- ===========================================================================
-- record_vendor_payment(): the mirror of record_customer_receipt for the payables side.
-- Insert the vendor payment, recompute purchase_bills.status from cumulative payments vs
-- total_amount, and insert a matching cash_flow_entries outflow row — one transaction,
-- caller-run so RLS governs each write.
-- ===========================================================================

create or replace function record_vendor_payment(
  p_purchase_bill_id uuid,
  p_amount_paid      numeric,
  p_payment_method   text default null,
  p_reference_number text default null,
  p_paid_date        date default current_date
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_payment_id uuid := gen_random_uuid();
  v_total      numeric(14, 2);
  v_paid       numeric(14, 2);
  v_new_status text;
begin
  if p_amount_paid is null or p_amount_paid <= 0 then
    raise exception 'Payment amount must be positive';
  end if;

  select total_amount into v_total from purchase_bills where id = p_purchase_bill_id;
  if v_total is null then
    raise exception 'Purchase bill not found or not visible to you'
      using errcode = 'no_data_found';
  end if;

  insert into vendor_payments (id, purchase_bill_id, amount_paid, payment_method, reference_number, paid_date, paid_by)
  values (v_payment_id, p_purchase_bill_id, p_amount_paid, p_payment_method, p_reference_number, p_paid_date, auth.uid());

  select coalesce(sum(amount_paid), 0) into v_paid from vendor_payments where purchase_bill_id = p_purchase_bill_id;

  v_new_status := case
    when v_paid >= v_total then 'paid'
    when v_paid > 0        then 'partially_paid'
    else 'unpaid'
  end;

  update purchase_bills set status = v_new_status, updated_at = now()
   where id = p_purchase_bill_id;

  insert into cash_flow_entries (organization_id, entry_type, source, amount, entry_date, linked_vendor_payment_id, recorded_by)
  select b.organization_id, 'outflow', 'vendor_payment', p_amount_paid, p_paid_date, v_payment_id, auth.uid()
  from purchase_bills b where b.id = p_purchase_bill_id;

  return v_payment_id;
end;
$$;

revoke execute on function record_vendor_payment(uuid, numeric, text, text, date) from anon;

-- ===========================================================================
-- record_expense(): atomic expense. Insert the expense and, for cash-affecting categories,
-- a matching cash_flow_entries outflow row in the same transaction. Caller-run (RLS
-- governs both inserts). source is derived from the category so cash flow stays consistent.
-- ===========================================================================

create or replace function record_expense(
  p_category                text,
  p_amount                  numeric,
  p_description             text default null,
  p_expense_date            date default current_date,
  p_approval_id             uuid default null,
  p_linked_salary_record_id uuid default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_expense_id uuid := gen_random_uuid();
  v_org_id     uuid := auth_org_id();
  v_source     text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Expense amount must be positive';
  end if;

  insert into expenses (id, organization_id, category, description, amount, expense_date, approval_id, linked_salary_record_id, recorded_by)
  values (v_expense_id, v_org_id, p_category, p_description, p_amount, p_expense_date, p_approval_id, p_linked_salary_record_id, auth.uid());

  -- Every recorded expense is a cash outflow. salary_disbursement maps to the 'salary'
  -- cash-flow source so the cash-flow view reflects payroll without reading salary_records.
  v_source := case when p_category = 'salary_disbursement' then 'salary' else 'other' end;

  insert into cash_flow_entries (organization_id, entry_type, source, amount, entry_date, linked_expense_id, recorded_by)
  values (v_org_id, 'outflow', v_source, p_amount, p_expense_date, v_expense_id, auth.uid());

  return v_expense_id;
end;
$$;

revoke execute on function record_expense(text, numeric, text, date, uuid, uuid) from anon;

-- ---------------------------------------------------------------------------
-- Storage: finance-documents (private). Path
-- '{organization_id}/{record_type}/{record_id}/{filename}'. Vendor bills, invoice PDFs,
-- tax backups. Object access mirrors the strict table RLS: CEO + Finance lead manage any
-- object in their org's folder; a Finance exec may manage objects they can reach by org.
-- No other department gets object access.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('finance-documents', 'finance-documents', false)
on conflict (id) do nothing;

-- Parse the leading '{organization_id}/' segment to a uuid, guarded so an off-convention
-- object matches nothing rather than erroring the policy. Mirrors hr_object_employee.
create or replace function finance_object_org(object_name text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare folder text;
begin
  folder := (storage.foldername(object_name))[1];
  if folder is null then return null; end if;
  if folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return folder::uuid;
end;
$$;

create policy "finance_documents_ceo_objects" on storage.objects
  for all
  using (
    bucket_id = 'finance-documents'
    and auth_is_ceo()
    and finance_object_org(name) = auth_org_id()
  )
  with check (
    bucket_id = 'finance-documents'
    and auth_is_ceo()
    and finance_object_org(name) = auth_org_id()
  );

create policy "finance_documents_lead_objects" on storage.objects
  for all
  using (
    bucket_id = 'finance-documents'
    and auth_is_finance_lead()
    and finance_object_org(name) = auth_org_id()
  )
  with check (
    bucket_id = 'finance-documents'
    and auth_is_finance_lead()
    and finance_object_org(name) = auth_org_id()
  );

create policy "finance_documents_member_objects" on storage.objects
  for all
  using (
    bucket_id = 'finance-documents'
    and auth_is_finance_member()
    and finance_object_org(name) = auth_org_id()
  )
  with check (
    bucket_id = 'finance-documents'
    and auth_is_finance_member()
    and finance_object_org(name) = auth_org_id()
  );

-- ---------------------------------------------------------------------------
-- Seed: Finance Manager lead role + module permissions.
--
-- 0002 seeded the Finance department and its 'Finance Executive' role. This adds the lead
-- role, named 'Finance Manager' so auth_is_department_manager()/isDepartmentManager()
-- accept it for CEO task delegation. Idempotent, same shape as 0015.
--
-- Permission split mirrors the access tiers: Finance Manager gets every Finance module
-- including reports (P&L/Balance Sheet); the ordinary Finance Executive gets the
-- operational modules (invoices, purchases, expenses, cash flow, tax, ledger, outstanding)
-- but NOT reports — those stay lead/CEO, matching the page-level gate.
-- ---------------------------------------------------------------------------

do $$
declare
  org_id        uuid;
  fin_dept_id   uuid;
  mgr_role_id   uuid;
  exec_role_id  uuid;
begin
  select id into org_id from organizations where name = 'Solar Pulse';
  if org_id is null then return; end if;

  select id into fin_dept_id from departments where organization_id = org_id and slug = 'finance';
  if fin_dept_id is null then return; end if;

  select id into mgr_role_id from roles where organization_id = org_id and name = 'Finance Manager';
  if mgr_role_id is null then
    insert into roles (organization_id, department_id, name)
    values (org_id, fin_dept_id, 'Finance Manager')
    returning id into mgr_role_id;
  end if;

  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select mgr_role_id, m, true, true, true, false, true, true
  from unnest(array[
    'tasks','approvals','departments',
    'invoices','purchases','expenses','budgets','cash_flow','tax','ledger','outstanding','reports'
  ]) as m
  on conflict (role_id, module) do nothing;

  -- The auto-seeded 'Finance Executive' (0002 names it '<dept.name> Executive'; Finance's
  -- name is exactly 'Finance', so no long-name trap). Operational modules only — NOT
  -- reports, mirroring the lead/CEO-only page gate.
  select id into exec_role_id from roles where organization_id = org_id and name = 'Finance Executive';
  if exec_role_id is not null then
    insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
    select exec_role_id, m, true, true, true, false, false, false
    from unnest(array['invoices','purchases','expenses','budgets','cash_flow','tax','ledger','outstanding']) as m
    on conflict (role_id, module) do nothing;
  end if;
end;
$$;
