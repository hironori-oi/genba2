-- =====================================================================
-- GENBA Phase 3b: CSV import job tracking + Phase 3a P2 follow-ups
-- =====================================================================
-- This migration closes the three P2 follow-ups deferred from the
-- Phase 3a security audit (docs/SECURITY-AUDIT-2026-05-12-phase3a.md):
--
--   (a) parent-tenant drift defense on movement_plan_lines /
--       inventory_plan_lines — BEFORE INSERT/UPDATE trigger that ensures
--       the parent plan's tenant_id matches the line's denormalised
--       tenant_id. RLS already guards the read path, but service_role
--       writes or a future buggy migration could otherwise produce an
--       orphan line that survives in storage.
--   (b) parsed_values size cap on qr_scan_histories — a DB-level CHECK
--       on `pg_column_size(parsed_values) <= 8192`. Storage / index
--       bloat defense; mirrors the zod tightening in src/lib/logi/
--       validators.ts (separate dispatch).
--
-- It also introduces the new csv_import_jobs table that the two Phase 3b
-- Edge Functions (movement-csv-import / inventory-csv-import) will write
-- a header row into so the UI can poll status + render row-level errors
-- without exposing the raw file. The table is tenant-scoped + RLS-gated
-- like every other tenant-owned table; only tenant_admin (or the
-- requester themselves) sees rows for their tenant.
--
-- Idempotent: every CREATE TABLE uses IF NOT EXISTS, every CREATE POLICY
-- is preceded by DROP POLICY IF EXISTS, every CREATE TRIGGER by DROP
-- TRIGGER IF EXISTS, and the parsed_values CHECK uses a guarded ALTER.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. csv_import_jobs — header row per CSV upload.
--    `errors` jsonb is bounded at the Edge Function layer (max 200 rows)
--    so we do not need a DB-level size cap here; storage will rarely
--    exceed a few KB. status enum is text+CHECK rather than a Postgres
--    ENUM because Phase 3a established that pattern (cheaper to migrate
--    new states later than to ALTER an enum).
-- ---------------------------------------------------------------------
create table if not exists public.csv_import_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('movement', 'inventory')),
  source_storage_path text not null,
  total_rows integer not null default 0 check (total_rows >= 0),
  success_rows integer not null default 0 check (success_rows >= 0),
  error_rows integer not null default 0 check (error_rows >= 0),
  errors jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed')),
  requested_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists csv_import_jobs_tenant_created_idx
  on public.csv_import_jobs (tenant_id, created_at desc);
create index if not exists csv_import_jobs_tenant_status_idx
  on public.csv_import_jobs (tenant_id, status);
create index if not exists csv_import_jobs_requested_by_idx
  on public.csv_import_jobs (requested_by);

alter table public.csv_import_jobs enable row level security;

-- SELECT: same-tenant read for everyone (workers can see their own job
-- status when polling); admins also see other workers' jobs in the same
-- tenant. system_admin sees everything.
drop policy if exists csv_import_jobs_select_same_tenant on public.csv_import_jobs;
create policy csv_import_jobs_select_same_tenant
on public.csv_import_jobs for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

-- INSERT: tenant_admin only. Workers do not upload CSVs in Phase 3b —
-- import is an admin-only operation per UC-3 (棚卸予定を CSV 取込) and
-- the import-screen authz check. service_role bypasses RLS.
drop policy if exists csv_import_jobs_insert_tenant_admin on public.csv_import_jobs;
create policy csv_import_jobs_insert_tenant_admin
on public.csv_import_jobs for insert to authenticated
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- UPDATE: tenant_admin only (status / row counts / errors / finished_at
-- progression). The Edge Function uses service_role and bypasses this.
drop policy if exists csv_import_jobs_update_tenant_admin on public.csv_import_jobs;
create policy csv_import_jobs_update_tenant_admin
on public.csv_import_jobs for update to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- DELETE: tenant_admin only.
drop policy if exists csv_import_jobs_delete_tenant_admin on public.csv_import_jobs;
create policy csv_import_jobs_delete_tenant_admin
on public.csv_import_jobs for delete to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- updated_at touch on UPDATE — reuses the Phase 1 helper.
drop trigger if exists csv_import_jobs_touch on public.csv_import_jobs;
create trigger csv_import_jobs_touch
before update on public.csv_import_jobs
for each row execute function public.touch_updated_columns();

