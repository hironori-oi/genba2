import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getAppSession, type AppRole } from "@/lib/auth/session";

/**
 * Role / tenant change pattern (AC-AUTH-01, 2026-05-11 owner decision).
 *
 * Server-only. Performs the following atomic sequence:
 *   1. Verify caller is tenant_admin (or system_admin for cross-tenant ops).
 *   2. Update `raw_app_meta_data` (`tenant_id`, `role`) via service_role.
 *      NEVER `raw_user_metadata` — that path is client-writable and is a
 *      privilege-escalation sink. See ARCHITECTURE §4 RLS-008.
 *   3. Revoke all refresh tokens for the target user via admin API so the
 *      old session cannot keep operating with stale claims.
 *
 * This function must never be imported from a client component. The
 * `import "server-only"` guard above plus the service-role client guard in
 * `supabase/admin.ts` keep the secret out of the client bundle.
 */

export type RoleChangeRequest = {
  targetUserId: string;
  newRole: AppRole;
  newTenantId?: string | null;
};

export type RoleChangeResult =
  | { ok: true }
  | { ok: false; code: "forbidden" | "not_found" | "unconfigured" | "error"; message: string };

export async function changeUserRole(
  req: RoleChangeRequest,
): Promise<RoleChangeResult> {
  const caller = await getAppSession();
  if (caller.kind === "unconfigured") {
    return {
      ok: false,
      code: "unconfigured",
      message: "Supabase 接続情報が未設定のため admin 操作は実行できません。",
    };
  }
  if (caller.kind === "unauthenticated") {
    return { ok: false, code: "forbidden", message: "認証が必要です。" };
  }
  if (caller.session.role !== "tenant_admin" && caller.session.role !== "system_admin") {
    return {
      ok: false,
      code: "forbidden",
      message: "ロール変更は tenant_admin 以上の権限が必要です。",
    };
  }

  const admin = createAdminClient();

  // Fetch the target user to learn the existing app_metadata so we merge,
  // not overwrite (other claims like onboarding flags must survive).
  const { data: targetData, error: fetchError } = await admin.auth.admin.getUserById(
    req.targetUserId,
  );
  if (fetchError || !targetData?.user) {
    return { ok: false, code: "not_found", message: "対象ユーザーが見つかりません。" };
  }

  // tenant_admin may only change users within their own tenant.
  const targetTenant = (targetData.user.app_metadata?.tenant_id ?? null) as string | null;
  if (
    caller.session.role === "tenant_admin" &&
    targetTenant !== caller.session.tenantId
  ) {
    return {
      ok: false,
      code: "forbidden",
      message: "他テナントのユーザーは変更できません。",
    };
  }

  const newAppMetadata = {
    ...(targetData.user.app_metadata ?? {}),
    role: req.newRole,
    ...(req.newTenantId !== undefined ? { tenant_id: req.newTenantId } : {}),
  };

  const { error: updateError } = await admin.auth.admin.updateUserById(req.targetUserId, {
    app_metadata: newAppMetadata,
  });
  if (updateError) {
    return { ok: false, code: "error", message: updateError.message };
  }

  // Revoke refresh tokens so the user's existing session cannot keep
  // operating with the stale claims. The SDK form
  // `admin.auth.admin.signOut(jwt, 'global')` expects the target user's
  // access-token JWT — which we do not hold here — so we call the
  // service-role RPC `public.admin_revoke_refresh_tokens` which deletes
  // every auth.refresh_tokens row for the target user_id. See
  // supabase/migrations/20260513000000_phase5_admin_revoke_refresh_tokens.sql
  // and docs/SECURITY-AUDIT-2026-05-12-ac-auth-01.md §7-1.
  const { error: revokeError } = await admin.rpc("admin_revoke_refresh_tokens", {
    p_user_id: req.targetUserId,
  });
  if (revokeError) {
    return {
      ok: false,
      code: "error",
      message: `metadata は更新されましたが refresh token revoke に失敗しました: ${revokeError.message}`,
    };
  }

  // If the caller modified themselves, also clear the *current* server-side
  // session cookie so they are forced through the login flow again.
  if (req.targetUserId === caller.session.userId) {
    const sb = await createClient();
    await sb.auth.signOut();
  }

  return { ok: true };
}
