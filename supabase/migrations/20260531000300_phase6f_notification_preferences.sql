-- =====================================================================
-- GENBA Phase 6f-3: notification_preferences (SMTP / webhook per tenant)
-- =====================================================================
-- Dispatch: T-20260515-110000-genba-phase6f-admin-ops
-- Architect: docs/ARCHITECTURE-phase6-operational-features.md §C.6f-3 +
--            ADR-P6-04 (new table over jsonb-on-tenants).
--
-- Security invariants:
--   * smtp_password / webhook_secret columns: REVOKE SELECT from
--     authenticated/anon (column-level grants). Only service_role can
--     read these in EF context; client bundle never sees them.
--   * RLS rows scoped to caller's tenant (tenant_admin can edit, worker
--     blocked). system_admin bypass via app.is_system_admin().
--   * audit trigger attached for change history.
-- =====================================================================

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  smtp_host text,
  smtp_port integer check (smtp_port is null or (smtp_port > 0 and smtp_port < 65536)),
  smtp_username text,
  smtp_password text,
  smtp_from_email text,
  smtp_from_name text,
  notify_correction_approval boolean not null default true,
  notify_correction_completed boolean not null default false,
  notify_monthly_cap boolean not null default true,
  webhook_url text,
  webhook_secret text,
  enabled_recipients jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  unique (tenant_id)
);

create index if not exists notification_preferences_tenant_idx
  on public.notification_preferences (tenant_id);

alter table public.notification_preferences enable row level security;

-- RLS SELECT: same tenant or system_admin.
drop policy if exists notification_preferences_select_same_tenant
  on public.notification_preferences;
create policy notification_preferences_select_same_tenant
on public.notification_preferences for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

-- RLS INSERT: tenant_admin in own tenant OR system_admin anywhere.
drop policy if exists notification_preferences_insert_tenant_admin
  on public.notification_preferences;
create policy notification_preferences_insert_tenant_admin
on public.notification_preferences for insert to authenticated
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- RLS UPDATE: tenant_admin in own tenant OR system_admin anywhere.
drop policy if exists notification_preferences_update_tenant_admin
  on public.notification_preferences;
create policy notification_preferences_update_tenant_admin
on public.notification_preferences for update to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- DELETE policy intentionally omitted (records preserved; system_admin
-- can delete via service_role if a tenant teardown is required).

-- ---------------------------------------------------------------------
-- Column-level privileges (ADR-P6-04 / RLS-606 / §E.6).
-- ---------------------------------------------------------------------
-- Strategy: revoke ALL from authenticated/anon, then grant SELECT only
-- on non-secret columns, and grant INSERT/UPDATE on all writable columns
-- (RLS still gates which rows). service_role bypasses both grants and
-- RLS, so the Edge Function notifier can still read smtp_password.
--
-- App callers MUST use an explicit column list in `.select(...)` —
-- `select('*')` will raise "permission denied for column smtp_password".

revoke all on public.notification_preferences from authenticated, anon;

grant select (
  id, tenant_id,
  smtp_host, smtp_port, smtp_username,
  smtp_from_email, smtp_from_name,
  notify_correction_approval, notify_correction_completed, notify_monthly_cap,
  webhook_url, enabled_recipients,
  created_at, updated_at, created_by, updated_by
) on public.notification_preferences to authenticated;

grant insert (
  tenant_id,
  smtp_host, smtp_port, smtp_username, smtp_password,
  smtp_from_email, smtp_from_name,
  notify_correction_approval, notify_correction_completed, notify_monthly_cap,
  webhook_url, webhook_secret, enabled_recipients,
  created_by, updated_by
) on public.notification_preferences to authenticated;

grant update (
  smtp_host, smtp_port, smtp_username, smtp_password,
  smtp_from_email, smtp_from_name,
  notify_correction_approval, notify_correction_completed, notify_monthly_cap,
  webhook_url, webhook_secret, enabled_recipients,
  updated_by
) on public.notification_preferences to authenticated;

-- service_role: full table privileges (EF notifier reads smtp_password).
grant all on public.notification_preferences to service_role;

-- ---------------------------------------------------------------------
-- updated_at touch trigger (re-uses Phase 1 helper)
-- ---------------------------------------------------------------------
drop trigger if exists notification_preferences_touch on public.notification_preferences;
create trigger notification_preferences_touch
  before update on public.notification_preferences
  for each row execute function public.touch_updated_columns();

-- ---------------------------------------------------------------------
-- audit trigger (from 6f-2)
-- ---------------------------------------------------------------------
drop trigger if exists trg_audit_log_notification_preferences on public.notification_preferences;
create trigger trg_audit_log_notification_preferences
  after insert or update or delete on public.notification_preferences
  for each row execute function app.log_admin_audit();

comment on table public.notification_preferences is
  'Phase 6f-3: per-tenant SMTP/webhook config. smtp_password & webhook_secret are column-level revoked from authenticated/anon (ADR-P6-04).';
comment on column public.notification_preferences.smtp_password is
  'Secret. SELECT not granted to authenticated/anon. Read only via service_role (Edge Function notifier).';
comment on column public.notification_preferences.webhook_secret is
  'Secret. SELECT not granted to authenticated/anon.';

-- =====================================================================
-- End of Phase 6f-3 notification_preferences migration.
-- =====================================================================
