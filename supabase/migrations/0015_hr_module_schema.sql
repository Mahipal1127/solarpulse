-- Solar Pulse OS
-- 0015 — HR department module
--
-- The most sensitive module in the system. Beyond the three tiers every prior module
-- used (CEO full / department lead full / individual own-only), HR needs a FOURTH,
-- tighter tier for compensation and performance data:
--
--   salary_records, appraisals, exits  →  CEO + HR LEAD only for anyone else's row;
--                                          an ordinary employee may READ their own and
--                                          nothing more; NO department-wide access for
--                                          regular ("HR Executive") staff.
--
-- This is deliberately NOT the "executive sees only own leads" scope pattern from
-- Sales. There, a wider view aids coordination. Here, a colleague's salary is never
-- appropriate for another regular employee — HR or otherwise — so the restriction is
-- about SENSITIVITY, not ownership scope. Do not collapse it into the standard tier.
--
-- Recruitment, attendance, and (non-salary) leave/KPI data use the standard three-tier
-- pattern, because any HR staff member operationally needs them.
--
-- KEY FACTS this migration is built on (verified against the existing schema):
--   * employees links to a user via employees.user_id (FK → users.id), NOT via
--     employees.id. Every self-scoping check goes through user_id = auth.uid().
--   * The HR department row (slug 'hr', name 'HR') is already seeded in 0002, which
--     also created the 'HR Executive' role. This migration must NOT re-insert the
--     department; it adds the 'HR Manager' lead role + permissions.
--   * The lead role is named 'HR Manager' (ends in "Manager") so
--     auth_is_department_manager() (0006) and isDepartmentManager() (guards.ts) accept
--     it for CEO task delegation. auth_is_hr_lead() below also honours 'HR Lead'.
--   * approvals (0001) has columns (type, requested_by, department_id, amount,
--     description, status, ...); 'leave' is a valid approval_type. It has NO source-FK,
--     so leave_requests carries an approval_id back-link instead.

-- ---------------------------------------------------------------------------
-- Extend the existing employees stub (0001). Idempotent column adds.
-- ---------------------------------------------------------------------------

alter table employees add column if not exists employee_code      text unique;
alter table employees add column if not exists phone              text;
alter table employees add column if not exists emergency_contact  text;
alter table employees add column if not exists employment_status  text not null default 'active';
  -- 'active' | 'on_leave' | 'exited'

-- ---------------------------------------------------------------------------
-- Tables
--
-- Statuses stay as text with a documented value list rather than enums — the same
-- choice the recent modules made, so a growing HR team can rename a stage without a
-- type migration.
-- ---------------------------------------------------------------------------

