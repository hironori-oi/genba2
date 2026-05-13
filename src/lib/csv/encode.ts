/**
 * CSV encoding helpers (Phase 3b).
 *
 * Implements PRODUCT_SPEC §6 AC-CSV-01 (shift_jis / utf8, 文字化けなし)
 * and D-02 (マスタ CSV テンプレ標準提供 — shift_jis / utf8 双方).
 *
 * UTF-8 output is BOM-prefixed so Windows Excel auto-detects the encoding
 * instead of falling back to Shift-JIS and mangling non-ASCII column
 * names. shift_jis output uses the `iconv-lite` runtime encoder; the
 * encoder maps any un-encodable codepoint to the byte sequence for "?"
 * by default which is the standard fallback for the platform.
 *
 * Server-side only — Node's Buffer + iconv-lite are not in the client
 * runtime. CSV export goes through a server action or Edge Function
 * (the EF path uses the Web-Streams variant under Deno, but the
 * sanitiser layer is shared with this module).
 */

import iconv from "iconv-lite";

export type CsvEncoding = "utf8" | "shift_jis";

const UTF8_BOM = Uint8Array.from([0xef, 0xbb, 0xbf]);

/**
 * Encode an already-serialised CSV string into the wire format for the
 * caller's chosen encoding.
 *
 * - `utf8`     → UTF-8 bytes prefixed with the BOM (Excel detection).
 * - `shift_jis` → cp932 bytes via iconv-lite. Unrepresentable codepoints
 *                 fall back to "?" (iconv-lite default).
 *
 * @see PRODUCT_SPEC.md §6 AC-CSV-01
 * @see PRODUCT_SPEC.md §7 D-02 (template encodings)
 */
export function encodeCsv(text: string, encoding: CsvEncoding): Buffer {
  if (encoding === "shift_jis") {
    // iconv-lite uses 'shift_jis' as an alias for cp932; we pass the
    // canonical label explicitly so a future package upgrade that drops
    // the alias still works.
    return iconv.encode(text, "Shift_JIS");
  }

  // UTF-8: prepend the BOM so Excel and Mac Numbers detect the encoding.
  const body = Buffer.from(text, "utf8");
  const out = Buffer.alloc(UTF8_BOM.length + body.length);
  out.set(UTF8_BOM, 0);
  body.copy(out, UTF8_BOM.length);
  return out;
}
