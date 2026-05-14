import "server-only";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/env";
import {
  DEFAULT_LOCALE,
  DEFAULT_THEME,
  LOCALE_COOKIE,
  THEME_COOKIE,
  isLocale,
  isTheme,
  type Locale,
  type Theme,
} from "./config";

export type AppPreferences = { locale: Locale; theme: Theme };

/**
 * Resolve the active locale + theme for server-rendered output.
 *
 * Priority: Supabase user_metadata.preferences (when signed in) → cookie
 * (mirrored by the preferences action) → defaults. Returning a cookie-only
 * fallback keeps unauthenticated screens (e.g. /login) consistent after a
 * preference change.
 */
export async function resolvePreferences(): Promise<AppPreferences> {
  let locale: Locale = DEFAULT_LOCALE;
  let theme: Theme = DEFAULT_THEME;

  if (supabaseConfigured()) {
    try {
      const supabase = await createClient();
      const { data } = await supabase.auth.getUser();
      const meta = (data?.user?.user_metadata ?? null) as
        | Record<string, unknown>
        | null;
      const prefs = meta?.preferences as Record<string, unknown> | undefined;
      if (prefs) {
        if (isLocale(prefs.language)) locale = prefs.language;
        if (isTheme(prefs.theme)) theme = prefs.theme;
      }
    } catch {
      // Best-effort — fall back to cookies / defaults below.
    }
  }

  const store = await cookies();
  const cookieLocale = store.get(LOCALE_COOKIE)?.value;
  const cookieTheme = store.get(THEME_COOKIE)?.value;
  if (locale === DEFAULT_LOCALE && isLocale(cookieLocale)) locale = cookieLocale;
  if (theme === DEFAULT_THEME && isTheme(cookieTheme)) theme = cookieTheme;

  return { locale, theme };
}
