"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { DataTable, type DataTableColumn } from "@/components/admin/DataTable";
import { isErr } from "@/lib/admin/shared/result";
import { changeUserRoleAction } from "./actions";

export type UserRow = {
  id: string;
  displayName: string | null;
  role: "worker" | "tenant_admin" | "system_admin";
  email: string | null;
  isSelf: boolean;
};

const ROLE_LABEL: Record<string, string> = {
  worker: "作業者",
  tenant_admin: "テナント管理者",
  system_admin: "システム管理者",
};

export function UsersList({
  rows: initial,
  canPromoteSystemAdmin,
}: {
  rows: UserRow[];
  canPromoteSystemAdmin: boolean;
}) {
  const [rows, setRows] = useState<UserRow[]>(initial);
  const [pending, setPending] = useState<
    | { row: UserRow; newRole: "worker" | "tenant_admin" | "system_admin" }
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, startTransition] = useTransition();

  function handleConfirm() {
    if (!pending) return;
    const target = pending;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await changeUserRoleAction({
        targetUserId: target.row.id,
        newRole: target.newRole,
      });
      if (isErr(result)) {
        setError(result.message);
        setPending(null);
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.id === target.row.id ? { ...r, role: target.newRole } : r,
        ),
      );
      setNotice(
        `${target.row.displayName ?? target.row.email ?? target.row.id.slice(0, 8)} のロールを ${ROLE_LABEL[target.newRole]} に変更しました。`,
      );
      setPending(null);
    });
  }

  const columns: DataTableColumn<UserRow>[] = [
    {
      key: "display",
      header: "表示名",
      render: (r) => (
        <span className="text-sm text-[var(--ink)]">
          {r.displayName ?? "(未設定)"}
          {r.isSelf ? (
            <span className="ml-2 border border-[var(--color-brand)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--color-brand)]">
              SELF
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "email",
      header: "メール",
      render: (r) => (
        <span className="font-mono text-xs text-[var(--muted)]">{r.email ?? "—"}</span>
      ),
    },
    {
      key: "role",
      header: "現在のロール",
      render: (r) => ROLE_LABEL[r.role] ?? r.role,
      width: "160px",
    },
  ];

  return (
    <section className="flex flex-col gap-3" data-component="users-list">
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
        actionsWidth="280px"
        renderActions={(row) => (
          <div className="flex flex-wrap justify-end gap-2">
            {(["worker", "tenant_admin", "system_admin"] as const).map((r) => {
              if (r === row.role) return null;
              if (r === "system_admin" && !canPromoteSystemAdmin) return null;
              return (
                <Button
                  key={r}
                  type="button"
                  variant="secondary"
                  size="md"
                  data-testid={`users-set-role-${row.id}-${r}`}
                  onClick={() => setPending({ row, newRole: r })}
                  disabled={submitting}
                >
                  → {ROLE_LABEL[r]}
                </Button>
              );
            })}
          </div>
        )}
        emptyMessage="自テナントのユーザーはいません。"
        caption="ユーザー一覧"
      />
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={handleConfirm}
        title="ロールを変更する"
        message={
          pending
            ? `${pending.row.displayName ?? pending.row.email ?? pending.row.id.slice(0, 8)} のロールを ${ROLE_LABEL[pending.newRole]} に変更します。続行しますか？ 変更後は対象ユーザーのリフレッシュトークンが無効化されます。`
            : ""
        }
        confirmLabel="変更"
        danger
        busy={submitting}
      />
    </section>
  );
}
