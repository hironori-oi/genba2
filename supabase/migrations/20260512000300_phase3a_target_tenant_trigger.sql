-- =====================================================================
-- GENBA Phase 3a: validate_target_tenant() trigger for qr_scan_histories
-- =====================================================================
-- Implements ARCHITECTURE §4 R-05 / RLS-007: when a qr_scan_histories row
-- has a (target_table, target_id) reference to another business record,
-- the referenced row's tenant_id MUST equal the qr_scan_histories row's
-- tenant_id. Cross-tenant references are rejected with SQLSTATE 42501.
--
-- Defense in depth:
--   1. CHECK constraint on qr_scan_histories.target_table (previous
--      migration) restricts to a fixed allow-list — this makes the
--      `format('… %I …', NEW.target_table)` EXECUTE safe from SQL injection.
--   2. The trigger function ALSO hardcodes the allow-list as a guard so a
--      future relaxation of the CHECK does not silently widen the attack
--      surface.
--
-- SECURITY DEFINER + `set search_path = ''` follows the lesson from
-- pick-checker 013_search_path: never depend on session search_path inside
-- a SECURITY DEFINER function.
-- =====================================================================

create or replace function public.validate_target_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tenant_id uuid;
begin
  -- Free-read rows leave target_table NULL; nothing to validate.
  if new.target_table is null or new.target_id is null then
    return new;
  end if;

  -- Defense-in-depth allow-list. Kept in lockstep with the CHECK
  -- constraint on qr_scan_histories.target_table. NEVER widen this list
  -- without also updating the CHECK constraint in the corresponding
  -- migration; never accept an arbitrary string here.
  if new.target_table not in (
    'movement_records',
    'movement_plans',
    'movement_plan_lines',
    'inventory_records',
    'inventory_plans',
    'inventory_plan_lines',
    'manufacturing_records',
    'manufacturing_plans',
    'mfg_processes'
  ) then
    raise exception 'qr_scan_histories.target_table % is not in allow-list', new.target_table
      using errcode = '42501';
  end if;

  -- Dynamic lookup of target row's tenant_id. The %I formatter quotes the
  -- identifier — combined with the allow-list above this is injection-safe.
  execute format(
    'select tenant_id from public.%I where id = $1',
    new.target_table
  )
  using new.target_id
  into target_tenant_id;

  if target_tenant_id is null then
    raise exception 'qr_scan_histories.target_id % not found in public.%',
      new.target_id, new.target_table
      using errcode = '42501';
  end if;

  if target_tenant_id <> new.tenant_id then
    raise exception 'qr_scan_histories.target_id tenant mismatch'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_target_tenant() from public;
grant execute on function public.validate_target_tenant() to authenticated, service_role;

drop trigger if exists qr_scan_histories_validate_target on public.qr_scan_histories;
create trigger qr_scan_histories_validate_target
before insert or update of target_table, target_id, tenant_id
on public.qr_scan_histories
for each row
execute function public.validate_target_tenant();

-- =====================================================================
-- End of Phase 3a target-tenant trigger migration.
-- =====================================================================
