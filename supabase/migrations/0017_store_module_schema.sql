-- Solar Pulse OS
-- 0017 — Store department module
--
-- The Store owns the company's master inventory and every physical stock movement. Its
-- defining KPI is 100% stock accuracy, so the load-bearing design decision here is that a
-- current quantity is NEVER stored on a row that a human can edit: it is always COMPUTED from
-- the append-only stock_movements log via the inventory_stock_levels view. There is nothing to
-- drift because there is nothing to keep in sync. This mirrors the reasoning 0016 used for
-- Finance's generated totals, applied to inventory instead of money.
--
-- ACCESS CONTROL — deliberately LOOSER than HR/Finance. Inventory is a shared operational
-- resource: fragmenting stock visibility per-person would defeat the point of a shared
-- warehouse. So this module uses the department-wide pattern (any Store member sees and logs
-- the whole picture), NOT the own-record-only tier HR/Finance need for compensation data.
-- Two RLS tiers therefore suffice per table: CEO org-wide, and Store member department-wide.
-- There is no separate "store lead" RLS tier because a lead is already a Store member and the
-- member policy grants full access — the lead differs only in extra dashboard summary widgets
-- (a UI concern), not in row visibility. This is why the "team view toggle" other modules
-- carry is intentionally absent here.
--
-- KEY FACTS this migration is built on (verified against the migrations that actually ran, not
-- the build prompt's assumptions):
--   * The build prompt guessed Distribution "likely doesn't exist yet". It DOES (0007). It
--     already OWNS the entire dispatch/logistics concept: material_dispatches (with a
--     dispatch_status that starts at 'preparing'), material_dispatch_items,
--     material_allocations, and material_returns — whose material_return_status even includes
--     'received_by_store'. So this module creates NO dispatch/allocation/return tables. The
--     Store "Dispatch Prep" page is a thin READ over Distribution's own 'preparing' dispatches;
--     it does not duplicate them. Distribution remains the system of record for dispatch.
--   * installations (0012) EXISTS, so stock_movements.installation_id carries a real FK to it
--     (the common "material issued to a specific install" case), not a bare uuid slot.
--   * subsidy_cases (0013) status enum has NO 'pending'/'completed' values. Its terminal
--     success state is 'disbursed' and its terminal failure is 'rejected'; everything else is
--     in-flight. PM Surya Ghar Analysis maps "completed" -> 'disbursed' and "pending" ->
--     NOT IN ('disbursed','rejected'). That mapping lives in the service layer, not here.
--   * customers (0005), installations (0012) and subsidy_cases (0013) have NO structured
--     district/area/city/pincode column — only free-text address (and subsidy_cases has none
--     at all). The blueprint's optional "district-wise summary" therefore has no column to
--     group by; it is deliberately NOT built and is flagged as a follow-up for whenever a
--     structured location field is added to customers/installations. This migration does not
--     invent a location column on another module's table.
--   * The Store department (slug 'store', name 'Store') and its 'Store Executive' role are
--     already seeded in 0002. This migration must NOT re-insert the department; it adds the
--     'Store Manager' lead role + permissions. 'Store Manager' ends in "Manager" so
--     auth_is_department_manager() (0006) / isDepartmentManager() (guards.ts) accept it for
--     CEO task delegation.
--   * Statuses stay plain text with a documented value list (0015/0016 convention), no new
--     enums, no check constraints on status.

-- ---------------------------------------------------------------------------
-- Auth helpers (security definer, mirroring auth_is_hr_member / auth_is_finance_lead)
--
-- auth_is_ceo() and auth_org_id() come from 0001. These two add the Store tiers. The member
-- helper keys off department slug only (membership, like auth_is_hr_member); the lead helper
-- additionally requires the manager role — it exists for symmetry and for any future
-- lead-only surface, even though the RLS below does not need a separate lead tier.
-- ---------------------------------------------------------------------------

create or replace function auth_is_store_member()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join departments d on d.id = u.department_id
    where u.id = auth.uid() and u.is_active and d.slug = 'store'
  );
