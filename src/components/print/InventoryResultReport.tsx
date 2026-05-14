import type { InventoryResultRow } from "@/lib/print/types";

function fmtDate(s: string): string {
  return new Date(s).toLocaleString("ja-JP");
}

function fmtDiff(d: number | null): string {
  if (d === null) return "-";
  if (d > 0) return `+${d}`;
  return String(d);
}

export function InventoryResultReport({
  rows,
  tenantLabel,
  from,
  to,
}: {
  rows: InventoryResultRow[];
  tenantLabel: string;
  from: string | undefined;
  to: string | undefined;
}) {
  const mismatchCount = rows.filter((r) => r.diff !== null && r.diff !== 0).length;
  return (
    <article data-testid="print-report-inventory-result">
      <header className="print-header">
        <h1 className="print-title">棚卸結果</h1>
        <p className="print-meta" data-testid="print-meta">
          テナント: {tenantLabel} / 期間: {from ?? "—"} ～ {to ?? "—"} / 件数:{" "}
          {rows.length} {mismatchCount > 0 ? `(差異: ${mismatchCount})` : null}
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="print-empty" data-testid="print-empty">
          該当する棚卸結果がありません。
        </p>
      ) : (
        <table className="print-table" data-testid="print-table">
          <thead>
            <tr>
              <th scope="col">記録日時</th>
              <th scope="col">品目</th>
              <th scope="col">ロケーション</th>
              <th scope="col">ロット</th>
              <th scope="col">計画</th>
              <th scope="col">実数</th>
              <th scope="col">差異</th>
              <th scope="col">照合</th>
              <th scope="col">作業者</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const mismatch = r.diff !== null && r.diff !== 0;
              return (
                <tr
                  key={r.id}
                  className={mismatch ? "print-row-mismatch" : undefined}
                  data-mismatch={mismatch ? "true" : "false"}
                >
                  <td>{fmtDate(r.recordedAt)}</td>
                  <td>{r.itemCode}</td>
                  <td>{r.locationCode ?? "-"}</td>
                  <td>{r.lot ?? "-"}</td>
                  <td>{r.expectedQuantity === null ? "-" : r.expectedQuantity}</td>
                  <td>{r.countedQuantity}</td>
                  <td className={mismatch ? "print-cell-mismatch" : undefined}>
                    {fmtDiff(r.diff)}
                  </td>
                  <td>{r.matchResult}</td>
                  <td>{r.workerLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <footer className="print-footer">
        <span>計画値との差異は赤強調しています (PRODUCT_SPEC §4 P1)。</span>
        <span data-testid="print-generated-at">
          出力: {new Date().toLocaleString("ja-JP")}
        </span>
      </footer>
    </article>
  );
}
