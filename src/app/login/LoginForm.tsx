"use client";

import { useActionState, useId } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { loginAction, type LoginState } from "./actions";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation/auth";

const initialState: LoginState = { status: "idle" };

export function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/app";
  const notice = params.get("notice");
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  const emailId = useId();
  const passwordId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {notice === "signed-out" ? (
        <Alert tone="info" title="お知らせ">
          ログアウトしました。
        </Alert>
      ) : null}
      {notice === "supabase-unconfigured" ? (
        <Alert tone="warn" title="セットアップ中">
          Supabase 接続が未設定のためログインできません。オーナーが認証情報を登録するまでお待ちください。
        </Alert>
      ) : null}
      {state.status === "error" && state.message ? (
        <Alert tone="error">{state.message}</Alert>
      ) : null}
      <input type="hidden" name="next" value={next} />
      <Field
        id={emailId}
        label="メールアドレス"
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        required
        error={state.fieldErrors?.email}
      />
      <Field
        id={passwordId}
        label="パスワード"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        hint={`${PASSWORD_MIN_LENGTH} 文字以上`}
        error={state.fieldErrors?.password}
      />
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "送信中…" : "ログイン"}
      </Button>
      <p className="text-xs text-[var(--muted)]">
        ※ 入力情報は暗号化通信で送信されます。
      </p>
    </form>
  );
}
