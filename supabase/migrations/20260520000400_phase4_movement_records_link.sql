-- =====================================================================
-- GENBA Phase 4a: movement_records.manufacturing_record_id FK + partial
--                 unique index for stock-in simultaneous record dedupe.
-- =====================================================================
-- Implements docs/ARCHITECTURE-phase4-manufacturing.md §3.5 +
-- §10 R-P4-04 (製造入庫二重記録).
--
-- Adds:
--   * column manufacturing_record_id (NULLABLE, FK -> manufacturing_records,
--     on delete set null) so a 製造入庫 row in movement_records can be
--     linked back to the manufacturing_records row that triggered it.
--   * index movement_records_manufacturing_record_idx for FK lookups.
--   * partial UNIQUE index movement_records_manufacturing_unique_alive
--     covering (manufacturing_record_id) WHERE manufacturing_record_id
--     IS NOT NULL AND deleted_at IS NULL — prevents double-record of a
--     製造入庫 for the same manufacturing_records row while still allowing
--     soft-deleted (deleted_at IS NOT NULL) historical correction trail.
--
-- Notes:
--   * The FK uses ON DELETE SET NULL so a manufacturing_records cascade
--     delete does not propagate-delete an in-stock movement row (stock
--     integrity wins).
--   * No RLS change is needed; movement_records RLS from Phase 3a still
--     applies (tenant_id pin is unaffected by the new column).
--
-- Idempotent: ALTER TABLE ADD COLUMN IF NOT EXISTS guarded; index uses
-- IF NOT EXISTS / DROP IF EXISTS.
-- =====================================================================

alter table public.movement_records
  add column if not exists manufacturing_record_id uuid
    references public.manufacturing_records(id) on delete set null;

create index if not exists movement_records_manufacturing_record_idx
  on public.movement_records (manufacturing_record_id);

drop index if exists public.movement_records_manufacturing_unique_alive;
create unique index movement_records_manufacturing_unique_alive
  on public.movement_records (manufacturing_record_id)
  where manufacturing_record_id is not null
    and deleted_at is null;

-- =====================================================================
-- End of Phase 4a movement_records link migration.
-- =====================================================================
