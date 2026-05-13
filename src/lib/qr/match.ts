import type { MatchRuleLine, ParsedValues } from "./types";

/**
 * 2-point match engine (QR_SPEC §4). Phase 2 ships the data shape +
 * pure-function matcher so the QR Settings screen can preview the rule
 * before Phase 3 wires it into business flows.
 *
 * Compare types implemented in Phase 2: `equals` (Unicode NFC), `numeric_equals`
 * (leading-zero tolerant). `prefix_equals` / `regex_match` / `range_check` are
 * Phase 5+ per the spec.
 */

export type MatchLineResult = {
  sortOrder: number;
  lineFieldCode: string;
  labelFieldCode: string;
  sourceValue: string | number | null;
  labelValue: string | number | null;
  compareType: MatchRuleLine["compareType"];
  result: "ok" | "ng" | "warning" | "skip";
  actionApplied: MatchRuleLine["mismatchAction"] | MatchRuleLine["missingValueAction"] | "ok";
};

export type MatchOutcome = {
  matchResult: "ok" | "ng";
  withWarnings: boolean;
  detail: MatchLineResult[];
};

export type MatchInputs = {
  /** Parsed values of the *source* (line/header) QR. */
  source: ParsedValues;
  /** Parsed values of the *label* QR. */
  label: ParsedValues;
  /** Lines of the match rule. */
  lines: ReadonlyArray<MatchRuleLine>;
};

export function runMatch({ source, label, lines }: MatchInputs): MatchOutcome {
  const detail: MatchLineResult[] = [];
  let anyNg = false;
  let anyWarn = false;

  const sorted = [...lines].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const line of sorted) {
    const sourceValue = source[line.lineFieldCode] ?? null;
    const labelValue = label[line.labelFieldCode] ?? null;

    if (sourceValue === null || labelValue === null) {
      // Missing value path.
      const action = line.missingValueAction;
      const result: MatchLineResult = {
        sortOrder: line.sortOrder,
        lineFieldCode: line.lineFieldCode,
        labelFieldCode: line.labelFieldCode,
        sourceValue,
        labelValue,
        compareType: line.compareType,
        result: action === "ng" ? "ng" : action === "warning" ? "warning" : "skip",
        actionApplied: action,
      };
      detail.push(result);
      if (action === "ng") anyNg = true;
      if (action === "warning") anyWarn = true;
      continue;
    }

    const equal = compareValues(sourceValue, labelValue, line.compareType);
    if (equal) {
      detail.push({
        sortOrder: line.sortOrder,
        lineFieldCode: line.lineFieldCode,
        labelFieldCode: line.labelFieldCode,
        sourceValue,
        labelValue,
        compareType: line.compareType,
        result: "ok",
        actionApplied: "ok",
      });
    } else {
      const action = line.mismatchAction;
      detail.push({
        sortOrder: line.sortOrder,
        lineFieldCode: line.lineFieldCode,
        labelFieldCode: line.labelFieldCode,
        sourceValue,
        labelValue,
        compareType: line.compareType,
        result: action === "ng" ? "ng" : "warning",
        actionApplied: action,
      });
      if (action === "ng") anyNg = true;
      if (action === "warning") anyWarn = true;
    }
  }

  return {
    matchResult: anyNg ? "ng" : "ok",
    withWarnings: anyWarn,
    detail,
  };
}

function compareValues(
  a: string | number,
  b: string | number,
  compareType: "equals" | "numeric_equals",
): boolean {
  if (compareType === "numeric_equals") {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
    return na === nb;
  }
  // Unicode NFC normalised string comparison.
  return String(a).normalize("NFC") === String(b).normalize("NFC");
}
