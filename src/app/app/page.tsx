import type { Metadata } from "next";
import Link from "next/link";
import { getAppSession } from "@/lib/auth/session";
import { Alert } from "@/components/ui/Alert";

export const metadata: Metadata = { title: "ダッシュボード" };

const BUSINESSES = [
  {
    code: "receiving",
    label: "入庫",
    badge: "入",
    accent: "var(--color-func-receive)",
    href: "/app/logi/receiving",
    note: "ラベル QR を読取して入庫を記録",
    disabled: false,
  },
  {
    code: "picking",
    label: "ピッキング",
    badge: "ピ",
    accent: "var(--color-func-pick)",
    href: "/app/logi/picking",
    note: "ヘッダ → 明細 → ラベルの 2 点照合",
    disabled: false,
  },
  {
    code: "inventory",
    label: "棚卸",
    badge: "棚",
    accent: "var(--color-func-inventory)",
    href: "/app/logi/inventory",
    note: "CSV 取込 → ロケ → ラベル → 実数量",
    disabled: false,
  },
  {
    code: "manufacturing",
    label: "製造",
    badge: "製",
    accent: "var(--color-func-manufact)",
    href: "/app/work/manufacturing",
    note: "Phase 4 で実装",
    disabled: true,
  },
];

export default async function AppHome({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const result = await getAppSession();
  const sp = (await searchParams) ?? {};
  const notice = typeof sp.notice === "string" ? sp.notice : null;

  // Layout already handled unconfigured/unauthenticated states, but narrow types here.
  const session = result.kind === "ok" ? result.session : null;

  return (
    <div className="flex flex-col gap-6">
      {notice === "recovery" ? (
        <Alert tone="info" title="パスワード再設定">
          パスワードのリセットが確認されました。設定タブからパスワードを更新してください (Phase 5 で UI 提供予定)。
        </Alert>
      ) : null}
      <section aria-labelledby="welcome">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          ダッシュボード
        </p>
        <h1
          id="welcome"
          className="mt-1 text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl"
        >
          {session?.displayName ?? session?.email ?? "ようこそ"} さん、こんにちは。
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          業務を選んで作業を開始します。Phase 1 では認証と基盤のみ実装、業務画面は Phase 3 以降で順次開放されます。
        </p>
      </section>

      <section aria-labelledby="business-list">
        <h2 id="business-list" className="sr-only">
          利用可能な業務
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {BUSINESSES.map((b) => (
            <li key={b.code}>
              {b.disabled ? (
                <article className="relative flex h-full flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4 opacity-70">
                  <span
                    aria-hidden
                    className="absolute left-0 top-0 h-full w-1"
                    style={{ background: b.accent }}
                  />
                  <header className="flex items-center gap-3 pl-2">
                    <span
                      aria-hidden
                      className="grid h-11 w-11 place-items-center font-mono text-base font-semibold text-white"
                      style={{ background: b.accent }}
                    >
                      {b.badge}
                    </span>
                    <h3 className="text-base font-semibold text-[var(--ink)]">{b.label}</h3>
                  </header>
                  <p className="pl-2 text-xs text-[var(--muted)]">{b.note}</p>
                  <span className="pl-2 text-xs font-medium text-[var(--muted)]">まもなく</span>
                </article>
              ) : (
                <Link
                  href={b.href}
                  data-testid={`dashboard-card-${b.code}`}
                  className="relative flex h-full flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                >
                  <span
                    aria-hidden
                    className="absolute left-0 top-0 h-full w-1"
                    style={{ background: b.accent }}
                  />
                  <header className="flex items-center gap-3 pl-2">
                    <span
                      aria-hidden
                      className="grid h-11 w-11 place-items-center font-mono text-base font-semibold text-white"
                      style={{ background: b.accent }}
                    >
                      {b.badge}
                    </span>
                    <h3 className="text-base font-semibold text-[var(--ink)]">{b.label}</h3>
                  </header>
                  <p className="pl-2 text-xs text-[var(--muted)]">{b.note}</p>
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="status"
        className="border border-[var(--border)] bg-[var(--surface)] p-4 text-sm"
      >
        <h2 id="status" className="text-sm font-semibold text-[var(--ink)]">
          セッション情報
        </h2>
        <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">ロール</dt>
            <dd className="font-mono text-sm text-[var(--ink)]">{session?.role ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">テナント ID</dt>
            <dd className="font-mono text-xs text-[var(--ink)] break-all">
              {session?.tenantId ?? "未割当 (オーナーが initial admin として割当)"}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
