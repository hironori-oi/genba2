"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import { isErr } from "@/lib/admin/shared/result";
import { approveCorrectionAuditAction } from "./actions";

export type PendingCorrectionRow = {
  id: string;
  businessCode: string;
  targetTable: string;
  oldRecordId: string;
  newRecordId: string;
  actorId: string;
  reason: string;
  createdAt: string;
};

const BUSINESS_LABEL: Record<string, string> = {
  receiving: "入庫",
  picking: "ピッキング",
  inventory: "棚卸",
  manufacturing: "製造",
};

export function CorrectionsPendingList({
  rows: initial,
}: {
  rows: PendingCorrectionRow[];
}) {
  const [rows, setRows] = useState<PendingCorrectionRow[]>(initial);
  const [target, setTarget] = useState<PendingCorrectionRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, startTransition] = useTransition();

  const columns: DataTableColumn<PendingCorrectionRow>[] = [
    {
      key: "createdAt",
      header: "申請日時",
      render: (r) => (
        <span className="font-mono text-xs">
          {new Date(r.createdAt).toLocaleString("ja-JP")}
        </span>
      ),
      width: "180px",
    },
    {
      key: "business",
      header: "業務",
      render: (r) => BUSINESS_LABEL[r.businessCode] ?? r.businessCode,
      width: "96px",
    },
    {
      key: "table",
      header: "対象テーブル",
      render: (r) => <span className="font-mono text-xs">{r.targetTable}</span>,
      width: "200px",
    },
    {
      key: "reason",
      header: "訂正理由",
      render: (r) => (
        <span className="block max-w-[40ch] whitespace-pre-wrap break-words text-sm">
          {r.reason}
        </span>
      ),
    },
    {
      key: "actor",
      header: "申請者 id",
      render: (r) => (
        <span className="font-mono text-[11px] text-[var(--muted)]">
          {r.actorId.slice(0, 8)}…
        </span>
      ),
      width: "120px",
    },
  ];

  function handleConfirm() {
    if (!target) return;
    const pending = target;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await approveCorrectionAuditAction({ id: pending.id });
      if (isErr(result)) {
        setError(result.message);
        return;
      }
      setRows((prev) => prev.filter((r) => r.id !== pending.id));
      setNotice(`訂正 ${pending.id.slice(0, 8)}… を承認しました。`);
      setTarget(null);
    });
  }

  return (
    <section
      className="flex flex-col gap-3"
      data-component="corrections-pending"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--muted)]">未承認 {rows.length} 件</p>
      </div>

      {error ? (
        <Alert tone="error" title="エラー">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert tone="ok" title="完了">
          {notice}
        </Alert>
      ) : null}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        renderActions={(row) => (
          <Button
            type="button"
            variant="primary"
            size="lg"
            data-testid={`corrections-pending-approve-${row.id}`}
            onClick={() => setTarget(row)}
            disabled={submitting}
          >
            承認
          </Button>
        )}
        actionsWidth="120px"
        emptyMessage="未承認の訂正はありません。"
        caption="未承認の訂正一覧"
      />

      <ConfirmDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        onConfirm={handleConfirm}
        title="訂正を承認する"
        message={
          target
            ? `この訂正 (id=${target.id.slice(0, 8)}…) を承認します。続行しますか？`
            : ""
        }
        confirmLabel="承認"
        busy={submitting}
      />
    </section>
  );
}
