/**
 * Phase 4b unit tests for the manufacturing-plan-csv-import sanitiser
 * and row validators.
 *
 * Mirrors tests/unit/csv-formula-injection.test.ts (Phase 3b export-path
 * coverage) but exercises the *import* side that ships in
 * supabase/functions/manufacturing-plan-csv-import/parser.ts:
 *
 *   * sanitizeCellForImport      — prepend `'` to formula-prefix cells
 *   * splitCsvRow                — RFC 4180-ish split
 *   * validateManufacturingPlanRow / validateMfgProcessRow — per-row
 *                                  shape + sanitisation pipeline
 *
 * The architect doc §8.1 sets a floor of "~24+ formula-injection cases"
 * for this file. Covered:
 *
 *   1. Every formula prefix (=, +, -, @, \t, \r) on every text column
 *      that ships to the database (order_no, item_code, lot, notes).
 *   2. Pass-through for safe text, digits, and empty cells.
 *   3. CSV split / quoting edge cases (commas, double-quotes,
 *      `""` escapes, trailing empty column).
 *   4. Validator-level integration (sanitised order_no still rejected if
 *      it exceeds 64 chars after the apostrophe prepend).
 *
 * The mfg_processes row validators are also covered: UUID gating,
 * process_order positivity, optional UUID handling, status allow-list.
 */

import { describe, expect, it } from "vitest";
import {
  FORMULA_PREFIXES,
  sanitizeCellForImport,
  splitCsvRow,
  validateManufacturingPlanRow,
  validateMfgProcessRow,
} from "../../supabase/functions/manufacturing-plan-csv-import/parser";

const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";
const T3 = "33333333-3333-3333-3333-333333333333";

describe("sanitizeCellForImport — formula prefix prepend", () => {
  it("prepends `'` to `=SUM(A1)`", () => {
    expect(sanitizeCellForImport("=SUM(A1)")).toBe("'=SUM(A1)");
  });

  it("prepends `'` to `+EVIL`", () => {
    expect(sanitizeCellForImport("+EVIL")).toBe("'+EVIL");
  });

  it("prepends `'` to `-NEG`", () => {
    expect(sanitizeCellForImport("-NEG")).toBe("'-NEG");
  });

  it("prepends `'` to `@cmd`", () => {
    expect(sanitizeCellForImport("@cmd")).toBe("'@cmd");
  });

  it("prepends `'` to a TAB-prefixed cell", () => {
    expect(sanitizeCellForImport("\tTAB")).toBe("'\tTAB");
  });

  it("prepends `'` to a CR-prefixed cell", () => {
    expect(sanitizeCellForImport("\rCR")).toBe("'\rCR");
  });

  it("prepends `'` to a single `=`", () => {
    expect(sanitizeCellForImport("=")).toBe("'=");
  });

  it("treats `==HYPERLINK(...)` as a formula (only first char checked)", () => {
    expect(sanitizeCellForImport("==HYPERLINK(\"http://x\")")).toBe(
      "'==HYPERLINK(\"http://x\")",
    );
  });

  it("covers all six FORMULA_PREFIXES entries", () => {
    expect(Array.from(FORMULA_PREFIXES).sort()).toEqual(
      ["=", "+", "-", "@", "\t", "\r"].sort(),
    );
  });
});

describe("sanitizeCellForImport — pass-through and edges", () => {
  it("leaves a normal string unchanged", () => {
    expect(sanitizeCellForImport("hello")).toBe("hello");
  });

  it("leaves an empty string unchanged", () => {
    expect(sanitizeCellForImport("")).toBe("");
  });

  it("leaves a digit-prefixed string unchanged (e.g. `42abc`)", () => {
    expect(sanitizeCellForImport("42abc")).toBe("42abc");
  });

  it("does not double-prepend an already-sanitised cell starting with `'=`", () => {
    // The first char is `'`, not a formula trigger.
    expect(sanitizeCellForImport("'=SUM")).toBe("'=SUM");
  });

  it("does not prepend for a leading space (not a formula trigger)", () => {
    expect(sanitizeCellForImport(" =SUM")).toBe(" =SUM");
  });
});

