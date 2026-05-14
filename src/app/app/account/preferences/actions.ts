"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  err,
  isErr,
  ok,
  type AdminActionResult,
} from "@/lib/admin/shared/result";
import {
  preferencesInputSchema,
  zodIssuesToFieldErrors,
  type PreferencesInput,
} from "@/lib/admin/shared/validation";
import { ensureAuthenticatedSession } from "@/lib/corrections/ensure-authenticated";
import { LOCALE_COOKIE, THEME_COOKIE } from "@/i18n/config";

/**
 * Phase 5d 個人設定 — preferences (language / theme / notification).
 * Phase 6e adds the i18n + dark-mode cookie mirror so the next render of
 * <html lang/data-theme> uses the new value without waiting for the user
 * metadata to round-trip through the auth refresh.
 */
export async function savePreferencesAction(
  input: PreferencesInput,
): Promise<AdminActionResult<PreferencesInput>> {
  const parsed = preferencesInputSchema.safeParse(input);
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

  const preferences = parsed.data;
  const { data, error } = await supabase.auth.updateUser({
    data: { preferences },
  });
  if (error) {
    return err("unexpected", "個人設定の更新に失敗しました。");
  }
  if (!data?.user) {
    return err("unexpected", "個人設定の更新結果を取得できませんでした。");
  }

  // Mirror to cookies so the next layout render picks up the change before
  // the supabase JWT refreshes (otherwise stale theme persists for ~1h).
  const store = await cookies();
  const cookieOpts = {
    path: "/",
    httpOnly: false,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 365,
  };
  store.set(LOCALE_COOKIE, preferences.language, cookieOpts);
  store.set(THEME_COOKIE, preferences.theme, cookieOpts);

  revalidatePath("/", "layout");
  revalidatePath("/app/account");
  revalidatePath("/app/account/preferences");
  return ok(preferences);
}
