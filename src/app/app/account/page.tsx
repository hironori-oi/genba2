import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { Alert } from "@/components/ui/Alert";
import { supabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "個人設定" };

const CARDS = [
  {
    href: "/app/account/profile",
    code: "profile",
    badge: "P",
    title: "プロフィール",
    description: "表示名と連絡先 (任意) を編集します。表示名はダッシュボードや履歴で利用されます。",
  },
  {
    href: "/app/account/preferences",
    code: "preferences",
    badge: "S",
    title: "個人設定",
    description: "表示言語 (日本語 / 英語)、テーマ (ライト / ダーク / OS追従)、通知の受信レベルを切り替えます。",
  },
];

export default async function AccountIndexPage() {
  const session = await getAppSession();
  if (session.kind === "unauthenticated") {
    redirect("/login?next=/app/account");
  }

  const configured = supabaseConfigured();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          個人設定
        </p>
        <h1
          id="account-heading"
          className="mt-1 text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl"
        >
          個人設定とプロフィール
        </h1>
        <p className="text-sm text-[var(--muted)]">
          自分のプロフィール (表示名 / 連絡先) と利用設定 (言語 / テーマ / 通知) を編集します。値は Supabase Auth の user_metadata に保存され、ロールやテナント割当には影響しません。
        </p>
      </header>

      {!configured ? (
        <Alert tone="info" title="プレビューモード">
          Supabase 接続情報が未設定のため、設定は保存されません。
        </Alert>
      ) : null}

      <section aria-labelledby="account-cards">
        <h2 id="account-cards" className="sr-only">
          利用可能なメニュー
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CARDS.map((c) => (
            <li key={c.code}>
              <Link
                href={c.href}
                data-testid={`account-card-${c.code}`}
                className="flex h-full flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
              >
                <header className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="grid h-11 w-11 place-items-center bg-[var(--color-brand)] font-mono text-base font-semibold text-[var(--color-brand-foreground)]"
                  >
                    {c.badge}
                  </span>
                  <h3 className="text-base font-semibold text-[var(--ink)]">
                    {c.title}
                  </h3>
                </header>
                <p className="text-sm text-[var(--muted)]">{c.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
