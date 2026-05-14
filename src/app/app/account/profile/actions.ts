"use server";

import { revalidatePath } from "next/cache";
import {
  err,
  isErr,
  ok,
  type AdminActionResult,
} from "@/lib/admin/shared/result";
import {
  profileInputSchema,
  zodIssuesToFieldErrors,
} from "@/lib/admin/shared/validation";
import { ensureAuthenticatedSession } from "@/lib/corrections/ensure-authenticated";

/**
 * Phase 5d 個人設定 — プロフィール (display_name / phone).
 *
 * Architect §3.4.4: 個人設定は supabase.auth.updateUser({ data }) で
 * user_metadata に保存する。tenant_id / role は absolutely never 触らない
 * (app_metadata 側、RLS-008 invariant)。display_name は session の
 * getAppSession 経由でも参照される (src/lib/auth/session.ts L46-47)。
 */

export type SaveProfileInput = {
  displayName: string;
  phone: string | null;
};

export async function saveProfileAction(
  input: SaveProfileInput,
): Promise<AdminActionResult<{ displayName: string; phone: string | null }>> {
  const parsed = profileInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      "validation",
      "入力内容を確認してください。",
      zodIssuesToFieldErrors(parsed.error),
    );
  }
  const gate = await ensureAuthenticatedSession();
  if (isErr(gate)) return gate;
  const { supabase } = gate.data;

  const { displayName, phone } = parsed.data;

  const { data, error } = await supabase.auth.updateUser({
    data: {
      display_name: displayName,
      phone: phone,
    },
  });
  if (error) {
    return err("unexpected", "プロフィールの更新に失敗しました。");
  }
  if (!data?.user) {
    return err("unexpected", "プロフィールの更新結果を取得できませんでした。");
  }

  revalidatePath("/app/account");
  revalidatePath("/app/account/profile");
  revalidatePath("/app");
  return ok({ displayName, phone });
}
