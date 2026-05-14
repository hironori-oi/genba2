import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { Alert } from "@/components/ui/Alert";
import { supabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "訂正" };

const CARDS = [
  {
    href: "/app/correct/movements",
    code: "movements",
    label: "入庫 / ピッキング 訂正",
    badge: "物",
    accent: "var(--color-func-receive)",
    description:
      "自分が登録した入庫 / ピッキング (movement_records) のうち、品目・数量・ロット・ロケーションの訂正を行います。",
  },
  {
    href: "/app/correct/inventory",
    code: "inventory",
    label: "棚卸 訂正",
    badge: "棚",
    accent: "var(--color-func-inventory)",
    description:
      "自分が登録した棚卸 (inventory_records) の実数量 / ロケーションを訂正します。",
  },
  {
    href: "/app/correct/manufacturing",
    code: "manufacturing",
    label: "製造実績 訂正",
    badge: "製",
    accent: "var(--color-func-manufact)",
    description:
      "自分が登録した製造実績 (manufacturing_records) の実数量・良品数量・不適合数量・時刻を訂正します。製造入庫を残すか同時に取り消すかも選択できます。",
  },
];

export default async function CorrectIndexPage() {
  const session = await getAppSession();
  if (session.kind === "unauthenticated") {
    redirect("/login?next=/app/correct");
  }

  const configured = supabaseConfigured();

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          訂正
        </p>
        <h1
          id="correct-heading"
          className="mt-1 text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl"
        >
          自分の記録を訂正
        </h1>
        <p className="text-sm text-[var(--muted)]">
          自分が登録した直近の業務記録を、新しいレコード + 旧レコードの論理削除として 1
          トランザクションで訂正します。訂正履歴は corrections_audit に保存され、テナント管理者が後から参照できます。
        </p>
      </header>

      {!configured ? (
        <Alert tone="info" title="プレビューモード">
          Supabase 接続情報が未設定のため、訂正は実行されません。
        </Alert>
      ) : null}

      <section aria-labelledby="correct-businesses">
        <h2 id="correct-businesses" className="sr-only">
          訂正できる業務
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CARDS.map((c) => (
            <li key={c.code}>
              <Link
                href={c.href}
                data-testid={`correct-card-${c.code}`}
                className="relative flex h-full flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
              >
                <span
                  aria-hidden
                  className="absolute left-0 top-0 h-full w-1"
                  style={{ background: c.accent }}
                />
                <header className="flex items-center gap-3 pl-2">
                  <span
                    aria-hidden
                    className="grid h-11 w-11 place-items-center font-mono text-base font-semibold text-white"
                    style={{ background: c.accent }}
                  >
                    {c.badge}
                  </span>
                  <h3 className="text-base font-semibold text-[var(--ink)]">
                    {c.label}
                  </h3>
                </header>
                <p className="pl-2 text-sm text-[var(--muted)]">{c.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="correct-notes"
        className="border border-[var(--border)] bg-[var(--surface)] p-4 text-sm"
      >
        <h2 id="correct-notes" className="text-sm font-semibold text-[var(--ink)]">
          訂正の取り扱い
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--muted)]">
          <li>表示されるのは自分が作成した未訂正の直近 30 件です。</li>
          <li>訂正の理由 (1〜256 文字) は必須です。</li>
          <li>製造実績の訂正は、紐付く製造入庫を残すかどうか選択できます (既定は残す)。</li>
        </ul>
      </section>
    </div>
  );
}