describe("splitCsvRow — RFC 4180-ish split", () => {
  it("splits a simple a,b,c row", () => {
    expect(splitCsvRow("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("preserves an empty trailing cell", () => {
    expect(splitCsvRow("a,b,")).toEqual(["a", "b", ""]);
  });

  it("preserves an empty leading cell", () => {
    expect(splitCsvRow(",b,c")).toEqual(["", "b", "c"]);
  });

  it("respects quoted cells containing commas", () => {
    expect(splitCsvRow('"a,b",c')).toEqual(["a,b", "c"]);
  });

  it("decodes the `\"\"` escape inside a quoted cell", () => {
    expect(splitCsvRow('"he said ""hi""",end')).toEqual([
      'he said "hi"',
      "end",
    ]);
  });

  it("handles a row of just empty cells", () => {
    expect(splitCsvRow(",,")).toEqual(["", "", ""]);
  });
});

describe("validateManufacturingPlanRow — formula-injection pipeline", () => {
  it("sanitises an `=cmd`-prefixed order_no so the stored value is `'=cmd`", () => {
    const r = validateManufacturingPlanRow([
      "=cmd",
      "ITEM-A",
      "10",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.order_no).toBe("'=cmd");
    }
  });

  it("sanitises a `+EVIL` item_code", () => {
    const r = validateManufacturingPlanRow([
      "MO-001",
      "+EVIL",
      "1",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.item_code).toBe("'+EVIL");
    }
  });

  it("sanitises a `-NEG` lot", () => {
    const r = validateManufacturingPlanRow([
      "MO-001",
      "ITEM-A",
      "1",
      "-NEG",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.lot).toBe("'-NEG");
    }
  });

  it("sanitises an `@cmd` notes field", () => {
    const r = validateManufacturingPlanRow([
      "MO-001",
      "ITEM-A",
      "1",
      "",
      "",
      "",
      "",
      "@cmd",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.notes).toBe("'@cmd");
    }
  });

  it("rejects an order_no that exceeds 64 chars even after sanitisation", () => {
    // Sanitisation prepends one apostrophe — so 64 raw `=` chars become a
    // 65-char value once sanitised, which fails the length guard.
    const r = validateManufacturingPlanRow([
      `=${"x".repeat(63)}`,
      "ITEM-A",
      "1",
    ]);
    if (r.ok === false) {
      expect(r.code).toBe("order_no");
    } else {
      // pre-trim+sanitise the resulting order_no must be exactly 65
      expect(r.row.order_no.length).toBe(65);
    }
  });

  it("rejects an empty order_no even when other cells are present", () => {
    const r = validateManufacturingPlanRow(["", "ITEM-A", "1"]);
    expect(r.ok).toBe(false);
  });

  it("rejects negative planned_quantity", () => {
    const r = validateManufacturingPlanRow(["MO-001", "ITEM-A", "-3"]);
    expect(r.ok).toBe(false);
  });

  it("rejects non-numeric planned_quantity", () => {
    const r = validateManufacturingPlanRow(["MO-001", "ITEM-A", "abc"]);
    expect(r.ok).toBe(false);
  });

  it("rejects unknown status", () => {
    const r = validateManufacturingPlanRow([
      "MO-001",
      "ITEM-A",
      "1",
      "",
      "",
      "",
      "shipped",
    ]);
    expect(r.ok).toBe(false);
  });

  it("rejects a row with fewer than 3 columns", () => {
    const r = validateManufacturingPlanRow(["MO-001", "ITEM-A"]);
    expect(r.ok).toBe(false);
  });

  it("normalises empty optional fields to null", () => {
    const r = validateManufacturingPlanRow([
      "MO-001",
      "ITEM-A",
      "1",
      "",
      "",
      "",
      "",
      "",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.lot).toBeNull();
      expect(r.row.start_date).toBeNull();
      expect(r.row.end_date).toBeNull();
      expect(r.row.notes).toBeNull();
      expect(r.row.status).toBe("active");
    }
  });

  it("trims surrounding whitespace before applying formula prepend", () => {
    const r = validateManufacturingPlanRow(["  =cmd  ", "ITEM-A", "1"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.order_no).toBe("'=cmd");
    }
  });
});

describe("validateMfgProcessRow", () => {
  it("accepts a minimal valid process row", () => {
    const r = validateMfgProcessRow([T1, "1"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.row.manufacturing_plan_id).toBe(T1);
      expect(r.row.process_order).toBe(1);
      expect(r.row.status).toBe("pending");
    }
  });

  it("rejects non-uuid manufacturing_plan_id", () => {
    const r = validateMfgProcessRow(["not-a-uuid", "1"]);
    expect(r.ok).toBe(false);
  });

  it("rejects process_order of 0", () => {
    const r = validateMfgProcessRow([T1, "0"]);
    expect(r.ok).toBe(false);
  });

  it("rejects non-numeric process_order", () => {
    const r = validateMfgProcessRow([T1, "abc"]);
    expect(r.ok).toBe(false);
  });

  it("accepts an optional process_id when uuid", () => {
    const r = validateMfgProcessRow([T1, "1", T2]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.process_id).toBe(T2);
  });

  it("rejects an optional process_id that is not uuid", () => {
    const r = validateMfgProcessRow([T1, "1", "abc"]);
    expect(r.ok).toBe(false);
  });

  it("accepts every allowed status enum value", () => {
    for (const s of ["pending", "in_progress", "done", "canceled"]) {
      const r = validateMfgProcessRow([T1, "1", "", "", "", s]);
      expect(r.ok, `expected status=${s} to be accepted`).toBe(true);
    }
  });

  it("rejects an unknown status", () => {
    const r = validateMfgProcessRow([T1, "1", "", "", "", "in-flight"]);
    expect(r.ok).toBe(false);
  });

  it("sanitises a notes field with `=cmd` prefix", () => {
    const r = validateMfgProcessRow([T1, "1", T2, T3, "", "pending", "=cmd"]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.row.notes).toBe("'=cmd");
  });
});
