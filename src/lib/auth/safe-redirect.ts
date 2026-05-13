/**
 * Reject anything that is not a single-leading-slash, non-protocol-relative
 * path. Blocks `//evil.example.com`, `/\evil`, `https://...`, mailto:, etc.
 * Used by login + callback redirects so a tampered `?next=` cannot send the
 * user off-site.
 */
export function safeInternalPath(value: unknown, fallback = "/app"): string {
  if (typeof value !== "string") return fallback;
  if (value.length === 0 || value.length > 1024) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  if (value.startsWith("/\\")) return fallback;
  if (/[\r\n\t]/.test(value)) return fallback;
  return value;
}
