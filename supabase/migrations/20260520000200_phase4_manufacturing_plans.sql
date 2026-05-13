-- =====================================================================
-- GENBA Phase 4a: manufacturing_plans + mfg_processes + parent tenant
--                 drift validation trigger.
-- =====================================================================
-- Implements docs/ARCHITECTURE-phase4-manufacturing.md §3.3 (ER) + §4.4
-- (enforce_mfg_process_tenant trigger).
--
-- Naming (ADR-P4-01): the per-plan工程 child is `mfg_processes` (not the
-- spec-original `manufacturing_plan_processes`). The Phase 3a allow-list
-- (qr_scan_histories.target_table CHECK + validate_target_tenant()) already
-- hard-codes `mfg_processes` — renaming would require synchronised edits
-- in 3 places. The master `processes` table from migration 20260520000100
-- is a distinct concept (tenant-wide工程 master); `mfg_processes` is the
-- per-plan工順 line. The `process_id` FK below links the two.
--
-- Tenant integrity (docs §4.4):
--   * mfg_processes.tenant_id is denormalised from manufacturing_plans for
--     fast RLS without a JOIN.
--   * BEFORE INSERT/UPDATE OF (manufacturing_plan_id, tenant_id) trigger
--     enforce_mfg_process_tenant() (SECURITY DEFINER, search_path='')
--     refuses drift between parent and child tenant_id with errcode 42501,
--     mirroring the Phase 3b enforce_plan_line_tenant() trigger.
--
-- Idempotent: every CREATE TABLE uses IF NOT EXISTS, every CREATE POLICY
-- is preceded by DROP POLICY IF EXISTS, every CREATE TRIGGER by DROP
-- TRIGGER IF EXISTS, every CREATE INDEX by IF NOT EXISTS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. manufacturing_plans — 製造指示ヘッダ
--    CSV 取込メタ列 (imported_file_name / imported_at) は Phase 4b
--    manufacturing-plan-csv-import EF が SET する。
-- ---------------------------------------------------------------------
create table if not exists public.manufacturing_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_no text not null,
  item_code text not null,
  planned_quantity numeric not null check (planned_quantity >= 0),
  lot text,
  start_date date,
  end_date date,
  status text not null default 'active'
    check (status in ('draft', 'active', 'closed')),
  notes text,
  imported_file_name text,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id, order_no)
);

create index if not exists manufacturing_plans_tenant_idx
  on public.manufacturing_plans (tenant_id);
create index if not exists manufacturing_plans_tenant_status_idx
  on public.manufacturing_plans (tenant_id, status);
create index if not exists manufacturing_plans_tenant_item_idx
  on public.manufacturing_plans (tenant_id, item_code);

alter table public.manufacturing_plans enable row level security;

drop policy if exists manufacturing_plans_select_same_tenant on public.manufacturing_plans;
create policy manufacturing_plans_select_same_tenant
on public.manufacturing_plans for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

drop policy if exists manufacturing_plans_modify_tenant_admin on public.manufacturing_plans;
create policy manufacturing_plans_modify_tenant_admin
on public.manufacturing_plans for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- ---------------------------------------------------------------------
-- 2. mfg_processes — 工順 (manufacturing_plans 1:N, 工程ごと)
--    tenant_id denormalised; parent tenant drift defended by trigger #3.
-- ---------------------------------------------------------------------
create table if not exists public.mfg_processes (
  id uuid primary key default gen_random_uuid(),
  manufacturing_plan_id uuid not null references public.manufacturing_plans(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  process_order integer not null,
  process_id uuid references public.processes(id) on delete restrict,
  equipment_id uuid references public.equipment(id) on delete restrict,
  assigned_worker_id uuid references auth.users(id),
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'done', 'canceled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (manufacturing_plan_id, process_order)
);

create index if not exists mfg_processes_plan_idx
  on public.mfg_processes (manufacturing_plan_id);
create index if not exists mfg_processes_tenant_idx
  on public.mfg_processes (tenant_id);
create index if not exists mfg_processes_tenant_status_idx
  on public.mfg_processes (tenant_id, status);
create index if not exists mfg_processes_process_idx
  on public.mfg_processes (process_id);
create index if not exists mfg_processes_equipment_idx
  on public.mfg_processes (equipment_id);

alter table public.mfg_processes enable row level security;

drop policy if exists mfg_processes_select_same_tenant on public.mfg_processes;
create policy mfg_processes_select_same_tenant
on public.mfg_processes for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

drop policy if exists mfg_processes_modify_tenant_admin on public.mfg_processes;
create policy mfg_processes_modify_tenant_admin
on public.mfg_processes for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- ---------------------------------------------------------------------
-- 3. enforce_mfg_process_tenant() — parent (manufacturing_plans) tenant
--    drift defense. Mirrors Phase 3b enforce_plan_line_tenant() pattern.
--    SECURITY DEFINER + search_path='' so the trigger can SELECT the
--    parent plan even if the caller is RLS-restricted, and never depends
--    on session search_path (pick-checker 013 lesson).
-- ---------------------------------------------------------------------
create or replace function public.enforce_mfg_process_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_tenant_id uuid;
begin
  if new.manufacturing_plan_id is null then
    return new;
  end if;

  select tenant_id
    into parent_tenant_id
    from public.manufacturing_plans
   where id = new.manufacturing_plan_id;

  if parent_tenant_id is null then
    raise exception 'mfg_processes parent manufacturing_plans % not found',
      new.manufacturing_plan_id
      using errcode = '42501';
  end if;

  if parent_tenant_id <> new.tenant_id then
    raise exception 'mfg_processes tenant_id mismatch with parent manufacturing_plans.tenant_id'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_mfg_process_tenant() from public;
grant execute on function public.enforce_mfg_process_tenant() to authenticated, service_role;

drop trigger if exists mfg_processes_enforce_tenant on public.mfg_processes;
create trigger mfg_processes_enforce_tenant
before insert or update of manufacturing_plan_id, tenant_id
on public.mfg_processes
for each row
execute function public.enforce_mfg_process_tenant();

-- ---------------------------------------------------------------------
-- 4. updated_at touch triggers
-- ---------------------------------------------------------------------
drop trigger if exists manufacturing_plans_touch on public.manufacturing_plans;
create trigger manufacturing_plans_touch
before update on public.manufacturing_plans
for each row execute function public.touch_updated_columns();

drop trigger if exists mfg_processes_touch on public.mfg_processes;
create trigger mfg_processes_touch
before update on public.mfg_processes
for each row execute function public.touch_updated_columns();

-- =====================================================================
-- End of Phase 4a manufacturing_plans + mfg_processes migration.
-- =====================================================================
