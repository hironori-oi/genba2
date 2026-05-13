import Link from "next/link";
import { type ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { AppRole } from "@/lib/auth/session";

type NavItem = {
  href: string;
  label: string;
  badge: string;
  accent: string;
  disabled?: boolean;
};

const BUSINESS_NAV: NavItem[] = [
  {
    href: "/app/logi/receiving",
    label: "入庫",
    badge: "入",
    accent: "bg-[var(--color-func-receive)]",
  },
  {
    href: "/app/logi/picking",
    label: "ピッキング",
    badge: "ピ",
    accent: "bg-[var(--color-func-pick)]",
  },
  {
    href: "/app/logi/inventory",
    label: "棚卸",
    badge: "棚",
    accent: "bg-[var(--color-func-inventory)]",
  },
  {
    href: "/app/work/manufacturing",
    label: "製造",
    badge: "製",
    accent: "bg-[var(--color-func-manufact)]",
    disabled: true,
  },
];

const ADMIN_NAV: NavItem[] = [
  {
    href: "/app/admin/fields",
    label: "項目設定",
    badge: "項",
    accent: "bg-[var(--surface-2)]",
  },
  {
    href: "/app/admin/qr",
    label: "QR 設定",
    badge: "Q",
    accent: "bg-[var(--surface-2)]",
  },
  {
    href: "/app/admin/match-rules",
    label: "照合ルール",
    badge: "照",
    accent: "bg-[var(--surface-2)]",
  },
];

const SYSTEM_NAV: NavItem[] = [
  {
    href: "/app/system-admin",
    label: "テナント管理",
    badge: "S",
    accent: "bg-[var(--surface-2)]",
    disabled: true,
  },
];

function navFor(role: AppRole): NavItem[] {
  if (role === "system_admin") return [...BUSINESS_NAV, ...ADMIN_NAV, ...SYSTEM_NAV];
  if (role === "tenant_admin") return [...BUSINESS_NAV, ...ADMIN_NAV];
  return BUSINESS_NAV;
}

const ROLE_LABEL: Record<AppRole, string> = {
  worker: "作業者",
  tenant_admin: "テナント管理者",
  system_admin: "システム管理者",
};

export function AppShell({
  role,
  email,
  displayName,
  tenantId,
  children,
  logoutAction,
}: {
  role: AppRole;
  email: string | null;
  displayName: string | null;
  tenantId: string | null;
  children: ReactNode;
  logoutAction?: () => Promise<void>;
}) {
  const items = navFor(role);

  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[240px_1fr]">
      <aside
        className="hidden flex-col bg-[var(--sidebar)] text-[var(--sidebar-foreground)] lg:flex"
        aria-label="グローバルナビゲーション"
      >
        <div className="px-6 py-5">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--sidebar-muted)]">
            GENBA
          </p>
          <p className="mt-1 font-mono text-sm text-[var(--sidebar-foreground)]">
            v0.1 / Phase 1
          </p>
        </div>
        <nav className="flex-1 px-3" aria-label="業務">
          <p className="px-3 pb-2 pt-4 text-[10px] uppercase tracking-wide text-[var(--sidebar-muted)]">
            業務
          </p>
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.href}>
                <NavLink {...item} />
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-white/10 px-4 py-4 text-xs text-[var(--sidebar-muted)]">
          <p className="font-medium text-[var(--sidebar-foreground)]">
            {displayName ?? email ?? "ユーザー未取得"}
          </p>
          <p>{ROLE_LABEL[role]}</p>
          <p className="mt-1 font-mono text-[10px] break-all">
            {tenantId ? `tenant: ${tenantId.slice(0, 8)}…` : "tenant: 未設定"}
          </p>
        </div>
      </aside>

      <div className="flex flex-col">
        <header
          className="flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 lg:px-8"
          role="banner"
        >
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center bg-[var(--color-brand)] font-mono text-sm font-semibold text-[var(--color-brand-foreground)]">
              G
            </span>
            <div className="hidden flex-col leading-tight sm:flex">
              <span className="text-sm font-semibold text-[var(--ink)]">GENBA</span>
              <span className="text-xs text-[var(--muted)]">
                現場作業記録 SaaS
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusChip tone="ok">オンライン</StatusChip>
            <StatusChip tone="muted">{ROLE_LABEL[role]}</StatusChip>
            {logoutAction ? (
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="h-9 px-3 text-sm font-medium text-[var(--ink)] border border-[var(--border)] hover:border-[var(--color-bad)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                >
                  ログアウト
                </button>
              </form>
            ) : null}
          </div>
        </header>

        <main
          id="main"
          className="flex-1 px-4 py-6 lg:px-8 lg:py-8"
          role="main"
        >
          {children}
        </main>
      </div>
    </div>
  );
}

function NavLink({ href, label, badge, accent, disabled }: NavItem) {
  const className = cn(
    "flex items-center gap-3 px-3 py-2 text-sm",
    "border-l-[3px] border-transparent",
    disabled
      ? "cursor-not-allowed text-[var(--sidebar-muted)]"
      : "text-[var(--sidebar-foreground)] hover:border-[var(--color-brand)] hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]",
  );
  const content = (
    <>
      <span
        aria-hidden
        className={cn(
          "grid h-7 w-7 place-items-center font-mono text-xs font-semibold text-white",
          accent,
        )}
      >
        {badge}
      </span>
      <span className="flex-1">{label}</span>
      {disabled ? (
        <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--sidebar-muted)]">
          P{label === "テナント管理" ? "6+" : "3+"}
        </span>
      ) : null}
    </>
  );
  if (disabled) {
    return (
      <span aria-disabled className={className} title="Phase 2 以降で実装">
        {content}
      </span>
    );
  }
  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}

function StatusChip({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "bad" | "muted";
  children: ReactNode;
}) {
  const palette: Record<typeof tone, string> = {
    ok: "border-[var(--color-ok)] text-[var(--color-ok)]",
    warn: "border-[var(--color-warn)] text-[var(--color-warn)]",
    bad: "border-[var(--color-bad)] text-[var(--color-bad)]",
    muted: "border-[var(--border)] text-[var(--muted)]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
        palette[tone],
      )}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          tone === "ok" && "bg-[var(--color-ok)]",
          tone === "warn" && "bg-[var(--color-warn)]",
          tone === "bad" && "bg-[var(--color-bad)]",
          tone === "muted" && "bg-[var(--muted)]",
        )}
      />
      {children}
    </span>
  );
}
