-- =====================================================================
-- GENBA Phase 4a: manufacturing_records + manufacturing_record_defects
--                 + parent tenant drift trigger #2.
-- =====================================================================
-- Implements docs/ARCHITECTURE-phase4-manufacturing.md §3.3 (3rd/4th
-- table) + §4.1 (RLS template) + §4.4 (enforce_manufacturing_record_-
-- defect_tenant trigger).
--
-- RLS pattern (LOGI movement_records と同形):
--   * manufacturing_records:
--     - SELECT same tenant or system_admin
--     - INSERT worker tenant_id = current AND worker_id = auth.uid()
--     - UPDATE self or tenant_admin (WITH CHECK pin tenant_id)
--     - DELETE tenant_admin
--   * manufacturing_record_defects (worker INSERT permitted because the
--     parent manufacturing_record was authored by this worker; recorder
--     check goes through the SECURITY DEFINER tenant-drift trigger plus
--     a created_by/tenant pin in the policy):
--     - SELECT same tenant or system_admin
--     - INSERT tenant_id = current AND created_by = auth.uid()
--     - UPDATE creator self or tenant_admin
--     - DELETE tenant_admin
--
-- Tenant integrity:
--   * manufacturing_record_defects.tenant_id is denormalised from the
--     parent manufacturing_records row. A SECURITY DEFINER trigger
--     enforce_manufacturing_record_defect_tenant() defends drift, mirror
--     of Phase 3b enforce_plan_line_tenant() but with parent table
--     hard-coded to manufacturing_records (no TG_TABLE_NAME branching,
--     per architect ADR — keeps the search_path='' surface minimal).
--
-- Idempotent: every CREATE uses IF NOT EXISTS / DROP IF EXISTS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. manufacturing_records — 製造実績 (mfg_processes 1:N)
--    work_minutes は started_at / ended_at から GENERATED.
--    started_at <= ended_at は CHECK で守る (NULL は許容)。
-- ---------------------------------------------------------------------
create table if not exists public.manufacturing_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mfg_process_id uuid not null references public.mfg_processes(id) on delete restrict,
  worker_id uuid not null references auth.users(id),
  work_date date not null,
  actual_quantity numeric not null check (actual_quantity >= 0),
  good_quantity numeric check (good_quantity is null or good_quantity >= 0),
  defect_quantity numeric not null default 0 check (defect_quantity >= 0),
  lot text,
  equipment_id uuid references public.equipment(id) on delete restrict,
  started_at timestamptz,
  ended_at timestamptz,
  work_minutes numeric generated always as (
    case
      when started_at is not null and ended_at is not null
        then extract(epoch from (ended_at - started_at)) / 60.0
      else null
    end
  ) stored,
  match_result text not null default 'ok'
    check (match_result in ('ok', 'ng', 'warning', 'skipped')),
  match_detail jsonb not null default '[]'::jsonb,
  recorded_at timestamptz not null default now(),
  previous_record_id uuid references public.manufacturing_records(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  check (started_at is null or ended_at is null or ended_at >= started_at)
);

create index if not exists manufacturing_records_tenant_recorded_idx
  on public.manufacturing_records (tenant_id, recorded_at desc);
create index if not exists manufacturing_records_process_idx
  on public.manufacturing_records (mfg_process_id);
create index if not exists manufacturing_records_worker_idx
  on public.manufacturing_records (worker_id);
create index if not exists manufacturing_records_previous_idx
  on public.manufacturing_records (previous_record_id);
create index if not exists manufacturing_records_tenant_work_date_idx
  on public.manufacturing_records (tenant_id, work_date desc);

alter table public.manufacturing_records enable row level security;

drop policy if exists manufacturing_records_select_same_tenant on public.manufacturing_records;
create policy manufacturing_records_select_same_tenant
on public.manufacturing_records for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

drop policy if exists manufacturing_records_insert_worker on public.manufacturing_records;
create policy manufacturing_records_insert_worker
on public.manufacturing_records for insert to authenticated
with check (
  tenant_id = app.current_tenant_id()
  and worker_id = auth.uid()
);

drop policy if exists manufacturing_records_update_self_or_admin on public.manufacturing_records;
create policy manufacturing_records_update_self_or_admin
on public.manufacturing_records for update to authenticated
using (
  tenant_id = app.current_tenant_id()
  and (worker_id = auth.uid() or app.is_tenant_admin())
)
with check (
  tenant_id = app.current_tenant_id()
  and (worker_id = auth.uid() or app.is_tenant_admin())
);

drop policy if exists manufacturing_records_delete_tenant_admin on public.manufacturing_records;
create policy manufacturing_records_delete_tenant_admin
on public.manufacturing_records for delete to authenticated
using (
  tenant_id = app.current_tenant_id()
  and app.is_tenant_admin()
);

