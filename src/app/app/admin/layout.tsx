import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/Alert";
import { getAppSession } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/env";

type AdminTab = {
  href: string;
  labelKey: string;
  badge: string;
  phase6Pending?: boolean;
};

const TABS: AdminTab[] = [
  { href: "/app/admin/fields", labelKey: "fields", badge: "項" },
  { href: "/app/admin/qr-formats", labelKey: "qr", badge: "Q" },
  { href: "/app/admin/qr", labelKey: "qrTest", badge: "T" },
  { href: "/app/admin/match-rules", labelKey: "matchRules", badge: "照" },
  { href: "/app/admin/csv-formats", labelKey: "csvFormats", badge: "C" },
  { href: "/app/admin/work-settings", labelKey: "workSettings", badge: "業" },
  { href: "/app/admin/masters", labelKey: "masters", badge: "製" },
  { href: "/app/admin/corrections-pending", labelKey: "correctionsPending", badge: "承" },
  { href: "/app/admin/reports", labelKey: "reports", badge: "報" },
  { href: "/app/admin/users", labelKey: "users", badge: "U" },
  { href: "/app/admin/usage", labelKey: "usage", badge: "%" },
  { href: "/app/admin/audit-logs", labelKey: "auditLogs", badge: "監" },
  { href: "/app/admin/notifications", labelKey: "notifications", badge: "通" },
  { href: "/app/admin/tenants", labelKey: "tenants", badge: "テ" },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const result = await getAppSession();
  if (result.kind === "ok" && result.session.role === "worker") {
    redirect("/app?notice=admin-forbidden");
  }

  const demoMode = !supabaseConfigured();
  const tAdmin = await getTranslations("admin");
  const tNav = await getTranslations("nav");
  const tCommon = await getTranslations("common");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          {tAdmin("eyebrow")}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl">
          {tAdmin("heading")}
        </h1>
        <p className="text-sm text-[var(--muted)]">{tAdmin("intro")}</p>
      </header>

      {demoMode ? (
        <Alert tone="info" title={tCommon("previewMode")}>
          {tCommon("previewModeDescription")}
        </Alert>
      ) : null}

      <nav
        aria-label={tAdmin("tabsAria")}
        className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-2"
      >
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
            {tNav(tab.labelKey)}
            {tab.phase6Pending ? (
              <span
                data-testid="phase6-pending-chip"
                className="ml-1 border border-[var(--color-warn)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--color-warn)]"
              >
                {tAdmin("phase6Pending")}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
