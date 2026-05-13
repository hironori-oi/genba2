-- =====================================================================
-- Phase 2 RLS test SQL — documents the expected outcomes for the new
-- Phase 2 settings + masters tables. Live two-JWT integration tests run
-- against a Supabase instance via tests/integration/rls/.
-- =====================================================================

do $$
declare
  msg text;
begin
  msg := 'RLS-101 (qr_format_definitions T2->T1 SELECT) — expect 0 rows for cross-tenant SELECT.';
  raise notice '%', msg;
  msg := 'RLS-102 (qr_item_definitions parent-tenant join) — worker in T2 SELECT items of T1 format — expect 0 rows.';
  raise notice '%', msg;
  msg := 'RLS-103 (worker INSERT into qr_format_definitions) — expect 42501 (insufficient privilege).';
  raise notice '%', msg;
  msg := 'RLS-104 (tenant_field_settings worker UPDATE) — expect 0 rows updated when role=worker.';
  raise notice '%', msg;
  msg := 'RLS-105 (match_rules cross-tenant DELETE) — expect 0 rows deleted.';
  raise notice '%', msg;
  msg := 'RLS-106 (work_settings worker INSERT) — expect 42501 (worker cannot create work_settings).';
  raise notice '%', msg;
  msg := 'RLS-107 (csv_import_definitions cross-tenant SELECT) — expect 0 rows.';
  raise notice '%', msg;
  msg := 'RLS-108 (standard_field_definitions worker UPDATE) — expect 42501 (only system_admin can edit catalog).';
  raise notice '%', msg;
end $$;
