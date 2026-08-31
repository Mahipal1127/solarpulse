-- Solar Pulse OS
-- Migration 0022: gate unclaimed department tasks behind the manager
--
-- The CEO now assigns work to a DEPARTMENT only, never to a person (the create
-- form and both task-create paths dropped the assignee field). A task therefore
-- lands unclaimed — assigned_department_id set, assigned_user_id null — and it is
-- the department's MANAGER who delegates it to an individual.
--
-- 0006 made an unclaimed department task visible to EVERY member of that
-- department:
--
--     assigned_department_id = auth_department_id()
--     and (assigned_user_id is null or auth_is_department_manager())
--
-- That was the right call when a department always had a manager to delegate, but
-- the rule we now want is:
--
--   * Department WITH a manager  → an unclaimed task is the manager's to hand out.
--                                  Plain members see it only once it is theirs.
--   * Department WITHOUT a manager (Tender, Accounts) → nobody delegates, so the
--                                  whole department shares the unclaimed task and
--                                  works it together. This is what keeps those two
--                                  departments functioning.
--
-- In practice the has-manager tightening matches what the UI already did — every
-- "My Tasks" board filters strictly on assigned_user_id = me, and the delegation
-- inbox is manager-only — so this closes the gap between RLS and the UI rather than
-- changing what anyone sees on screen. The no-manager branch is preserved exactly.

-- ---------------------------------------------------------------------------
-- Helper: does the caller's own department have an active manager?
--
-- Same '<Department> Manager' role-name convention as auth_is_department_manager()
-- (0006). security definer so it sees users regardless of the caller's own RLS.
-- Parameterless on purpose: every policy below only ever asks about the caller's
-- department (assigned_department_id = auth_department_id() already holds when it
-- is evaluated), so the answer is constant per caller and short-circuits cleanly.
-- ---------------------------------------------------------------------------

create or replace function auth_my_department_has_active_manager()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join roles r on r.id = u.role_id
    where u.department_id = auth_department_id()
      and u.is_active
      and r.name like '%Manager'
  );
$$;

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------

drop policy if exists "member_view_relevant_tasks"   on tasks;
drop policy if exists "member_update_relevant_tasks" on tasks;

-- Read: my own task; anything in my department if I manage it; and — only when my
-- department has no manager — an unclaimed department task, which the whole
-- department then shares.
create policy "member_view_relevant_tasks" on tasks
  for select
  using (
    organization_id = auth_org_id()
    and (
      assigned_user_id = auth.uid()
      or (
        assigned_department_id = auth_department_id()
        and (
          auth_is_department_manager()
          or (assigned_user_id is null and not auth_my_department_has_active_manager())
        )
      )
    )
  );

-- Write: progress my own task; as a manager, write any task in my department
-- (this is what makes delegation possible — setting assigned_user_id on an
-- unclaimed one); or, in a manager-less department, write the shared unclaimed
-- task. with check mirrors using, so no write can push a task out of the
-- department or onto another person than the rules above allow.
create policy "member_update_relevant_tasks" on tasks
  for update
  using (
    organization_id = auth_org_id()
    and (
      assigned_user_id = auth.uid()
      or (auth_is_department_manager() and assigned_department_id = auth_department_id())
      or (
        assigned_department_id = auth_department_id()
        and assigned_user_id is null
        and not auth_my_department_has_active_manager()
      )
    )
  )
  with check (
    organization_id = auth_org_id()
    and (
      assigned_user_id = auth.uid()
      or (auth_is_department_manager() and assigned_department_id = auth_department_id())
      or (
        assigned_department_id = auth_department_id()
        and assigned_user_id is null
        and not auth_my_department_has_active_manager()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- task_updates follows tasks (same visibility rule, scoped through the task)
-- ---------------------------------------------------------------------------

drop policy if exists "member_view_task_updates"   on task_updates;
drop policy if exists "member_insert_task_updates" on task_updates;

create policy "member_view_task_updates" on task_updates
  for select
  using (exists (
    select 1 from tasks t
    where t.id = task_updates.task_id
      and t.organization_id = auth_org_id()
      and (
        t.assigned_user_id = auth.uid()
        or (
          t.assigned_department_id = auth_department_id()
          and (
            auth_is_department_manager()
            or (t.assigned_user_id is null and not auth_my_department_has_active_manager())
          )
        )
      )
  ));

create policy "member_insert_task_updates" on task_updates
  for insert
  with check (
    updated_by = auth.uid()
    and exists (
      select 1 from tasks t
      where t.id = task_updates.task_id
        and t.organization_id = auth_org_id()
        and (
          t.assigned_user_id = auth.uid()
          or (auth_is_department_manager() and t.assigned_department_id = auth_department_id())
          or (
            t.assigned_department_id = auth_department_id()
            and t.assigned_user_id is null
            and not auth_my_department_has_active_manager()
          )
        )
    )
  );

-- ---------------------------------------------------------------------------
-- task_attachments follows tasks, for the same reason
-- ---------------------------------------------------------------------------

drop policy if exists "member_view_task_attachments" on task_attachments;
drop policy if exists "member_add_task_attachments"  on task_attachments;

create policy "member_view_task_attachments" on task_attachments
  for select
  using (exists (
    select 1 from tasks t
    where t.id = task_attachments.task_id
      and t.organization_id = auth_org_id()
      and (
        t.assigned_user_id = auth.uid()
        or (
          t.assigned_department_id = auth_department_id()
          and (
            auth_is_department_manager()
            or (t.assigned_user_id is null and not auth_my_department_has_active_manager())
          )
        )
      )
  ));

create policy "member_add_task_attachments" on task_attachments
  for insert
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from tasks t
      where t.id = task_attachments.task_id
        and t.organization_id = auth_org_id()
        and (
          t.assigned_user_id = auth.uid()
          or (auth_is_department_manager() and t.assigned_department_id = auth_department_id())
          or (
            t.assigned_department_id = auth_department_id()
            and t.assigned_user_id is null
            and not auth_my_department_has_active_manager()
          )
        )
    )
  );
