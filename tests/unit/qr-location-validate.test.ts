import { describe, expect, it } from "vitest";
import { validateLocationScan, type QrFormatDefinition } from "@/lib/qr";

const TENANT = "11111111-1111-1111-1111-111111111111";

function locationFormat(
  overrides: Partial<QrFormatDefinition> = {},
): QrFormatDefinition {
  return {
    id: "f-loc-test",
    tenantId: TENANT,
    qrType: "location",
    version: 1,
    formatCode: "LOC",
    formatName: "ロケ V1",
    delimiter: "pipe",
    delimiterChar: null,
    encoding: "utf8",
    readable: true,
    issuable: false,
    validFrom: "2026-01-01",
    items: [
      {
        position: 1,
        qrItemName: "ロケーション",
        targetColumn: "location_code",
        required: true,
        dataType: "text",
        missingValueAction: "error",
      },
    ],
    pattern: "^[A-Z]-\\d{2}-\\d{2}$",
    ...overrides,
  };
}

describe("validateLocationScan — inventory location step QR validation", () => {
  it("L01: free-text fallback — no location formats supplied passes any non-empty input", () => {
    const result = validateLocationScan("anything-goes", []);
    expect(result).toEqual({ ok: true, code: "anything-goes" });
  });

  it("L02: format with empty pattern keeps free-text fallback (validation off)", () => {
    const fmt = locationFormat({ pattern: null });
    const result = validateLocationScan("ZZZ-99-99-9", [fmt]);
    expect(result).toEqual({ ok: true, code: "ZZZ-99-99-9" });
  });

  it("L03: matching pattern passes and trims whitespace", () => {
    const result = validateLocationScan("  A-03-15  ", [locationFormat()]);
    expect(result).toEqual({ ok: true, code: "A-03-15" });
  });

  it("L04: mismatching pattern fails with reason pattern_mismatch and exposes the trimmed code for telemetry", () => {
    const result = validateLocationScan("not-a-loc-code", [locationFormat()]);
    expect(result).toEqual({
      ok: false,
      code: "not-a-loc-code",
      reason: "pattern_mismatch",
    });
  });

  it("L05: empty input fails with reason empty (no inline error shown — flow simply does not advance)", () => {
    const result = validateLocationScan("   ", [locationFormat()]);
    expect(result).toEqual({ ok: false, code: "", reason: "empty" });
  });

  it("L06: unreadable format is ignored so a tenant can disable enforcement without DB delete", () => {
    const fmt = locationFormat({ readable: false });
    const result = validateLocationScan("not-matching", [fmt]);
    expect(result).toEqual({ ok: true, code: "not-matching" });
  });

  it("L07: multiple formats — any matching pattern accepts", () => {
    const strict = locationFormat({ id: "f-strict", pattern: "^A-\\d{2}-\\d{2}$" });
    const loose = locationFormat({ id: "f-loose", pattern: "^Z-FREEFORM$" });
    expect(validateLocationScan("A-03-15", [strict, loose])).toEqual({
      ok: true,
      code: "A-03-15",
    });
    expect(validateLocationScan("Z-FREEFORM", [strict, loose])).toEqual({
      ok: true,
      code: "Z-FREEFORM",
    });
    expect(validateLocationScan("nope", [strict, loose])).toEqual({
      ok: false,
      code: "nope",
      reason: "pattern_mismatch",
    });
  });

  it("L08: an unparseable regex source is skipped and falls back to free-text (misconfiguration must not block workers)", () => {
    const broken = locationFormat({ pattern: "[unterminated" });
    const result = validateLocationScan("anything", [broken]);
    expect(result).toEqual({ ok: true, code: "anything" });
  });
});
