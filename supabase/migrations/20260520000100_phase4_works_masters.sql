-- =====================================================================
-- GENBA Phase 4a: WORKS manufacturing master tables — alignment migration
-- =====================================================================
-- The four master tables proposed in
-- docs/ARCHITECTURE-phase4-manufacturing.md §3.2 — processes / equipment
-- / defect_groups / defects — were in fact already created by Phase 2
-- (supabase/migrations/20260512000000_phase2_settings_masters.sql,
-- starting at line 554). The Phase 4 architect doc was written without
-- visibility into that Phase 2 work; the Phase 4a foundation only needs
-- these tables to exist as FK targets for manufacturing_plans /
-- mfg_processes / manufacturing_records / manufacturing_record_defects,
-- which they already do.
--
-- This migration therefore does the minimum non-destructive alignment:
--   * ADD COLUMN IF NOT EXISTS note text on each of the four masters so
--     downstream Phase 5 master CRUD UI can attach free-form ops notes
--     without requiring a follow-up migration.
--   * Keep all Phase 2 columns intact (`code`, `name`, `enabled`,
--     `sort_order`, audit5, plus `defects.severity` / `equipment.process_id`).
--   * Do NOT rename Phase 2 columns. The architect doc's `process_code`
--     / `process_name` / `active` names were renames of `code` / `name`
--     / `enabled` and renames in production would break Phase 2 admin UI
--     bindings — explicitly out of scope per the Phase 4a dispatch
--     NON_SCOPE_DO_NOT_TOUCH list.
--   * Do NOT re-declare RLS / policies — Phase 2 already set them up
--     equivalent to the architect template (same tenant SELECT /
--     tenant_admin modify).
--
-- Result: this file is mostly documentary, plus the `note` column ADDs.
-- It must remain in the migration sequence so the apply ordering and
-- audit trail match the architect doc §7.1 (six files numbered 100..600).
--
-- Idempotent: every ADD COLUMN uses IF NOT EXISTS.
-- =====================================================================

alter table public.processes
  add column if not exists note text;
alter table public.equipment
  add column if not exists note text;
alter table public.defect_groups
  add column if not exists note text;
alter table public.defects
  add column if not exists note text;

do $$
begin
  raise notice 'Phase 4a masters alignment complete:';
  raise notice '  processes / equipment / defect_groups / defects existed from Phase 2';
  raise notice '  added: note text (idempotent ADD COLUMN IF NOT EXISTS)';
end $$;

-- =====================================================================
-- End of Phase 4a WORKS masters alignment migration.
-- =====================================================================
