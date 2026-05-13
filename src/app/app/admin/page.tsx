import Link from "next/link";

const CARDS = [
  {
    href: "/app/admin/fields",
    title: "項目設定",
    badge: "項",
    description: "標準項目の利用 ON/OFF と用途 (5 種) を設定します。",
  },
  {
    href: "/app/admin/qr",
    title: "QR 設定",
    badge: "Q",
    description: "QR フォーマット V1/V2 を編集し、読取テストで両バージョンの解析結果を確認します。",
  },
  {
    href: "/app/admin/match-rules",
    title: "照合ルール",
    badge: "照",
    description: "2 点照合のフィールド対応・比較方法・NG/警告ポリシーを設定します。",
  },
];

export default function AdminIndex() {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {CARDS.map((c) => (
        <li key={c.href}>
          <Link
            href={c.href}
            className="flex h-full flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            <header className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid h-11 w-11 place-items-center bg-[var(--color-brand)] font-mono text-base font-semibold text-[var(--color-brand-foreground)]"
              >
                {c.badge}
              </span>
              <h2 className="text-base font-semibold text-[var(--ink)]">{c.title}</h2>
            </header>
            <p className="text-sm text-[var(--muted)]">{c.description}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
