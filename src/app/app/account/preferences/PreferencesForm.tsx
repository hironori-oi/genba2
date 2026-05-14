"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { isErr } from "@/lib/admin/shared/result";
import type { PreferencesInput } from "@/lib/admin/shared/validation";
import { savePreferencesAction } from "./actions";

const LANGUAGES: Array<{ value: PreferencesInput["language"]; labelKey: string }> = [
  { value: "ja", labelKey: "languageOptions.ja" },
  { value: "en", labelKey: "languageOptions.en" },
];

const THEMES: Array<{
  value: PreferencesInput["theme"];
  labelKey: string;
  hintKey: string;
}> = [
  { value: "auto", labelKey: "themeOptions.auto", hintKey: "themeOptions.autoHint" },
  { value: "light", labelKey: "themeOptions.light", hintKey: "themeOptions.lightHint" },
  { value: "dark", labelKey: "themeOptions.dark", hintKey: "themeOptions.darkHint" },
];

const NOTIFICATIONS: Array<{
  value: PreferencesInput["notification"];
  labelKey: string;
  hintKey: string;
}> = [
  {
    value: "all",
    labelKey: "notificationOptions.all",
    hintKey: "notificationOptions.allHint",
  },
  {
    value: "important",
    labelKey: "notificationOptions.important",
    hintKey: "notificationOptions.importantHint",
  },
  {
    value: "none",
    labelKey: "notificationOptions.none",
    hintKey: "notificationOptions.noneHint",
  },
];

export function PreferencesForm({ initial }: { initial: PreferencesInput }) {
  const router = useRouter();
  const t = useTranslations("preferences");
  const tCommon = useTranslations("common");
  const [prefs, setPrefs] = useState<PreferencesInput>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, startTransition] = useTransition();

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setNotice(null);
    startTransition(async () => {
      const result = await savePreferencesAction(prefs);
      if (isErr(result)) {
        setError(result.message);
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        return;
      }
      setNotice(t("saveSuccessBody"));
      // Re-fetch the server-rendered shell so language/theme tokens reflect
      // the new preference immediately (next-intl reads locale + globals.css
      // reads data-theme during render — both are server-driven).
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-6 border border-[var(--border)] bg-[var(--surface)] p-4"
      data-testid="preferences-form"
    >
      <fieldset className="flex flex-col gap-2" data-testid="preferences-language">
        <legend className="text-sm font-medium text-[var(--ink)]">
          {t("languageLegend")}
        </legend>
        <div className="flex flex-wrap gap-2">
          {LANGUAGES.map((opt) => {
            const selected = prefs.language === opt.value;
            return (
              <label
                key={opt.value}
                className={
                  "inline-flex h-12 cursor-pointer items-center gap-2 border px-3 text-sm focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-brand)] " +
                  (selected
                    ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-brand-foreground)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--color-brand)]")
                }
              >
                <input
                  type="radio"
                  name="language"
                  value={opt.value}
                  checked={selected}
                  onChange={() => setPrefs({ ...prefs, language: opt.value })}
                  className="sr-only"
                  data-testid={`preferences-language-${opt.value}`}
                />
                {t(opt.labelKey)}
              </label>
            );
          })}
        </div>
        {fieldErrors["language"] ? (
          <p role="alert" className="text-xs font-medium text-[var(--color-bad)]">
            {fieldErrors["language"]}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-2" data-testid="preferences-theme">
        <legend className="text-sm font-medium text-[var(--ink)]">
          {t("themeLegend")}
        </legend>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {THEMES.map((opt) => {
            const selected = prefs.theme === opt.value;
            return (
              <label
                key={opt.value}
                className={
                  "flex min-h-14 cursor-pointer items-start gap-3 border p-3 text-sm focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-brand)] " +
                  (selected
                    ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-brand-foreground)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--color-brand)]")
                }
              >
                <input
                  type="radio"
                  name="theme"
                  value={opt.value}
                  checked={selected}
                  onChange={() => setPrefs({ ...prefs, theme: opt.value })}
                  className="mt-1 h-5 w-5"
                  data-testid={`preferences-theme-${opt.value}`}
                />
                <span className="flex flex-col">
                  <span className="font-medium">{t(opt.labelKey)}</span>
                  <span
                    className={
                      "text-xs " +
                      (selected
                        ? "text-[var(--color-brand-foreground)]"
                        : "text-[var(--muted)]")
                    }
                  >
                    {t(opt.hintKey)}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {fieldErrors["theme"] ? (
          <p role="alert" className="text-xs font-medium text-[var(--color-bad)]">
            {fieldErrors["theme"]}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="flex flex-col gap-2" data-testid="preferences-notification">
        <legend className="text-sm font-medium text-[var(--ink)]">
          {t("notificationLegend")}
        </legend>
        <div className="flex flex-col gap-2">
          {NOTIFICATIONS.map((opt) => {
            const selected = prefs.notification === opt.value;
            return (
              <label
                key={opt.value}
                className={
                  "flex min-h-14 cursor-pointer items-start gap-3 border p-3 text-sm focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-brand)] " +
                  (selected
                    ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-brand-foreground)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--color-brand)]")
                }
              >
                <input
                  type="radio"
                  name="notification"
                  value={opt.value}
                  checked={selected}
                  onChange={() => setPrefs({ ...prefs, notification: opt.value })}
                  className="mt-1 h-5 w-5"
                  data-testid={`preferences-notification-${opt.value}`}
                />
                <span className="flex flex-col">
                  <span className="font-medium">{t(opt.labelKey)}</span>
                  <span
                    className={
                      "text-xs " +
                      (selected
                        ? "text-[var(--color-brand-foreground)]"
                        : "text-[var(--muted)]")
                    }
                  >
                    {t(opt.hintKey)}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {fieldErrors["notification"] ? (
          <p role="alert" className="text-xs font-medium text-[var(--color-bad)]">
            {fieldErrors["notification"]}
          </p>
        ) : null}
      </fieldset>

      {error ? (
        <Alert tone="error" title={t("saveError")}>
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="info" title={t("saveSuccess")}>
          {notice}
        </Alert>
      ) : null}

      <footer className="flex flex-wrap justify-end gap-2">
        <Button
          type="submit"
          variant="primary"
          size="lg"
          data-testid="preferences-save"
          disabled={submitting}
        >
          {submitting ? tCommon("saving") : tCommon("save")}
        </Button>
      </footer>
    </form>
  );
}
