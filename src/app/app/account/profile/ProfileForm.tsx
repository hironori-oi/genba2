"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { isErr } from "@/lib/admin/shared/result";
import { saveProfileAction } from "./actions";

export function ProfileForm({
  email,
  initialDisplayName,
  initialPhone,
}: {
  email: string | null;
  initialDisplayName: string;
  initialPhone: string | null;
}) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setNotice(null);
    startTransition(async () => {
      const result = await saveProfileAction({
        displayName,
        phone: phone.length > 0 ? phone : null,
      });
      if (isErr(result)) {
        setError(result.message);
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        return;
      }
      setNotice("プロフィールを更新しました。");
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 border border-[var(--border)] bg-[var(--surface)] p-4"
      data-testid="profile-form"
    >
      <Field
        label="メールアドレス"
        value={email ?? ""}
        readOnly
        disabled
        data-testid="profile-email"
        hint="変更するには再招待 / パスワードリセット手順をご利用ください。"
      />
      <Field
        label="表示名"
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        data-testid="profile-display-name"
        error={fieldErrors["displayName"]}
        required
      />
      <Field
        label="連絡先 (任意)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        data-testid="profile-phone"
        error={fieldErrors["phone"]}
        hint="ハイフン / 半角スペース / 先頭 + を許容します。"
      />

      {error ? (
        <Alert tone="error" title="保存できませんでした">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="info" title="保存完了">
          {notice}
        </Alert>
      ) : null}

      <footer className="flex flex-wrap justify-end gap-2">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          data-testid="profile-save"
          disabled={submitting}
        >
          {submitting ? "保存中…" : "保存"}
        </Button>
      </footer>
    </form>
  );
}
