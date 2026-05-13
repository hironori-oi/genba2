"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/env";
import { loginSchema } from "@/lib/validation/auth";
import { safeInternalPath } from "@/lib/auth/safe-redirect";

export type LoginState = {
  status: "idle" | "error";
  message?: string;
  fieldErrors?: Record<string, string>;
};

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
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
      status: "error",
      message:
        "Supabase の接続情報が未設定です。オーナーが .env.enc に Supabase 認証情報を登録するまでログインできません。",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return {
      status: "error",
      message: "メールアドレスまたはパスワードが正しくありません。",
    };
  }

  const next = safeInternalPath(formData.get("next"));
  redirect(next);
}

export async function logoutAction(): Promise<void> {
  if (!supabaseConfigured()) {
    redirect("/login");
  }
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login?notice=signed-out");
}
