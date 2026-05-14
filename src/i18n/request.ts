import { getRequestConfig } from "next-intl/server";
import { resolvePreferences } from "./preferences";
import { DEFAULT_LOCALE } from "./config";

/**
 * next-intl request config (ADR-P6-06 §B.4.2).
 *
 * URL-prefix routing is intentionally NOT used; the locale comes from the
 * authenticated preference (user_metadata.preferences.language) with a cookie
 * fallback for unauth screens. See src/i18n/preferences.ts.
 */
export default getRequestConfig(async () => {
  const { locale } = await resolvePreferences();
  const resolved = locale ?? DEFAULT_LOCALE;
  const messages = (await import(`../../messages/${resolved}.json`)).default;
  return { locale: resolved, messages };
});
