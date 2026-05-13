import type { DelimiterKind, QrFormatDefinition } from "./types";

/**
 * Resolve the literal delimiter character used by a format definition.
 * QR_SPEC §2: delimiter ∈ {comma, tab, pipe, other}.
 */
export function resolveDelimiter(
  delimiter: DelimiterKind,
  delimiterChar?: string | null,
): string {
  switch (delimiter) {
    case "comma":
      return ",";
    case "tab":
      return "\t";
    case "pipe":
      return "|";
    case "other": {
      const ch = delimiterChar ?? "";
      if (!ch) {
        throw new Error("delimiter='other' requires a non-empty delimiter_char");
      }
      return ch;
    }
  }
}

export function delimiterFor(format: Pick<QrFormatDefinition, "delimiter" | "delimiterChar">): string {
  return resolveDelimiter(format.delimiter, format.delimiterChar ?? null);
}