$$;

create or replace function auth_is_store_lead()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from users u
    join roles r on r.id = u.role_id
    join departments d on d.id = u.department_id
    where u.id = auth.uid() and u.is_active
      and d.slug = 'store'
      and r.name in ('Store Manager', 'Store Lead')
  );
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- The master item catalogue. One row per item TYPE the Store carries, not per physical unit.
-- current_quantity is deliberately absent — see inventory_stock_levels below. Nothing here is
-- a running total, so nothing here can drift.
create table inventory_items (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  name               text not null,
  -- 'solar_panel' | 'inverter' | 'structure' | 'cable' | 'accessory' | 'tool'
  category           text not null,
  sku                text,
  unit               text not null default 'pcs',   -- 'pcs' | 'meter' | 'kg' | 'set' | ...
  reorder_threshold  numeric,                        -- at/below this the item flags low-stock; flag only, never auto-orders
  rack_location      text,                           -- simple free-text label e.g. 'Rack A-3', not a bin map
  created_by         uuid not null references users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- SKU is unique WITHIN an org (not globally): two orgs may legitimately reuse a code.
  unique (organization_id, sku)
);

create index inventory_items_org_idx on inventory_items (organization_id);
create index inventory_items_category_idx on inventory_items (organization_id, category);

-- The append-only ledger of every physical stock change. The ONLY way a quantity ever moves.
-- quantity is always POSITIVE for the real movement types (the sign is implied by the type and
-- applied in the view); 'adjustment' is the sole exception — a manual correction may go either
-- way, so it carries a signed quantity. The check enforces exactly that.
create table stock_movements (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  inventory_item_id  uuid not null references inventory_items(id) on delete cascade,
  -- 'stock_in' | 'stock_out' | 'material_issue' | 'material_return' | 'damaged' | 'adjustment'
  movement_type      text not null,
  quantity           numeric not null,
  -- what this movement relates to: 'purchase_order' | 'installation' | 'task' | 'manual' | 'other'
  reference_type     text,
  reference_id       uuid,                            -- polymorphic id matching reference_type; nullable
  -- explicit FK for the common case (material issued to a specific install). installations
  -- (0012) exists, so this is a real constraint, not a bare uuid slot.
  installation_id    uuid references installations(id) on delete set null,
  notes              text,
  performed_by       uuid not null references users(id),
  created_at         timestamptz not null default now(),
  -- adjustment may be negative (a correction either way) but never zero; every other type
  -- must be strictly positive. This is what lets the view trust the type to imply the sign.
  constraint stock_movements_quantity_nonzero check (quantity <> 0),
  constraint stock_movements_quantity_positive_unless_adjustment
    check (movement_type = 'adjustment' or quantity > 0)
);

create index stock_movements_item_idx on stock_movements (inventory_item_id);
create index stock_movements_org_idx on stock_movements (organization_id);
create index stock_movements_performer_idx on stock_movements (performed_by);
create index stock_movements_installation_idx on stock_movements (installation_id);

-- The current quantity of any item = sum of inbound minus sum of outbound, computed live.
-- security_invoker = true so the view runs with the querying user's privileges and inherits
-- the base tables' RLS (the ai_settings_public pattern from 0001). A view cannot carry its own
-- policy, and this is the one safe way to expose a computed value without a SECURITY DEFINER
-- footgun. NOTE on 'adjustment': the build prompt's boilerplate put it in an `else 0` branch,
-- which silently made adjustment a no-op (it would record a row but never change stock). That
-- is corrected here — adjustment adds its signed quantity, so it actually functions as the
-- correction its name promises.
create view inventory_stock_levels
with (security_invoker = true)
as
  select
    i.id                as inventory_item_id,
    i.organization_id,
    i.name,
    i.category,
    i.sku,
    i.unit,
    i.reorder_threshold,
    i.rack_location,
    coalesce(sum(
      case
        when m.movement_type in ('stock_in', 'material_return') then m.quantity
        when m.movement_type in ('stock_out', 'material_issue', 'damaged') then -m.quantity
        when m.movement_type = 'adjustment' then m.quantity   -- signed: may be negative
        else 0
      end
    ), 0) as current_quantity
  from inventory_items i
  left join stock_movements m on m.inventory_item_id = i.id
  group by i.id, i.organization_id, i.name, i.category, i.sku, i.unit, i.reorder_threshold, i.rack_location;

