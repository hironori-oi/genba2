-- =====================================================================
-- Phase 3a RLS test SQL — documents the expected outcomes for the new
-- Phase 3a LOGI foundation tables and the qr_scan_histories trigger /
-- raw_value protection. Live two-JWT integration tests run against a
-- Supabase instance via tests/integration/rls/rls-phase3a.test.ts.
-- =====================================================================

do $$
declare
  msg text;
begin
  msg := 'RLS-007 (qr_scan_histories target_id cross-tenant INSERT) — expect 42501 from validate_target_tenant() trigger.';
  raise notice '%', msg;
  msg := 'RLS-201 (movement_records cross-tenant SELECT) — expect 0 rows.';
  raise notice '%', msg;
  msg := 'RLS-202 (worker INSERT into movement_records with worker_id != auth.uid()) — expect 42501.';
  raise notice '%', msg;
  msg := 'RLS-203 (worker UPDATE of another worker''s movement_record same tenant) — expect 0 rows unless tenant_admin.';
  raise notice '%', msg;
  msg := 'RLS-204 (inventory_records cross-tenant SELECT) — expect 0 rows.';
  raise notice '%', msg;
  msg := 'RLS-205 (SELECT raw_value FROM qr_scan_histories as authenticated worker) — expect column-grant permission error or empty raw_value via view.';
  raise notice '%', msg;
  msg := 'RLS-206 (SELECT raw_value via v_qr_scan_histories_admin as tenant_admin) — expect rows; as worker expect 0 rows.';
  raise notice '%', msg;
  msg := 'RLS-207 (qr_scan_histories raw_value 4097-char INSERT) — expect CHECK constraint violation.';
  raise notice '%', msg;
  msg := 'RLS-208 (qr_scan_histories target_table=''users'' INSERT) — expect CHECK constraint violation (not in allow-list).';
  raise notice '%', msg;
end $$;
