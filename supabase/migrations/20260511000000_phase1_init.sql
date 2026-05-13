-- =====================================================================
-- GENBA Phase 1: tenants / profiles / tenant_subscriptions / businesses
-- =====================================================================
-- Source of truth for the Phase 1 schema. This file is the only place
-- where the bootstrap RLS policies, audit columns, and businesses seed
-- are defined for Phase 1.
--
-- Decisions reflected (2026-05-11 owner Phase 0 review):
--   * created_by / updated_by columns from Phase 1 onward (audit/timing P1)
--   * raw_app_meta_data is the ONLY source for tenant_id / role claims;
--     raw_user_metadata is client-writable via the JS SDK and MUST NOT be
--     read in any RLS predicate. The helper functions below read straight
--     from `auth.jwt()` to avoid the recursive policy bug we hit in
--     pick-checker (`010_fix_rls_recursion`).
--   * 4 businesses seeded per tenant via a trigger on tenants insert.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. JWT claim helpers (NO auth.users join — see ARCHITECTURE §4 R-01).
-- ---------------------------------------------------------------------
create schema if not exists app;

create or replace function app.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(coalesce(
    auth.jwt() -> 'app_metadata' ->> 'tenant_id',
    auth.jwt() ->> 'tenant_id'
  ), '')::uuid;
$$;

create or replace function app.current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> 'role',
    auth.jwt() ->> 'role',
    'worker'
  );
$$;

create or replace function app.is_tenant_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.current_role() in ('tenant_admin', 'system_admin');
$$;

create or replace function app.is_system_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.current_role() = 'system_admin';
$$;

revoke all on function app.current_tenant_id() from public;
revoke all on function app.current_role() from public;
revoke all on function app.is_tenant_admin() from public;
revoke all on function app.is_system_admin() from public;
grant execute on function app.current_tenant_id() to authenticated, anon, service_role;
grant execute on function app.current_role() to authenticated, anon, service_role;
grant execute on function app.is_tenant_admin() to authenticated, service_role;
grant execute on function app.is_system_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. tenants
-- ---------------------------------------------------------------------
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz
);

alter table public.tenants enable row level security;

create policy tenants_select_self
on public.tenants for select to authenticated
using (id = app.current_tenant_id() or app.is_system_admin());

create policy tenants_modify_system_admin
on public.tenants for all to authenticated
using (app.is_system_admin())
with check (app.is_system_admin());

-- ---------------------------------------------------------------------
-- 3. profiles (1:1 with auth.users; readable per-tenant)
--    Authorization claims (tenant_id / role) live in auth.users.app_metadata.
--    `profiles` exists to carry display data and per-tenant assignments.
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  role text not null default 'worker' check (role in ('worker', 'tenant_admin', 'system_admin')),
  display_name text,
  assigned_businesses jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz
);

create index if not exists profiles_tenant_id_idx on public.profiles (tenant_id);

alter table public.profiles enable row level security;

create policy profiles_select_same_tenant
on public.profiles for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

create policy profiles_update_self_or_admin
on public.profiles for update to authenticated
using (
  (id = auth.uid() and tenant_id = app.current_tenant_id())
  or (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (id = auth.uid() and tenant_id = app.current_tenant_id())
  or (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

create policy profiles_insert_admin_only
on public.profiles for insert to authenticated
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

create policy profiles_delete_admin_only
on public.profiles for delete to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- ---------------------------------------------------------------------
-- 4. tenant_subscriptions (enabled businesses / caps)
-- ---------------------------------------------------------------------
create table if not exists public.tenant_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan text not null default 'logi' check (plan in ('logi', 'works', 'both')),
  enabled_businesses jsonb not null default '["receiving","picking","inventory"]'::jsonb,
  enabled_features jsonb not null default '{}'::jsonb,
  max_users integer not null default 10,
  max_scans_per_month integer not null default 50000,
  pitr_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id)
);

alter table public.tenant_subscriptions enable row level security;

create policy tenant_subs_select_same_tenant
on public.tenant_subscriptions for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

create policy tenant_subs_modify_system_admin
on public.tenant_subscriptions for all to authenticated
using (app.is_system_admin())
with check (app.is_system_admin());

-- ---------------------------------------------------------------------
-- 5. businesses (4 fixed kinds: receiving / picking / inventory / manufacturing)
-- ---------------------------------------------------------------------
create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null check (code in ('receiving', 'picking', 'inventory', 'manufacturing')),
  name text not null,
  sort_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id, code)
);

create index if not exists businesses_tenant_id_idx on public.businesses (tenant_id);

alter table public.businesses enable row level security;

create policy businesses_select_same_tenant
on public.businesses for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

create policy businesses_modify_tenant_admin
on public.businesses for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- Seed the 4 fixed businesses whenever a tenant row is created.
create or replace function public.seed_default_businesses()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.businesses (tenant_id, code, name, sort_order, enabled, created_by, updated_by)
  values
    (new.id, 'receiving', '入庫', 10, true, new.created_by, new.created_by),
    (new.id, 'picking', 'ピッキング', 20, true, new.created_by, new.created_by),
    (new.id, 'inventory', '棚卸', 30, true, new.created_by, new.created_by),
    (new.id, 'manufacturing', '製造', 40, true, new.created_by, new.created_by)
  on conflict do nothing;

  insert into public.tenant_subscriptions (tenant_id, plan, enabled_businesses, created_by, updated_by)
  values (new.id, 'logi', '["receiving","picking","inventory"]'::jsonb, new.created_by, new.created_by)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists tenants_seed_businesses on public.tenants;
create trigger tenants_seed_businesses
after insert on public.tenants
for each row execute function public.seed_default_businesses();

-- ---------------------------------------------------------------------
-- 6. updated_at + updated_by maintenance
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists tenants_touch on public.tenants;
create trigger tenants_touch before update on public.tenants
for each row execute function public.touch_updated_columns();

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
for each row execute function public.touch_updated_columns();

drop trigger if exists tenant_subs_touch on public.tenant_subscriptions;
create trigger tenant_subs_touch before update on public.tenant_subscriptions
for each row execute function public.touch_updated_columns();

drop trigger if exists businesses_touch on public.businesses;
create trigger businesses_touch before update on public.businesses
for each row execute function public.touch_updated_columns();
