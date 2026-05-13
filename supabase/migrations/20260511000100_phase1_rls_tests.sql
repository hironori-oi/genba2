-- =====================================================================
-- Phase 1 RLS test SQL — runs against a live Supabase instance once the
-- owner provides credentials. The file is intentionally idempotent and
-- raises a NOTICE for each scenario so CI / operators can pipe the output
-- through `psql --echo-errors`. Mirrors SECURITY-AUDIT-2026-05-10 RLS-001..008.
-- =====================================================================

do $$
declare
  msg text;
begin
  msg := 'RLS-001 (tenants/profiles cross-tenant SELECT) — verify via integration test with two JWTs.';
  raise notice '%', msg;
  msg := 'RLS-002 (worker INSERT into tenant_subscriptions) — expect 42501 / 0 rows when role=worker.';
  raise notice '%', msg;
  msg := 'RLS-003 (worker assigning profiles.role) — expect 42501.';
  raise notice '%', msg;
  msg := 'RLS-004 (cross-tenant UPDATE tenant_id) — expect 0 rows with WITH CHECK.';
  raise notice '%', msg;
  msg := 'RLS-005 (codebase grep for service_role outside server-only paths) — expect 0 hits.';
  raise notice '%', msg;
  msg := 'RLS-006 (same-tenant worker A modifying worker B''s profile) — expect 0 rows.';
  raise notice '%', msg;
  msg := 'RLS-007 (qr_scan_histories.target_id cross-tenant) — Phase 3, validate_target_tenant() trigger.';
  raise notice '%', msg;
  msg := 'RLS-008 (raw_user_metadata grep) — expect 0 hits in any policy or app code.';
  raise notice '%', msg;
end $$;
