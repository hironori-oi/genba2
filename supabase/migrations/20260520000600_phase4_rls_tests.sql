-- =====================================================================
-- GENBA Phase 4a: RLS-401..408 declared test catalog (Phase 4a marker)
-- =====================================================================
-- This migration is documentation-only. It executes a no-op DO block that
-- emits the RLS-401..408 test catalog as a NOTICE in the Supabase logs at
-- apply time. The actual live execution of these tests is deferred to
-- Phase 4d per docs/ARCHITECTURE-phase4-manufacturing.md §7.1 / §8.2 —
-- this marker migration exists so that:
--
--   1. The Phase 4a apply sequence has a stable terminal file (`...600`)
--      visible in the migrations directory, matching the architect doc.
--   2. A future operator running `select * from pg_catalog.pg_proc where
--      proname like 'enforce_%'` or grep'ing the migration log can find
--      the catalog of intended RLS coverage in one place.
--
-- The corresponding TypeScript test stanza is appended (declared_only)
-- to tests/integration/rls/rls-phase3a.test.ts in this dispatch; live
-- execution waits for the Phase 4d dispatch which provisions the
-- manufacturing seed data.
--
-- No table, function, policy, trigger, or grant is created or modified
-- by this file.
-- =====================================================================

do $$
begin
  raise notice 'Phase 4a RLS-401..408 catalog (declared, live exec deferred to 4d):';
  raise notice '  RLS-401  manufacturing_plans              cross-tenant SELECT -> 0 rows';
  raise notice '  RLS-402  mfg_processes                    worker INSERT       -> 42501 (tenant_admin only)';
  raise notice '  RLS-403  mfg_processes                    parent tenant drift -> 42501 via enforce_mfg_process_tenant';
  raise notice '  RLS-404  manufacturing_records            worker_id != auth.uid() -> RLS WITH CHECK reject';
  raise notice '  RLS-405  manufacturing_records            worker A updates B (same tenant) -> reject (self-only)';
  raise notice '  RLS-406  manufacturing_record_defects     parent tenant drift -> 42501 via enforce_manufacturing_record_defect_tenant';
  raise notice '  RLS-407  manufacturing_record_defects     cross-tenant SELECT -> 0 rows';
  raise notice '  RLS-408  qr_scan_histories                target=manufacturing_records cross-tenant -> 42501 via validate_target_tenant';
end $$;

-- =====================================================================
-- End of Phase 4a RLS test catalog marker.
-- =====================================================================
