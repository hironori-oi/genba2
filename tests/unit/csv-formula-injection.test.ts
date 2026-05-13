/**
 * Unit tests for the CSV formula-injection sanitiser.
 *
 * Covers ARCHITECTURE.md §4 "Formula injection 防御" + RFC 4180 quoting.
 * Each prefix char (`=`, `+`, `-`, `@`, `\t`, `\r`) must get an apostrophe
 * prepended; cells with commas or quotes must be RFC 4180 quoted; numbers
 * stringify without quoting.
 */

import { describe, expect, it } from "vitest";
import {
  sanitizeCsvCell,
  serializeCsv,
  serializeCsvRow,
} from "@/lib/csv/sanitize";

describe("sanitizeCsvCell — formula prefix prepend", () => {
  it("prepends `'` to `=SUM(A1)`", () => {
    expect(sanitizeCsvCell("=SUM(A1)")).toBe("'=SUM(A1)");
  });

  it("prepends `'` to `+ATTACK`", () => {
    expect(sanitizeCsvCell("+ATTACK")).toBe("'+ATTACK");
  });

  it("prepends `'` to `-1+2`", () => {
    expect(sanitizeCsvCell("-1+2")).toBe("'-1+2");
  });

  it("prepends `'` to `@cmd`", () => {
    expect(sanitizeCsvCell("@cmd")).toBe("'@cmd");
  });

  it("prepends `'` to a TAB-prefixed cell", () => {
    expect(sanitizeCsvCell("\tTAB")).toBe("'\tTAB");
  });

  it("prepends `'` to a CR-prefixed cell (quoted because it contains \\r)", () => {
    // The prepended apostrophe still leaves a \r inside the cell, which
    // forces RFC 4180 quoting.
    expect(sanitizeCsvCell("\rCR")).toBe('"\'\rCR"');
  });

  it("treats a single `=` as the same trigger", () => {
    expect(sanitizeCsvCell("=")).toBe("'=");
  });
});

describe("sanitizeCsvCell — pass-through and edge cases", () => {
  it("leaves a normal string unchanged", () => {
    expect(sanitizeCsvCell("hello")).toBe("hello");
  });

  it("coerces null to an empty string", () => {
    expect(sanitizeCsvCell(null)).toBe("");
  });

  it("coerces undefined to an empty string", () => {
    expect(sanitizeCsvCell(undefined)).toBe("");
  });

  it("returns empty string for an empty input", () => {
    expect(sanitizeCsvCell("")).toBe("");
  });

  it("stringifies a number without quoting (42 → \"42\")", () => {
    expect(sanitizeCsvCell(42)).toBe("42");
  });

  it("prepends `'` to a negative number (Excel-formula collision on '-')", () => {
    // -3 stringifies to "-3" whose first char is the formula trigger '-'.
    expect(sanitizeCsvCell(-3)).toBe("'-3");
  });

  it("does not prepend `'` for a number that starts with a digit", () => {
    expect(sanitizeCsvCell(0)).toBe("0");
  });
});

describe("sanitizeCsvCell — RFC 4180 quoting", () => {
  it("quotes a cell containing a comma", () => {
    expect(sanitizeCsvCell("a,b")).toBe('"a,b"');
  });

  it("escapes `\"` to `\"\"` and wraps in quotes", () => {
    expect(sanitizeCsvCell('he said "hi"')).toBe('"he said ""hi"""');
  });

  it("quotes a cell containing a newline", () => {
    expect(sanitizeCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("serializeCsvRow", () => {
  it("joins cells with commas", () => {
    expect(serializeCsvRow(["a", "b", "c"])).toBe("a,b,c");
  });

  it("applies the formula prepend per cell", () => {
    expect(serializeCsvRow(["safe", "=danger"])).toBe("safe,'=danger");
  });

  it("quotes individual cells that contain commas without confusing the joiner", () => {
    expect(serializeCsvRow(["a,b", "c"])).toBe('"a,b",c');
  });

  it("handles null/undefined cells as empty fields", () => {
    expect(serializeCsvRow(["x", null, undefined, "y"])).toBe("x,,,y");
  });
});

describe("serializeCsv", () => {
  it("separates rows with \\r\\n (RFC 4180)", () => {
    expect(
      serializeCsv([
        ["a", "b"],
        ["c", "d"],
      ]),
    ).toBe("a,b\r\nc,d");
  });

  it("never appends a trailing \\r\\n", () => {
    const out = serializeCsv([["only"]]);
    expect(out.endsWith("\r\n")).toBe(false);
    expect(out).toBe("only");
  });

  it("preserves prepend + quoting across rows", () => {
    expect(
      serializeCsv([
        ["=hack", "ok"],
        ["a,b", "@evil"],
      ]),
    ).toBe('\'=hack,ok\r\n"a,b",\'@evil');
  });
});
