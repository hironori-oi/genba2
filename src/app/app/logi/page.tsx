import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "物流業務" };

type Business = {
  href: string;
  code: string;
  label: string;
  badge: string;
  accent: string;
  description: string;
  disabled?: boolean;
  disabledNote?: string;
};

const BUSINESSES: Business[] = [
  {
    href: "/app/logi/receiving",
    code: "receiving",
    label: "入庫",
    badge: "入",
    accent: "var(--color-func-receive)",
    description:
      "現品ラベル QR を自由読取して入庫を記録します (UC-2)。ロケーション補正・手入力フォールバックに対応。",
  },
  {
    href: "/app/logi/picking",
    code: "picking",
    label: "ピッキング",
    badge: "ピ",
    accent: "var(--color-func-pick)",
    description:
      "ヘッダ → 明細 → 現品ラベルの 2 点照合 (UC-1)。NG 時は ng_flow の設定に従って block / warn。",
  },
  {
    href: "/app/logi/inventory",
    code: "inventory",
    label: "棚卸",
    badge: "棚",
    accent: "var(--color-func-inventory)",
    description:
      "棚卸計画 CSV 取込 → ロケーション QR → ラベル QR → 実数量入力 (UC-3)。差異 CSV を出力できます。",
  },
  {
    // Phase 4c で WORKS エリアの /app/works/manufacturing が公開されたため
    // enable に切替。LOGI 3 業務とは別ディレクトリだが、現場が dashboard /
    // LOGI トップから直接渡れるように同列に表示する。
    href: "/app/works/manufacturing",
    code: "manufacturing",
    label: "製造",
    badge: "製",
    accent: "var(--color-func-manufact)",
    description:
      "製造実績の登録 (UC-4)。工程 → 実数量 → 不適合 → 任意の製造入庫を 1 トランザクションで登録します。",
  },
];

export default async function LogiIndexPage() {
  const result = await getAppSession();
  if (result.kind === "unauthenticated") {
    redirect("/login?next=/app/logi");
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="logi-heading">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          LOGI
        </p>
        <h1
          id="logi-heading"
          className="mt-1 text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl"
        >
          物流業務
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          入庫 / ピッキング / 棚卸 の 3 業務を 1 端末で扱います。各業務は QR を中心に進み、必要に応じて手入力フォールバックに切替えできます。製造業務は WORKS エリア (/app/works/manufacturing) で同じ操作感で扱えます。
        </p>
      </section>

      <section aria-labelledby="logi-businesses">
        <h2 id="logi-businesses" className="sr-only">
          利用可能な物流業務
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {BUSINESSES.map((b) => (
            <li key={b.code}>
              {b.disabled ? (
                <article
                  data-testid={`logi-card-${b.code}`}
                  className="relative flex h-full flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4 opacity-70"
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
                    <h3 className="text-base font-semibold text-[var(--ink)]">
                      {b.label}
                    </h3>
                  </header>
                  <p className="pl-2 text-sm text-[var(--muted)]">
                    {b.description}
                  </p>
                  {b.disabledNote ? (
                    <span className="pl-2 font-mono text-xs uppercase tracking-wide text-[var(--muted)]">
                      {b.disabledNote}
                    </span>
                  ) : null}
                </article>
              ) : (
                <Link
                  href={b.href}
                  data-testid={`logi-card-${b.code}`}
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
                    <h3 className="text-base font-semibold text-[var(--ink)]">
                      {b.label}
                    </h3>
                  </header>
                  <p className="pl-2 text-sm text-[var(--muted)]">
                    {b.description}
                  </p>
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="logi-secondary"
        className="border border-[var(--border)] bg-[var(--surface)] p-4 text-sm"
      >
        <h2
          id="logi-secondary"
          className="text-sm font-semibold text-[var(--ink)]"
        >
          関連メニュー
        </h2>
        <ul className="mt-2 flex flex-wrap gap-2">
          <li>
            <Link
              href="/app/logi/history"
              data-testid="logi-link-history"
              className="inline-flex h-12 items-center border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--ink)] hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
            >
              履歴を見る
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
