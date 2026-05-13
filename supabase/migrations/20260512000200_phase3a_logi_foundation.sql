-- =====================================================================
-- GENBA Phase 3a: LOGI foundation tables (RECEIVING / PICKING / INVENTORY)
-- =====================================================================
-- Foundation-layer schema only. UI / Scanner / CSV / WORKS-only tables
-- (manufacturing_*) are explicitly out of scope for Phase 3a and will ship
-- in Phase 3b / Phase 4.
--
-- Decisions reflected (2026-05-12 owner Phase 3a kickoff):
--   * movement_plans / movement_plan_lines / movement_records cover both
--     receiving (入庫) and picking (ピッキング) — distinguished via
--     business_code. UC-2 free-read uses NULLABLE movement_plan_line_id.
--   * inventory_plans / inventory_plan_lines / inventory_records mirror
--     the movement structure for 棚卸 (no business_code; inventory only).
--   * qr_scan_histories carries the raw QR payload + parser output. Per
--     QR_SPEC §7, `raw_value` is restricted to tenant_admin via column
--     grants + dedicated view (see migration 20260512000400).
--   * Every tenant-owned table has tenant_id + audit columns + RLS using
--     the existing app.* helpers from Phase 1. NO `auth.users` join in any
--     policy USING/WITH CHECK (pick-checker lesson 010_fix_rls_recursion).
--   * 訂正用 self-FK `previous_record_id` on movement_records /
--     inventory_records — when a worker re-scans to correct a prior entry
--     the old row remains for audit (PRODUCT_SPEC §6 訂正フロー).
--   * Cross-table tenant integrity on qr_scan_histories.target_id is
--     enforced by the validate_target_tenant() trigger from migration
--     20260512000300 — see ARCHITECTURE §4 R-05 / RLS-007.
--   * Idempotent: every CREATE TABLE uses IF NOT EXISTS, every CREATE
--     POLICY is preceded by DROP POLICY IF EXISTS, every CREATE TRIGGER
--     by DROP TRIGGER IF EXISTS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. movement_plans (receiving / picking) — operational config
-- ---------------------------------------------------------------------
create table if not exists public.movement_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  business_code text not null check (business_code in ('receiving', 'picking')),
  plan_code text not null,
  plan_name text not null,
  source_location text,
  destination_location text,
  plan_date date,
  status text not null default 'active' check (status in ('draft', 'active', 'closed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id, business_code, plan_code)
);

create index if not exists movement_plans_tenant_business_idx
  on public.movement_plans (tenant_id, business_code);
create index if not exists movement_plans_tenant_status_idx
  on public.movement_plans (tenant_id, status);

alter table public.movement_plans enable row level security;

drop policy if exists movement_plans_select_same_tenant on public.movement_plans;
create policy movement_plans_select_same_tenant
on public.movement_plans for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

drop policy if exists movement_plans_modify_tenant_admin on public.movement_plans;
create policy movement_plans_modify_tenant_admin
on public.movement_plans for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- ---------------------------------------------------------------------
-- 2. movement_plan_lines — line items of a movement plan
--    tenant_id denormalised for fast RLS without join.
-- ---------------------------------------------------------------------
create table if not exists public.movement_plan_lines (
  id uuid primary key default gen_random_uuid(),
  movement_plan_id uuid not null references public.movement_plans(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  line_no integer not null,
  item_code text not null,
  planned_quantity numeric not null check (planned_quantity >= 0),
  location_code text,
  lot text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (movement_plan_id, line_no)
);

create index if not exists movement_plan_lines_plan_idx
  on public.movement_plan_lines (movement_plan_id);
create index if not exists movement_plan_lines_tenant_idx
  on public.movement_plan_lines (tenant_id);

alter table public.movement_plan_lines enable row level security;

drop policy if exists movement_plan_lines_select_same_tenant on public.movement_plan_lines;
create policy movement_plan_lines_select_same_tenant
on public.movement_plan_lines for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

drop policy if exists movement_plan_lines_modify_tenant_admin on public.movement_plan_lines;
create policy movement_plan_lines_modify_tenant_admin
on public.movement_plan_lines for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- ---------------------------------------------------------------------
-- 3. movement_records — actual scan/record entries for receiving / picking
--    Per ARCHITECTURE §4 RLS template: workers may INSERT only their own
--    rows, may UPDATE only their own rows (tenant_admin can update any),
--    DELETE only by tenant_admin. movement_plan_line_id is NULLABLE for
--    UC-2 free-read.
-- ---------------------------------------------------------------------
create table if not exists public.movement_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  business_code text not null check (business_code in ('receiving', 'picking')),
  movement_plan_line_id uuid references public.movement_plan_lines(id) on delete set null,
  worker_id uuid not null references auth.users(id),
  item_code text not null,
  quantity numeric not null check (quantity >= 0),
  lot text,
  location_code text,
  match_result text not null default 'ok'
    check (match_result in ('ok', 'ng', 'warning', 'skipped')),
  match_detail jsonb not null default '[]'::jsonb,
  recorded_at timestamptz not null default now(),
  previous_record_id uuid references public.movement_records(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz
);

create index if not exists movement_records_plan_line_idx
  on public.movement_records (movement_plan_line_id);
create index if not exists movement_records_tenant_business_recorded_idx
  on public.movement_records (tenant_id, business_code, recorded_at desc);
create index if not exists movement_records_worker_idx
  on public.movement_records (worker_id);
create index if not exists movement_records_previous_idx
  on public.movement_records (previous_record_id);

alter table public.movement_records enable row level security;

drop policy if exists movement_records_select_same_tenant on public.movement_records;
create policy movement_records_select_same_tenant
on public.movement_records for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

drop policy if exists movement_records_insert_worker on public.movement_records;
create policy movement_records_insert_worker
on public.movement_records for insert to authenticated
with check (
  tenant_id = app.current_tenant_id()
  and worker_id = auth.uid()
);

drop policy if exists movement_records_update_self_or_admin on public.movement_records;
create policy movement_records_update_self_or_admin
on public.movement_records for update to authenticated
using (
  tenant_id = app.current_tenant_id()
  and (worker_id = auth.uid() or app.is_tenant_admin())
)
with check (
  tenant_id = app.current_tenant_id()
  and (worker_id = auth.uid() or app.is_tenant_admin())
);

drop policy if exists movement_records_delete_tenant_admin on public.movement_records;
create policy movement_records_delete_tenant_admin
on public.movement_records for delete to authenticated
using (
  tenant_id = app.current_tenant_id()
  and app.is_tenant_admin()
);

-- ---------------------------------------------------------------------
-- 4. inventory_plans — 棚卸 operational config
-- ---------------------------------------------------------------------
create table if not exists public.inventory_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_code text not null,
  plan_name text not null,
  plan_date date,
  status text not null default 'active' check (status in ('draft', 'active', 'closed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id, plan_code)
);

create index if not exists inventory_plans_tenant_idx
  on public.inventory_plans (tenant_id);
create index if not exists inventory_plans_tenant_status_idx
  on public.inventory_plans (tenant_id, status);

alter table public.inventory_plans enable row level security;

drop policy if exists inventory_plans_select_same_tenant on public.inventory_plans;
create policy inventory_plans_select_same_tenant
on public.inventory_plans for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

drop policy if exists inventory_plans_modify_tenant_admin on public.inventory_plans;
create policy inventory_plans_modify_tenant_admin
on public.inventory_plans for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- ---------------------------------------------------------------------
-- 5. inventory_plan_lines — line items of an inventory plan
-- ---------------------------------------------------------------------
create table if not exists public.inventory_plan_lines (
  id uuid primary key default gen_random_uuid(),
  inventory_plan_id uuid not null references public.inventory_plans(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  line_no integer not null,
  item_code text not null,
  location_code text,
  expected_quantity numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (inventory_plan_id, line_no)
);

create index if not exists inventory_plan_lines_plan_idx
  on public.inventory_plan_lines (inventory_plan_id);
create index if not exists inventory_plan_lines_tenant_idx
  on public.inventory_plan_lines (tenant_id);

alter table public.inventory_plan_lines enable row level security;

drop policy if exists inventory_plan_lines_select_same_tenant on public.inventory_plan_lines;
create policy inventory_plan_lines_select_same_tenant
on public.inventory_plan_lines for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

drop policy if exists inventory_plan_lines_modify_tenant_admin on public.inventory_plan_lines;
create policy inventory_plan_lines_modify_tenant_admin
on public.inventory_plan_lines for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- ---------------------------------------------------------------------
-- 6. inventory_records — actual count entries for 棚卸
-- ---------------------------------------------------------------------
create table if not exists public.inventory_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  inventory_plan_line_id uuid references public.inventory_plan_lines(id) on delete set null,
  worker_id uuid not null references auth.users(id),
  item_code text not null,
  counted_quantity numeric not null check (counted_quantity >= 0),
  location_code text,
  lot text,
  match_result text not null default 'ok'
    check (match_result in ('ok', 'ng', 'warning', 'skipped')),
  match_detail jsonb not null default '[]'::jsonb,
  recorded_at timestamptz not null default now(),
  previous_record_id uuid references public.inventory_records(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz
);

create index if not exists inventory_records_plan_line_idx
  on public.inventory_records (inventory_plan_line_id);
create index if not exists inventory_records_tenant_recorded_idx
  on public.inventory_records (tenant_id, recorded_at desc);
create index if not exists inventory_records_worker_idx
  on public.inventory_records (worker_id);
create index if not exists inventory_records_previous_idx
  on public.inventory_records (previous_record_id);

alter table public.inventory_records enable row level security;

drop policy if exists inventory_records_select_same_tenant on public.inventory_records;
create policy inventory_records_select_same_tenant
on public.inventory_records for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

drop policy if exists inventory_records_insert_worker on public.inventory_records;
create policy inventory_records_insert_worker
on public.inventory_records for insert to authenticated
with check (
  tenant_id = app.current_tenant_id()
  and worker_id = auth.uid()
);

drop policy if exists inventory_records_update_self_or_admin on public.inventory_records;
create policy inventory_records_update_self_or_admin
on public.inventory_records for update to authenticated
using (
  tenant_id = app.current_tenant_id()
  and (worker_id = auth.uid() or app.is_tenant_admin())
)
with check (
  tenant_id = app.current_tenant_id()
  and (worker_id = auth.uid() or app.is_tenant_admin())
);

drop policy if exists inventory_records_delete_tenant_admin on public.inventory_records;
create policy inventory_records_delete_tenant_admin
on public.inventory_records for delete to authenticated
using (
  tenant_id = app.current_tenant_id()
  and app.is_tenant_admin()
);

-- ---------------------------------------------------------------------
-- 7. qr_scan_histories — raw QR payload + parsed values + match result
--
--    QR_SPEC §6 / §7 + ARCHITECTURE §4 R-05:
--    * target_table is restricted via fixed allow-list CHECK so the
--      validate_target_tenant() trigger (next migration) can safely
--      `EXECUTE format('… %I …', NEW.target_table)` without SQL injection
--      risk. Future migrations broadening this list must keep the trigger
--      allow-list in lockstep.
--    * raw_value capped at 4096 chars to mirror QR_SPEC §7 and the parser
--      constant QR_MAX_LENGTH (src/lib/qr/types.ts).
--    * raw_value SELECT will be hidden from non-admins by column grants +
--      views in migration 20260512000400 — kept here only as the storage
--      surface.
-- ---------------------------------------------------------------------
create table if not exists public.qr_scan_histories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  scanned_by uuid not null references auth.users(id),
  qr_type text not null check (qr_type in ('header', 'line', 'label')),
  qr_format_definition_id uuid references public.qr_format_definitions(id) on delete set null,
  raw_value text not null check (char_length(raw_value) <= 4096),
  parsed_values jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  match_result text not null default 'none'
    check (match_result in ('ok', 'ng', 'warning', 'skipped', 'none')),
  match_detail jsonb not null default '[]'::jsonb,
  target_table text check (
    target_table is null or target_table in (
      'movement_records',
      'movement_plans',
      'movement_plan_lines',
      'inventory_records',
      'inventory_plans',
      'inventory_plan_lines',
      'manufacturing_records',
      'manufacturing_plans',
      'mfg_processes'
    )
  ),
  target_id uuid,
  error_reason text,
  business_code text check (
    business_code is null or business_code in (
      'receiving', 'picking', 'inventory', 'manufacturing'
    )
  ),
  created_at timestamptz not null default now()
);

create index if not exists qr_scan_histories_tenant_created_idx
  on public.qr_scan_histories (tenant_id, created_at desc);
create index if not exists qr_scan_histories_tenant_business_created_idx
  on public.qr_scan_histories (tenant_id, business_code, created_at desc);
create index if not exists qr_scan_histories_target_idx
  on public.qr_scan_histories (target_table, target_id);
create index if not exists qr_scan_histories_format_idx
  on public.qr_scan_histories (qr_format_definition_id);
create index if not exists qr_scan_histories_scanned_by_idx
  on public.qr_scan_histories (scanned_by);

alter table public.qr_scan_histories enable row level security;

drop policy if exists qr_scan_histories_select_same_tenant on public.qr_scan_histories;
create policy qr_scan_histories_select_same_tenant
on public.qr_scan_histories for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

drop policy if exists qr_scan_histories_insert_self on public.qr_scan_histories;
create policy qr_scan_histories_insert_self
on public.qr_scan_histories for insert to authenticated
with check (
  tenant_id = app.current_tenant_id()
  and scanned_by = auth.uid()
);

drop policy if exists qr_scan_histories_update_tenant_admin on public.qr_scan_histories;
create policy qr_scan_histories_update_tenant_admin
on public.qr_scan_histories for update to authenticated
using (
  tenant_id = app.current_tenant_id()
  and app.is_tenant_admin()
)
with check (
  tenant_id = app.current_tenant_id()
  and app.is_tenant_admin()
);

drop policy if exists qr_scan_histories_delete_tenant_admin on public.qr_scan_histories;
create policy qr_scan_histories_delete_tenant_admin
on public.qr_scan_histories for delete to authenticated
using (
  tenant_id = app.current_tenant_id()
  and app.is_tenant_admin()
);

-- ---------------------------------------------------------------------
-- 8. updated_at triggers for every Phase 3a table.
--    qr_scan_histories is append-only (no updated_at column) so it is
--    excluded from the touch loop.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'movement_plans',
      'movement_plan_lines',
      'movement_records',
      'inventory_plans',
      'inventory_plan_lines',
      'inventory_records'
    ])
  loop
    execute format(
      'drop trigger if exists %I_touch on public.%I;',
      t, t
    );
    execute format(
      'create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_columns();',
      t, t
    );
  end loop;
end $$;

-- =====================================================================
-- End of Phase 3a foundation migration.
-- =====================================================================
