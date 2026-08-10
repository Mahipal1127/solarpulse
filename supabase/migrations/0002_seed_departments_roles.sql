-- Solar Pulse OS — CEO Module
-- Migration 0002: seed org, departments, roles, permissions
--
-- Idempotent. Run after 0001. Creates one organization with the standard
-- department tree, a CEO role, and a default "<Department> Executive" role per
-- department with sensible module permissions.

do $$
declare
  org_id uuid;
  dept record;
  ceo_role_id uuid;
  exec_role_id uuid;
  finance_id uuid;
begin
  -- Organization ------------------------------------------------------------
  select id into org_id from organizations where name = 'Solar Pulse';
  if org_id is null then
    insert into organizations (name) values ('Solar Pulse') returning id into org_id;
  end if;

  -- Departments -------------------------------------------------------------
  insert into departments (organization_id, name, slug)
  values
    (org_id, 'Tender', 'tender'),
    (org_id, 'Sales', 'sales'),
    (org_id, 'Distribution', 'distribution'),
    (org_id, 'Technical', 'technical'),
    (org_id, 'Operations & Maintenance', 'operations-maintenance'),
    (org_id, 'DISCOM', 'discom'),
    (org_id, 'Marketing & Training', 'marketing-training'),
    (org_id, 'HR', 'hr'),
    (org_id, 'Finance', 'finance'),
    (org_id, 'Store', 'store')
  on conflict (organization_id, slug) do nothing;

  -- Finance sub-section: Accounts is just a department with a parent
  select id into finance_id from departments where organization_id = org_id and slug = 'finance';
  insert into departments (organization_id, parent_department_id, name, slug)
  values (org_id, finance_id, 'Accounts', 'accounts')
  on conflict (organization_id, slug) do nothing;

  -- CEO role: org-wide, department_id null -----------------------------------
  select id into ceo_role_id from roles where organization_id = org_id and name = 'CEO';
  if ceo_role_id is null then
    insert into roles (organization_id, department_id, name)
    values (org_id, null, 'CEO')
    returning id into ceo_role_id;
  end if;

  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select ceo_role_id, m, true, true, true, true, true, true
  from unnest(array[
    'tasks','approvals','departments','analytics','audit','ai','ai_settings',
    'finance_reports','hr_records'
  ]) as m
  on conflict (role_id, module) do nothing;

  -- One default executive role per department --------------------------------
  for dept in
    select id, name from departments where organization_id = org_id
  loop
    select id into exec_role_id
      from roles
     where organization_id = org_id and name = dept.name || ' Executive';

    if exec_role_id is null then
      insert into roles (organization_id, department_id, name)
      values (org_id, dept.id, dept.name || ' Executive')
      returning id into exec_role_id;
    end if;

    -- Department executives work their own tasks and raise approval requests.
    -- They cannot approve, and have no access to ai/ai_settings/audit at all.
    insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
    values
      (exec_role_id, 'tasks',       true, false, true,  false, false, false),
      (exec_role_id, 'approvals',   true, true,  false, false, false, false),
      (exec_role_id, 'departments', true, false, false, false, false, false)
    on conflict (role_id, module) do nothing;
  end loop;
end;
$$;
