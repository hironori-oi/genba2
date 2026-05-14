import type { PickingListRow } from "@/lib/print/types";

function fmtDate(s: string): string {
  return new Date(s).toLocaleString("ja-JP");
}

function fmtNum(n: number | null): string {
  return n === null ? "-" : String(n);
}

export function PickingListReport({
  rows,
  tenantLabel,
  from,
  to,
}: {
  rows: PickingListRow[];
  tenantLabel: string;
  from: string | undefined;
  to: string | undefined;
}) {
  const mismatchCount = rows.filter((r) => r.mismatch).length;
  return (
    <article data-testid="print-report-picking-list">
      <header className="print-header">
        <h1 className="print-title">出荷一覧 (ピッキング実績)</h1>
        <p className="print-meta" data-testid="print-meta">
          テナント: {tenantLabel} / 期間: {from ?? "—"} ～ {to ?? "—"} / 件数:{" "}
          {rows.length}{" "}
          {mismatchCount > 0 ? `(計画差異: ${mismatchCount})` : null}
        </p>
      </header>
      {rows.length === 0 ? (
        <p className="print-empty" data-testid="print-empty">
          該当するピッキング記録がありません。
        </p>
      ) : (
        <table className="print-table" data-testid="print-table">
          <thead>
            <tr>
              <th scope="col">記録日時</th>
              <th scope="col">計画</th>
              <th scope="col">品目</th>
              <th scope="col">ロケーション</th>
              <th scope="col">ロット</th>
              <th scope="col">計画数</th>
              <th scope="col">実数</th>
              <th scope="col">差異</th>
              <th scope="col">照合</th>
              <th scope="col">作業者</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const diff =
                r.expectedQuantity === null
                  ? null
                  : r.quantity - r.expectedQuantity;
              return (
                <tr
                  key={r.id}
                  className={r.mismatch ? "print-row-mismatch" : undefined}
                  data-mismatch={r.mismatch ? "true" : "false"}
                  data-testid={`print-row-${r.id}`}
                >
                  <td>{fmtDate(r.recordedAt)}</td>
                  <td>{r.planCode ?? "-"}</td>
                  <td>{r.itemCode}</td>
                  <td>{r.locationCode ?? "-"}</td>
                  <td>{r.lot ?? "-"}</td>
                  <td>{fmtNum(r.expectedQuantity)}</td>
                  <td className={r.mismatch ? "print-cell-mismatch" : undefined}>
                    {r.quantity}
                  </td>
                  <td>{diff === null ? "-" : diff > 0 ? `+${diff}` : diff}</td>
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
