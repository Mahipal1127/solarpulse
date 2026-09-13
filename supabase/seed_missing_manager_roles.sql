-- =============================================================================
-- Solar Pulse OS — Repair: ensure every department's Manager role exists
-- =============================================================================
-- WHAT THIS FIXES. The HR onboarding wizard's role picker hides the auto-seeded
-- '<Department> Executive' roles (lib/hr/dashboard.ts, RETIRED_ONBOARDING_ROLES)
-- and expects each department to run on its '<Department> Manager' role instead.
-- Those Manager roles are created by migrations 0005 (Sales), 0008 (Technical),
-- 0013 (DISCOM), 0014 (Marketing), 0015 (HR), 0016 (Finance), 0017 (Store) and
-- 0012 (O&M) / 0007 (Distribution). If any of those migrations were not applied
-- to the live database — or were applied after the picker change shipped — the
-- affected departments appear in the picker with ZERO selectable roles and HR
-- cannot onboard anyone into them.
--
-- The symptoms this script repairs: "Sales / Marketing / Technical / DISCOM
-- roles are missing when HR tries to assign a role to a new employee."
--
-- WHAT IT DOES. For each of the seven department Manager roles, creates the role
-- if missing and seeds its module permissions with the EXACT same lists the
-- owning migration grants (copied verbatim from 0005/0008/0012/0013/0014/0016/
-- 0017). Idempotent — safe to run repeatedly; existing roles are left untouched.
--
-- WHY DUPLICATE THE LISTS. The promote script (seed_promote_departments_to_
-- manager.sql) refuses to create Manager roles for exactly this reason — the
-- permission sets belong to the migrations. This script is a REPAIR for a
-- database where re-running full migrations is impractical; it duplicates the
-- lists so the operator can fix a live system without re-applying modules. If
-- a later migration changes a department's permission list, update it here too.
--
-- HOW TO RUN. Supabase SQL editor (or psql) against the database the app points
-- at. Then verify with the query at the bottom: every department should list
-- exactly one non-hidden (Manager) role.
-- =============================================================================

do $$
declare
  org_id uuid;
