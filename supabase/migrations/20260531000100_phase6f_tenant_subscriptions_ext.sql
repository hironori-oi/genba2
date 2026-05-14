-- =====================================================================
-- GENBA Phase 6f: tenant_subscriptions extension
-- =====================================================================
-- Dispatch: T-20260515-110000-genba-phase6f-admin-ops
-- Architect: docs/ARCHITECTURE-phase6-operational-features.md §C.6f-1.
--
-- Existing Phase 1 table (public.tenant_subscriptions) already carries
--   plan / enabled_businesses / enabled_features / max_users /
--   max_scans_per_month / pitr_enabled / audit columns.
-- 6f-1 only adds two new lifecycle columns (`plan_started_at`,
-- `plan_ended_at`) so system_admin can record subscription windows.
-- RLS policies are unchanged (Phase 1 already enforces:
--   SELECT: same tenant OR system_admin; ALL: system_admin only).
-- =====================================================================

alter table public.tenant_subscriptions
  add column if not exists plan_started_at timestamptz;

alter table public.tenant_subscriptions
  add column if not exists plan_ended_at timestamptz;

-- Backfill plan_started_at for existing rows from created_at so legacy
-- subscription rows do not display empty lifecycle in the admin UI.
update public.tenant_subscriptions
   set plan_started_at = created_at
 where plan_started_at is null;

comment on column public.tenant_subscriptions.plan_started_at is
  'Phase 6f-1: subscription plan start (system_admin set). Null = unknown / backfilled.';
comment on column public.tenant_subscriptions.plan_ended_at is
  'Phase 6f-1: subscription plan end. Null = active (currently valid).';

-- =====================================================================
-- End of Phase 6f-1 tenant_subscriptions extension.
-- =====================================================================
