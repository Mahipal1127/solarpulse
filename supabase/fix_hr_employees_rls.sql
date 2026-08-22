-- Solar Pulse OS — repair the HR employees RLS policies on a live database.
--
-- WHY. Migration 0015 adds the policies that let an HR lead (HR Manager) read the whole
-- employee roster. If 0015's RLS half was never applied to this database, the only
-- employees policy in force is the 0001 fallback `members_view_own_employee_row`
-- (user_id = auth.uid()) — so an HR Manager sees ONLY their own employee row and the
-- roster shows 0 people even though the rows exist. Onboarding wrote those rows via the
-- service-role client, which bypasses RLS, so the write succeeded while the read is
-- filtered.
--
-- This installs ONLY the helper functions and employees policies needed for the roster
-- read. It does NOT touch tables (they already exist). Safe to run more than once:
-- functions use CREATE OR REPLACE; policies are dropped first, then recreated.
-- Run in the Supabase SQL editor against the same database the app points at.

-- ---------------------------------------------------------------------------
-- RLS helper functions (idempotent) — copied verbatim from 0015.
-- ---------------------------------------------------------------------------

create or replace function auth_is_hr_member()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join departments d on d.id = u.department_id
    where u.id = auth.uid() and u.is_active and d.slug = 'hr'
  );
$$;

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

create or replace function auth_owns_employee(p_employee_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from employees e
    where e.id = p_employee_id and e.user_id = auth.uid()
  );
$$;

create or replace function auth_employee_org(p_employee_id uuid)
returns uuid language sql stable security definer set search_path = public
as $$
  select u.organization_id
  from employees e join users u on u.id = e.user_id
  where e.id = p_employee_id;
$$;

-- ---------------------------------------------------------------------------
-- employees policies (drop-then-create so this is safe to re-run).
-- ---------------------------------------------------------------------------

drop policy if exists "hr_lead_full_access_employees" on employees;
create policy "hr_lead_full_access_employees" on employees
  for all
  using (auth_is_hr_lead() and auth_employee_org(id) = auth_org_id())
  with check (auth_is_hr_lead() and auth_employee_org(id) = auth_org_id());

drop policy if exists "hr_member_view_employees" on employees;
create policy "hr_member_view_employees" on employees
  for select
  using (auth_is_hr_member() and auth_employee_org(id) = auth_org_id());

-- ---------------------------------------------------------------------------
-- Proof. After the statements above, this should list FOUR policies on employees:
--   ceo_full_access_employees, members_view_own_employee_row,
--   hr_lead_full_access_employees, hr_member_view_employees
-- If the last two are now present, the roster read is unblocked.
-- ---------------------------------------------------------------------------

select policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'employees'
order by policyname;
