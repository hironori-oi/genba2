/**
 * Phase 3b — Scanner reducer / state machine tests.
 *
 * Validates the public contract of src/components/scanner/scanner-state.ts.
 * The reducer is pure (no React), so we exercise it directly without RTL.
 */

import { describe, expect, it } from "vitest";
import {
  decideCanSubmit,
  initialScannerState,
  scannerReducer,
} from "@/components/scanner/scanner-state";
import type { MatchOutcome } from "@/lib/qr/match";

const okOutcome: MatchOutcome = {
  matchResult: "ok",
  withWarnings: false,
  detail: [],
};
const okWarnOutcome: MatchOutcome = {
  matchResult: "ok",
  withWarnings: true,
  detail: [],
};
const ngOutcome: MatchOutcome = {
  matchResult: "ng",
  withWarnings: false,
  detail: [],
};

describe("decideCanSubmit", () => {
  it("returns false when no match has been attempted", () => {
    expect(decideCanSubmit(null, "block")).toBe(false);
    expect(decideCanSubmit(null, "warn")).toBe(false);
  });

  it("returns false on NG with ng_flow=block", () => {
    expect(decideCanSubmit(ngOutcome, "block")).toBe(false);
  });

  it("returns true on NG with ng_flow=warn (confirmation path)", () => {
    expect(decideCanSubmit(ngOutcome, "warn")).toBe(true);
  });

  it("returns true on OK regardless of ng_flow", () => {
    expect(decideCanSubmit(okOutcome, "block")).toBe(true);
    expect(decideCanSubmit(okOutcome, "warn")).toBe(true);
  });

  it("returns true on OK-with-warnings regardless of ng_flow", () => {
    expect(decideCanSubmit(okWarnOutcome, "block")).toBe(true);
    expect(decideCanSubmit(okWarnOutcome, "warn")).toBe(true);
  });
});

describe("scannerReducer", () => {
  it("advances header → line → label → review", () => {
    let s = initialScannerState("block");
    expect(s.step).toBe("idle");
    s = scannerReducer(s, {
      type: "scan_header",
      parsed: { shipment_no: "S-1" },
    });
    expect(s.step).toBe("line");
    expect(s.header).toEqual({ shipment_no: "S-1" });
    s = scannerReducer(s, {
      type: "scan_line",
      parsed: { line_no: 1 },
    });
    expect(s.step).toBe("label");
    s = scannerReducer(s, {
      type: "scan_label",
      parsed: { item_code: "A" },
    });
    expect(s.step).toBe("review");
    expect(s.label).toEqual({ item_code: "A" });
  });

  it("set_match updates canSubmit per ng_flow", () => {
    const init = initialScannerState("block");
    const afterNg = scannerReducer(init, { type: "set_match", outcome: ngOutcome });
    expect(afterNg.match).toBe(ngOutcome);
    expect(afterNg.canSubmit).toBe(false);

    const warnInit = initialScannerState("warn");
    const warnAfterNg = scannerReducer(warnInit, {
      type: "set_match",
      outcome: ngOutcome,
    });
    expect(warnAfterNg.canSubmit).toBe(true);
  });

  it("submit_success resets to a fresh state with step=submitted", () => {
    let s = initialScannerState("warn");
    s = scannerReducer(s, { type: "scan_label", parsed: { item_code: "A" } });
    s = scannerReducer(s, { type: "set_match", outcome: okOutcome });
    s = scannerReducer(s, { type: "submit_success" });
    expect(s.step).toBe("submitted");
    expect(s.header).toBeNull();
    expect(s.line).toBeNull();
    expect(s.label).toBeNull();
    expect(s.match).toBeNull();
    expect(s.canSubmit).toBe(false);
    expect(s.ngFlow).toBe("warn");
  });

  it("reset returns initialScannerState (preserving ng_flow)", () => {
    const after = scannerReducer(
      {
        ...initialScannerState("warn"),
        step: "review",
        label: { item_code: "A" },
      },
      { type: "reset" },
    );
    expect(after).toEqual(initialScannerState("warn"));
  });

  it("fail records the error message", () => {
    const after = scannerReducer(initialScannerState("block"), {
      type: "fail",
      error: "unknown_format",
    });
    expect(after.error).toBe("unknown_format");
  });

  it("manual_mode_on flips manualMode flag", () => {
    const after = scannerReducer(initialScannerState("block"), {
      type: "manual_mode_on",
    });
    expect(after.manualMode).toBe(true);
  });
});