-- ---------------------------------------------------------------------
-- 2. manufacturing_record_defects — 製造実績不適合 (manufacturing_records 1:N)
--    tenant_id denormalised, parent tenant drift defended by trigger #3.
-- ---------------------------------------------------------------------
create table if not exists public.manufacturing_record_defects (
  id uuid primary key default gen_random_uuid(),
  manufacturing_record_id uuid not null references public.manufacturing_records(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  defect_id uuid not null references public.defects(id) on delete restrict,
  defect_quantity numeric not null check (defect_quantity >= 0),
  notes text,
  recorded_at timestamptz not null default now(),
  previous_record_id uuid references public.manufacturing_record_defects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz
);

create index if not exists manufacturing_record_defects_record_idx
  on public.manufacturing_record_defects (manufacturing_record_id);
create index if not exists manufacturing_record_defects_tenant_idx
  on public.manufacturing_record_defects (tenant_id);
create index if not exists manufacturing_record_defects_defect_idx
  on public.manufacturing_record_defects (defect_id);
create index if not exists manufacturing_record_defects_previous_idx
  on public.manufacturing_record_defects (previous_record_id);

alter table public.manufacturing_record_defects enable row level security;

drop policy if exists manufacturing_record_defects_select_same_tenant on public.manufacturing_record_defects;
create policy manufacturing_record_defects_select_same_tenant
on public.manufacturing_record_defects for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

drop policy if exists manufacturing_record_defects_insert_worker on public.manufacturing_record_defects;
create policy manufacturing_record_defects_insert_worker
on public.manufacturing_record_defects for insert to authenticated
with check (
  tenant_id = app.current_tenant_id()
  and created_by = auth.uid()
);

drop policy if exists manufacturing_record_defects_update_self_or_admin on public.manufacturing_record_defects;
create policy manufacturing_record_defects_update_self_or_admin
on public.manufacturing_record_defects for update to authenticated
using (
  tenant_id = app.current_tenant_id()
  and (created_by = auth.uid() or app.is_tenant_admin())
)
with check (
  tenant_id = app.current_tenant_id()
  and (created_by = auth.uid() or app.is_tenant_admin())
);

drop policy if exists manufacturing_record_defects_delete_tenant_admin on public.manufacturing_record_defects;
create policy manufacturing_record_defects_delete_tenant_admin
on public.manufacturing_record_defects for delete to authenticated
using (
  tenant_id = app.current_tenant_id()
  and app.is_tenant_admin()
);

-- ---------------------------------------------------------------------
-- 3. enforce_manufacturing_record_defect_tenant() — parent
--    (manufacturing_records) tenant drift defense.
--    Same SECURITY DEFINER + search_path='' guard as
--    enforce_mfg_process_tenant().
-- ---------------------------------------------------------------------
create or replace function public.enforce_manufacturing_record_defect_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_tenant_id uuid;
begin
  if new.manufacturing_record_id is null then
    return new;
  end if;

  select tenant_id
    into parent_tenant_id
    from public.manufacturing_records
   where id = new.manufacturing_record_id;

  if parent_tenant_id is null then
    raise exception 'manufacturing_record_defects parent manufacturing_records % not found',
      new.manufacturing_record_id
      using errcode = '42501';
  end if;

  if parent_tenant_id <> new.tenant_id then
    raise exception 'manufacturing_record_defects tenant_id mismatch with parent manufacturing_records.tenant_id'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_manufacturing_record_defect_tenant() from public;
grant execute on function public.enforce_manufacturing_record_defect_tenant()
  to authenticated, service_role;

drop trigger if exists manufacturing_record_defects_enforce_tenant on public.manufacturing_record_defects;
create trigger manufacturing_record_defects_enforce_tenant
before insert or update of manufacturing_record_id, tenant_id
on public.manufacturing_record_defects
for each row
execute function public.enforce_manufacturing_record_defect_tenant();

-- ---------------------------------------------------------------------
-- 4. updated_at touch triggers
-- ---------------------------------------------------------------------
drop trigger if exists manufacturing_records_touch on public.manufacturing_records;
create trigger manufacturing_records_touch
before update on public.manufacturing_records
for each row execute function public.touch_updated_columns();

drop trigger if exists manufacturing_record_defects_touch on public.manufacturing_record_defects;
create trigger manufacturing_record_defects_touch
before update on public.manufacturing_record_defects
for each row execute function public.touch_updated_columns();

-- =====================================================================
-- End of Phase 4a manufacturing_records + manufacturing_record_defects.
-- =====================================================================
