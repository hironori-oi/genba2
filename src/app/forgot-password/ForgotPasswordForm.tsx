"use client";

import { useActionState, useId } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Alert";
import { requestPasswordResetAction, type ResetState } from "./actions";

const initialState: ResetState = { status: "idle" };

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    requestPasswordResetAction,
    initialState,
  );
  const emailId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.status === "sent" ? (
        <Alert tone="ok" title="送信完了">
          {state.message}
        </Alert>
      ) : null}
      {state.status === "unconfigured" ? (
        <Alert tone="warn" title="セットアップ中">
          {state.message}
        </Alert>
      ) : null}
      {state.status === "error" && state.message ? (
        <Alert tone="error">{state.message}</Alert>
      ) : null}
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
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? "送信中…" : "リセットメールを送る"}
      </Button>
    </form>
  );
}
