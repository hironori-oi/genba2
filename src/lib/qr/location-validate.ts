import type { QrFormatDefinition } from "./types";

/**
 * Pure validator for the inventory location step.
 *
 * Real-world location QRs (e.g. `A-03-15`) are flat strings without a
 * `V<n>|...` version prefix, so they cannot be round-tripped through
 * parseQr. Instead each tenant's `qr_format_definitions` row for
 * `qr_type = 'location'` carries an optional `pattern` (regex source).
 * The validator:
 *
 *   1. Trims the raw scan.
 *   2. Returns the trimmed value as-is when no readable location format
 *      with a non-empty pattern is supplied (free-text fallback).
 *   3. Otherwise accepts the value iff at least one candidate pattern
 *      matches; otherwise reports `pattern_mismatch`.
 *
 * Patterns that fail to compile (`new RegExp` throws) are skipped — they
 * never cause a mismatch on their own. This keeps a misconfigured row
 * from blocking all field workers.
 */

export type LocationValidateOk = {
  ok: true;
  code: string;
};

export type LocationValidateErrReason = "empty" | "pattern_mismatch";

export type LocationValidateErr = {
  ok: false;
  code: string;
  reason: LocationValidateErrReason;
};

export type LocationValidateResult = LocationValidateOk | LocationValidateErr;

export function validateLocationScan(
  raw: string,
  locationFormats: ReadonlyArray<QrFormatDefinition> | null | undefined,
): LocationValidateResult {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed.length === 0) {
    return { ok: false, code: "", reason: "empty" };
  }

  const candidates = (locationFormats ?? []).filter(
    (f) =>
      f.qrType === "location" &&
      f.readable &&
      typeof f.pattern === "string" &&
      f.pattern.length > 0,
  );

  if (candidates.length === 0) {
    return { ok: true, code: trimmed };
  }

  let anyValidPattern = false;
  for (const f of candidates) {
    const src = f.pattern as string;
    let re: RegExp;
    try {
      re = new RegExp(src);
    } catch {
      continue;
    }
    anyValidPattern = true;
    if (re.test(trimmed)) {
      return { ok: true, code: trimmed };
    }
  }

  if (!anyValidPattern) {
    return { ok: true, code: trimmed };
  }

  return { ok: false, code: trimmed, reason: "pattern_mismatch" };
}
