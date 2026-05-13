import "server-only";

/**
 * Tenant pinning helper shared by every server action that mutates a
 * tenant-owned row. Phase 4b extracts the inline `resolveTenantAndUser`
 * pattern that previously lived in src/lib/logi/actions.ts so LOGI
 * (movement/inventory) and WORKS (manufacturing) actions share one
 * source of truth.
 *
 * Contract:
 *
 *   1. Acquire a Supabase server client backed by the caller's anon JWT.
 *      RLS + the validate_target_tenant() trigger are the authorisation
 *      gates — this helper never bypasses them.
 *   2. Re-read tenant_id from `auth.jwt() -> app_metadata` via
 *      supabase.auth.getUser() (which round-trips to Supabase Auth).
 *      Caller-supplied tenant_id is NEVER trusted.
 *   3. Reject when the session lacks a `tenant_id` claim — Phase 1
 *      onboarding pins the claim before the user can reach the app shell,
 *      so a missing claim is a hard error rather than a silent fallback.
 *   4. NEVER consult `raw_user_metadata` — that field is user-writable
 *      and must not gate authorisation (SECURITY-AUDIT carryover).
 *
 * Returns a discriminated union: callers branch on `"code" in result` to
 * surface the error to the client via the standard ActionResult shape.
 */

import { createClient } from "@/lib/supabase/server";

export type TenantContext = {
  tenantId: string;
  userId: string;
};

export type TenantResolutionError = {
  code: "unauthenticated" | "tenant_missing";
  message: string;
};

export type ResolvedTenantContext = TenantContext | TenantResolutionError;

/**
 * Resolve the authenticated caller's tenant + user id. Pass in the
 * Supabase client returned by `createClient()` if you already created
 * one (saves a cookie round-trip); otherwise this helper creates one.
 */
export async function resolveTenantAndUser(
  supabase?: Awaited<ReturnType<typeof createClient>>,
): Promise<ResolvedTenantContext> {
  const client = supabase ?? (await createClient());
  const { data: userData, error: userErr } = await client.auth.getUser();
  if (userErr || !userData?.user) {
    return { code: "unauthenticated", message: "ログインが必要です" };
  }
  // app_metadata is the only authorisation surface — raw_user_metadata is
  // user-writable and must not gate tenant resolution.
  const meta = (userData.user.app_metadata ?? {}) as Record<string, unknown>;
  const tenantId =
    typeof meta.tenant_id === "string" && meta.tenant_id.length > 0
      ? meta.tenant_id
      : null;
  if (!tenantId) {
    return { code: "tenant_missing", message: "テナント情報が取得できません" };
  }
  return { tenantId, userId: userData.user.id };
}

/** Narrowing helper for callers using the discriminated union. */
export function isTenantResolutionError(
  v: ResolvedTenantContext,
): v is TenantResolutionError {
  return "code" in v;
}