-- ---------------------------------------------------------------------
-- 2. Parent-tenant drift defense (Phase 3a P2 follow-up #2 / #3 of audit).
--    SECURITY DEFINER so the trigger can SELECT the parent plan even if
--    the caller is RLS-restricted. search_path = '' to avoid the
--    pick-checker 013 lesson; we fully-qualify every table reference.
--
--    The trigger executes BEFORE INSERT and BEFORE UPDATE OF the FK or
--    tenant_id columns so we never re-scan a row whose parent FK has
--    not changed. The early NULL check matches the rest of the codebase
--    (allow null parent for free-read rows where applicable; currently
--    plan_lines have NOT NULL parent FKs, but the guard is cheap).
-- ---------------------------------------------------------------------
create or replace function public.enforce_plan_line_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_tenant_id uuid;
  parent_table text;
  parent_id uuid;
begin
  -- Resolve which parent table to look up by inspecting the trigger
  -- context. TG_TABLE_NAME is set by Postgres for trigger functions.
  if tg_table_name = 'movement_plan_lines' then
    parent_table := 'movement_plans';
    parent_id := new.movement_plan_id;
  elsif tg_table_name = 'inventory_plan_lines' then
    parent_table := 'inventory_plans';
    parent_id := new.inventory_plan_id;
  else
    -- Defense in depth: if someone wires this function to an unexpected
    -- table the trigger refuses rather than silently allow. errcode
    -- 42501 (insufficient_privilege) keeps the externally observable
    -- behaviour consistent with our other tenancy guards.
    raise exception 'enforce_plan_line_tenant fired on unsupported table %', tg_table_name
      using errcode = '42501';
  end if;

  if parent_id is null then
    -- A NOT NULL constraint exists on the FK column at the table level,
    -- but if a future migration relaxes it the early return keeps the
    -- trigger safe rather than crashing with a NULL parent lookup.
    return new;
  end if;

  execute format(
    'select tenant_id from public.%I where id = $1',
    parent_table
  )
  using parent_id
  into parent_tenant_id;

  if parent_tenant_id is null then
    raise exception '% parent % not found in public.%',
      tg_table_name, parent_id, parent_table
      using errcode = '42501';
  end if;

  if parent_tenant_id <> new.tenant_id then
    raise exception '% tenant_id mismatch with parent %.tenant_id',
      tg_table_name, parent_table
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_plan_line_tenant() from public;
grant execute on function public.enforce_plan_line_tenant() to authenticated, service_role;

drop trigger if exists movement_plan_lines_enforce_tenant on public.movement_plan_lines;
create trigger movement_plan_lines_enforce_tenant
before insert or update of movement_plan_id, tenant_id
on public.movement_plan_lines
for each row
execute function public.enforce_plan_line_tenant();

drop trigger if exists inventory_plan_lines_enforce_tenant on public.inventory_plan_lines;
create trigger inventory_plan_lines_enforce_tenant
before insert or update of inventory_plan_id, tenant_id
on public.inventory_plan_lines
for each row
execute function public.enforce_plan_line_tenant();

-- ---------------------------------------------------------------------
-- 3. parsed_values size cap on qr_scan_histories (Phase 3a P2 follow-up).
--    pg_column_size returns the on-disk size (jsonb is binary-packed so
--    8192 bytes typically maps to ~2x text size). The cap is generous
--    enough that legitimate QR payloads (≤4096 chars + parser output)
--    fit comfortably; abusive payloads from a compromised parser are
--    rejected at INSERT time. Idempotent: drop the named CHECK first
--    in case a previous failed deploy left a stale partial constraint.
-- ---------------------------------------------------------------------
alter table public.qr_scan_histories
  drop constraint if exists qr_scan_histories_parsed_values_size;

alter table public.qr_scan_histories
  add constraint qr_scan_histories_parsed_values_size
  check (pg_column_size(parsed_values) <= 8192);

-- =====================================================================
-- End of Phase 3b CSV jobs + P2 follow-up migration.
-- =====================================================================
