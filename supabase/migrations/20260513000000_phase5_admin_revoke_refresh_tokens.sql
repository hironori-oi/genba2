-- =====================================================================
-- GENBA Phase 5 (AC-AUTH-01 prod fix): admin_revoke_refresh_tokens RPC
-- =====================================================================
-- Replaces the broken `admin.auth.admin.signOut(userId, 'global')` call
-- in src/lib/auth/role-change.ts. SECURITY-AUDIT-2026-05-12-ac-auth-01
-- §4 showed that the SDK form expects the user's access-token JWT, not
-- a user id, so every prod-side revoke silently no-ops.
--
-- Adopted path (Option C, owner-approved 2026-05-13):
--   * server-side code calls `supabase.rpc('admin_revoke_refresh_tokens',
--     { p_user_id })` via the service-role client.
--   * the function deletes every row in `auth.refresh_tokens` owned by
--     the target user, which is exactly what `signOut(scope='global')`
--     is documented to do but cannot, because the caller does not hold
--     the target user's JWT.
--
-- Defense in depth:
--   1. SECURITY DEFINER so the function can write to `auth.refresh_tokens`
--      even though the calling role normally cannot. `set search_path =
--      ''` per the project convention (see phase1_init.sql and
--      validate_target_tenant) — never trust the session search_path
--      inside a SECURITY DEFINER body.
--   2. `revoke all from public` plus `grant execute … to service_role`:
--      at the PostgreSQL grant layer the function is callable ONLY by
--      the Supabase service_role — authenticated/anon users get an
--      `42501` from PG before the body runs.
--   3. Inside the body, an extra guard checks `auth.role() =
--      'service_role'`. The app-layer code in
--      `src/lib/auth/role-change.ts` is responsible for verifying the
--      caller is tenant_admin or system_admin BEFORE opening the
--      service-role client — those JWT claims are not visible here
--      because a service_role-authenticated request carries the
--      service_role JWT, not the operator's. This guard is the last
--      line of defense if the function is ever accidentally re-granted
--      to a wider role.
-- =====================================================================

create or replace function public.admin_revoke_refresh_tokens(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  -- Defense-in-depth caller check. The PG-level grant restricts this
  -- function to service_role; this guard repeats the check inside the
  -- body so a future relaxation of the grant does not silently widen
  -- the attack surface. tenant_admin / system_admin authorization is
  -- enforced by src/lib/auth/role-change.ts BEFORE the service-role
  -- client is opened — service_role JWTs do not carry app_metadata.role.
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'admin_revoke_refresh_tokens may only be invoked via service_role'
      using errcode = '42501';
  end if;

  delete from auth.refresh_tokens
  where user_id = p_user_id::text;

  get diagnostics v_deleted = row_count;

  return v_deleted;
end;
$$;

revoke all on function public.admin_revoke_refresh_tokens(uuid) from public;
revoke all on function public.admin_revoke_refresh_tokens(uuid) from anon, authenticated;
grant execute on function public.admin_revoke_refresh_tokens(uuid) to service_role;

comment on function public.admin_revoke_refresh_tokens(uuid) is
  'AC-AUTH-01 prod fix. Deletes auth.refresh_tokens rows for p_user_id. '
  'Callable only via service_role; tenant_admin/system_admin auth is '
  'enforced at the app layer in src/lib/auth/role-change.ts.';

-- =====================================================================
-- End of Phase 5 admin_revoke_refresh_tokens migration.
-- =====================================================================
