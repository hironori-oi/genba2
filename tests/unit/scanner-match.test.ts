/**
 * Phase 3b scanner-state composite tests.
 *
 * The Scanner state machine lives in src/components/scanner/ (FRONTEND
 * worker territory) — this file does NOT import that module yet. Instead
 * we validate the *contract* between runMatch (src/lib/qr/match.ts) and
 * the canSubmit decision rule that the scanner reducer will mirror:
 *
 *   ng_flow = "block" → match.matchResult === "ng" → canSubmit = false
 *   ng_flow = "warn"  → match.matchResult === "ng" → canSubmit = true (with warnings flag)
 *   ng_flow = "warn"  → match.matchResult === "ok" with warnings → canSubmit = true (warnings flag)
 *
 * The helper `decideCanSubmit` is duplicated inline so the test is
 * self-contained; the frontend's scanner-state.ts is expected to export
 * the same shape verbatim.
 */

import { describe, expect, it } from "vitest";
import { runMatch, type MatchRuleLine, type MatchOutcome } from "@/lib/qr";

type NgFlow = "block" | "warn" | "approve";

/**
 * Decision rule the frontend scanner-state.ts will mirror:
 *   block → ng disables submit; ok/ok-with-warnings still submittable.
 *   warn  → always submittable, surface warnings flag.
 *   approve → out of scope for Phase 3b (P2 leader-approval, returns
 *             same as warn for unit-test purposes).
 */
function decideCanSubmit(
  outcome: MatchOutcome,
  ngFlow: NgFlow,
): { canSubmit: boolean; warnings: boolean } {
  if (outcome.matchResult === "ng" && ngFlow === "block") {
    return { canSubmit: false, warnings: outcome.withWarnings };
  }
  return {
    canSubmit: true,
    warnings: outcome.withWarnings || outcome.matchResult === "ng",
  };
}

const itemEqualsLine: MatchRuleLine = {
  sortOrder: 1,
  lineFieldCode: "item_code",
  labelFieldCode: "item_code",
  compareType: "equals",
  missingValueAction: "ng",
  mismatchAction: "ng",
};

const qtyEqualsLine: MatchRuleLine = {
  sortOrder: 2,
  lineFieldCode: "quantity",
  labelFieldCode: "quantity",
  compareType: "numeric_equals",
  missingValueAction: "warning",
  mismatchAction: "warning",
};

describe("runMatch composite outcomes", () => {
  it("ok when item_code and quantity both match", () => {
    const out = runMatch({
      source: { item_code: "A", quantity: 5 },
      label: { item_code: "A", quantity: 5 },
      lines: [itemEqualsLine, qtyEqualsLine],
    });
    expect(out.matchResult).toBe("ok");
    expect(out.withWarnings).toBe(false);
  });

  it("ng when item_code mismatches with mismatch_action=ng", () => {
    const out = runMatch({
      source: { item_code: "A", quantity: 5 },
      label: { item_code: "B", quantity: 5 },
      lines: [itemEqualsLine, qtyEqualsLine],
    });
    expect(out.matchResult).toBe("ng");
  });

  it("ok-with-warnings when only the warning-action line mismatches", () => {
    const out = runMatch({
      source: { item_code: "A", quantity: 5 },
      label: { item_code: "A", quantity: 6 },
      lines: [itemEqualsLine, qtyEqualsLine],
    });
    expect(out.matchResult).toBe("ok");
    expect(out.withWarnings).toBe(true);
  });
});

describe("decideCanSubmit × ng_flow", () => {
  it("ng + ng_flow=block → canSubmit=false", () => {
    const out = runMatch({
      source: { item_code: "A" },
      label: { item_code: "B" },
      lines: [itemEqualsLine],
    });
    const d = decideCanSubmit(out, "block");
    expect(d.canSubmit).toBe(false);
  });

  it("ng + ng_flow=warn → canSubmit=true with warnings flag", () => {
    const out = runMatch({
      source: { item_code: "A" },
      label: { item_code: "B" },
      lines: [itemEqualsLine],
    });
    const d = decideCanSubmit(out, "warn");
    expect(d.canSubmit).toBe(true);
    expect(d.warnings).toBe(true);
  });

  it("ok + ng_flow=block → canSubmit=true", () => {
    const out = runMatch({
      source: { item_code: "A" },
      label: { item_code: "A" },
      lines: [itemEqualsLine],
    });
    expect(decideCanSubmit(out, "block").canSubmit).toBe(true);
  });

  it("ok-with-warnings + ng_flow=warn → canSubmit=true with warnings flag", () => {
    const out = runMatch({
      source: { item_code: "A", quantity: 5 },
      label: { item_code: "A", quantity: 6 },
      lines: [itemEqualsLine, qtyEqualsLine],
    });
    const d = decideCanSubmit(out, "warn");
    expect(d.canSubmit).toBe(true);
    expect(d.warnings).toBe(true);
  });
});

describe("decideCanSubmit × missing-value action", () => {
  it("missing source value with missing_value_action=warning + ng_flow=warn → canSubmit=true with warnings", () => {
    const out = runMatch({
      source: { item_code: "A" }, // quantity missing
      label: { item_code: "A", quantity: 5 },
      lines: [itemEqualsLine, qtyEqualsLine], // qty line missing=warning
    });
    expect(out.matchResult).toBe("ok"); // warning != ng for aggregate
    expect(out.withWarnings).toBe(true);
    const d = decideCanSubmit(out, "warn");
    expect(d.canSubmit).toBe(true);
    expect(d.warnings).toBe(true);
  });

  it("missing source value with missing_value_action=ng + ng_flow=block → canSubmit=false", () => {
    const out = runMatch({
      source: {}, // item_code missing → ng per itemEqualsLine.missingValueAction
      label: { item_code: "A" },
      lines: [itemEqualsLine],
    });
    expect(out.matchResult).toBe("ng");
    expect(decideCanSubmit(out, "block").canSubmit).toBe(false);
  });

  it("missing both sides with missing_value_action=skip stays ok", () => {
    const skipLine: MatchRuleLine = {
      ...qtyEqualsLine,
      missingValueAction: "skip",
    };
    const out = runMatch({
      source: {},
      label: {},
      lines: [skipLine],
    });
    expect(out.matchResult).toBe("ok");
    expect(out.withWarnings).toBe(false);
    expect(decideCanSubmit(out, "block").canSubmit).toBe(true);
  });
});
