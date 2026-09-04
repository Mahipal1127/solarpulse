-- =============================================================================
-- Solar Pulse OS — Wipe All Data (preserve CEO + HR Lead logins)
-- =============================================================================
-- WHAT THIS DOES. Empties every data table in the public schema (candidates,
-- employees, salaries, leave, applications, reports, expenses, everything)
-- while leaving the SCHEMA intact and preserving two specific auth users
-- so the CEO and HR Lead can still log in and start fresh. Tables and
-- columns are NOT dropped. All idempotent guards are NOT added — this
-- script is run once on purpose.
--
-- WHAT THIS DOES NOT DO. It does not undo migrations. It does not reseed
-- the org / departments / roles / permissions (0002 still does that). It
-- does not touch the auth.users rows for ceo@solarpulse.in or hr@gmail.com.
-- After running, the two preserved users still authenticate; the
-- onboarding wizard is the only way to populate data again.
--
-- WHY IT IS IRREVERSIBLE. TRUNCATE ... CASCADE removes the data, including
-- audit_logs. After this runs, every past action leaves no trace in the
-- database. The HR Documents storage bucket (hr-documents) is NOT touched
-- by this script — old uploaded files remain in Storage until you delete
-- them from the dashboard or run a separate bucket cleanup.
--
-- WHEN TO USE THIS. A clean slate on a development database. A test
-- environment reset. A staging mirror you want wiped before a fresh demo.
-- NOT a production wipe path — there is no confirmation prompt, no
-- safety record, no recovery. If you need to do this in production, take
-- a full backup first and accept the audit-log loss deliberately.
--
-- HOW TO USE.
--   1. Take a backup of anything you want to keep. There is no undo.
--   2. In the Supabase dashboard, confirm ceo@solarpulse.in and
--      hr@gmail.com exist as auth users (they are the only survivors).
--   3. Paste this file into the SQL editor and run.
--   4. The script prints a before/after summary; spot-check the AFTER
--      "users_preserved" count to be 2.
-- ============================== THE SCRIPT ================================

-- ---------------------------------------------------------------------------
-- Step 1: Snapshot the protected auth user ids BEFORE we truncate. The
-- public.users table has its rows deleted by CASCADE on auth.users, so we
-- capture the ids and reinsert the two user rows after. The auth.users
-- rows themselves are NEVER deleted by this script.
-- ---------------------------------------------------------------------------

create temporary table _wipe_preserved_auth_ids on commit drop as
  select id, email
  from auth.users
  where email in ('ceo@solarpulse.in', 'hr@gmail.com');

-- Fail loud if the operator forgot to create one of the protected users
-- — better to know now than after a destructive run.
do $$
declare
  v_have int := (select count(*) from _wipe_preserved_auth_ids);
  v_ceo  int := (select count(*) from _wipe_preserved_auth_ids where email = 'ceo@solarpulse.in');
  v_hr   int := (select count(*) from _wipe_preserved_auth_ids where email = 'hr@gmail.com');
begin
  if v_have <> 2 or v_ceo = 0 or v_hr = 0 then
    raise exception
      'Wipe refused: expected both ceo@solarpulse.in AND hr@gmail.com in auth.users, found % total (ceo=%, hr=%). Create both first.',
      v_have, v_ceo, v_hr;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Step 2: BEFORE snapshot. Counts per table so you can verify afterwards
-- that the wipe actually removed what you expected.
-- ---------------------------------------------------------------------------

select 'BEFORE' as snapshot_phase, 'users' as table_name, count(*) as rows from users
union all select 'BEFORE', 'employees',         count(*) from employees
union all select 'BEFORE', 'leave_requests',    count(*) from leave_requests
union all select 'BEFORE', 'attendance_records',count(*) from attendance_records
union all select 'BEFORE', 'salary_records',    count(*) from salary_records
union all select 'BEFORE', 'performance_kpis',  count(*) from performance_kpis
union all select 'BEFORE', 'appraisals',        count(*) from appraisals
union all select 'BEFORE', 'applications',     count(*) from applications
union all select 'BEFORE', 'employee_reports',  count(*) from employee_reports
union all select 'BEFORE', 'employee_documents',count(*) from employee_documents
union all select 'BEFORE', 'candidates',       count(*) from candidates
union all select 'BEFORE', 'tasks',             count(*) from tasks
union all select 'BEFORE', 'tasks' as table_name, (select count(*) from tasks) where false = false
union all select 'BEFORE', 'audit_logs',        count(*) from audit_logs
order by table_name;

-- ---------------------------------------------------------------------------
-- Step 3: The wipe. TRUNCATE ... CASCADE follows FK chains so dependent
-- rows in referencing tables are removed in the same call. The two
-- protected auth.users rows are not touched. The company_details,
-- organization, departments, and roles rows are also dropped here because
-- the only FKs into them are from data tables — re-seed is via 0002
-- after this script.
--
-- CASCADE order matters: tables that others depend on come last. The
-- explicit list removes the ambiguity of "TRUNCATE the whole schema" and
-- keeps the policy and function definitions intact (TRUNCATE only
-- removes rows, not policies / triggers / functions).
-- ---------------------------------------------------------------------------

