import type { DefectReportRow } from "@/lib/print/types";

function fmtDate(s: string): string {
  return new Date(s).toLocaleString("ja-JP");
}

export function DefectReportPrint({
  rows,
  tenantLabel,
  from,
  to,
}: {
  rows: DefectReportRow[];
  tenantLabel: string;
  from: string | undefined;
  to: string | undefined;
}) {
  return (
    <article data-testid="print-report-defect-report">
      <header className="print-header">
        <h1 className="print-title">不適合報告</h1>
        <p className="print-meta" data-testid="print-meta">
          テナント: {tenantLabel} / 期間: {from ?? "—"} ～ {to ?? "—"} / 件数:{" "}
          {rows.length}
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="print-empty" data-testid="print-empty">
          該当する不適合がありません。
        </p>
      ) : (
        <table className="print-table" data-testid="print-table">
          <thead>
            <tr>
              <th scope="col">記録日時</th>
              <th scope="col">作業日</th>
              <th scope="col">品目</th>
              <th scope="col">不適合 code</th>
              <th scope="col">不適合 名称</th>
              <th scope="col">重要度</th>
              <th scope="col">数量</th>
              <th scope="col">備考</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={r.severity === "critical" ? "print-row-mismatch" : undefined}
                data-severity={r.severity}
              >
                <td>{fmtDate(r.recordedAt)}</td>
                <td>{r.workDate ?? "-"}</td>
                <td>{r.itemCode ?? "-"}</td>
                <td>{r.defectCode}</td>
                <td>{r.defectName}</td>
                <td>{r.severity}</td>
                <td>{r.defectQuantity}</td>
                <td>{r.notes ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <footer className="print-footer">
        <span>critical 重要度は赤強調表示しています。</span>
        <span data-testid="print-generated-at">
          出力: {new Date().toLocaleString("ja-JP")}
        </span>
      </footer>
    </article>
  );
}