-- Damage detail hanging off the 'damaged' movement that recorded the quantity change. Split
-- from the movement so the ledger stays uniform and the damage reason/photo live with the one
-- movement type that needs them. No organization_id: it is scoped through its parent movement.
create table damaged_stock_records (
  id                 uuid primary key default gen_random_uuid(),
  stock_movement_id  uuid not null references stock_movements(id) on delete cascade,
  reason             text,
  reported_by        uuid not null references users(id),
  photo_file_path    text,                            -- store-media bucket, optional
  created_at         timestamptz not null default now()
);

create index damaged_stock_records_movement_idx on damaged_stock_records (stock_movement_id);

-- Dealer network — a simple contact/relationship log per the discovery notes, deliberately NOT
-- a second Sales pipeline (no stages, no deal tracking).
create table dealers (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references organizations(id) on delete cascade,
  name                text not null,
  contact_person      text,
  phone               text,
  location            text,
  -- 'prospective' | 'active' | 'inactive'
  relationship_status text not null default 'prospective',
  notes               text,
  managed_by          uuid not null references users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index dealers_org_idx on dealers (organization_id);

-- Field observations from market surveys — a lightweight log, not a research tool.
create table market_survey_notes (
  id             uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  area           text not null,
  observations   text not null,
  surveyed_by    uuid not null references users(id),
  survey_date    date not null default current_date,
  created_at     timestamptz not null default now()
);

create index market_survey_notes_org_idx on market_survey_notes (organization_id);

-- Office/facility upkeep — a simple open/in-progress/resolved issue log, not a ticketing
-- product. No updated_at trigger: the lifecycle is captured by resolved_by/resolved_at rather
-- than a general mutation timestamp.
create table facility_maintenance_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  issue           text not null,
  -- 'open' | 'in_progress' | 'resolved'
  status          text not null default 'open',
  reported_by     uuid not null references users(id),
  resolved_by     uuid references users(id),
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index facility_maintenance_logs_org_idx on facility_maintenance_logs (organization_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers (only the two tables with a mutable lifecycle, per 0015/0016)
-- ---------------------------------------------------------------------------

create trigger inventory_items_set_updated_at
  before update on inventory_items
  for each row execute function set_updated_at();

create trigger dealers_set_updated_at
  before update on dealers
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — two tiers per table: CEO org-wide, Store member department-wide. See the header on why
-- there is no separate lead tier. Child table (damaged_stock_records) scopes org through its
-- parent movement, the receipts→invoices pattern from 0016.
-- ---------------------------------------------------------------------------

alter table inventory_items enable row level security;
alter table stock_movements enable row level security;
alter table damaged_stock_records enable row level security;
alter table dealers enable row level security;
alter table market_survey_notes enable row level security;
alter table facility_maintenance_logs enable row level security;

-- inventory_items
create policy "ceo_full_access_inventory_items" on inventory_items
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "store_member_access_inventory_items" on inventory_items
  for all
  using (auth_is_store_member() and organization_id = auth_org_id())
  with check (auth_is_store_member() and organization_id = auth_org_id());

-- stock_movements
create policy "ceo_full_access_stock_movements" on stock_movements
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "store_member_access_stock_movements" on stock_movements
  for all
  using (auth_is_store_member() and organization_id = auth_org_id())
  with check (auth_is_store_member() and organization_id = auth_org_id());

-- damaged_stock_records (org-scoped through the parent movement)
create policy "ceo_full_access_damaged_stock" on damaged_stock_records
  for all
  using (
    auth_is_ceo()
    and exists (
      select 1 from stock_movements m
      where m.id = damaged_stock_records.stock_movement_id
        and m.organization_id = auth_org_id()
    )
  )
  with check (
    auth_is_ceo()
    and exists (
      select 1 from stock_movements m
      where m.id = damaged_stock_records.stock_movement_id
        and m.organization_id = auth_org_id()
    )
  );

create policy "store_member_access_damaged_stock" on damaged_stock_records
  for all
  using (
    auth_is_store_member()
    and exists (
      select 1 from stock_movements m
      where m.id = damaged_stock_records.stock_movement_id
        and m.organization_id = auth_org_id()
    )
  )
  with check (
    auth_is_store_member()
    and exists (
      select 1 from stock_movements m
      where m.id = damaged_stock_records.stock_movement_id
        and m.organization_id = auth_org_id()
    )
  );

-- dealers
create policy "ceo_full_access_dealers" on dealers
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "store_member_access_dealers" on dealers
  for all
  using (auth_is_store_member() and organization_id = auth_org_id())
  with check (auth_is_store_member() and organization_id = auth_org_id());

-- market_survey_notes
create policy "ceo_full_access_market_survey" on market_survey_notes
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "store_member_access_market_survey" on market_survey_notes
  for all
  using (auth_is_store_member() and organization_id = auth_org_id())
  with check (auth_is_store_member() and organization_id = auth_org_id());

-- facility_maintenance_logs
create policy "ceo_full_access_facility" on facility_maintenance_logs
  for all
  using (auth_is_ceo() and organization_id = auth_org_id())
  with check (auth_is_ceo() and organization_id = auth_org_id());

create policy "store_member_access_facility" on facility_maintenance_logs
  for all
  using (auth_is_store_member() and organization_id = auth_org_id())
  with check (auth_is_store_member() and organization_id = auth_org_id());

-- NOTE — future cross-department read (deliberately NOT built yet). O&M may one day need to
-- read inventory_stock_levels to check "is this in stock?" before scheduling an install. When
-- that need is real, add a narrow `for select` policy on inventory_items and stock_movements
-- scoped to auth_is_om_member() (the view inherits it automatically) — a read-only exception in
-- the spirit of Finance's get_invoice_status_for_deal, never a widening of write access. Today
-- nothing in O&M queries stock, so adding it now would be speculative; left as a follow-up.

-- ---------------------------------------------------------------------------
-- record_damaged_stock(): atomic damage entry. Insert the 'damaged' stock movement (which
-- decrements the computed quantity) AND its damaged_stock_records detail row in ONE
-- transaction. A partial failure — movement without detail, or detail without movement — would
-- corrupt the ledger the whole module's accuracy rests on, the same reason Finance's
-- receipt/payment writes are single transactions.
--
-- NOT security definer: it runs as the caller, so both inserts pass the caller's own RLS. A
-- non-Store user cannot see the item (RLS) and so cannot record damage against it. The
-- organization_id and performed_by/reported_by are derived server-side (from the item and
-- auth.uid()), never trusted from the client.
-- ---------------------------------------------------------------------------

create or replace function record_damaged_stock(
  p_inventory_item_id uuid,
  p_quantity          numeric,
  p_reason            text default null,
  p_notes             text default null,
  p_photo_file_path   text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_movement_id uuid := gen_random_uuid();
  v_org_id      uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Damaged quantity must be positive';
  end if;

  -- Reading the item under the caller's RLS: if they cannot see it, it is not theirs to touch.
  select organization_id into v_org_id from inventory_items where id = p_inventory_item_id;
  if v_org_id is null then
    raise exception 'Inventory item not found or not visible to you'
      using errcode = 'no_data_found';
  end if;

  insert into stock_movements (
    id, organization_id, inventory_item_id, movement_type, quantity,
    reference_type, notes, performed_by
  )
  values (
    v_movement_id, v_org_id, p_inventory_item_id, 'damaged', p_quantity,
    'manual', p_notes, auth.uid()
  );

  insert into damaged_stock_records (stock_movement_id, reason, reported_by, photo_file_path)
  values (v_movement_id, p_reason, auth.uid(), p_photo_file_path);

  return v_movement_id;
end;
$$;

revoke execute on function record_damaged_stock(uuid, numeric, text, text, text) from anon;

-- ---------------------------------------------------------------------------
-- Storage: private store-media bucket for damaged-stock photos. Objects live under
-- '{organization_id}/{stock_movement_id}/{filename}'. Mirrors finance-documents (0016): a path
-- helper parses the leading org-folder to a uuid and every object policy scopes on it.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('store-media', 'store-media', false)
on conflict (id) do nothing;

create or replace function store_object_org(object_name text)
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

create policy "store_media_ceo_objects" on storage.objects
  for all
  using (bucket_id = 'store-media' and auth_is_ceo() and store_object_org(name) = auth_org_id())
  with check (bucket_id = 'store-media' and auth_is_ceo() and store_object_org(name) = auth_org_id());

create policy "store_media_member_objects" on storage.objects
  for all
  using (bucket_id = 'store-media' and auth_is_store_member() and store_object_org(name) = auth_org_id())
  with check (bucket_id = 'store-media' and auth_is_store_member() and store_object_org(name) = auth_org_id());

-- ---------------------------------------------------------------------------
-- Store Manager lead role + permissions. 0002 seeded the department and 'Store Executive'
-- only; the lead role is created here idempotently, exactly as 0015/0016 did for HR/Finance.
-- Named with the "Manager" suffix so auth_is_department_manager()/isDepartmentManager() accept
-- it for CEO task delegation.
-- ---------------------------------------------------------------------------

do $$
declare
  org_id        uuid;
  store_dept_id uuid;
  mgr_role_id   uuid;
  exec_role_id  uuid;
begin
  select id into org_id from organizations where name = 'Solar Pulse';
  if org_id is null then return; end if;

  select id into store_dept_id from departments where organization_id = org_id and slug = 'store';
  if store_dept_id is null then return; end if;

  select id into mgr_role_id from roles where organization_id = org_id and name = 'Store Manager';
  if mgr_role_id is null then
    insert into roles (organization_id, department_id, name)
    values (org_id, store_dept_id, 'Store Manager')
    returning id into mgr_role_id;
  end if;

  insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
  select mgr_role_id, m, true, true, true, false, true, true
  from unnest(array[
    'tasks','departments',
    'inventory','stock_movements','warehouse','dealers','market_survey','facility','pm_surya_ghar'
  ]) as m
  on conflict (role_id, module) do nothing;

  -- The auto-seeded 'Store Executive' (0002 names it '<dept.name> Executive'; Store's name is
  -- exactly 'Store'). Same operational modules, no approve/export — matching the Finance
  -- executive shape. Inventory access is department-wide regardless; these permission rows are
  -- for UI/menu affordances, RLS is the real boundary.
  select id into exec_role_id from roles where organization_id = org_id and name = 'Store Executive';
  if exec_role_id is not null then
    insert into permissions (role_id, module, can_view, can_create, can_edit, can_delete, can_approve, can_export)
    select exec_role_id, m, true, true, true, false, false, false
    from unnest(array[
      'inventory','stock_movements','warehouse','dealers','market_survey','facility','pm_surya_ghar'
    ]) as m
    on conflict (role_id, module) do nothing;
  end if;
end;
$$;
