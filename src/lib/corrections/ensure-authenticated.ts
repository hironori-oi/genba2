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
 * Phase 5d 訂正画面用 guard — worker でも到達可。
 *
 * Architect doc §2.3 / dispatch SCOPE: 訂正画面 (/app/correct/*) は worker
 * を含む全ロールが利用できる。ensureTenantAdmin を流用すると worker が
 * 自レコードを訂正できなくなるため、専用の "authenticated session" guard を
 * 持つ。RLS は引き続き旧 row の self-or-admin policy で gate されるため、
 * 他人の record を訂正しようとしても DB 側で 0 rows → not_found となる。
 */

export type EnsureAuthenticatedOk = {
  userId: string;
  tenantId: string;
  role: AppRole;
  supabase: SupabaseClient;
};

export async function ensureAuthenticatedSession(): Promise<
  AdminActionResult<EnsureAuthenticatedOk>
> {
  const session = await getAppSession();
  if (session.kind === "unconfigured") {
    return err(
      "unconfigured",
      "Supabase 接続情報が未設定のため、訂正は実行できません。",
    );
  }
  if (session.kind === "unauthenticated") {
    return err("forbidden", "認証が必要です。");
  }
  const { role, tenantId, userId } = session.session;
  if (!tenantId) {
    return err(
      "forbidden",
      "テナント情報が解決できませんでした。再ログインしてください。",
    );
  }
  const supabase = await createClient();
  return ok({ userId, tenantId, role, supabase });
}
