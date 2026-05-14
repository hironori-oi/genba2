import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/env";
import {
  isPrintReportKind,
  parsePaper,
  PRINT_REPORT_TITLES,
  type PrintFilter,
  type PrintReportKind,
} from "@/lib/print/types";
import {
  fetchDefectReport,
  fetchInventoryResult,
  fetchManufacturingDaily,
  fetchPickingList,
} from "@/lib/print/queries";
import { PrintShell } from "@/components/print/PrintShell";
import { ManufacturingDailyReport } from "@/components/print/ManufacturingDailyReport";
import { DefectReportPrint } from "@/components/print/DefectReportPrint";
import { InventoryResultReport } from "@/components/print/InventoryResultReport";
import { PickingListReport } from "@/components/print/PickingListReport";

import "./print.css";

type PageProps = {
  params: Promise<{ report: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { report } = await params;
  if (!isPrintReportKind(report)) return { title: "印刷プレビュー" };
  return { title: PRINT_REPORT_TITLES[report] };
}

function pickStr(
  sp: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = sp[key];
  if (typeof v === "string" && v.length > 0) return v;
  if (Array.isArray(v) && v[0]) return v[0];
  return undefined;
}

function buildFilter(
  sp: Record<string, string | string[] | undefined>,
): PrintFilter {
  return {
    from: pickStr(sp, "from"),
    to: pickStr(sp, "to"),
    recordId: pickStr(sp, "recordId"),
    planId: pickStr(sp, "planId"),
  };
}

function searchStringOf(sp: Record<string, string | string[] | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") usp.set(k, v);
    else if (Array.isArray(v) && v[0]) usp.set(k, v[0]);
  }
  return usp.toString();
}

export default async function PrintReportPage({ params, searchParams }: PageProps) {
  const { report } = await params;
  if (!isPrintReportKind(report)) {
    notFound();
  }
  const reportKind = report as PrintReportKind;
  const sp = (await searchParams) ?? {};

  const session = await getAppSession();
  if (session.kind === "unauthenticated") {
    const next = `/print/${reportKind}?${searchStringOf(sp)}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  if (session.kind === "unconfigured") {
    return (
      <main className="print-page" id="main">
        <p className="print-empty">
          Supabase 接続情報が未設定のため、印刷プレビューは表示できません。
        </p>
      </main>
    );
  }

  const isAdmin =
    session.session.role === "tenant_admin" ||
    session.session.role === "system_admin";

  // ADR-P6-07 — worker は自分のレコードのみ印刷可。tenant_admin / system_admin
  // は全件可。RLS は tenant 単位で gate するため tenant_id pin はそのまま。
  const workerId = isAdmin ? undefined : session.session.userId;

  const paper = parsePaper(sp.paper);
  const filter = buildFilter(sp);
  const tenantLabel = session.session.tenantId
    ? session.session.tenantId.slice(0, 8)
    : "—";

  if (!supabaseConfigured()) {
    return (
      <main className="print-page" id="main">
        <p className="print-empty">プレビューモード: Supabase 未設定です。</p>
      </main>
    );
  }

  const basePath = `/print/${reportKind}`;
  const searchString = searchStringOf(sp);

  let body: React.ReactNode = null;
  try {
    switch (reportKind) {
      case "manufacturing-daily": {
        const rows = await fetchManufacturingDaily(filter, { workerId });
        body = (
          <ManufacturingDailyReport
            rows={rows}
            tenantLabel={tenantLabel}
            from={filter.from}
            to={filter.to}
          />
        );
        break;
      }
      case "defect-report": {
        const rows = await fetchDefectReport(filter, { workerId });
        body = (
          <DefectReportPrint
            rows={rows}
            tenantLabel={tenantLabel}
            from={filter.from}
            to={filter.to}
          />
        );
        break;
      }
      case "inventory-result": {
        const rows = await fetchInventoryResult(filter, { workerId });
        body = (
          <InventoryResultReport
            rows={rows}
            tenantLabel={tenantLabel}
            from={filter.from}
            to={filter.to}
          />
        );
        break;
      }
      case "picking-list": {
        const rows = await fetchPickingList(filter, { workerId });
        body = (
          <PickingListReport
            rows={rows}
            tenantLabel={tenantLabel}
            from={filter.from}
            to={filter.to}
          />
        );
        break;
      }
    }
  } catch (e) {
    body = (
      <article data-testid={`print-report-${reportKind}-error`}>
        <header className="print-header">
          <h1 className="print-title">{PRINT_REPORT_TITLES[reportKind]}</h1>
          <p className="print-meta">取得エラー</p>
        </header>
        <p className="print-empty">{(e as Error).message}</p>
      </article>
    );
  }

  return (
    <PrintShell
      paper={paper}
      reportKind={reportKind}
      basePath={basePath}
      searchString={searchString}
    >
      {body}
    </PrintShell>
  );
}
