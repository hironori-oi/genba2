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
 * Phase 6f system_admin guard. Stricter sibling of ensureTenantAdmin —
 * only `system_admin` role passes. Used for /app/admin/tenants where
 * cross-tenant CRUD must remain inaccessible to tenant_admin.
 *
 * RLS-008: role is read from `app_metadata` (via getAppSession) only.
 */

export type EnsureSystemAdminOk = {
  userId: string;
  tenantId: string | null;
  role: AppRole;
  supabase: SupabaseClient;
};

export async function ensureSystemAdmin(): Promise<
  AdminActionResult<EnsureSystemAdminOk>
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
  if (role !== "system_admin") {
    return err("forbidden", "この操作には system_admin 権限が必要です。");
  }

  const supabase = await createClient();
  return ok({ userId, tenantId, role, supabase });
}
