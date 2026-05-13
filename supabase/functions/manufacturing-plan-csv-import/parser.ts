/**
 * Pure parser + sanitiser helpers for the manufacturing-plan-csv-import
 * Edge Function. Split out of index.ts so they can be unit-tested under
 * Node (vitest) without pulling in the Deno-only `serve` / esm.sh imports
 * at module load time.
 *
 * Mirrors the security envelope documented in index.ts:
 *
 *   * Formula injection: cells starting with =, +, -, @, \t, or \r get
 *     `'` prepended so a malicious supplier cannot land a literal
 *     =HYPERLINK(...) in manufacturing_plans.order_no.
 *   * Cell shape: same comma-separated, `"..."` quoted, `""` escape
 *     dialect as the export path in src/lib/csv/sanitize.ts.
 *   * Per-row validation mirrors src/lib/works/validators.ts (the EF
 *     cannot import that module — it lives in the Next 15 app build
 *     graph). Any change to the zod schema MUST be paired with a change
 *     here.
 */

// deno-lint-ignore-file no-explicit-any
export const FORMULA_PREFIXES: ReadonlySet<string> = new Set([
  "=",
  "+",
  "-",
  "@",
  "\t",
  "\r",
]);

/**
 * Prepend `'` to a cell value if its first character is a formula
 * trigger. Returns the input unchanged otherwise (including empty
 * strings). This is the import-side mirror of sanitizeCsvCell in
 * src/lib/csv/sanitize.ts.
 */
export function sanitizeCellForImport(value: string): string {
  if (value.length === 0) return value;
  if (FORMULA_PREFIXES.has(value[0]!)) return `'${value}`;
  return value;
}

/**
 * Split a single CSV line into cells. Supports the `"..."` / `""` dialect
 * but does NOT support multi-line quoted fields (each input line is one
 * row). Newlines must be pre-split by the caller.
 */
export function splitCsvRow(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  let cur = "";
  let inQuotes = false;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      cells.push(cur);
      cur = "";
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  cells.push(cur);
  return cells;
}

export type ValidationResult =
  | { ok: true; row: Record<string, any> }
  | { ok: false; code: string; message: string };

const PLAN_STATUSES = ["draft", "active", "closed"] as const;
const PROCESS_STATUSES = [
  "pending",
  "in_progress",
  "done",
  "canceled",
] as const;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;

/**
 * Validate a manufacturing_plans CSV row.
 *
 * Columns (after sanitisation + trim):
 *   order_no, item_code, planned_quantity, lot, start_date, end_date,
 *   status, notes
 */
export function validateManufacturingPlanRow(
  cells: string[],
): ValidationResult {
  if (cells.length < 3) {
    return {
      ok: false,
      code: "column_count",
      message: "order_no/item_code/planned_quantity required",
    };
  }
  const sanitized = cells.map((c) => sanitizeCellForImport(c.trim()));
  const [
    order_no,
    item_code,
    planned_quantity_s,
    lot,
    start_date,
    end_date,
    status,
    notes,
  ] = sanitized;
  if (!order_no) {
    return { ok: false, code: "order_no", message: "order_no required" };
  }
  if (order_no.length > 64) {
    return { ok: false, code: "order_no", message: "order_no too long" };
  }
  if (/[\r\n]/.test(order_no)) {
    return {
      ok: false,
      code: "order_no",
      message: "control chars not allowed",
    };
  }
  if (!item_code) {
    return { ok: false, code: "item_code", message: "item_code required" };
  }
  if (item_code.length > 64) {
    return { ok: false, code: "item_code", message: "item_code too long" };
  }
  if (/[\r\n]/.test(item_code)) {
    return {
      ok: false,
      code: "item_code",
      message: "control chars not allowed",
    };
  }
  const planned_quantity = Number(planned_quantity_s);
  if (!Number.isFinite(planned_quantity) || planned_quantity < 0) {
    return {
      ok: false,
      code: "planned_quantity",
      message: "planned_quantity must be nonneg number",
    };
  }
  if (status && !PLAN_STATUSES.includes(status as (typeof PLAN_STATUSES)[number])) {
    return { ok: false, code: "status", message: "status invalid" };
  }
  return {
    ok: true,
    row: {
      order_no,
      item_code,
      planned_quantity,
      lot: lot || null,
      start_date: start_date || null,
      end_date: end_date || null,
      status: status || "active",
      notes: notes || null,
    },
  };
}

/**
 * Validate an mfg_processes CSV row.
 *
 * Columns (after sanitisation + trim):
 *   manufacturing_plan_id, process_order, process_id?, equipment_id?,
 *   assigned_worker_id?, status, notes
 */
export function validateMfgProcessRow(cells: string[]): ValidationResult {
  if (cells.length < 2) {
    return {
      ok: false,
      code: "column_count",
      message: "manufacturing_plan_id/process_order required",
    };
  }
  const sanitized = cells.map((c) => sanitizeCellForImport(c.trim()));
  const [
    manufacturing_plan_id,
    process_order_s,
    process_id,
    equipment_id,
    assigned_worker_id,
    status,
    notes,
  ] = sanitized;
  if (!UUID_RE.test(manufacturing_plan_id)) {
    return {
      ok: false,
      code: "manufacturing_plan_id",
      message: "manufacturing_plan_id must be uuid",
    };
  }
  const process_order = Number(process_order_s);
  if (!Number.isInteger(process_order) || process_order < 1) {
    return {
      ok: false,
      code: "process_order",
      message: "process_order must be positive integer",
    };
  }
  const optUuid = (
    v: string | undefined,
    label: string,
  ):
    | { ok: true; value: string | null }
    | { ok: false; code: string; message: string } => {
    if (!v) return { ok: true, value: null };
    if (!UUID_RE.test(v)) {
      return {
        ok: false,
        code: label,
        message: `${label} must be uuid`,
      };
    }
    return { ok: true, value: v };
  };
  const pr = optUuid(process_id, "process_id");
  if (!pr.ok) return pr;
  const eq = optUuid(equipment_id, "equipment_id");
  if (!eq.ok) return eq;
  const aw = optUuid(assigned_worker_id, "assigned_worker_id");
  if (!aw.ok) return aw;
  if (
    status &&
    !PROCESS_STATUSES.includes(status as (typeof PROCESS_STATUSES)[number])
  ) {
    return { ok: false, code: "status", message: "status invalid" };
  }
  return {
    ok: true,
    row: {
      manufacturing_plan_id,
      process_order,
      process_id: pr.value,
      equipment_id: eq.value,
      assigned_worker_id: aw.value,
      status: status || "pending",
      notes: notes || null,
    },
  };
}
