"use server";

import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured, getAppUrl } from "@/lib/env";
import { passwordResetRequestSchema } from "@/lib/validation/auth";

export type ResetState = {
  status: "idle" | "sent" | "unconfigured" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
};

export async function requestPasswordResetAction(
  _prev: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const parsed = passwordResetRequestSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString();
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { status: "error", fieldErrors };
  }

  if (!supabaseConfigured()) {
    return {
      status: "unconfigured",
      message:
        "セットアップ未完了のためリセットメールは送信されていません。オーナーが Supabase 接続情報を登録した後に再度お試しください。",
    };
  }

  const supabase = await createClient();
  // Email enumeration mitigation: ignore the error and always show success.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${getAppUrl()}/auth/callback?type=recovery`,
  });

  return {
    status: "sent",
    message: "ご登録のメールアドレスが存在する場合、リセット手順をお送りしました。",
  };
}
