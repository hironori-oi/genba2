import Link from "next/link";

export default function RootPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-6 py-12">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
        GENBA / Phase 1 Scaffolding
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[var(--ink)] sm:text-5xl">
        現場の入力に、迷いを残さない。
      </h1>
      <p className="mt-4 max-w-xl text-base text-[var(--muted)]">
        QR を読む → 照合する → 登録する。製造 / 物流現場の 4 業務 (入庫・ピッキング・棚卸・製造) を 1 端末で扱う multi-tenant SaaS。
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/login"
          className="inline-flex h-14 min-w-14 items-center justify-center bg-[var(--color-brand)] px-6 text-base font-medium text-[var(--color-brand-foreground)] hover:bg-[oklch(42%_.1_175)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          ログイン
        </Link>
        <Link
          href="/forgot-password"
          className="inline-flex h-14 min-w-14 items-center justify-center border border-[var(--border)] bg-[var(--surface)] px-6 text-base font-medium text-[var(--ink)] hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          パスワードをお忘れの方
        </Link>
      </div>
      <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <BusinessBadge label="入庫" badge="入" accent="bg-[var(--color-func-receive)]" />
        <BusinessBadge label="ピッキング" badge="ピ" accent="bg-[var(--color-func-pick)]" />
        <BusinessBadge label="棚卸" badge="棚" accent="bg-[var(--color-func-inventory)]" />
        <BusinessBadge label="製造" badge="製" accent="bg-[var(--color-func-manufact)]" />
      </ul>
    </main>
  );
}

function BusinessBadge({
  label,
  badge,
  accent,
}: {
  label: string;
  badge: string;
  accent: string;
}) {
  // Non-interactive marketing card. Min height >= 56px keeps it from reading
  // as a tappable button while still meeting DESIGN_DIRECTION glove-touch
  // sizing.
  return (
    <li className="flex min-h-14 items-center gap-3 border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
      <span
        aria-hidden
        className={`grid h-10 w-10 place-items-center font-mono text-sm font-semibold text-white ${accent}`}
      >
        {badge}
      </span>
      <span className="text-base font-medium text-[var(--ink)]">{label}</span>
    </li>
  );
}
