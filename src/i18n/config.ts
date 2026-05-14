export const SUPPORTED_LOCALES = ["ja", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "ja";

export const SUPPORTED_THEMES = ["light", "dark", "auto"] as const;
export type Theme = (typeof SUPPORTED_THEMES)[number];
export const DEFAULT_THEME: Theme = "auto";

export function isLocale(value: unknown): value is Locale {
  return value === "ja" || value === "en";
}

export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "auto";
}

// Cookie names — set by the preferences server action (see actions.ts).
export const LOCALE_COOKIE = "genba_locale";
export const THEME_COOKIE = "genba_theme";
