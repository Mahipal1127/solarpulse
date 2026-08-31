-- ===========================================================================
-- 0024 — Employee "Applications" + HR attendance made read-only
--
-- TWO changes, both in the HR/self-service space:
--
--  1. A new `applications` table: a free-text application an employee writes to
--     HR, the CEO, or both (leave keeps its own dedicated table + approvals flow;
--     this is the general "I need to write to management" channel). Same tri-tier
--     RLS shape as leave_requests — the author self-submits and self-views; the
--     addressed side (HR members for 'hr'/'both', CEO for 'ceo'/'both') sees and
--     works the inbox. "Working it" here is only marking a lightweight status
--     (submitted -> acknowledged -> closed), not an approvals-table decision, so
--     it stays on this table rather than borrowing the approvals machinery.
--
--  2. Attendance becomes READ-ONLY for HR. HR no longer marks attendance on
--     anyone's behalf — every employee marks their own via the allotted QR (a
--     separate kiosk that writes through the service-role client, bypassing RLS,
--     or via self check-in under employee_own_attendance). So the two HR write
--     policies drop from FOR ALL to FOR SELECT: HR can see the whole org's
--     attendance, but not create or edit it. CEO and employee-self policies are
--     unchanged.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. applications
-- ---------------------------------------------------------------------------

create table applications (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references employees(id) on delete cascade,
  recipient    text not null,              -- 'hr' | 'ceo' | 'both'
  subject      text not null,
  body         text not null,
  status       text not null default 'submitted',  -- 'submitted' | 'acknowledged' | 'closed'
  handled_by   uuid references users(id),  -- who last changed the status
  handled_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index applications_employee_idx on applications (employee_id);
create index applications_recipient_idx on applications (recipient);
create index applications_status_idx on applications (status);

create trigger applications_set_updated_at
  before update on applications
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: applications (org-wide self insert/view + addressed side manages)
-- ---------------------------------------------------------------------------

alter table applications enable row level security;

-- CEO: sees and works every application addressed to the CEO ('ceo' or 'both'),
-- scoped to the CEO's own org. FOR ALL so a status update passes with-check too.
create policy "ceo_manage_applications" on applications
  for all
  using (
    auth_is_ceo()
    and auth_employee_org(employee_id) = auth_org_id()
    and recipient in ('ceo', 'both')
  )
  with check (
    auth_is_ceo()
    and auth_employee_org(employee_id) = auth_org_id()
    and recipient in ('ceo', 'both')
  );

-- HR members: see and work every application addressed to HR ('hr' or 'both').
-- Marking a status is an operational HR write (like recruitment/attendance
-- filing was), open to any HR member — it is not an approvals decision.
create policy "hr_manage_applications" on applications
  for all
  using (
    auth_is_hr_member()
    and auth_employee_org(employee_id) = auth_org_id()
    and recipient in ('hr', 'both')
  )
  with check (
    auth_is_hr_member()
    and auth_employee_org(employee_id) = auth_org_id()
    and recipient in ('hr', 'both')
  );

-- Any employee: view their own applications, whatever the recipient.
create policy "employee_view_own_applications" on applications
  for select
  using (auth_owns_employee(employee_id));

-- Any employee: submit their own, and only as 'submitted'. employee_id is derived
-- server-side from the session, never the body — this with-check backs that.
create policy "employee_submit_own_application" on applications
  for insert
  with check (auth_owns_employee(employee_id) and status = 'submitted');

-- ---------------------------------------------------------------------------
-- 2. Attendance: HR read-only
--
-- Postgres has no "alter policy command", so each FOR ALL policy is dropped and
-- recreated as FOR SELECT. HR keeps full visibility of the org's attendance;
-- the ability to INSERT/UPDATE/DELETE is removed. The employee-self (FOR ALL)
-- and CEO policies are left exactly as they were.
-- ---------------------------------------------------------------------------

drop policy if exists "hr_member_manage_attendance" on attendance_records;

create policy "hr_member_view_attendance" on attendance_records
  for select
  using (auth_is_hr_member() and auth_employee_org(employee_id) = auth_org_id());

drop policy if exists "hr_lead_full_access_attendance" on attendance_records;

create policy "hr_lead_view_attendance" on attendance_records
  for select
  using (auth_is_hr_lead() and auth_employee_org(employee_id) = auth_org_id());
