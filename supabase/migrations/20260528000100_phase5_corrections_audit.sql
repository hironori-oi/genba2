-- =====================================================================
-- GENBA Phase 5a: corrections_audit table + RLS (immutable audit log).
-- =====================================================================
-- Implements docs/ARCHITECTURE-phase5-admin-ui.md §3.5 ADR-P5-03 + §4.3.
--
-- Purpose: record WHO / WHEN / WHY of every 4-業務 correction. previous-
-- _record_id alone (on movement_records / inventory_records / manufact-
-- uring_records / manufacturing_record_defects) only chains the rows;
-- the actor_id, reason, and (optional) approved_by must live elsewhere.
--
-- Immutability:
--   * INSERT は actor_id = auth.uid() + tenant_id = current で gate
--     (correction RPC が anon JWT 経由で書き込む経路のみ許可)
--   * UPDATE は tenant_admin / system_admin のみ (approval workflow)
--   * DELETE policy は意図的に作らない (= 不変)
--
-- Index strategy: (tenant_id, business_code, created_at desc) で
-- 「過去 N 件の訂正一覧」を 1 index で satisfy.
--
-- Idempotent: every CREATE uses IF NOT EXISTS / DROP IF EXISTS.
-- =====================================================================

create table if not exists public.corrections_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  business_code text not null check (
    business_code in ('receiving', 'picking', 'inventory', 'manufacturing')
  ),
  target_table text not null check (
    target_table in (
      'movement_records',
      'inventory_records',
      'manufacturing_records',
      'manufacturing_record_defects'
    )
  ),
  old_record_id uuid not null,
  new_record_id uuid not null,
  reason text not null check (char_length(reason) between 1 and 256),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists corrections_audit_tenant_business_created_idx
  on public.corrections_audit (tenant_id, business_code, created_at desc);

create index if not exists corrections_audit_old_record_idx
  on public.corrections_audit (old_record_id);

create index if not exists corrections_audit_new_record_idx
  on public.corrections_audit (new_record_id);

create index if not exists corrections_audit_actor_idx
  on public.corrections_audit (actor_id);

alter table public.corrections_audit enable row level security;

-- SELECT: 同テナント所属の authenticated user / system_admin
drop policy if exists corrections_audit_select_same_tenant
  on public.corrections_audit;
create policy corrections_audit_select_same_tenant
on public.corrections_audit for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

-- INSERT: caller の tenant_id と actor_id (=auth.uid()) のみ許可。
--   実運用上 INSERT は correction RPC (SECURITY INVOKER) 経由のみだが、
--   RLS 側でも actor_id = auth.uid() を強制し、別人なりすまし INSERT を
--   reject (architect §4.3 / R-P5 「forensic integrity」)。
drop policy if exists corrections_audit_insert_via_rpc
  on public.corrections_audit;
create policy corrections_audit_insert_via_rpc
on public.corrections_audit for insert to authenticated
with check (
  tenant_id = app.current_tenant_id()
  and actor_id = auth.uid()
);

-- UPDATE: tenant_admin / system_admin のみ。承認フロー (approved_by /
-- approved_at の書込) で利用。worker UPDATE は reject。
drop policy if exists corrections_audit_update_tenant_admin
  on public.corrections_audit;
create policy corrections_audit_update_tenant_admin
on public.corrections_audit for update to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- DELETE policy: 意図的に作らない (audit log は不変)
-- =====================================================================
-- End of Phase 5a corrections_audit migration.
-- =====================================================================
