/**
 * Client-side helpers for the CSV import UI bridge (Phase 3b).
 *
 * These helpers run in the browser bundle — they MUST NOT import the
 * Supabase service-role client, `server-only`, or any Node-only module
 * (Buffer, iconv-lite, etc.). They exist so the upload form can pre-flight
 * obviously-invalid files before posting to the Edge Function, and so
 * server error payloads coming back from the EF normalise cleanly into
 * the form-state shape consumed by react-hook-form / Zustand.
 *
 * The actual upload + parse / insert is performed server-side by the
 * Edge Functions in supabase/functions/{movement,inventory}-csv-import.
 */

/** Same 10 MB ceiling enforced server-side by the Edge Function. */
export const CSV_MAX_FILE_SIZE = 10 * 1024 * 1024;

export type CsvFileValidationOk = { ok: true };
export type CsvFileValidationError = {
  ok: false;
  reason: "content_type" | "size" | "empty";
  message: string;
};
export type CsvFileValidationResult = CsvFileValidationOk | CsvFileValidationError;

/**
 * Lightweight client-side pre-flight check before uploading a CSV.
 *
 * - `content_type`: the browser's detected MIME must include "csv" or
 *   "excel" / "sheet" (a few legacy browsers report .csv files as
 *   `application/vnd.ms-excel`). The server re-checks Content-Type from
 *   the upload itself — this is purely a UX guard.
 * - `size`: refuse anything above 10 MB up-front so users aren't waiting
 *   for the server-side 413.
 * - `empty`: refuse zero-byte uploads (mostly a paste-mistake guard).
 */
export function validateCsvFile(file: File): CsvFileValidationResult {
  if (file.size === 0) {
    return {
      ok: false,
      reason: "empty",
      message: "ファイルが空です",
    };
  }
  if (file.size > CSV_MAX_FILE_SIZE) {
    return {
      ok: false,
      reason: "size",
      message: "ファイルサイズが 10MB を超えています",
    };
  }

  const ct = (file.type || "").toLowerCase();
  // Some browsers omit the MIME type for .csv on drag-and-drop. We
  // accept an empty string as long as the filename ends in .csv so the
  // common UX path stays smooth — the server still enforces a strict
  // Content-Type header on the upload itself.
  const looksLikeCsvName = file.name.toLowerCase().endsWith(".csv");
  const acceptable =
    ct.includes("csv") ||
    ct.includes("excel") ||
    ct.includes("sheet") ||
    (ct === "" && looksLikeCsvName);

  if (!acceptable) {
    return {
      ok: false,
      reason: "content_type",
      message: "CSV または Excel 形式のファイルを選択してください",
    };
  }

  return { ok: true };
}

/**
 * Normalise an arbitrary error payload returned from the Edge Function
 * (or thrown by the fetch wrapper) into the `{ code, message }` shape
 * used by the form's error rendering. Falls back to a generic code so
 * the UI never has to special-case `undefined`.
 */
export function normalizeImportError(raw: unknown): {
  code: string;
  message: string;
} {
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (obj.error && typeof obj.error === "object") {
      const e = obj.error as Record<string, unknown>;
      return {
        code: typeof e.code === "string" ? e.code : "import_failed",
        message:
          typeof e.message === "string"
            ? e.message
            : "CSV 取込に失敗しました",
      };
    }
    if (typeof obj.message === "string") {
      return {
        code: typeof obj.code === "string" ? obj.code : "import_failed",
        message: obj.message,
      };
    }
  }
  if (typeof raw === "string") {
    return { code: "import_failed", message: raw };
  }
  return { code: "import_failed", message: "CSV 取込に失敗しました" };
}