-- Recruitment: simple records, not an ATS/sourcing pipeline.
create table candidates (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references organizations(id) on delete cascade,
  name                      text not null,
  phone                     text,
  email                     text,
  applied_for_department_id uuid references departments(id) on delete set null,
  applied_for_role          text,
  resume_file_path          text,
  -- 'applied' | 'screening' | 'interview_scheduled' | 'offered' | 'hired' | 'rejected'
  status                    text not null default 'applied',
  source                    text,   -- 'referral' | 'job_portal' | 'walk_in' | 'other'
  added_by                  uuid not null references users(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index candidates_org_status_idx on candidates (organization_id, status);
create index candidates_added_by_idx    on candidates (added_by);

create table interviews (
  id             uuid primary key default gen_random_uuid(),
  candidate_id   uuid not null references candidates(id) on delete cascade,
  scheduled_date timestamptz,
  interviewer_id uuid references users(id) on delete set null,
  round          text,   -- 'screening' | 'technical' | 'final'
  result         text not null default 'pending',  -- 'pending' | 'passed' | 'failed'
  feedback       text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index interviews_candidate_idx   on interviews (candidate_id);
create index interviews_interviewer_idx  on interviews (interviewer_id, scheduled_date);

-- Employee documents. Scoped through employee_id. Sensitivity varies by document_type
-- (an offer_letter/contract is more sensitive than an id_proof), so the RLS keeps
-- these to CEO + HR lead + the employee themselves — no blanket HR-member read.
create table employee_documents (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id) on delete cascade,
  -- 'id_proof' | 'address_proof' | 'offer_letter' | 'contract' | 'exit_letter' | 'other'
  document_type text not null,
  file_path     text not null,   -- hr-documents bucket, '{employee_id}/{filename}'
  file_name     text not null,
  uploaded_by   uuid not null references users(id),
  created_at    timestamptz not null default now()
);

create index employee_documents_employee_idx on employee_documents (employee_id);

-- Exit records. Inserting one also flips employees.employment_status = 'exited' and
-- users.is_active = false — done atomically in process_employee_exit() below, never
-- as three separate client calls.
create table exits (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references employees(id) on delete cascade,
  exit_date    date not null,
  reason       text,
  exit_type    text,   -- 'resignation' | 'termination' | 'end_of_contract'
  notes        text,
  processed_by uuid not null references users(id),
  created_at   timestamptz not null default now()
);

create index exits_employee_idx on exits (employee_id);

-- Attendance. Marked in-app (self check-in/out) or by HR (marked_by set). One row per
-- employee per day. No biometric/device sync.
create table attendance_records (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  date        date not null,
  check_in    timestamptz,
  check_out   timestamptz,
  -- 'present' | 'absent' | 'half_day' | 'on_leave' | 'holiday'
  status      text not null default 'present',
  marked_by   uuid references users(id),  -- null when self-marked, set when HR marked it
  created_at  timestamptz not null default now(),
  unique (employee_id, date)
);

create index attendance_records_employee_date_idx on attendance_records (employee_id, date);
create index attendance_records_date_idx           on attendance_records (date);

-- Leave requests. Written by EVERY employee org-wide, not just HR. Each submission also
-- creates a linked approvals row (type 'leave') via submit_leave_request(); approval_id
-- is that back-link (approvals itself has no source-FK). Deciding the approval
-- propagates status here via decideApproval() in lib/services/approvals.ts.
create table leave_requests (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  leave_type  text not null,   -- 'casual' | 'sick' | 'earned' | 'unpaid'
  start_date  date not null,
  end_date    date not null,
  reason      text,
  status      text not null default 'pending',  -- 'pending' | 'approved' | 'rejected'
  approval_id uuid references approvals(id) on delete set null,
  approved_by uuid references users(id),
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index leave_requests_employee_idx on leave_requests (employee_id);
create index leave_requests_status_idx    on leave_requests (status);
create index leave_requests_approval_idx   on leave_requests (approval_id);

-- Salary. net_payable is a GENERATED column so it can never drift from the parts.
-- Produces the record + payslip; actual disbursement is a Finance/banking action
-- outside this system.
create table salary_records (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references employees(id) on delete cascade,
  effective_month date not null,   -- first of the month this applies to
  base_salary     numeric(14, 2) not null,
  bonus           numeric(14, 2) not null default 0,
  incentives      numeric(14, 2) not null default 0,
  deductions      numeric(14, 2) not null default 0,
  net_payable     numeric(14, 2) generated always as
                    (base_salary + bonus + incentives - deductions) stored,
  status          text not null default 'draft',  -- 'draft' | 'finalized' | 'paid'
  processed_by    uuid not null references users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (employee_id, effective_month)
);

create index salary_records_employee_idx on salary_records (employee_id, effective_month desc);
create index salary_records_month_idx     on salary_records (effective_month);

-- Performance KPIs. Set by HR lead / CEO; the employee reads their own.
create table performance_kpis (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references employees(id) on delete cascade,
  period_start    date not null,
  period_end      date not null,
  kpi_description text not null,
  target_value    text,
  actual_value    text,
  status          text not null default 'in_progress',  -- 'in_progress' | 'met' | 'not_met'
  set_by          uuid not null references users(id),
  created_at      timestamptz not null default now()
);

create index performance_kpis_employee_idx on performance_kpis (employee_id);

-- Appraisals. A single record per review period, not a workflow engine. Same restricted
-- visibility as salary.
create table appraisals (
  id                   uuid primary key default gen_random_uuid(),
  employee_id          uuid not null references employees(id) on delete cascade,
  review_period        text not null,   -- 'H1 2026', 'Q3 2026', ...
  rating               text,
  strengths            text,
  areas_of_improvement text,
  reviewed_by          uuid not null references users(id),
  reviewed_at          timestamptz not null default now(),
  created_at           timestamptz not null default now()
);

create index appraisals_employee_idx on appraisals (employee_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers, reusing set_updated_at() from 0001. Only the tables with a
-- mutable lifecycle carry updated_at (documents, exits, attendance, kpis, appraisals
-- are append-only facts).
-- ---------------------------------------------------------------------------

create trigger candidates_set_updated_at
  before update on candidates
  for each row execute function set_updated_at();

create trigger interviews_set_updated_at
  before update on interviews
  for each row execute function set_updated_at();

create trigger leave_requests_set_updated_at
  before update on leave_requests
  for each row execute function set_updated_at();

create trigger salary_records_set_updated_at
  before update on salary_records
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helpers, mirroring the per-module pattern from 0014.
-- ---------------------------------------------------------------------------

-- Any active member of the HR department.
create or replace function auth_is_hr_member()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join departments d on d.id = u.department_id
    where u.id = auth.uid() and u.is_active and d.slug = 'hr'
  );
$$;

-- The HR lead tier. Honours 'HR Manager' (the seeded role) and 'HR Lead' (a hand-made
-- role), same belt-and-suspenders as auth_is_marketing_lead() in 0014.
create or replace function auth_is_hr_lead()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join roles r on r.id = u.role_id
    join departments d on d.id = u.department_id
    where u.id = auth.uid() and u.is_active
      and d.slug = 'hr'
      and r.name in ('HR Manager', 'HR Lead')
  );
$$;

-- Is p_employee_id the caller's OWN employees row? The self tier for salary/appraisal/
-- KPI/attendance/leave keys off this (employees.user_id = auth.uid()).
create or replace function auth_owns_employee(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from employees e
    where e.id = p_employee_id and e.user_id = auth.uid()
  );
$$;

-- The employee row's organization, for org-scoping HR-lead policies (HR data is keyed
-- by employee_id, and employees has no organization_id column of its own).
create or replace function auth_employee_org(p_employee_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$
  select u.organization_id
  from employees e join users u on u.id = e.user_id
  where e.id = p_employee_id;
$$;

-- ---------------------------------------------------------------------------
-- RLS: employees (extend the 0001 policy set)
--
-- 0001 gave employees only ceo_full_access_employees + members_view_own_employee_row.
-- HR needs to manage the roster, so add HR-lead-full and HR-member-view. These are the
-- non-sensitive personnel fields (designation, code, phone, reporting line); pay and
-- appraisal live in their own tables under the stricter four-tier RLS. RLS is enabled
-- on this table already (0001) — only policies are added here.
--
-- Note: INSERT of an employees row (onboarding) and the users row behind it is NOT
-- granted to HR here — it runs through hireEmployee() in the service layer on the
-- service-role client behind a CEO/HR-lead guard, because creating a login account is a
-- privileged action the users-table RLS deliberately keeps to the CEO. Deactivation
-- likewise goes through process_employee_exit(). What HR gets here is read + edit of
-- existing personnel fields.
-- ---------------------------------------------------------------------------

create policy "hr_lead_full_access_employees" on employees
  for all
  using (auth_is_hr_lead() and auth_employee_org(id) = auth_org_id())
  with check (auth_is_hr_lead() and auth_employee_org(id) = auth_org_id());

create policy "hr_member_view_employees" on employees
  for select
  using (auth_is_hr_member() and auth_employee_org(id) = auth_org_id());

-- ---------------------------------------------------------------------------
-- RLS: candidates + interviews (standard three-tier, recruitment is operational)
-- ---------------------------------------------------------------------------

alter table candidates enable row level security;

create policy "ceo_full_access_candidates" on candidates
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "hr_lead_full_access_candidates" on candidates
  for all
  using (auth_is_hr_lead() and organization_id = auth_org_id())
  with check (auth_is_hr_lead() and organization_id = auth_org_id());

-- An HR member manages candidates they added.
create policy "hr_member_own_candidates" on candidates
  for all
  using (auth_is_hr_member() and organization_id = auth_org_id() and added_by = auth.uid())
  with check (auth_is_hr_member() and organization_id = auth_org_id() and added_by = auth.uid());

alter table interviews enable row level security;

create policy "ceo_full_access_interviews" on interviews
  for all
  using (auth_is_ceo() and exists (
    select 1 from candidates c where c.id = interviews.candidate_id and c.organization_id = auth_org_id()))
  with check (auth_is_ceo() and exists (
    select 1 from candidates c where c.id = interviews.candidate_id and c.organization_id = auth_org_id()));

create policy "hr_lead_full_access_interviews" on interviews
  for all
  using (auth_is_hr_lead() and exists (
    select 1 from candidates c where c.id = interviews.candidate_id and c.organization_id = auth_org_id()))
  with check (auth_is_hr_lead() and exists (
    select 1 from candidates c where c.id = interviews.candidate_id and c.organization_id = auth_org_id()));

-- An HR member sees/edits interviews they conduct, or those on a candidate they added.
create policy "hr_member_own_interviews" on interviews
  for all
  using (
    auth_is_hr_member()
    and (
      interviewer_id = auth.uid()
      or exists (select 1 from candidates c
                 where c.id = interviews.candidate_id
                   and c.organization_id = auth_org_id()
                   and c.added_by = auth.uid())
    )
  )
  with check (
    auth_is_hr_member()
    and exists (select 1 from candidates c
                where c.id = interviews.candidate_id and c.organization_id = auth_org_id())
  );

-- ---------------------------------------------------------------------------
-- RLS: employee_documents (CEO + HR lead + the employee themselves; no blanket member)
-- ---------------------------------------------------------------------------

alter table employee_documents enable row level security;

create policy "ceo_full_access_employee_documents" on employee_documents
  for all
  using (auth_is_ceo() and auth_employee_org(employee_id) = auth_org_id())
  with check (auth_is_ceo() and auth_employee_org(employee_id) = auth_org_id());

create policy "hr_lead_full_access_employee_documents" on employee_documents
  for all
  using (auth_is_hr_lead() and auth_employee_org(employee_id) = auth_org_id())
  with check (auth_is_hr_lead() and auth_employee_org(employee_id) = auth_org_id());

create policy "employee_view_own_documents" on employee_documents
  for select
  using (auth_owns_employee(employee_id));

-- ---------------------------------------------------------------------------
-- RLS: attendance_records (org-wide self + HR lead + CEO)
--
-- Every employee, whatever department, may see and mark their OWN attendance — this is
-- the company-wide personal surface, like the check-in button. HR lead and CEO see the
-- whole org's for the overview.
-- ---------------------------------------------------------------------------

alter table attendance_records enable row level security;

create policy "ceo_full_access_attendance" on attendance_records
  for all
  using (auth_is_ceo() and auth_employee_org(employee_id) = auth_org_id())
  with check (auth_is_ceo() and auth_employee_org(employee_id) = auth_org_id());

create policy "hr_lead_full_access_attendance" on attendance_records
  for all
  using (auth_is_hr_lead() and auth_employee_org(employee_id) = auth_org_id())
  with check (auth_is_hr_lead() and auth_employee_org(employee_id) = auth_org_id());

-- HR members mark attendance for others (field staff without app access that day).
create policy "hr_member_manage_attendance" on attendance_records
  for all
  using (auth_is_hr_member() and auth_employee_org(employee_id) = auth_org_id())
  with check (auth_is_hr_member() and auth_employee_org(employee_id) = auth_org_id());

-- Any employee: their own row (self check-in/out).
create policy "employee_own_attendance" on attendance_records
  for all
  using (auth_owns_employee(employee_id))
  with check (auth_owns_employee(employee_id));

-- ---------------------------------------------------------------------------
-- RLS: leave_requests (org-wide self insert/view + HR lead + CEO)
-- ---------------------------------------------------------------------------

alter table leave_requests enable row level security;

create policy "ceo_full_access_leave" on leave_requests
  for all
  using (auth_is_ceo() and auth_employee_org(employee_id) = auth_org_id())
  with check (auth_is_ceo() and auth_employee_org(employee_id) = auth_org_id());

create policy "hr_lead_full_access_leave" on leave_requests
  for all
  using (auth_is_hr_lead() and auth_employee_org(employee_id) = auth_org_id())
  with check (auth_is_hr_lead() and auth_employee_org(employee_id) = auth_org_id());

-- HR members may see the whole queue (they process leave), but the DECISION is an
-- approvals-table action restricted to lead/CEO — this only grants visibility here.
create policy "hr_member_view_leave" on leave_requests
  for select
  using (auth_is_hr_member() and auth_employee_org(employee_id) = auth_org_id());

-- Any employee: view and submit their own. The submit path is submit_leave_request(),
-- which runs as the caller — this with-check admits that insert.
create policy "employee_own_leave" on leave_requests
  for select
  using (auth_owns_employee(employee_id));

create policy "employee_submit_own_leave" on leave_requests
  for insert
  with check (auth_owns_employee(employee_id) and status = 'pending');

-- ---------------------------------------------------------------------------
-- RLS: salary_records — STRICTER FOUR-TIER. CEO + HR lead full; employee READ-ONLY
-- own; NO department-wide member access. A regular HR Executive cannot see anyone
-- else's pay. This is the acceptance-critical policy set.
-- ---------------------------------------------------------------------------

alter table salary_records enable row level security;

create policy "ceo_full_access_salary" on salary_records
  for all
  using (auth_is_ceo() and auth_employee_org(employee_id) = auth_org_id())
  with check (auth_is_ceo() and auth_employee_org(employee_id) = auth_org_id());

create policy "hr_lead_full_access_salary" on salary_records
  for all
  using (auth_is_hr_lead() and auth_employee_org(employee_id) = auth_org_id())
  with check (auth_is_hr_lead() and auth_employee_org(employee_id) = auth_org_id());

-- The employee may READ their own pay, never write it. No insert/update/delete policy
-- for them, and deliberately none for ordinary HR members.
create policy "employee_view_own_salary" on salary_records
  for select
  using (auth_owns_employee(employee_id));

-- ---------------------------------------------------------------------------
-- RLS: appraisals — STRICTER FOUR-TIER, same shape as salary.
-- ---------------------------------------------------------------------------

alter table appraisals enable row level security;

create policy "ceo_full_access_appraisals" on appraisals
  for all
  using (auth_is_ceo() and auth_employee_org(employee_id) = auth_org_id())
  with check (auth_is_ceo() and auth_employee_org(employee_id) = auth_org_id());

create policy "hr_lead_full_access_appraisals" on appraisals
  for all
  using (auth_is_hr_lead() and auth_employee_org(employee_id) = auth_org_id())
  with check (auth_is_hr_lead() and auth_employee_org(employee_id) = auth_org_id());

create policy "employee_view_own_appraisals" on appraisals
  for select
  using (auth_owns_employee(employee_id));

-- ---------------------------------------------------------------------------
-- RLS: exits — STRICTER FOUR-TIER (view side). Writes go through
-- process_employee_exit() (security definer, guarded internally), so only CEO + HR
-- lead read arbitrary rows; the employee may read their own exit record.
-- ---------------------------------------------------------------------------

alter table exits enable row level security;

create policy "ceo_full_access_exits" on exits
  for all
  using (auth_is_ceo() and auth_employee_org(employee_id) = auth_org_id())
  with check (auth_is_ceo() and auth_employee_org(employee_id) = auth_org_id());

create policy "hr_lead_full_access_exits" on exits
  for all
  using (auth_is_hr_lead() and auth_employee_org(employee_id) = auth_org_id())
  with check (auth_is_hr_lead() and auth_employee_org(employee_id) = auth_org_id());

create policy "employee_view_own_exit" on exits
  for select
  using (auth_owns_employee(employee_id));

-- ---------------------------------------------------------------------------
-- RLS: performance_kpis — CEO + HR lead full; employee reads own. (Set by lead/CEO;
-- expanding to department leads later is easy, restricting after the fact is not.)
-- ---------------------------------------------------------------------------

alter table performance_kpis enable row level security;

create policy "ceo_full_access_kpis" on performance_kpis
  for all
  using (auth_is_ceo() and auth_employee_org(employee_id) = auth_org_id())
  with check (auth_is_ceo() and auth_employee_org(employee_id) = auth_org_id());

create policy "hr_lead_full_access_kpis" on performance_kpis
  for all
  using (auth_is_hr_lead() and auth_employee_org(employee_id) = auth_org_id())
  with check (auth_is_hr_lead() and auth_employee_org(employee_id) = auth_org_id());

create policy "employee_view_own_kpis" on performance_kpis
  for select
  using (auth_owns_employee(employee_id));

-- ---------------------------------------------------------------------------
-- Storage: hr-documents (private). Path '{employee_id}/{filename}'. Payroll/exit and
-- personal docs are sensitive, so object access mirrors the stricter table RLS: CEO +
-- HR lead manage any; the employee may READ their own folder. No blanket HR-member
-- object access.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('hr-documents', 'hr-documents', false)
on conflict (id) do nothing;

-- Parse the leading '{employee_id}/' segment to a uuid, guarded so an off-convention
-- object matches nothing rather than erroring the policy. Mirrors marketing_object_item.
create or replace function hr_object_employee(object_name text)
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

create policy "hr_documents_ceo_objects" on storage.objects
  for all
  using (
    bucket_id = 'hr-documents'
    and auth_is_ceo()
    and auth_employee_org(hr_object_employee(name)) = auth_org_id()
  )
  with check (
    bucket_id = 'hr-documents'
    and auth_is_ceo()
    and auth_employee_org(hr_object_employee(name)) = auth_org_id()
  );

create policy "hr_documents_lead_objects" on storage.objects
  for all
  using (
    bucket_id = 'hr-documents'
    and auth_is_hr_lead()
    and auth_employee_org(hr_object_employee(name)) = auth_org_id()
  )
  with check (
    bucket_id = 'hr-documents'
    and auth_is_hr_lead()
    and auth_employee_org(hr_object_employee(name)) = auth_org_id()
  );

create policy "hr_documents_employee_read_own" on storage.objects
  for select
  using (
    bucket_id = 'hr-documents'
    and auth_owns_employee(hr_object_employee(name))
  );

-- ---------------------------------------------------------------------------
-- process_employee_exit(): atomic exit. Insert the exits row, flip
-- employees.employment_status = 'exited', and deactivate users.is_active = false — all
-- or nothing. A half-completed exit (record made but account still active, or vice
-- versa) is a real security/payroll risk, not just a data blip.
--
-- SECURITY DEFINER with an INTERNAL guard: deactivating ANOTHER user's row is beyond
-- HR-lead RLS on users (members_update_own_user is self-only, and broadening that
-- table's RLS would leak across every module). So this runs as owner but refuses
-- anyone who is not CEO or HR lead — the guard is the access control, RLS is bypassed
-- only for this one narrow, audited operation.
-- ---------------------------------------------------------------------------

create or replace function process_employee_exit(
  p_employee_id uuid,
  p_exit_date   date,
  p_exit_type   text default null,
  p_reason      text default null,
  p_notes       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exit_id uuid := gen_random_uuid();
  v_user_id uuid;
  v_org_id  uuid := auth_org_id();
begin
  if not (auth_is_ceo() or auth_is_hr_lead()) then
    raise exception 'Only the CEO or an HR lead may process an exit'
      using errcode = 'insufficient_privilege';
  end if;

  select e.user_id into v_user_id
  from employees e join users u on u.id = e.user_id
  where e.id = p_employee_id and u.organization_id = v_org_id;

  if v_user_id is null then
    raise exception 'Employee not found or not in your organization'
      using errcode = 'no_data_found';
  end if;

  insert into exits (id, employee_id, exit_date, reason, exit_type, notes, processed_by)
  values (v_exit_id, p_employee_id, p_exit_date, p_reason, p_exit_type, p_notes, auth.uid());

  update employees set employment_status = 'exited', updated_at = now()
   where id = p_employee_id;

  update users set is_active = false, updated_at = now()
   where id = v_user_id;

  return v_exit_id;
end;
$$;

revoke execute on function process_employee_exit(uuid, date, text, text, text) from anon;

-- ---------------------------------------------------------------------------
-- submit_leave_request(): atomic leave submission. Insert the leave_requests row AND a
-- linked approvals row (type 'leave'), then stamp the approval_id back onto the leave
-- row. NOT security definer — it runs as the caller so both inserts pass RLS
-- (employee_submit_own_leave + department_create_approvals), and an employee can only
-- ever file their own. Splitting this across client calls risks a leave row with no
-- approval, or an approval with no leave — the close_deal()/create_marketing_lead()
-- precedent.
-- ---------------------------------------------------------------------------

create or replace function submit_leave_request(
  p_employee_id uuid,
  p_leave_type  text,
  p_start_date  date,
  p_end_date    date,
  p_reason      text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_leave_id    uuid := gen_random_uuid();
  v_approval_id uuid := gen_random_uuid();
  v_org_id      uuid := auth_org_id();
  v_dept_id     uuid := auth_department_id();
begin
  if not auth_owns_employee(p_employee_id) then
    raise exception 'You may only file leave for yourself'
      using errcode = 'insufficient_privilege';
  end if;
  if p_end_date < p_start_date then
    raise exception 'Leave end date cannot be before the start date';
  end if;

  -- The linked approval, so the request surfaces on the CEO's existing Approvals page
  -- (and any lead queue) rather than a second, parallel mechanism. department_id is the
  -- requester's own department — a leave request belongs to whoever filed it.
  insert into approvals (id, organization_id, type, requested_by, department_id, description, status)
  values (v_approval_id, v_org_id, 'leave', auth.uid(), v_dept_id,
          format('Leave: %s (%s to %s)', p_leave_type, p_start_date, p_end_date), 'pending');

  insert into leave_requests (id, employee_id, leave_type, start_date, end_date, reason, status, approval_id)
  values (v_leave_id, p_employee_id, p_leave_type, p_start_date, p_end_date, p_reason, 'pending', v_approval_id);

  return v_leave_id;
end;
$$;

revoke execute on function submit_leave_request(uuid, text, date, date, text) from anon;

-- ---------------------------------------------------------------------------
-- Seed: HR Manager lead role + module permissions.
--
-- 0002 seeded the HR department and its 'HR Executive' role. This adds the lead role,
-- named 'HR Manager' so auth_is_department_manager()/isDepartmentManager() accept it.
-- Idempotent, same shape as 0014.
--
-- The permission split enforces the sensitivity tier: HR Manager gets payroll +
-- performance; the ordinary HR Executive gets recruitment/attendance/leave (operational
-- work) but NOT payroll or performance — matching the RLS above.
-- ---------------------------------------------------------------------------

do $$
declare
  org_id       uuid;
  hr_dept_id   uuid;
  mgr_role_id  uuid;
  exec_role_id uuid;
begin
  select id into org_id from organizations where name = 'Solar Pulse';
  if org_id is null then return; end if;

  select id into hr_dept_id from departments where organization_id = org_id and slug = 'hr';
  if hr_dept_id is null then return; end if;

  select id into mgr_role_id from roles where organization_id = org_id and name = 'HR Manager';
  if mgr_role_id is null then
    insert into roles (organization_id, department_id, name)
    values (org_id, hr_dept_id, 'HR Manager')
    returning id into mgr_role_id;
  end if;

  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select mgr_role_id, m, true, true, true, false, true, true
  from unnest(array[
    'tasks','approvals','departments',
    'recruitment','employees','attendance','leave','payroll','performance'
  ]) as m
  on conflict (role_id, module) do nothing;

  -- The auto-seeded 'HR Executive' (0002 names it '<dept.name> Executive'; HR's name is
  -- exactly 'HR', so no long-name trap). Operational modules only — NOT payroll or
  -- performance, mirroring the stricter RLS tier.
  select id into exec_role_id from roles where organization_id = org_id and name = 'HR Executive';
  if exec_role_id is not null then
    insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
    select exec_role_id, m, true, true, true, false, false, false
    from unnest(array['recruitment','employees','attendance','leave']) as m
    on conflict (role_id, module) do nothing;
  end if;
end;
$$;
