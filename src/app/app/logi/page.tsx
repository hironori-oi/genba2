import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "物流業務" };

type Business = {
  href: string;
  code: string;
  badge: string;
  accent: string;
  disabled?: boolean;
  disabledNote?: string;
};

const BUSINESSES: Business[] = [
  {
    href: "/app/logi/receiving",
    code: "receiving",
    badge: "入",
    accent: "var(--color-func-receive)",
  },
  {
    href: "/app/logi/picking",
    code: "picking",
    badge: "ピ",
    accent: "var(--color-func-pick)",
  },
  {
    href: "/app/logi/inventory",
    code: "inventory",
    badge: "棚",
    accent: "var(--color-func-inventory)",
  },
  {
    href: "/app/works/manufacturing",
    code: "manufacturing",
    badge: "製",
    accent: "var(--color-func-manufact)",
  },
];

export default async function LogiIndexPage() {
  const result = await getAppSession();
  if (result.kind === "unauthenticated") {
    redirect("/login?next=/app/logi");
  }

  const tLogi = await getTranslations("logi");
  const tNav = await getTranslations("nav");

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="logi-heading">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          {tLogi("eyebrow")}
        </p>
        <h1
          id="logi-heading"
          className="mt-1 text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl"
        >
          {tLogi("heading")}
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">{tLogi("intro")}</p>
      </section>

      <section aria-labelledby="logi-businesses">
        <h2 id="logi-businesses" className="sr-only">
          {tLogi("businessesSr")}
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {BUSINESSES.map((b) => {
            const label = tNav(b.code);
            const description = tLogi(`businesses.${b.code}Description`);
            return (
              <li key={b.code}>
                {b.disabled ? (
                  <article
                    data-testid={`logi-card-${b.code}`}
                    className="relative flex h-full flex-col gap-3 border border-dashed border-[var(--border)] bg-[var(--surface-2)] p-4"
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
                    <p className="pl-2 text-sm text-[var(--muted)]">
                      {description}
                    </p>
                    {b.disabledNote ? (
                      <span className="pl-2 font-mono text-xs uppercase tracking-wide text-[var(--muted)]">
                        {b.disabledNote}
                      </span>
                    ) : null}
                  </article>
                ) : (
                  <article
                    data-testid={`logi-card-${b.code}`}
                    className="relative flex h-full flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4"
                  >
                    <span
                      aria-hidden
                      className="absolute left-0 top-0 h-full w-1"
                      style={{ background: b.accent }}
                    />
                    <Link
                      href={b.href}
                      data-testid={`logi-card-${b.code}-primary`}
                      className="flex flex-col gap-2 pl-2 transition-colors hover:text-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                    >
                      <header className="flex items-center gap-3">
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
                      <p className="text-sm text-[var(--muted)]">{description}</p>
                      <span
                        className="mt-1 inline-flex h-12 items-center justify-center self-start border border-[var(--color-brand)] bg-[var(--color-brand)] px-4 text-sm font-semibold text-[var(--color-brand-foreground)]"
                        aria-hidden
                      >
                        {tLogi("primaryStart")}
                      </span>
                    </Link>
                    <Link
                      href={`${b.href}?mode=scan`}
                      data-testid={`logi-card-${b.code}-scan`}
                      className="ml-2 inline-flex h-12 min-h-12 items-center justify-center self-start border border-[var(--border)] bg-[var(--surface-2)] px-4 text-sm font-medium text-[var(--ink)] hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                      aria-label={tLogi("scanStartAria", { label })}
                    >
                      {tLogi("scanStart")}
                    </Link>
                  </article>
                )}
              </li>
            );
          })}
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
          {tLogi("relatedHeading")}
        </h2>
        <ul className="mt-2 flex flex-wrap gap-2">
          <li>
            <Link
              href="/app/logi/history"
              data-testid="logi-link-history"
              className="inline-flex h-12 items-center border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--ink)] hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
            >
              {tLogi("linkHistory")}
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
