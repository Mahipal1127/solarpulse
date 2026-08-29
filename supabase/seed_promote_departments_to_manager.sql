-- Solar Pulse OS — promote DISCOM / Marketing / Sales / Store / Technical staff to their
-- department's Manager role, so each of those five departments runs on ONE role.
--
-- WHY. This is the same product decision already applied to HR in
-- seed_promote_hr_to_manager.sql: a department should have one role, not a Manager/Executive
-- pair. lib/hr/dashboard.ts drops these Executive roles from the onboarding picker so no NEW
-- hire can land on one; this moves the people already on them.
--
-- READ THIS BEFORE RUNNING — it is not the same change HR got.
-- HR's Executive was a *crippled* role: barred from payroll and performance (0015), so it
-- could not do the job and nobody lost anything by leaving it. In these five departments the
-- Executive tier is not crippled, it is SCOPED — "only the rows assigned to them" (0005 for
-- Sales, 0013 for DISCOM), with no can_approve and no can_export. The Manager tier is
-- department-wide, and RLS decides that from the role NAME (auth_is_department_manager() in
-- 0006 matches '%Manager'; isDepartmentManager() in guards.ts matches /\sManager$/).
--
-- So running this means: every member of these five departments will see their whole
-- department's rows instead of just their own, and gains approve + export. That is the
-- intended trade for a small team where everyone already works everything — but it IS a
-- permission widening, not a cosmetic cleanup. Untouched: HR (already done separately),
-- Finance, Distribution, Operations & Maintenance, Accounts and Tender.
--
-- NOT REVERSIBLE BY RE-RUNNING. Once a user is moved, nothing records that they used to be
-- an Executive, so there is no "demote back" script — undoing it means deciding by hand who
-- should be an Executive again. If that matters, snapshot first:
--   select u.id, u.full_name, r.name from users u join roles r on r.id = u.role_id
--    where r.name like '%Executive';
--
-- It does NOT delete the Executive roles. RLS policies and history reference them, and 0002
-- re-creates one per department anyway; they are simply no longer selectable or occupied.
--
-- Safe to run more than once: it only touches users still sitting on an Executive role.
-- Run against the same database the app points at (Supabase SQL editor, or psql).

do $$
declare
  org_id       uuid;
  dept_id      uuid;
  mgr_role_id  uuid;
  exec_role_id uuid;
  moved        int;
  total        int := 0;
  r            record;
begin
  select id into org_id from organizations where name = 'Solar Pulse';
  if org_id is null then
    raise notice 'No Solar Pulse org found — nothing to do.';
    return;
  end if;

  -- Department slugs come from 0002. The Executive names are whatever 0002's loop produced:
  -- '<dept.name> Executive'. That is why Marketing's is the long-form
  -- 'Marketing & Training Executive' while its lead (0014) is the short 'Marketing Manager' —
  -- the department is named "Marketing & Training". Do not "tidy" that string.
  for r in
    select * from (values
      ('discom',             'DISCOM Executive',               'DISCOM Manager',    '0013'),
      ('marketing-training', 'Marketing & Training Executive', 'Marketing Manager', '0014'),
      ('sales',              'Sales Executive',                'Sales Manager',     '0005'),
      ('store',              'Store Executive',                'Store Manager',     '0017'),
      ('technical',          'Technical Executive',            'Technical Manager', '0008')
    ) as t(dept_slug, exec_name, mgr_name, migration)
  loop
    -- Belt-and-braces: plpgsql already nulls an INTO target when a lookup finds nothing, but
    -- these carry across loop iterations and a stale id here would move users into another
    -- department's role.
    dept_id      := null;
    mgr_role_id  := null;
    exec_role_id := null;

    select id into dept_id
      from departments
     where organization_id = org_id and slug = r.dept_slug;
    if dept_id is null then
      raise notice 'SKIPPED %: no department with slug "%".', r.mgr_name, r.dept_slug;
      continue;
    end if;

    -- Unlike the HR seed, this does NOT create the Manager role when it is missing. Each of
    -- these five grants a different module list in its own migration (DISCOM gets
    -- net_metering/subsidy/documents/consumer_verification, Store gets
    -- inventory/warehouse/dealers/..., and so on). Duplicating five permission sets here
    -- would silently drift from the migrations that own them, and a Manager created with the
    -- wrong module list looks fine until someone cannot open a page. So: run the module
    -- migration, then run this.
    select id into mgr_role_id
      from roles
     where organization_id = org_id and name = r.mgr_name;
    if mgr_role_id is null then
      raise notice 'SKIPPED %: role missing. Apply migration % first, then re-run this seed.',
        r.mgr_name, r.migration;
      continue;
    end if;

    select id into exec_role_id
      from roles
     where organization_id = org_id and name = r.exec_name;
    if exec_role_id is null then
      raise notice 'Nothing to do for %: no "%" role present.', r.mgr_name, r.exec_name;
      continue;
    end if;

    update users
    set role_id = mgr_role_id
    where organization_id = org_id
      and role_id = exec_role_id;
    get diagnostics moved = row_count;
    total := total + moved;

    raise notice 'Promoted % user(s): % -> %.', moved, r.exec_name, r.mgr_name;
  end loop;

  raise notice '---';
  raise notice 'Done. % user(s) promoted across the five departments.', total;
  raise notice 'Each now reads their whole department rather than only rows assigned to them,';
  raise notice 'and has can_approve + can_export. See the header before treating this as cosmetic.';
end;
$$;
