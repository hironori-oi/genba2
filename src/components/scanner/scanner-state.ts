/**
 * Phase 3b — Scanner state machine.
 *
 * Pure, framework-free reducer + types so the same state shape can drive:
 *   - the 3-step pick flow (header → line → label → match → quantity)
 *   - the 1-step free-read receiving flow (label → quantity)
 *   - the inventory flow (location → label → quantity)
 *
 * NOTE: this file is intentionally React-free so it is trivially unit testable
 * and so the same reducer can be reused by future server-side replay tools.
 *
 * Spec references:
 *   - ARCHITECTURE.md §3 state machines
 *   - QR_SPEC.md §4 2 point match
 *   - PRODUCT_SPEC.md §3 UC-1..UC-4
 */

import type { ParsedValues } from "@/lib/qr/types";
import type { MatchOutcome } from "@/lib/qr/match";

export type ScanStep =
  | "idle"
  | "header"
  | "line"
  | "label"
  | "review"
  | "submitted";

export type NgFlow = "block" | "warn";

export type ScannerState = {
  step: ScanStep;
  header: ParsedValues | null;
  line: ParsedValues | null;
  label: ParsedValues | null;
  match: MatchOutcome | null;
  ngFlow: NgFlow;
  canSubmit: boolean;
  error: string | null;
  manualMode: boolean;
};

export type ScanEvent =
  | { type: "scan_header"; parsed: ParsedValues }
  | { type: "scan_line"; parsed: ParsedValues }
  | { type: "scan_label"; parsed: ParsedValues }
  | { type: "set_match"; outcome: MatchOutcome }
  | { type: "submit_success" }
  | { type: "reset" }
  | { type: "manual_mode_on" }
  | { type: "fail"; error: string };

export function initialScannerState(ngFlow: NgFlow = "block"): ScannerState {
  return {
    step: "idle",
    header: null,
    line: null,
    label: null,
    match: null,
    ngFlow,
    canSubmit: false,
    error: null,
    manualMode: false,
  };
}

/**
 * Decide whether the user is allowed to press 登録 (submit).
 *
 *   - No match attempted yet  → false. (UI shows "照合してください".)
 *   - Match returned `ng` and ng_flow=block → false. (Hard block per
 *     AC-QR-01.)
 *   - Match returned `ng` and ng_flow=warn  → true. (Confirmation dialog
 *     surfaces, then submit proceeds.)
 *   - Match returned `ok`   → true. (Warnings allowed.)
 */
export function decideCanSubmit(
  match: MatchOutcome | null,
  ngFlow: NgFlow,
): boolean {
  if (match === null) return false;
  if (ngFlow === "block" && match.matchResult === "ng") return false;
  return true;
}

export function scannerReducer(
  state: ScannerState,
  event: ScanEvent,
): ScannerState {
  switch (event.type) {
    case "scan_header":
      return {
        ...state,
        header: event.parsed,
        step: "line",
        error: null,
      };

    case "scan_line":
      return {
        ...state,
        line: event.parsed,
        step: "label",
        error: null,
      };

    case "scan_label": {
      // We move to `review` here; the host component is expected to dispatch
      // `set_match` after invoking runMatch with the new label payload.
      return {
        ...state,
        label: event.parsed,
        step: "review",
        error: null,
      };
    }

    case "set_match": {
      const canSubmit = decideCanSubmit(event.outcome, state.ngFlow);
      return {
        ...state,
        match: event.outcome,
        canSubmit,
        error: null,
      };
    }

    case "submit_success":
      return {
        ...initialScannerState(state.ngFlow),
        step: "submitted",
      };

    case "reset":
      return initialScannerState(state.ngFlow);

    case "manual_mode_on":
      return { ...state, manualMode: true };

    case "fail":
      return { ...state, error: event.error };

    default: {
      // Exhaustiveness check — TS will error here if ScanEvent grows.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _exhaustive: never = event;
      return state;
    }
  }
}
