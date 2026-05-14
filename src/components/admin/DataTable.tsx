"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";

/**
 * DataTable — Phase 5 master CRUD shared primitive (architect §3.1 / §3.2.0).
 *
 * Minimum table only. Sorting and filtering are deferred to a later phase
 * (architect §9 R-P5-17: server-side LIMIT 500 with admin search/filter
 * lives in the page, not in this primitive).
 *
 * Rows are server-rendered serializable data; the component does not fetch.
 * Edit / delete actions use 56×56 touch targets so glove-wearing operators
 * (Phase 0 design principle / Phase 3b 56-px floor) can hit them reliably.
 */

export type DataTableColumn<TRow> = {
  key: string;
  header: ReactNode;
  render: (row: TRow) => ReactNode;
  align?: "start" | "center" | "end";
  width?: string;
};

export type DataTableProps<TRow> = {
  rows: ReadonlyArray<TRow>;
  columns: ReadonlyArray<DataTableColumn<TRow>>;
  rowKey: (row: TRow) => string;
  onEdit?: (row: TRow) => void;
  onDelete?: (row: TRow) => void;
  /**
   * Override the default edit/delete action cell with a custom renderer
   * (e.g. an action-menu disclosure that bundles edit / delete / clone /
   * other row-scoped affordances). When supplied, `onEdit` / `onDelete`
   * are ignored and the caller is responsible for the entire actions cell.
   */
  renderActions?: (row: TRow) => ReactNode;
  /** Width override for the actions column (default 144px). */
  actionsWidth?: string;
  loading?: boolean;
  emptyMessage?: ReactNode;
  caption?: ReactNode;
};

const ALIGN_CLASSES: Record<NonNullable<DataTableColumn<unknown>["align"]>, string> = {
  start: "text-start",
  center: "text-center",
  end: "text-end",
};

export function DataTable<TRow>({
  rows,
  columns,
  rowKey,
  onEdit,
  onDelete,
  renderActions,
  actionsWidth,
  loading = false,
  emptyMessage,
  caption,
}: DataTableProps<TRow>) {
  const showActions = Boolean(renderActions || onEdit || onDelete);

  return (
    <div
      className="w-full overflow-x-auto rounded-[8px] border border-[var(--border)] bg-[var(--surface)]"
      data-component="admin-data-table"
    >
      <table
        className="w-full border-collapse text-sm"
        aria-busy={loading || undefined}
        aria-rowcount={rows.length}
      >
        {caption ? (
          <caption className="sr-only">{caption}</caption>
        ) : null}
        <thead className="bg-[var(--surface-2)] text-[var(--muted)]">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                style={col.width ? { width: col.width } : undefined}
                className={cn(
                  "px-3 py-3 text-xs font-semibold uppercase tracking-wide",
                  ALIGN_CLASSES[col.align ?? "start"],
                )}
              >
                {col.header}
              </th>
            ))}
            {showActions ? (
              <th
                scope="col"
                className="px-3 py-3 text-end text-xs font-semibold uppercase tracking-wide"
                style={{ width: actionsWidth ?? "144px" }}
              >
                <span className="sr-only">操作</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td
                colSpan={columns.length + (showActions ? 1 : 0)}
                className="px-3 py-8 text-center text-[var(--muted)]"
                role="status"
                aria-live="polite"
              >
                読み込み中…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + (showActions ? 1 : 0)}
                className="px-3 py-8 text-center text-[var(--muted)]"
              >
                {emptyMessage ?? "データがありません。"}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const id = rowKey(row);
              return (
                <tr
                  key={id}
                  className="border-t border-[var(--border)] hover:bg-[var(--surface-2)]/40"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-3 py-3 align-middle text-[var(--ink)]",
                        ALIGN_CLASSES[col.align ?? "start"],
                      )}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                  {showActions ? (
                    <td className="px-2 py-2 text-end">
                      {renderActions ? (
                        renderActions(row)
                      ) : (
                        <div className="flex justify-end gap-2">
                          {onEdit ? (
                            <Button
                              type="button"
                              variant="secondary"
                              size="lg"
                              className="h-14 min-h-14 w-14 min-w-14 px-0"
                              aria-label={`編集: ${id}`}
                              onClick={() => onEdit(row)}
                            >
                              編集
                            </Button>
                          ) : null}
                          {onDelete ? (
                            <Button
                              type="button"
                              variant="danger"
                              size="lg"
                              className="h-14 min-h-14 w-14 min-w-14 px-0"
                              aria-label={`削除: ${id}`}
                              onClick={() => onDelete(row)}
                            >
                              削除
                            </Button>
                          ) : null}
                        </div>
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
