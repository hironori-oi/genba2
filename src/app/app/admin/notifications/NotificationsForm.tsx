"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { isErr } from "@/lib/admin/shared/result";
import { upsertNotificationPreferencesAction } from "./actions";

export type SafePreferences = {
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUsername: string | null;
  smtpFromEmail: string | null;
  smtpFromName: string | null;
  notifyCorrectionApproval: boolean;
  notifyCorrectionCompleted: boolean;
  notifyMonthlyCap: boolean;
  webhookUrl: string | null;
  hasSmtpPassword: boolean;
  hasWebhookSecret: boolean;
};

export function NotificationsForm({ initial }: { initial: SafePreferences }) {
  const [smtpHost, setSmtpHost] = useState(initial.smtpHost ?? "");
  const [smtpPort, setSmtpPort] = useState(
    initial.smtpPort ? String(initial.smtpPort) : "587",
  );
  const [smtpUsername, setSmtpUsername] = useState(initial.smtpUsername ?? "");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFromEmail, setSmtpFromEmail] = useState(initial.smtpFromEmail ?? "");
  const [smtpFromName, setSmtpFromName] = useState(initial.smtpFromName ?? "");
  const [notifyCorrectionApproval, setNotifyCorrectionApproval] = useState(
    initial.notifyCorrectionApproval,
  );
  const [notifyCorrectionCompleted, setNotifyCorrectionCompleted] = useState(
    initial.notifyCorrectionCompleted,
  );
  const [notifyMonthlyCap, setNotifyMonthlyCap] = useState(
    initial.notifyMonthlyCap,
  );
  const [webhookUrl, setWebhookUrl] = useState(initial.webhookUrl ?? "");
  const [webhookSecret, setWebhookSecret] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setFieldErrors({});
    startTransition(async () => {
      const result = await upsertNotificationPreferencesAction({
        smtpHost: smtpHost.trim() || null,
        smtpPort: smtpPort.trim() || null,
        smtpUsername: smtpUsername.trim() || null,
        smtpPassword: smtpPassword || null,
        smtpFromEmail: smtpFromEmail.trim() || null,
        smtpFromName: smtpFromName.trim() || null,
        notifyCorrectionApproval,
        notifyCorrectionCompleted,
        notifyMonthlyCap,
        webhookUrl: webhookUrl.trim() || null,
        webhookSecret: webhookSecret || null,
      });
      if (isErr(result)) {
        setError(result.message);
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        return;
      }
      setSmtpPassword("");
      setWebhookSecret("");
      setNotice("通知設定を保存しました。");
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
      data-component="notifications-form"
    >
      {error ? (
        <Alert tone="error" title="保存エラー">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="ok" title="完了">
          {notice}
        </Alert>
      ) : null}

      <fieldset className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4">
        <legend className="px-1 text-sm font-semibold text-[var(--ink)]">
          SMTP 接続情報
        </legend>
        <p className="text-xs text-[var(--muted)]">
          パスワードは保存後に画面へ表示されません。空欄のまま保存すれば現在のパスワードは保持されます。
        </p>
        <Field
          id="smtp-host"
          label="SMTP host"
          value={smtpHost}
          onChange={(e) => setSmtpHost(e.target.value)}
          placeholder="smtp.example.com"
          error={fieldErrors.smtpHost}
          data-testid="notif-smtp-host"
        />
        <Field
          id="smtp-port"
          label="SMTP port"
          inputMode="numeric"
          value={smtpPort}
          onChange={(e) => setSmtpPort(e.target.value)}
          placeholder="587"
          error={fieldErrors.smtpPort}
          data-testid="notif-smtp-port"
        />
        <Field
          id="smtp-username"
          label="SMTP username"
          value={smtpUsername}
          onChange={(e) => setSmtpUsername(e.target.value)}
          error={fieldErrors.smtpUsername}
          data-testid="notif-smtp-username"
        />
        <Field
          id="smtp-password"
          label={
            initial.hasSmtpPassword
              ? "SMTP password (設定済 — 変更時のみ入力)"
              : "SMTP password"
          }
          type="password"
          value={smtpPassword}
          onChange={(e) => setSmtpPassword(e.target.value)}
          autoComplete="new-password"
          error={fieldErrors.smtpPassword}
          data-testid="notif-smtp-password"
          hint={
            initial.hasSmtpPassword
              ? "保存済みパスワードはサーバーから読み取れない設計のため、画面には決して表示されません。"
              : "未設定。Edge Function からのみ読み取り可能 (RLS-606)。"
          }
        />
        <Field
          id="smtp-from-email"
          label="差出人メール"
          type="email"
          value={smtpFromEmail}
          onChange={(e) => setSmtpFromEmail(e.target.value)}
          error={fieldErrors.smtpFromEmail}
          data-testid="notif-smtp-from-email"
        />
        <Field
          id="smtp-from-name"
          label="差出人名"
          value={smtpFromName}
          onChange={(e) => setSmtpFromName(e.target.value)}
          error={fieldErrors.smtpFromName}
          data-testid="notif-smtp-from-name"
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4">
        <legend className="px-1 text-sm font-semibold text-[var(--ink)]">
          通知トリガ
        </legend>
        <Toggle
          id="notify-correction-approval"
          label="訂正承認待ち通知"
          checked={notifyCorrectionApproval}
          onChange={setNotifyCorrectionApproval}
        />
        <Toggle
          id="notify-correction-completed"
          label="訂正完了通知"
          checked={notifyCorrectionCompleted}
          onChange={setNotifyCorrectionCompleted}
        />
        <Toggle
          id="notify-monthly-cap"
          label="月間スキャン上限 80% 到達通知"
          checked={notifyMonthlyCap}
          onChange={setNotifyMonthlyCap}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4">
        <legend className="px-1 text-sm font-semibold text-[var(--ink)]">
          Webhook (任意)
        </legend>
        <Field
          id="webhook-url"
          label="Webhook URL"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://hooks.example.com/genba"
          error={fieldErrors.webhookUrl}
          data-testid="notif-webhook-url"
        />
        <Field
          id="webhook-secret"
          label={
            initial.hasWebhookSecret
              ? "Webhook secret (設定済 — 変更時のみ入力)"
              : "Webhook secret"
          }
          type="password"
          value={webhookSecret}
          onChange={(e) => setWebhookSecret(e.target.value)}
          autoComplete="new-password"
          error={fieldErrors.webhookSecret}
          hint="保存後はサーバーから読み取れません (column-level revoke)。"
        />
      </fieldset>

      <div className="flex justify-end">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          disabled={submitting}
          data-testid="notifications-save"
        >
          {submitting ? "保存中…" : "保存"}
        </Button>
      </div>
    </form>
  );
}

function Toggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex h-14 min-h-14 items-center justify-between gap-3 border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm text-[var(--ink)]"
    >
      <span className="flex-1">{label}</span>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-6 w-6"
        data-testid={`${id}-toggle`}
      />
    </label>
  );
}
