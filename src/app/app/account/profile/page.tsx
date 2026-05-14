import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/env";
import { ProfileForm } from "./ProfileForm";

export const metadata: Metadata = { title: "プロフィール" };

export default async function ProfilePage() {
  const session = await getAppSession();
  if (session.kind === "unauthenticated") {
    redirect("/login?next=/app/account/profile");
  }

  const configured = supabaseConfigured();
  let email = session.kind === "ok" ? session.session.email : null;
  let displayName: string = session.kind === "ok" ? session.session.displayName ?? "" : "";
  let phone: string | null = null;

  if (configured) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data?.user) {
      email = data.user.email ?? email;
      const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
      if (typeof meta.display_name === "string") {
        displayName = meta.display_name;
      }
      if (typeof meta.phone === "string") {
        phone = meta.phone;
      }
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          個人設定 / プロフィール
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl">
          プロフィール
        </h1>
        <p className="text-sm text-[var(--muted)]">
          表示名と任意の連絡先を編集します。メールアドレスはログイン用の識別子で、別画面 (招待 / リセット) からのみ変更できます。
        </p>
      </header>

      <nav aria-label="個人設定パンくず" className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/app/account"
          data-testid="account-back-to-index"
          className="inline-flex h-12 items-center border border-[var(--border)] bg-[var(--surface)] px-3 text-[var(--ink)] hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          ← 個人設定トップへ戻る
        </Link>
      </nav>

      {!configured ? (
        <Alert tone="info" title="プレビューモード">
          Supabase 接続情報が未設定のため、更新は保存されません。
        </Alert>
      ) : null}

      <ProfileForm
        email={email}
        initialDisplayName={displayName}
        initialPhone={phone}
      />
    </div>
  );
}
