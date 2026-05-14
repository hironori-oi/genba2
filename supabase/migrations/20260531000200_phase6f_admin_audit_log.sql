-- =====================================================================
-- GENBA Phase 6f-2: admin_audit_log + settings-table triggers
-- =====================================================================
-- Dispatch: T-20260515-110000-genba-phase6f-admin-ops
-- Architect: docs/ARCHITECTURE-phase6-operational-features.md §C.6f-2 / §E.5.
--
-- Captures (who / when / what changed) for SETTINGS tables only — record
-- tables (movement / inventory / manufacturing) are intentionally
-- excluded because they already have `corrections_audit` (Phase 5) and
-- INSERT cost on hot paths matters.
--
-- Immutability invariants (RLS-604 / RLS-605):
--   * No DELETE policy (rows cannot be removed by any role except
--     superuser / service_role).
--   * No UPDATE policy (service_role bypasses RLS — but no client role
--     can UPDATE).
--   * INSERT happens via SECURITY DEFINER trigger func — bypasses RLS
--     by definition. No INSERT policy granted to authenticated.
-- =====================================================================

-- 1. admin_audit_log table -------------------------------------------

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  actor_id uuid references auth.users(id),
  table_name text not null,
  op text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_tenant_created_idx
  on public.admin_audit_log (tenant_id, created_at desc);

create index if not exists admin_audit_log_table_idx
  on public.admin_audit_log (tenant_id, table_name, created_at desc);

create index if not exists admin_audit_log_actor_idx
  on public.admin_audit_log (actor_id, created_at desc);

alter table public.admin_audit_log enable row level security;

-- SELECT: same tenant OR system_admin (RLS-604 read-side).
drop policy if exists admin_audit_log_select_same_tenant
  on public.admin_audit_log;
create policy admin_audit_log_select_same_tenant
on public.admin_audit_log for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

-- INSERT / UPDATE / DELETE policies: intentionally omitted (immutable).
-- service_role bypasses RLS and the trigger func uses SECURITY DEFINER.

-- 2. trigger function -------------------------------------------------

create or replace function app.log_admin_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_before jsonb;
  v_after jsonb;
  v_actor uuid := auth.uid();
begin
  if (TG_OP = 'DELETE') then
    v_before := to_jsonb(OLD);
    v_after  := null;
    v_tenant := (v_before ->> 'tenant_id')::uuid;
  elsif (TG_OP = 'UPDATE') then
    v_before := to_jsonb(OLD);
    v_after  := to_jsonb(NEW);
    v_tenant := (v_after ->> 'tenant_id')::uuid;
  else
    v_before := null;
    v_after  := to_jsonb(NEW);
    v_tenant := (v_after ->> 'tenant_id')::uuid;
  end if;

  -- Scrub secret columns from notification_preferences snapshots so
  -- the audit log itself never carries SMTP password / webhook secret.
  if (TG_TABLE_NAME = 'notification_preferences') then
    if v_before is not null then
      v_before := v_before - 'smtp_password' - 'webhook_secret';
    end if;
    if v_after is not null then
      v_after  := v_after  - 'smtp_password' - 'webhook_secret';
    end if;
  end if;

  if v_tenant is not null then
    insert into public.admin_audit_log
      (tenant_id, actor_id, table_name, op, before, after)
    values
      (v_tenant, v_actor, TG_TABLE_NAME::text, TG_OP, v_before, v_after);
  end if;

  return coalesce(NEW, OLD);
end;
$$;

revoke all on function app.log_admin_audit() from public;
grant execute on function app.log_admin_audit() to authenticated, service_role;

-- 3. Attach trigger to settings tables --------------------------------
-- Records tables (movement_records / inventory_records / manufacturing_*)
-- are intentionally excluded (corrections_audit covers them).

drop trigger if exists trg_audit_log_work_settings on public.work_settings;
create trigger trg_audit_log_work_settings
  after insert or update or delete on public.work_settings
  for each row execute function app.log_admin_audit();

drop trigger if exists trg_audit_log_tenant_field_settings on public.tenant_field_settings;
create trigger trg_audit_log_tenant_field_settings
  after insert or update or delete on public.tenant_field_settings
  for each row execute function app.log_admin_audit();

drop trigger if exists trg_audit_log_match_rules on public.match_rules;
create trigger trg_audit_log_match_rules
  after insert or update or delete on public.match_rules
  for each row execute function app.log_admin_audit();

drop trigger if exists trg_audit_log_qr_format_definitions on public.qr_format_definitions;
create trigger trg_audit_log_qr_format_definitions
  after insert or update or delete on public.qr_format_definitions
  for each row execute function app.log_admin_audit();

drop trigger if exists trg_audit_log_csv_import_definitions on public.csv_import_definitions;
create trigger trg_audit_log_csv_import_definitions
  after insert or update or delete on public.csv_import_definitions
  for each row execute function app.log_admin_audit();

drop trigger if exists trg_audit_log_csv_export_definitions on public.csv_export_definitions;
create trigger trg_audit_log_csv_export_definitions
  after insert or update or delete on public.csv_export_definitions
  for each row execute function app.log_admin_audit();

drop trigger if exists trg_audit_log_tenant_subscriptions on public.tenant_subscriptions;
create trigger trg_audit_log_tenant_subscriptions
  after insert or update or delete on public.tenant_subscriptions
  for each row execute function app.log_admin_audit();

drop trigger if exists trg_audit_log_profiles on public.profiles;
create trigger trg_audit_log_profiles
  after insert or update or delete on public.profiles
  for each row execute function app.log_admin_audit();

-- notification_preferences trigger is attached in migration 6f-3 since
-- that table does not exist yet.

-- =====================================================================
-- End of Phase 6f-2 admin_audit_log migration.
-- =====================================================================
