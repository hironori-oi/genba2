-- =====================================================================
-- GENBA Phase 3a: qr_scan_histories.raw_value column-level protection
-- =====================================================================
-- QR_SPEC §7 / Phase 3 DoD: `raw_value` is the original QR string and may
-- include sensitive customer-supplied data. Workers must NOT read it.
-- Only tenant_admin (and system_admin) of the owning tenant may see it.
--
-- Approach (defense in depth):
--
--   (1) Column-level GRANTs — `authenticated` loses SELECT on the base
--       qr_scan_histories table entirely, then we re-grant SELECT on
--       every column EXCEPT raw_value. So even if a future migration
--       weakens RLS, the column grant still blocks the read.
--
--       This affects only SELECT — INSERT/UPDATE/DELETE column privileges
--       are unchanged (RLS still gates writes). Workers and admins both
--       continue to INSERT raw_value via the existing insert_self policy.
--       service_role retains full access (it bypasses RLS and grants).
--
--   (2) Two views with WHERE clauses to express the read surface, using
--       DIFFERENT security models for the worker vs admin paths:
--
--       v_qr_scan_histories       — same-tenant rows, NO raw_value column.
--                                   The default read path for worker + UI.
--                                   security_invoker=true so the base
--                                   table's RLS still applies; the column
--                                   grant on the underlying table already
--                                   excludes raw_value for `authenticated`,
--                                   and the view's SELECT list also omits
--                                   it. Tenancy enforced by RLS + WHERE.
--
--       v_qr_scan_histories_admin — same-tenant rows, INCLUDES raw_value;
--                                   gated by app.is_tenant_admin() so a
--                                   non-admin's SELECT returns 0 rows.
--                                   **security_invoker is NOT set** — the
--                                   view runs as its OWNER (which has
--                                   SELECT on raw_value). If we set
--                                   security_invoker=true, the caller is
--                                   the `authenticated` role which does
--                                   NOT have SELECT(raw_value) at the
--                                   column-grant layer, so even tenant_admin
--                                   would hit 42501. Tenancy is enforced
--                                   by the explicit WHERE clause using
--                                   JWT-derived helpers (app.is_tenant_admin()
--                                   and app.current_tenant_id() — both
--                                   SECURITY DEFINER + search_path='' —
--                                   so the JWT cannot be spoofed and the
--                                   gate cannot be bypassed via search_path
--                                   shadowing). security_barrier=true is
--                                   set on the admin view to prevent the
--                                   planner from pushing user-supplied
--                                   predicates ahead of the security
--                                   predicate (which would leak raw_value
--                                   timing/error oracles to non-admins).
--
-- IMPORTANT: querying the base `public.qr_scan_histories` table directly
-- as `authenticated` and selecting raw_value will fail with a permission
-- error from the column grant layer. Server code should ALWAYS go through
-- one of the two views — see src/lib/logi/history.ts.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Column-level grants on the base table.
-- ---------------------------------------------------------------------
-- Drop the table-level SELECT for authenticated. The role still keeps
-- INSERT/UPDATE/DELETE because those table-level grants come from the
-- default `public` schema grant chain — we only revoke SELECT here.
revoke select on public.qr_scan_histories from authenticated;

-- Re-grant SELECT on every column EXCEPT raw_value. Listing columns
-- explicitly is the only way Postgres expresses column-level SELECT.
grant select (
  id,
  tenant_id,
  scanned_by,
  qr_type,
  qr_format_definition_id,
  parsed_values,
  warnings,
  match_result,
  match_detail,
  target_table,
  target_id,
  error_reason,
  business_code,
  created_at
) on public.qr_scan_histories to authenticated;

-- service_role retains full SELECT (default grant from the schema chain;
-- explicit GRANT for clarity / re-applyability).
grant select on public.qr_scan_histories to service_role;

-- ---------------------------------------------------------------------
-- 2. v_qr_scan_histories — worker/admin read surface (no raw_value).
--    The base table's RLS already gates tenancy; the explicit WHERE here
--    makes the contract obvious and survives accidental policy edits.
-- ---------------------------------------------------------------------
create or replace view public.v_qr_scan_histories as
select
  id,
  tenant_id,
  scanned_by,
  qr_type,
  qr_format_definition_id,
  parsed_values,
  warnings,
  match_result,
  match_detail,
  target_table,
  target_id,
  error_reason,
  business_code,
  created_at
from public.qr_scan_histories
where tenant_id = app.current_tenant_id() or app.is_system_admin();

comment on view public.v_qr_scan_histories is
  'Phase 3a: read surface for QR scan history WITHOUT raw_value. Use this view from worker-facing code; raw_value access requires v_qr_scan_histories_admin.';

-- security_invoker = true means the view executes with the caller's
-- privileges so the base-table RLS still applies. Postgres 15+ supports
-- this option natively. If the deployed Postgres is older the view
-- becomes effectively security_definer (owner = postgres), in which case
-- the explicit WHERE clause above is the only tenancy gate — that is why
-- we include it.
alter view public.v_qr_scan_histories set (security_invoker = true);

grant select on public.v_qr_scan_histories to authenticated;
grant select on public.v_qr_scan_histories to service_role;

-- ---------------------------------------------------------------------
-- 3. v_qr_scan_histories_admin — tenant_admin read surface (WITH raw_value).
--    Gated by app.is_tenant_admin() so non-admin workers see 0 rows.
-- ---------------------------------------------------------------------
create or replace view public.v_qr_scan_histories_admin as
select
  id,
  tenant_id,
  scanned_by,
  qr_type,
  qr_format_definition_id,
  raw_value,
  parsed_values,
  warnings,
  match_result,
  match_detail,
  target_table,
  target_id,
  error_reason,
  business_code,
  created_at
from public.qr_scan_histories
where
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin();

comment on view public.v_qr_scan_histories_admin is
  'Phase 3a: admin-only read surface for QR scan history INCLUDING raw_value. Worker callers see 0 rows because the WHERE clause requires app.is_tenant_admin(). Runs as view OWNER (NOT security_invoker) so raw_value access is not blocked by the authenticated role''s column-grant. Tenancy is enforced solely by the WHERE clause + JWT-signed claims.';

-- Defense in depth: security_barrier prevents the planner from reordering
-- a user-supplied predicate ahead of the security predicate, which could
-- otherwise leak existence/timing of raw_value rows to non-admins. We do
-- NOT set security_invoker=true here — see the header comment for why.
alter view public.v_qr_scan_histories_admin set (security_barrier = true);

grant select on public.v_qr_scan_histories_admin to authenticated;
grant select on public.v_qr_scan_histories_admin to service_role;

-- =====================================================================
-- End of Phase 3a raw_value protection migration.
-- =====================================================================
