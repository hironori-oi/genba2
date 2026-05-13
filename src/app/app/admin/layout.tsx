import { redirect } from "next/navigation";
import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { getAppSession } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/env";

const TABS = [
  { href: "/app/admin/fields", label: "項目設定", badge: "項" },
  { href: "/app/admin/qr", label: "QR 設定", badge: "Q" },
  { href: "/app/admin/match-rules", label: "照合ルール", badge: "照" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await getAppSession();
  // The /app layout already redirected unauthenticated visitors. We still
  // need to verify role here because RLS happens at query time; surfacing a
  // clean "forbidden" message is friendlier than a Supabase 42501.
  if (result.kind === "ok" && result.session.role === "worker") {
    redirect("/app?notice=admin-forbidden");
  }

  const demoMode = !supabaseConfigured();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          運用設定
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl">
          項目・QR・照合ルール
        </h1>
        <p className="text-sm text-[var(--muted)]">
          標準項目の利用 ON/OFF と用途、QR バージョン、照合ルールを編集します。Phase 2 では編集 UI と読取テストを提供し、Phase 3 以降の業務画面はここでの設定をそのまま使用します。
        </p>
      </header>

      {demoMode ? (
        <Alert tone="info" title="プレビューモード">
          Supabase 接続情報が未設定のため、ダミーデータでプレビュー表示しています。実値を `.env.enc` に登録後、ライブ DB の値が表示されます。
        </Alert>
      ) : null}

      <nav aria-label="管理タブ" className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-2">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="inline-flex h-12 items-center gap-2 border border-[var(--border)] bg-[var(--surface)] px-3 text-sm font-medium text-[var(--ink)] hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            <span
              aria-hidden
              className="grid h-7 w-7 place-items-center bg-[var(--surface-2)] font-mono text-xs font-semibold text-[var(--ink)]"
            >
              {tab.badge}
            </span>
            {tab.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