begin
  select id into org_id from organizations where name = 'Solar Pulse';
  if org_id is null then
    raise exception 'No "Solar Pulse" organisation found — run migration 0002 first.';
  end if;

  -- =========================================================================
  -- helper: create a department Manager role if absent.
  -- The role is scoped to the department (department_id not null) and named
  -- '<X> Manager' so auth_is_department_manager() (0006) and isDepartment-
  -- Manager() (guards.ts) accept it for CEO task delegation.
  -- =========================================================================

  -- ── Sales Manager (0005) ─────────────────────────────────────────────────
  -- Manager: view/create/edit + approve + export on all Sales modules.
  with ins as (
    insert into roles (organization_id, department_id, name)
    select org_id, d.id, 'Sales Manager'
    from departments d
    where d.organization_id = org_id and d.slug = 'sales'
      and not exists (select 1 from roles r where r.organization_id = org_id and r.name = 'Sales Manager')
    returning id
  )
  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select ins.id, m, true, true, true, false, true, true
  from ins, unnest(array[
    'leads', 'customers', 'follow_ups', 'site_visits',
    'quotations', 'proposals', 'deal_closures', 'sales_targets'
  ]) as m
  on conflict (role_id, module) do nothing;

  -- Sales Manager also works tasks (0005 grants this separately).
  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select r.id, 'tasks', true, false, true, false, false, false
  from roles r
  where r.organization_id = org_id and r.name = 'Sales Manager'
  on conflict (role_id, module) do nothing;

  -- ── Technical Manager (0008) ─────────────────────────────────────────────
  with ins as (
    insert into roles (organization_id, department_id, name)
    select org_id, d.id, 'Technical Manager'
    from departments d
    where d.organization_id = org_id and d.slug = 'technical'
      and not exists (select 1 from roles r where r.organization_id = org_id and r.name = 'Technical Manager')
    returning id
  )
  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select ins.id, m, true, true, true, false, true, true
  from ins, unnest(array[
    'tasks','approvals','departments','surveys','designs','generation_reports','it_support'
  ]) as m
  on conflict (role_id, module) do nothing;

  -- ── DISCOM Manager (0013) ────────────────────────────────────────────────
  with ins as (
    insert into roles (organization_id, department_id, name)
    select org_id, d.id, 'DISCOM Manager'
    from departments d
    where d.organization_id = org_id and d.slug = 'discom'
      and not exists (select 1 from roles r where r.organization_id = org_id and r.name = 'DISCOM Manager')
    returning id
  )
  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select ins.id, m, true, true, true, false, true, true
  from ins, unnest(array[
    'tasks','approvals','departments','net_metering','subsidy','documents','consumer_verification'
  ]) as m
  on conflict (role_id, module) do nothing;

  -- ── Marketing Manager (0014) ─────────────────────────────────────────────
  -- Department slug is 'marketing-training'; role name is the SHORT form so the
  -- '%Manager' RLS/guard matchers accept it.
  with ins as (
    insert into roles (organization_id, department_id, name)
    select org_id, d.id, 'Marketing Manager'
    from departments d
    where d.organization_id = org_id and d.slug = 'marketing-training'
      and not exists (select 1 from roles r where r.organization_id = org_id and r.name = 'Marketing Manager')
    returning id
  )
  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select ins.id, m, true, true, true, false, true, true
  from ins, unnest(array[
    'tasks','approvals','departments',
    'content_calendar','campaigns','lead_generation','ai_insights'
  ]) as m
  on conflict (role_id, module) do nothing;

  -- ── Store Manager (0017) ─────────────────────────────────────────────────
  with ins as (
    insert into roles (organization_id, department_id, name)
    select org_id, d.id, 'Store Manager'
    from departments d
    where d.organization_id = org_id and d.slug = 'store'
      and not exists (select 1 from roles r where r.organization_id = org_id and r.name = 'Store Manager')
    returning id
  )
  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select ins.id, m, true, true, true, false, true, true
  from ins, unnest(array[
    'tasks','departments',
    'inventory','stock_movements','warehouse','dealers','market_survey','facility','pm_surya_ghar'
  ]) as m
  on conflict (role_id, module) do nothing;

  -- ── O&M Manager (0012) ───────────────────────────────────────────────────
  -- Department slug 'operations-maintenance'; role name 'Operations & Maintenance
  -- Manager' (ends in Manager, so the delegation matchers accept it).
  with ins as (
    insert into roles (organization_id, department_id, name)
    select org_id, d.id, 'Operations & Maintenance Manager'
    from departments d
    where d.organization_id = org_id and d.slug = 'operations-maintenance'
      and not exists (
        select 1 from roles r
        where r.organization_id = org_id and r.name = 'Operations & Maintenance Manager'
      )
    returning id
  )
  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select ins.id, m, true, true, true, false, true, true
  from ins, unnest(array[
    'tasks','approvals','departments',
    'installations','service_tickets','amc','performance'
  ]) as m
  on conflict (role_id, module) do nothing;

  -- ── Distribution Manager (0007) ──────────────────────────────────────────
  with ins as (
    insert into roles (organization_id, department_id, name)
    select org_id, d.id, 'Distribution Manager'
    from departments d
    where d.organization_id = org_id and d.slug = 'distribution'
      and not exists (select 1 from roles r where r.organization_id = org_id and r.name = 'Distribution Manager')
    returning id
  )
  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select ins.id, m, true, true, true, false, true, true
  from ins, unnest(array[
    'tasks','approvals','departments',
    'purchase_orders','dispatches','allocations','returns','vendors'
  ]) as m
  on conflict (role_id, module) do nothing;

  -- =========================================================================
  -- HR Manager and Finance Manager are NOT created here. Their permission sets
  -- are the sensitive tier (0015 bars non-lead HR from payroll; 0016 walls the
  -- Finance executive off from money surfaces) and were seeded by migrations
  -- 0015/0016 which bootstrap_fresh_system.sql already verifies. If either of
  -- THOSE is missing, re-run the migrations — do not guess their grants here.
  -- =========================================================================
end;
$$;

-- =============================================================================
-- Verification. Every department should show at least one role the onboarding
-- picker will offer (i.e. one NOT in RETIRED_ONBOARDING_ROLES). A department
-- with a NULL selectable_roles count is exactly the bug this script fixes.
-- =============================================================================

select
  d.slug                                        as department,
  count(r.id)                                   as total_roles,
  count(r.id) filter (
    where r.name not in (
      'HR Executive',
      'DISCOM Executive',
      'Marketing & Training Executive',
      'Sales Executive',
      'Store Executive',
      'Technical Executive'
    )
  )                                             as selectable_roles,
  string_agg(r.name, ', ' order by r.name)      as roles
from departments d
left join roles r on r.department_id = d.id
where d.organization_id = (select id from organizations where name = 'Solar Pulse')
group by d.slug
order by d.slug;

-- =============================================================================
-- END. After running: reload /hr/onboarding/new in the app. Every department
-- (Sales, Technical, DISCOM, Marketing & Training, Store, O&M, Distribution)
-- now has its Manager role selectable in the Role dropdown.
-- =============================================================================