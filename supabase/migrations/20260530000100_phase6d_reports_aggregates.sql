-- =====================================================================
-- GENBA Phase 6d: Reports aggregates — monthly_scan_usage MV + RLS wrapper
-- + manufacturing_record_defects breakdown index.
--
-- Dispatch: T-20260515-090000-genba-phase6d-reports
-- Architect: docs/ARCHITECTURE-phase6-operational-features.md §B.3 / §C.6d.
--
-- Design notes:
--   * MV `public.mv_monthly_scan_usage` aggregates `qr_scan_histories`
--     per (tenant_id, period_start, business_code). Refreshed by the
--     Phase 6f Edge Function cron (out of scope here — this migration
--     ships SQL only).
--   * Postgres does NOT apply RLS to materialized views. Architect §B.3.4
--     prescribes wrapping the MV with a view that re-establishes the
--     tenant gate. We use `security_invoker = true` + a join through the
--     RLS-protected `public.tenant_subscriptions` table — callers can
--     only see their own tenant's subscriptions row, so the join
--     transparently filters MV rows to that same tenant. This avoids
--     adding a new RPC (architect: "RPC 不要").
--   * Concurrent refresh requires a UNIQUE index on the MV; we add one
--     on (tenant_id, period_start, business_code).
--   * Defect breakdown: a partial composite index on
--     (tenant_id, defect_id, recorded_at desc) speeds up the weekly /
--     monthly "top 5 defect" rollups. NOTE: the actual schema uses
--     `defect_id uuid` (not the architect's draft `defect_code`).
-- =====================================================================

-- 1. MV: monthly QR scan usage per tenant × business_code -------------

create materialized view if not exists public.mv_monthly_scan_usage as
select
  tenant_id,
  date_trunc('month', created_at)::date as period_start,
  business_code,
  count(*)::bigint as scan_count
from public.qr_scan_histories
group by 1, 2, 3;

-- UNIQUE index — required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
create unique index if not exists mv_monthly_scan_usage_uniq_idx
  on public.mv_monthly_scan_usage (tenant_id, period_start, business_code);

-- Tenant-pinned scan index for the dashboard SELECT path.
create index if not exists mv_monthly_scan_usage_tenant_period_idx
  on public.mv_monthly_scan_usage (tenant_id, period_start desc);

-- Grant SELECT to authenticated. RLS is enforced via the wrapper view
-- below (MVs themselves cannot host RLS policies in Postgres 15).
grant select on public.mv_monthly_scan_usage to authenticated;

-- 2. RLS-safe wrapper view -------------------------------------------
--
-- `security_invoker = true` ensures the view's SELECT runs with the
-- caller's privileges; the INNER JOIN through `tenant_subscriptions`
-- (which DOES have RLS) means an authenticated user can only observe
-- MV rows whose tenant they're a member of. Cross-tenant SELECT
-- naturally returns 0 rows because the join eliminates them. This is
-- the RLS-601..610 (Phase 6d aggregate variant) invariant.

create or replace view public.monthly_scan_usage
with (security_invoker = true) as
select
  mv.tenant_id,
  mv.period_start,
  mv.business_code,
  mv.scan_count
from public.mv_monthly_scan_usage mv
join public.tenant_subscriptions ts on ts.tenant_id = mv.tenant_id;

grant select on public.monthly_scan_usage to authenticated;

comment on view public.monthly_scan_usage is
  'Phase 6d RLS-safe wrapper around mv_monthly_scan_usage. Tenant gate enforced via security_invoker + join through tenant_subscriptions (RLS-gated). Architect B.3.4.';

-- 3. Defect breakdown composite index --------------------------------

create index if not exists manufacturing_record_defects_tenant_defect_recorded_idx
  on public.manufacturing_record_defects (tenant_id, defect_id, recorded_at desc)
  where deleted_at is null;

comment on index public.manufacturing_record_defects_tenant_defect_recorded_idx is
  'Phase 6d defect breakdown rollup index. Supports weekly/monthly top-N defect aggregates by tenant. Partial: deleted_at is null.';