truncate table
  applications,
  appraisals,
  employee_documents,
  employee_reports,
  performance_kpis,
  salary_records,
  attendance_records,
  leave_requests,
  interviews,
  candidates,
  tasks,
  task_updates,
  task_attachments,
  approvals,
  -- Finance + Accounts
  invoices, receipts, purchase_bills, vendor_payments,
  expenses, budgets, cash_flow_entries, gst_filings, tds_records, ledger_entries,
  -- Sales
  leads, customers, follow_ups, site_visit_requests, quotations, proposals,
  deal_closures, sales_targets,
  -- Distribution
  vendors, purchase_orders, purchase_order_items,
  material_dispatches, material_dispatch_items,
  material_allocations, material_returns,
  document_counters,
  -- Technical
  site_surveys, survey_photos, designs, generation_reports,
  it_support_tickets, data_backup_logs,
  -- O&M
  installations, installation_team_members, installation_progress_updates,
  installation_photos, installation_checklists, final_inspections,
  completion_reports, service_tickets, service_reports, performance_logs,
  amc_contracts, amc_visits,
  -- DISCOM (0013 — table names are *_status_history, not *_history)
  net_metering_applications, net_metering_status_history,
  subsidy_cases, subsidy_status_history,
  government_documents, consumer_verifications,
  -- Marketing (0014)
  content_calendar_items, content_posts, content_assets, campaigns, brand_profiles,
  -- Store (0017)
  stores, store_inventory_items, store_inventory_movements, store_inventory_returns,
  -- Instagram audit (0020)
  instagram_audit_runs, instagram_audit_findings, instagram_audit_actions,
  -- Marketing AI creative (0021)
  marketing_creative_runs, marketing_creative_assets,
  -- HR record
  exits,
  -- Employees last (no other table FKs into employees in a destructive
  -- direction; public.users still references employees via the auth id).
  employees
restart identity cascade;

-- ---------------------------------------------------------------------------
-- Step 4: Reinsert the two protected users. Their public.users rows were
-- removed by CASCADE when auth.users CASCADE was not (we only truncated
-- data tables, not auth.users). Re-create their public.users rows with
-- the same shape 0002 / 0004 would have produced. The role and department
-- FKs are looked up at runtime; if either role is missing the script
-- halts with a clear error.
-- ---------------------------------------------------------------------------

do $$
declare
  v_ceo_id uuid;
  v_hr_id  uuid;
  v_org_id uuid;
  v_hr_dept_id uuid;
  v_ceo_role_id uuid;
  v_hr_role_id uuid;
begin
  select id into v_ceo_id from _wipe_preserved_auth_ids where email = 'ceo@solarpulse.in';
  select id into v_hr_id  from _wipe_preserved_auth_ids where email = 'hr@gmail.com';

  select id into v_org_id from organizations where name = 'Solar Pulse';
  if v_org_id is null then
    raise exception 'Solar Pulse organisation not found — run migration 0002 first.';
  end if;

  select id into v_hr_dept_id from departments where organization_id = v_org_id and slug = 'hr';
  select id into v_ceo_role_id from roles where organization_id = v_org_id and name = 'CEO';
  select id into v_hr_role_id from roles where organization_id = v_org_id and name in ('HR Manager', 'HR Lead');

  if v_ceo_role_id is null then
    raise exception 'Role "CEO" not found — run migration 0002 first.';
  end if;
  if v_hr_role_id is null then
    raise exception 'Role "HR Manager" (or "HR Lead") not found — run migration 0015 first.';
  end if;
  if v_hr_dept_id is null then
    raise exception 'Department "hr" not found — run migration 0002 first.';
  end if;

  insert into users (id, organization_id, department_id, role_id, full_name, email, is_active)
  values (v_ceo_id, v_org_id, null, v_ceo_role_id, 'Solar CEO', 'ceo@solarpulse.in', true);

  insert into users (id, organization_id, department_id, role_id, full_name, email, is_active)
  values (v_hr_id, v_org_id, v_hr_dept_id, v_hr_role_id, 'HR Lead', 'hr@gmail.com', true);
end
$$;

-- ---------------------------------------------------------------------------
-- Step 5: AFTER snapshot. Every data table should be 0. The protected
-- users count should be 2. If anything here is non-zero that you did
-- not expect, the wipe was partial and the next query tells you what
-- remains.
-- ---------------------------------------------------------------------------

select 'AFTER' as snapshot_phase, 'users' as table_name, count(*) as rows from users
union all select 'AFTER', 'employees',         count(*) from employees
union all select 'AFTER', 'leave_requests',    count(*) from leave_requests
union all select 'AFTER', 'attendance_records',count(*) from attendance_records
union all select 'AFTER', 'salary_records',    count(*) from salary_records
union all select 'AFTER', 'performance_kpis',  count(*) from performance_kpis
union all select 'AFTER', 'appraisals',        count(*) from appraisals
union all select 'AFTER', 'applications',     count(*) from applications
union all select 'AFTER', 'employee_reports',  count(*) from employee_reports
union all select 'AFTER', 'employee_documents',count(*) from employee_documents
union all select 'AFTER', 'candidates',       count(*) from candidates
union all select 'AFTER', 'tasks',             count(*) from tasks
union all select 'AFTER', 'audit_logs',        count(*) from audit_logs
order by table_name;

-- The two preserved users, so you can sign in and start fresh.
select id, email, full_name, is_active
from users
where email in ('ceo@solarpulse.in', 'hr@gmail.com')
order by email;

-- ============================== END OF SCRIPT =============================
-- After the AFTER snapshot shows zeros across the data tables and 2
-- preserved users, the system is back to "fresh, with two login-able
-- accounts." Sign in as the CEO and onboard everyone else from
-- /hr/onboarding/new.
--
-- The HR Documents storage bucket is NOT touched. Old uploaded photos,
-- ID cards, and onboarding documents remain in Storage until you delete
-- them from the Supabase dashboard or run a separate bucket-cleanup
-- script. If you want a fully empty bucket, do that manually before or
-- after this script.
