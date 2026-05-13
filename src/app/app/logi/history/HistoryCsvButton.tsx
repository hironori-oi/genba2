"use client";

import { useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { serializeCsv } from "@/lib/csv/sanitize";

type Row = {
  id: string;
  createdAt: string;
  businessCode: string | null;
  qrType: string;
  matchResult: string;
  targetTable: string | null;
  targetId: string | null;
  parsedSummary: string;
};

/**
 * Phase 3b — Browser-side CSV emitter for the history page.
 *
 * For Phase 3b the server hands us at most 200 rows (clampLimit), so we
 * serialise them client-side using the same sanitizer the EF will use.
 * Phase 4 will swap this to a streamed server action for unbounded ranges.
 */
export function HistoryCsvButton({ rows }: { rows: Row[] }) {
  const download = useCallback(() => {
    const header = [
      "id",
      "created_at",
      "business_code",
      "qr_type",
      "match_result",
      "target_table",
      "target_id",
      "parsed_summary",
    ];
    const body = rows.map((r) => [
      r.id,
      r.createdAt,
      r.businessCode ?? "",
      r.qrType,
      r.matchResult,
      r.targetTable ?? "",
      r.targetId ?? "",
      r.parsedSummary,
    ]);
    const csv = serializeCsv([header, ...body]);
    // BOM for Excel friendliness.
    const blob = new Blob(["﻿" + csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scan-history-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [rows]);

  return (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      onClick={download}
      disabled={rows.length === 0}
      data-testid="history-csv-export"
    >
      CSV 出力 ({rows.length})
    </Button>
  );
}
