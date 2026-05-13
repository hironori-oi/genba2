/**
 * QR parser type definitions (Phase 2 — QR_SPEC.md §3, §4, §7).
 *
 * Pure types only. Safe to import from client OR server code.
 */

export type QrType = "header" | "line" | "label" | "location";

export type DelimiterKind = "comma" | "tab" | "pipe" | "other";

export type EncodingKind = "utf8" | "shift_jis";

export type ItemDataType = "text" | "numeric" | "date";

export type MissingValueAction = "error" | "allow_blank";

/**
 * Maximum raw QR payload accepted by the parser. QR_SPEC §7 sets server-side
 * reject at 4096 chars; we keep parser ≤ 4096 too so the boundary is the same
 * everywhere. (Test T12 uses 10000 characters and expects a reject.)
 */
export const QR_MAX_LENGTH = 4096;

export type QrItemDefinition = {
  position: number; // 1-based
  qrItemName: string;
  targetColumn: string;
  required: boolean;
  dataType: ItemDataType;
  /** Required only when dataType === "date". */
  dateFormat?: string | null;
  missingValueAction: MissingValueAction;
};

export type QrFormatDefinition = {
  id: string;
  tenantId: string;
  qrType: QrType;
  version: number;
  formatCode: string;
  formatName: string;
  delimiter: DelimiterKind;
  /** Custom delimiter character when `delimiter === "other"`. */
  delimiterChar?: string | null;
  encoding: EncodingKind;
  readable: boolean;
  issuable: boolean;
  validFrom: string; // ISO date
  items: QrItemDefinition[];
  /**
   * Optional regex source (no flags). Currently consumed only by the
   * location-step validator (qrType === "location") for free-text style
   * QRs that do not carry a `V<n>|...` version prefix. When unset/null
   * the validator falls back to free-text acceptance.
   */
  pattern?: string | null;
};

export type ParsedFieldOk = {
  status: "ok";
  position: number;
  itemName: string;
  targetColumn: string;
  rawValue: string;
  value: string | number | null;
};

export type ParsedFieldError = {
  status: "error";
  position: number;
  itemName: string;
  targetColumn: string;
  rawValue: string;
  reason: ParseFieldErrorReason;
  message: string;
};

export type ParseFieldErrorReason =
  | "required_missing"
  | "numeric_parse_failed"
  | "date_parse_failed";

export type ParsedField = ParsedFieldOk | ParsedFieldError;

export type ParsedValues = Record<string, string | number | null>;

export type ParseSuccess = {
  ok: true;
  versionToken: string;
  version: number;
  format: QrFormatDefinition;
  fields: ParsedField[];
  parsedValues: ParsedValues;
  warnings: string[];
};

export type ParseFailureReason =
  | "empty_input"
  | "input_too_long"
  | "control_char"
  | "unreadable_input"
  | "version_missing"
  | "version_invalid"
  | "delimiter_missing"
  | "unknown_format"
  | "format_unreadable"
  | "column_count_short";

export type ParseFailure = {
  ok: false;
  versionToken: string | null;
  rawValue: string;
  reason: ParseFailureReason;
  message: string;
};

export type ParseResult = ParseSuccess | ParseFailure;

/**
 * Match rule input (Phase 2 simple CRUD). The full matching engine ships
 * with Phase 3 business screens; we only need the data shape here so the
 * UI + parser library agree on the contract.
 */
export type MatchRuleLine = {
  sortOrder: number;
  lineFieldCode: string;
  labelFieldCode: string;
  compareType: "equals" | "numeric_equals";
  missingValueAction: "ng" | "warning" | "skip";
  mismatchAction: "ng" | "warning";
};
