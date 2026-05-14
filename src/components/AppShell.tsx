import Link from "next/link";
import { type ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/cn";
import type { AppRole } from "@/lib/auth/session";
import { resolveUsageBannerSignal } from "@/lib/admin/usage/banner";

type NavItemDef = {
  href: string;
  labelKey: string;
  badge: string;
  accent: string;
  disabled?: boolean;
  phase6Pending?: boolean;
};

const BUSINESS_NAV: NavItemDef[] = [
  {
    href: "/app/logi/receiving",
    labelKey: "receiving",
    badge: "入",
    accent: "bg-[var(--color-func-receive)]",
  },
  {
    href: "/app/logi/picking",
    labelKey: "picking",
    badge: "ピ",
    accent: "bg-[var(--color-func-pick)]",
  },
  {
    href: "/app/logi/inventory",
    labelKey: "inventory",
    badge: "棚",
    accent: "bg-[var(--color-func-inventory)]",
  },
  {
    href: "/app/work/manufacturing",
    labelKey: "manufacturing",
    badge: "製",
    accent: "bg-[var(--color-func-manufact)]",
    disabled: true,
  },
];

const ADMIN_NAV: NavItemDef[] = [
  { href: "/app/admin/fields", labelKey: "fields", badge: "項", accent: "bg-[var(--surface-2)]" },
  { href: "/app/admin/qr", labelKey: "qr", badge: "Q", accent: "bg-[var(--surface-2)]" },
  { href: "/app/admin/match-rules", labelKey: "matchRules", badge: "照", accent: "bg-[var(--surface-2)]" },
  { href: "/app/admin/reports", labelKey: "reports", badge: "報", accent: "bg-[var(--surface-2)]" },
  { href: "/app/admin/users", labelKey: "users", badge: "U", accent: "bg-[var(--surface-2)]" },
  { href: "/app/admin/usage", labelKey: "usage", badge: "%", accent: "bg-[var(--surface-2)]" },
  { href: "/app/admin/audit-logs", labelKey: "auditLogs", badge: "監", accent: "bg-[var(--surface-2)]" },
  { href: "/app/admin/notifications", labelKey: "notifications", badge: "通", accent: "bg-[var(--surface-2)]" },
];

const SYSTEM_NAV: NavItemDef[] = [
  { href: "/app/admin/tenants", labelKey: "tenants", badge: "テ", accent: "bg-[var(--surface-2)]" },
];

function navFor(role: AppRole): NavItemDef[] {
  if (role === "system_admin") return [...BUSINESS_NAV, ...ADMIN_NAV, ...SYSTEM_NAV];
  if (role === "tenant_admin") return [...BUSINESS_NAV, ...ADMIN_NAV];
  return BUSINESS_NAV;
}

export async function AppShell({
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
  const tShell = await getTranslations("appShell");
  const tNav = await getTranslations("nav");
  const tRoles = await getTranslations("roles");
  const tCommon = await getTranslations("common");
  const banner = await resolveUsageBannerSignal(role, tenantId);

  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[240px_1fr]">
      <aside
        className="hidden flex-col bg-[var(--sidebar)] text-[var(--sidebar-foreground)] lg:flex"
        aria-label={tShell("navAriaGlobal")}
      >
        <div className="px-6 py-5">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--sidebar-muted)]">
            GENBA
          </p>
          <p className="mt-1 font-mono text-sm text-[var(--sidebar-foreground)]">
            {tShell("phaseChip")}
          </p>
        </div>
        <nav className="flex-1 px-3" aria-label={tShell("navAriaBusiness")}>
          <p className="px-3 pb-2 pt-4 text-[10px] uppercase tracking-wide text-[var(--sidebar-muted)]">
            {tShell("navSectionBusiness")}
          </p>
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.href}>
                <NavLink
                  item={item}
                  label={tNav(item.labelKey)}
                  pendingChipFuture={tShell("pendingChipFuture")}
                  pendingChipP6={tShell("pendingChipP6")}
                  pendingTitle={tShell("phasePending")}
                />
              </li>
            ))}
          </ul>
        </nav>
        <div className="border-t border-white/10 px-4 py-4 text-xs text-[var(--sidebar-muted)]">
          <p className="font-medium text-[var(--sidebar-foreground)]">
            {displayName ?? email ?? tCommon("userMissing")}
          </p>
          <p>{tRoles(role)}</p>
          <p className="mt-1 font-mono text-[10px] break-all">
            {tenantId
              ? `${tShell("tenantPrefix")}: ${tenantId.slice(0, 8)}…`
              : tCommon("tenantNotSet")}
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
                {tShell("productTagline")}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusChip tone="ok">{tCommon("online")}</StatusChip>
            <StatusChip tone="muted">{tRoles(role)}</StatusChip>
            {logoutAction ? (
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="h-9 px-3 text-sm font-medium text-[var(--ink)] border border-[var(--border)] hover:border-[var(--color-bad)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                >
                  {tShell("logout")}
                </button>
              </form>
            ) : null}
          </div>
        </header>

        {banner ? (
          <div
            data-testid="app-shell-usage-banner"
            data-warning={banner.warning}
            role={banner.warning === "exceeded" ? "alert" : "status"}
            aria-live={banner.warning === "exceeded" ? "assertive" : "polite"}
            className={cn(
              "flex flex-col gap-1 border-b px-4 py-2 text-sm lg:px-8",
              banner.warning === "exceeded"
                ? "border-[var(--color-bad)] bg-[oklch(94%_.04_25)]"
                : "border-[var(--color-warn)] bg-[oklch(96%_.04_70)]",
            )}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              {banner.warning === "exceeded"
                ? tShell("usageBannerExceededTitle")
                : tShell("usageBannerWarnTitle")}
            </p>
            <p className="flex flex-wrap items-center gap-3 text-[var(--ink)]">
              <span>
                {banner.warning === "exceeded"
                  ? tShell("usageBannerExceededBody", {
                      used: banner.used.toLocaleString(),
                      cap: banner.cap.toLocaleString(),
                    })
                  : tShell("usageBannerWarnBody", {
                      used: banner.used.toLocaleString(),
                      cap: banner.cap.toLocaleString(),
                      percent: banner.percent,
                    })}
              </span>
              <Link
                href="/app/admin/usage"
                data-testid="app-shell-usage-banner-cta"
                className="inline-flex h-9 items-center border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--ink)] hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
              >
                {tShell("usageBannerOpenAction")}
              </Link>
            </p>
          </div>
        ) : null}

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

function NavLink({
  item,
  label,
  pendingChipFuture,
  pendingChipP6,
  pendingTitle,
}: {
  item: NavItemDef;
  label: string;
  pendingChipFuture: string;
  pendingChipP6: string;
  pendingTitle: string;
}) {
  const { href, badge, accent, disabled, phase6Pending } = item;
  const className = cn(
    "flex items-center gap-3 px-3 py-2 text-sm",
    "border-l-[3px] border-transparent",
    disabled
      ? "cursor-not-allowed text-[var(--sidebar-muted)]"
      : "text-[var(--sidebar-foreground)] hover:border-[var(--color-brand)] hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]",
  );
  const trailing = disabled ? (
    <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--sidebar-muted)]">
      {pendingChipFuture}
    </span>
  ) : phase6Pending ? (
    <span
      data-testid="phase6-pending-chip"
      className="border border-[var(--color-warn)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--sidebar-foreground)]"
    >
      {pendingChipP6}
    </span>
  ) : null;
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
      {trailing}
    </>
  );
  if (disabled) {
    return (
      <span aria-disabled className={className} title={pendingTitle}>
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
