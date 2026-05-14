import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getAppSession, type AppRole } from "@/lib/auth/session";
import {
  err,
  ok,
  type AdminActionResult,
} from "@/lib/admin/shared/result";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 5 admin server-action guard (architect doc §3.3 `ensureTenantAdmin`).
 *
 * Returns an AdminActionResult so callers can early-return without a custom
 * thrown-error shape. On success, the envelope carries an anon-JWT Supabase
 * server client plus the caller's userId/tenantId/role — every admin action
 * needs all three, so we factor the read once.
 *
 * Role gate: `tenant_admin` is the dispatch brief's literal floor; we also
 * accept `system_admin` because architect §2.3 grants system_admin admin
 * access (all admin CRUD + cross-tenant) and the existing role-change.ts
 * pattern (src/lib/auth/role-change.ts) treats system_admin as a superset
 * of tenant_admin. Phase 5b can introduce a tighter `ensureSystemAdmin` for
 * Phase 6 tenant-management screens.
 *
 * `app_metadata.role` only — never `user_metadata` (RLS-008 invariant from
 * docs/ARCHITECTURE.md §4). The read happens inside getAppSession() which
 * pins to `app_metadata`.
 */

export type EnsureTenantAdminOk = {
  userId: string;
  tenantId: string;
  role: AppRole;
  supabase: SupabaseClient;
};

export async function ensureTenantAdmin(): Promise<
  AdminActionResult<EnsureTenantAdminOk>
> {
  const session = await getAppSession();
  if (session.kind === "unconfigured") {
    return err(
      "unconfigured",
      "Supabase 接続情報が未設定のため admin 操作は実行できません。",
    );
  }
  if (session.kind === "unauthenticated") {
    return err("forbidden", "認証が必要です。");
  }

  const { role, tenantId, userId } = session.session;
  if (role !== "tenant_admin" && role !== "system_admin") {
    return err("forbidden", "この操作には tenant_admin 権限が必要です。");
  }
  if (!tenantId) {
    return err(
      "forbidden",
      "テナント情報が解決できませんでした。再ログインしてください。",
    );
  }

  const supabase = await createClient();
  return ok({ userId, tenantId, role, supabase });
}
