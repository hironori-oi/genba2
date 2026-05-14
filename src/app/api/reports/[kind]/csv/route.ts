import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { isErr } from "@/lib/admin/shared/result";
import {
  getDailyKpi,
  getMonthlyScanUsage,
  getMonthlySummary,
  getWeeklyDefectBreakdown,
  getWeeklySeries,
  type ReportKind,
} from "@/lib/reports/aggregate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseKind(value: string): ReportKind | null {
  if (value === "daily" || value === "weekly" || value === "monthly") return value;
  return null;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowsToCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(row.map(csvEscape).join(","));
  // BOM keeps Excel/Numbers happy with Japanese column names.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

function csvResponse(filenameStem: string, csv: string): NextResponse {
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filenameStem}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ kind: string }> },
): Promise<NextResponse> {
  const { kind: rawKind } = await context.params;
  const kind = parseKind(rawKind);
  if (!kind) {
    return NextResponse.json(
      { status: "error", code: "validation", message: "kind は daily / weekly / monthly のみ指定可能です" },
      { status: 400 },
    );
  }

  const gate = await ensureTenantAdmin();
  if (isErr(gate)) {
    const status = gate.code === "forbidden" ? 403 : gate.code === "unconfigured" ? 503 : 400;
    return NextResponse.json({ status: "error", code: gate.code, message: gate.message }, { status });
  }
  const { supabase, tenantId } = gate.data;

  const ts = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);

  if (kind === "daily") {
    const d = await getDailyKpi(supabase, tenantId);
    const csv = rowsToCsv(
      ["date", "manufacturing_actual", "manufacturing_good", "manufacturing_defect", "receiving", "picking", "inventory", "corrections"],
      [[
        d.date,
        d.manufacturingActualQty,
        d.manufacturingGoodQty,
        d.manufacturingDefectQty,
        d.receivingCount,
        d.pickingCount,
        d.inventoryCount,
        d.correctionsCount,
      ]],
    );
    return csvResponse(`genba-report-daily-${ts}`, csv);
  }
  if (kind === "weekly") {
    const [series, defects] = await Promise.all([
      getWeeklySeries(supabase, tenantId),
      getWeeklyDefectBreakdown(supabase, tenantId),
    ]);
    const dailyCsv = rowsToCsv(
      ["date", "receiving", "picking", "inventory", "manufacturing"],
      series.map((s) => [s.date, s.receiving, s.picking, s.inventory, s.manufacturing]),
    );
    const defectCsv = rowsToCsv(
      ["defect_name", "count"],
      defects.map((d) => [d.defectName, d.count]),
    );
    const combined =
      "# weekly_series\r\n" + dailyCsv + "\r\n# defect_breakdown\r\n" + defectCsv;
    return csvResponse(`genba-report-weekly-${ts}`, combined);
  }
  // monthly
  const [summary, usage] = await Promise.all([
    getMonthlySummary(supabase, tenantId),
    getMonthlyScanUsage(supabase, tenantId),
  ]);
  const summaryCsv = rowsToCsv(
    ["period", "manufacturing_total", "movement_total", "corrections_total", "scan_total", "scan_cap", "scan_usage_pct"],
    [[
      summary.periodStart,
      summary.manufacturingTotal,
      summary.movementTotal,
      summary.correctionsTotal,
      summary.scanTotal,
      summary.scanCap ?? "",
      summary.scanUsagePct ?? "",
    ]],
  );
  const usageCsv = rowsToCsv(
    ["period_start", "business_code", "scan_count"],
    usage.map((u) => [u.periodStart, u.businessCode, u.scanCount]),
  );
  const combined =
    "# monthly_summary\r\n" + summaryCsv + "\r\n# scan_usage_history\r\n" + usageCsv;
  return csvResponse(`genba-report-monthly-${ts}`, combined);
}
