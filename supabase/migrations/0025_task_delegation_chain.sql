-- Solar Pulse OS
-- Migration 0025 — hierarchical task delegation with full traceability
--
-- THE MODEL
--   * A task may carry a CHAIN:
--       parent_task_id        — the task this one was spun off from (a sub-task
--                               or requirement discovered while working).
--       root_task_id          — the top of the chain (itself for a top-level
--                               task). One indexed lookup returns a whole tree.
--       origin_department_id  — the department the ORIGINAL task was assigned
--                               to: the owner for the chain's entire life. It
--                               is copied onto every child at insert time and
--                               never rewritten by delegation, so even a task
--                               that has travelled CEO → Distribution →
--                               Technical → Marketing still belongs to
--                               Distribution for visibility purposes.
--   * Execution may travel independently of ownership: an assignee forwards
--     their open task to another employee or department; the origin and the
--     chain links do not move. Forwarding and sub-task creation are privileged
--     server paths (lib/services/tasks.ts: forwardTask / createSubTask) that
--     check the right to act and then write on the service client — the same
--     pattern onboarding, ID cards and password reset use.
--
-- VISIBILITY — the ownership rule this migration encodes into RLS
--   * CEO: everything (ceo_full_access, 0001 — untouched).
--   * A manager of the ORIGIN department: every task in any chain their
--     department owns. This is "Distribution Head sees the complete journey
--     of our department's task, including the work Technical and Marketing
--     did to fulfil it".
--   * The creator of a task: sees that node wherever it was assigned — an
--     employee who raised a requirement can watch it through to completion
--     without seeing the rest of the target department's queue.
--   * Everyone else: exactly what 0022 already gave them — their own tasks,
--     their department's managed tasks, an unclaimed task in a managerless
--     department. A plain member of Technical sees the node assigned to
--     Technical and nothing of Distribution's internal chain.
--
-- EXISTING DATA
--   Every pre-existing task becomes the root of its own chain, owned by the
--   department it was already assigned to — nothing changes for anyone.

-- ---------------------------------------------------------------------------
-- 0. Helper — included here so this migration stands alone
--
-- auth_my_department_has_active_manager() is defined in 0022, but a database
-- may have skipped or partially applied that file. create or replace makes
-- this idempotent: on a 0022'd database it is a no-op that redefines the
-- identical function, and on a fresh one it fills the gap instead of failing
-- at the first policy that calls it. Same '<Department> Manager' role-name
-- convention as auth_is_department_manager() (0006); security definer so it
-- sees users regardless of the caller's own RLS.
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
-- 1. Chain columns
-- ---------------------------------------------------------------------------

alter table tasks add column if not exists parent_task_id       uuid references tasks(id) on delete set null;
alter table tasks add column if not exists root_task_id         uuid references tasks(id) on delete set null;
alter table tasks add column if not exists origin_department_id uuid references departments(id) on delete set null;

-- Every existing task is its own root, owned by the department it already has.
update tasks
   set root_task_id = id,
       origin_department_id = assigned_department_id
 where root_task_id is null;

create index if not exists tasks_root_idx   on tasks (root_task_id);
create index if not exists tasks_parent_idx on tasks (parent_task_id);
create index if not exists tasks_origin_idx on tasks (origin_department_id);

comment on column tasks.parent_task_id is
  'The task this one was spun off from — a sub-task or requirement discovered while working the parent. Null on a top-level task.';
comment on column tasks.root_task_id is
  'The top of this task''s chain. Set to self on creation for top-level tasks; inherited from the parent for sub-tasks. One index lookup fetches a whole journey.';
comment on column tasks.origin_department_id is
  'The department the ORIGINAL task in this chain was assigned to — the chain''s owner. Copied at insert, never rewritten by delegation.';

-- ---------------------------------------------------------------------------
-- 2. Read policies — two new branches on the existing rules
--
-- member_view_relevant_tasks keeps every 0022 branch and adds:
--   * created_by = me            — the person who raised a requirement (or the
--                                  manager who originated a task) can see that
--                                  node wherever it ended up.
--   * origin = my dept, as manager — the origin department's complete journey,
--                                  including nodes now sitting in other
--                                  departments.
-- The origin branch is deliberately manager-only: a department's internal
-- delegate-to-whom decisions are a manager's oversight, and a plain member's
-- board should not fill with other departments' sub-tasks.
-- ---------------------------------------------------------------------------

drop policy if exists "member_view_relevant_tasks" on tasks;

create policy "member_view_relevant_tasks" on tasks
  for select
  using (
    organization_id = auth_org_id()
    and (
      assigned_user_id = auth.uid()
      or created_by = auth.uid()
      or (
        auth_is_department_manager()
        and (
          assigned_department_id = auth_department_id()
          or origin_department_id = auth_department_id()
        )
      )
      or (
        assigned_department_id = auth_department_id()
        and assigned_user_id is null
        and not auth_my_department_has_active_manager()
      )
    )
  );

-- task_updates and task_attachments follow the task, so their view policies get
-- the same two branches — the origin manager reading the journey must also see
-- the progress notes filed against nodes sitting in other departments, and the
-- creator of a sub-task must see updates on their own node. The insert policies
-- (0022) stay exactly as they are: only the task's own participants write
-- against it.

drop policy if exists "member_view_task_updates" on task_updates;

create policy "member_view_task_updates" on task_updates
  for select
  using (exists (
    select 1 from tasks t
    where t.id = task_updates.task_id
      and t.organization_id = auth_org_id()
      and (
        t.assigned_user_id = auth.uid()
        or t.created_by = auth.uid()
        or (
          auth_is_department_manager()
          and (
            t.assigned_department_id = auth_department_id()
            or t.origin_department_id = auth_department_id()
          )
        )
        or (
          t.assigned_department_id = auth_department_id()
          and t.assigned_user_id is null
          and not auth_my_department_has_active_manager()
        )
      )
  ));

drop policy if exists "member_view_task_attachments" on task_attachments;

create policy "member_view_task_attachments" on task_attachments
  for select
  using (exists (
    select 1 from tasks t
    where t.id = task_attachments.task_id
      and t.organization_id = auth_org_id()
      and (
        t.assigned_user_id = auth.uid()
        or t.created_by = auth.uid()
        or (
          auth_is_department_manager()
          and (
            t.assigned_department_id = auth_department_id()
            or t.origin_department_id = auth_department_id()
          )
        )
        or (
          t.assigned_department_id = auth_department_id()
          and t.assigned_user_id is null
          and not auth_my_department_has_active_manager()
        )
      )
  ));

-- ---------------------------------------------------------------------------
-- 3. Write policies — deliberately unchanged
--
-- member_update_relevant_tasks (0022) still governs in-place writes: the
-- assignee progresses their own task; a manager writes within their own
-- department. Delegation — creating sub-tasks anywhere in the organisation and
-- forwarding tasks across departments — is deliberately NOT an RLS write,
-- because its invariants (the copied chain links, the immutable origin, the
-- target's existence and activity) cannot be expressed as a per-row check the
-- caller cannot sidestep. Those writes go through the privileged service path,
-- which verifies the right to act and then writes on the service client,
-- exactly like onboarding and ID cards. The audit row and the task_updates
-- handoff note come from the same path, so the trail is complete by
-- construction.
-- ---------------------------------------------------------------------------