import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getAppSession } from "@/lib/auth/session";
import { Alert } from "@/components/ui/Alert";

export const metadata: Metadata = { title: "ダッシュボード" };

const BUSINESSES = [
  {
    code: "receiving",
    badge: "入",
    accent: "var(--color-func-receive)",
    href: "/app/logi/receiving",
    disabled: false,
  },
  {
    code: "picking",
    badge: "ピ",
    accent: "var(--color-func-pick)",
    href: "/app/logi/picking",
    disabled: false,
  },
  {
    code: "inventory",
    badge: "棚",
    accent: "var(--color-func-inventory)",
    href: "/app/logi/inventory",
    disabled: false,
  },
  {
    code: "manufacturing",
    badge: "製",
    accent: "var(--color-func-manufact)",
    href: "/app/work/manufacturing",
    disabled: true,
  },
] as const;

export default async function AppHome({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const result = await getAppSession();
  const sp = (await searchParams) ?? {};
  const notice = typeof sp.notice === "string" ? sp.notice : null;

  const tDash = await getTranslations("dashboard");
  const tNav = await getTranslations("nav");

  const session = result.kind === "ok" ? result.session : null;
  const greetingName =
    session?.displayName ?? session?.email ?? tDash("greetingFallback");

  return (
    <div className="flex flex-col gap-6">
      {notice === "recovery" ? (
        <Alert tone="info" title={tDash("noticePasswordReset")}>
          {tDash("noticePasswordResetBody")}
        </Alert>
      ) : null}
      <section aria-labelledby="welcome">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          {tDash("eyebrow")}
        </p>
        <h1
          id="welcome"
          className="mt-1 text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl"
        >
          {tDash("greeting", { name: greetingName })}
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">{tDash("intro")}</p>
      </section>

      <section aria-labelledby="business-list">
        <h2 id="business-list" className="sr-only">
          {tDash("businessListSr")}
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {BUSINESSES.map((b) => {
            const label = tNav(b.code);
            const note = tDash(`businesses.${b.code}Note`);
            return (
              <li key={b.code}>
                {b.disabled ? (
                  <article className="relative flex h-full flex-col gap-3 border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-4">
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
                        {label}
                      </h3>
                    </header>
                    <p className="pl-2 text-xs text-[var(--ink)]">{note}</p>
                    <span className="pl-2 text-xs font-semibold text-[var(--ink)]">
                      {tDash("comingSoon")}
                    </span>
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
                      <h3 className="text-base font-semibold text-[var(--ink)]">
                        {label}
                      </h3>
                    </header>
                    <p className="pl-2 text-xs text-[var(--muted)]">{note}</p>
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section
        aria-labelledby="status"
        className="border border-[var(--border)] bg-[var(--surface)] p-4 text-sm"
      >
        <h2 id="status" className="text-sm font-semibold text-[var(--ink)]">
          {tDash("sessionHeading")}
        </h2>
        <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">
              {tDash("roleLabel")}
            </dt>
            <dd className="font-mono text-sm text-[var(--ink)]">
              {session?.role ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">
              {tDash("tenantLabel")}
            </dt>
            <dd className="font-mono text-xs text-[var(--ink)] break-all">
              {session?.tenantId ?? tDash("tenantUnassigned")}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
