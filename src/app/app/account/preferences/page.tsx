import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAppSession } from "@/lib/auth/session";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/env";
import { PreferencesForm } from "./PreferencesForm";
import type {
  PreferencesInput,
} from "@/lib/admin/shared/validation";

export const metadata: Metadata = { title: "個人設定" };

const DEFAULT_PREFS: PreferencesInput = {
  language: "ja",
  theme: "auto",
  notification: "important",
};

function readPreferences(raw: unknown): PreferencesInput {
  if (!raw || typeof raw !== "object") return DEFAULT_PREFS;
  const r = raw as Record<string, unknown>;
  const language =
    r.language === "ja" || r.language === "en" ? r.language : DEFAULT_PREFS.language;
  const theme =
    r.theme === "light" || r.theme === "dark" || r.theme === "auto"
      ? r.theme
      : DEFAULT_PREFS.theme;
  const notification =
    r.notification === "all" ||
    r.notification === "important" ||
    r.notification === "none"
      ? r.notification
      : DEFAULT_PREFS.notification;
  return { language, theme, notification };
}

export default async function PreferencesPage() {
  const session = await getAppSession();
  if (session.kind === "unauthenticated") {
    redirect("/login?next=/app/account/preferences");
  }

  const configured = supabaseConfigured();
  let initial: PreferencesInput = DEFAULT_PREFS;

  if (configured) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data?.user) {
      const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
      initial = readPreferences(meta.preferences);
    }
  }

  const tAccount = await getTranslations("account");
  const tCommon = await getTranslations("common");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          {tAccount("eyebrow")}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl">
          {tAccount("heading")}
        </h1>
        <p className="text-sm text-[var(--muted)]">{tAccount("intro")}</p>
      </header>

      <nav aria-label={tAccount("breadcrumbAria")} className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/app/account"
          data-testid="account-back-to-index"
          className="inline-flex h-12 items-center border border-[var(--border)] bg-[var(--surface)] px-3 text-[var(--ink)] hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          {tAccount("backToIndex")}
        </Link>
      </nav>

      {!configured ? (
        <Alert tone="info" title={tCommon("previewMode")}>
          {tAccount("previewBanner")}
        </Alert>
      ) : null}

      <PreferencesForm initial={initial} />
    </div>
  );
}
