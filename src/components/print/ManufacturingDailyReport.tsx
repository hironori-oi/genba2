import type { ManufacturingDailyRow } from "@/lib/print/types";

function fmtDate(s: string): string {
  return new Date(s).toLocaleString("ja-JP");
}

function fmtNum(n: number | null): string {
  return n === null ? "-" : String(n);
}

export function ManufacturingDailyReport({
  rows,
  tenantLabel,
  from,
  to,
}: {
  rows: ManufacturingDailyRow[];
  tenantLabel: string;
  from: string | undefined;
  to: string | undefined;
}) {
  const mismatchCount = rows.filter((r) => r.mismatch).length;
  return (
    <article data-testid="print-report-manufacturing-daily">
      <header className="print-header">
        <h1 className="print-title">製造実績日報</h1>
        <p className="print-meta" data-testid="print-meta">
          テナント: {tenantLabel} / 期間: {from ?? "—"} ～ {to ?? "—"} / 件数:{" "}
          {rows.length}{" "}
          {mismatchCount > 0 ? `(計画差異: ${mismatchCount})` : null}
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="print-empty" data-testid="print-empty">
          該当する記録がありません。
        </p>
      ) : (
        <table className="print-table" data-testid="print-table">
          <thead>
            <tr>
              <th scope="col">記録日時</th>
              <th scope="col">指示書</th>
              <th scope="col">品目</th>
              <th scope="col">工程</th>
              <th scope="col">設備</th>
              <th scope="col">計画</th>
              <th scope="col">実績</th>
              <th scope="col">良品</th>
              <th scope="col">不適合</th>
              <th scope="col">ロット</th>
              <th scope="col">作業者</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={r.mismatch ? "print-row-mismatch" : undefined}
                data-mismatch={r.mismatch ? "true" : "false"}
                data-testid={`print-row-${r.id}`}
              >
                <td>{fmtDate(r.recordedAt)}</td>
                <td>{r.orderNo ?? "-"}</td>
                <td>{r.itemCode ?? "-"}</td>
                <td>
                  {r.processName ? `${r.processName} (${r.processCode ?? "-"})` : "-"}
                </td>
                <td>{r.equipmentName ?? "-"}</td>
                <td>{fmtNum(r.plannedQuantity)}</td>
                <td className={r.mismatch ? "print-cell-mismatch" : undefined}>
                  {r.actualQuantity}
                </td>
                <td>{fmtNum(r.goodQuantity)}</td>
                <td>{r.defectQuantity}</td>
                <td>{r.lot ?? "-"}</td>
                <td>{r.workerLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <footer className="print-footer">
        <span>計画 vs 実績の差異は赤強調しています (PRODUCT_SPEC §4 P1)。</span>
        <span data-testid="print-generated-at">
          出力: {new Date().toLocaleString("ja-JP")}
        </span>
      </footer>
    </article>
  );
}
