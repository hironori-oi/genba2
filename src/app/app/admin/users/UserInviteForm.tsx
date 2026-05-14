"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { isErr } from "@/lib/admin/shared/result";
import { inviteUserAction } from "./actions";

/**
 * Phase 6f-6 / 6g — degraded-mode invitation surface.
 *
 * - When `smtpConfigured = false`, all inputs render disabled and the helper
 *   text explains the SMTP gate. This satisfies the architect
 *   "degraded mode" requirement (`SMTP 未設定の場合は STATUS: degraded で
 *   degrade`, ARCHITECTURE-phase6 §C.6f-6) without silently swallowing the
 *   submit.
 * - Even when SMTP is configured, the server action currently returns
 *   `delivery: "degraded"` because the `inviteUser` Edge Function is not
 *   yet deployed in Phase 6 (architect §C.6f-4 / Phase 7 follow-up). The
 *   notice copy makes that explicit.
 */
export function UserInviteForm({
  smtpConfigured,
  canPromoteTenantAdmin,
}: {
  smtpConfigured: boolean;
  canPromoteTenantAdmin: boolean;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"worker" | "tenant_admin">("worker");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, startTransition] = useTransition();

  const disabled = !smtpConfigured || submitting;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!smtpConfigured) return;
    setError(null);
    setNotice(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await inviteUserAction({ email: email.trim(), role });
      if (isErr(result)) {
        setError(result.message);
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        return;
      }
      setNotice(result.data.note);
      setEmail("");
    });
  }

  return (
    <section
      data-component="user-invite-form"
      className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-[var(--ink)]">ユーザーを招待</h3>
        <p className="text-xs text-[var(--muted)]">
          メールアドレスとロールを指定して招待します。SMTP / Edge Function が未設定の場合は
          記録のみで送信は保留されます。
        </p>
      </header>

      {!smtpConfigured ? (
        <Alert tone="warn" title="SMTP 未設定のため招待は無効化されています">
          <p data-testid="user-invite-disabled-reason">
            通知設定で SMTP host を登録すると招待フォームが有効になります。
            登録後に `inviteUser` Edge Function (Phase 7 デプロイ予定) からメールが送信されます。
          </p>
        </Alert>
      ) : null}

      {error ? (
        <Alert tone="error" title="送信エラー">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="warn" title="招待を記録 (degraded)">
          <p data-testid="user-invite-degraded-note">{notice}</p>
        </Alert>
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <Field
          id="invite-email"
          label="メールアドレス"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={disabled}
          required
          error={fieldErrors.email}
          data-testid="user-invite-email"
          autoComplete="off"
        />
        <fieldset className="flex flex-col gap-2" disabled={disabled}>
          <legend className="text-sm font-medium text-[var(--ink)]">付与するロール</legend>
          <label className="flex h-12 min-h-12 items-center gap-2 border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm">
            <input
              type="radio"
              name="invite-role"
              value="worker"
              checked={role === "worker"}
              onChange={() => setRole("worker")}
              data-testid="user-invite-role-worker"
            />
            作業者 (worker)
          </label>
          {canPromoteTenantAdmin ? (
            <label className="flex h-12 min-h-12 items-center gap-2 border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm">
              <input
                type="radio"
                name="invite-role"
                value="tenant_admin"
                checked={role === "tenant_admin"}
                onChange={() => setRole("tenant_admin")}
                data-testid="user-invite-role-tenant-admin"
              />
              テナント管理者 (tenant_admin) — system_admin のみ
            </label>
          ) : null}
        </fieldset>
        <div className="flex justify-end">
          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={disabled}
            data-testid="user-invite-submit"
          >
            {submitting ? "送信中…" : "招待する"}
          </Button>
        </div>
      </form>
    </section>
  );
}
