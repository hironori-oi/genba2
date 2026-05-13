import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { Alert } from "@/components/ui/Alert";
import {
  fetchScanHistoryByIdForAdmin,
  fetchScanHistoryByIdForWorker,
} from "@/lib/logi/history";
import { supabaseConfigured } from "@/lib/env";
import type {
  QrScanHistoryAdminRow,
  QrScanHistoryRow,
} from "@/lib/logi/types";

export const metadata: Metadata = { title: "スキャン履歴 (詳細)" };

type PageProps = {
  params: Promise<{ id: string }>;
};

/**
 * Phase 3b — スキャン履歴 詳細ページ (read-only).
 *
 * Renders a single qr_scan_histories row. Two read modes mirror the list page:
 *
 *   * tenant_admin / system_admin → v_qr_scan_histories_admin (raw_value 表示)
 *   * worker                       → v_qr_scan_histories       (raw_value 非表示)
 *
 * The id slug is taken from the URL. RLS + view filtering will return null for
 * cross-tenant or non-admin admin-view requests; the UI treats null as a
 * generic 404 so we don't leak row existence across tenants.
 */
export default async function HistoryDetailPage({ params }: PageProps) {
  const { id } = await params;

  const session = await getAppSession();
  if (session.kind === "unauthenticated") {
    redirect(`/login?next=/app/logi/history/${id}`);
  }

  const isAdmin =
    session.kind === "ok" &&
    (session.session.role === "tenant_admin" ||
      session.session.role === "system_admin");

  const configured = supabaseConfigured();

  let row: QrScanHistoryRow | QrScanHistoryAdminRow | null = null;
  let rawValue: string | null = null;
  let fetchError: string | null = null;

  if (configured) {
    if (isAdmin) {
      const { data, error } = await fetchScanHistoryByIdForAdmin(id);
      if (error) {
        fetchError = error.message;
      } else if (data) {
        row = data;
        rawValue = data.rawValue;
      }
    } else {
      const { data, error } = await fetchScanHistoryByIdForWorker(id);
      if (error) fetchError = error.message;
      else row = data;
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3">
        <div>
          <Link
            href="/app/logi/history"
            data-testid="history-detail-back"
            aria-label="履歴一覧に戻る"
            className="inline-flex h-14 w-14 items-center justify-center border border-[var(--border)] bg-[var(--surface)] font-mono text-xs text-[var(--ink)] hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          >
            戻る
          </Link>
        </div>
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          履歴 / 詳細
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl">
          スキャン履歴 詳細
        </h1>
        <p className="font-mono text-xs text-[var(--muted)]" data-testid="history-detail-id">
          id: {id}
        </p>
      </header>

      {!configured ? (
        <Alert tone="info" title="プレビューモード">
          Supabase 接続情報が未設定のため、詳細は表示できません。`.env.enc` 設定後に再度アクセスしてください。
        </Alert>
      ) : null}

      {fetchError ? (
        <Alert tone="error" title="読込エラー">
          {fetchError}
        </Alert>
      ) : null}

      {configured && !fetchError && !row ? (
        <Alert tone="warn" title="該当履歴がありません">
          指定された id の履歴は見つかりませんでした。別のテナントの履歴か、削除済みの可能性があります。
        </Alert>
      ) : null}

      {row ? (
        <section
          aria-labelledby="history-detail-fields"
          className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4"
        >
          <h2
            id="history-detail-fields"
            className="text-base font-semibold text-[var(--ink)]"
          >
            記録内容
          </h2>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr]">
            <DtDd label="作成日時">
              <span className="font-mono text-xs text-[var(--ink)]">
                {new Date(row.createdAt).toLocaleString("ja-JP")}
              </span>
            </DtDd>
            <DtDd label="業務">
              <span className="font-mono text-xs text-[var(--ink)]">
                {row.businessCode ?? "-"}
              </span>
            </DtDd>
            <DtDd label="QR 種別">
              <span className="font-mono text-xs text-[var(--ink)]">
                {row.qrType}
              </span>
            </DtDd>
            <DtDd label="照合結果">
              <span
                data-testid="history-detail-match"
                className={
                  "font-mono text-xs " +
                  (row.matchResult === "ok"
                    ? "text-[var(--color-ok)]"
                    : row.matchResult === "ng"
                      ? "text-[var(--color-bad)]"
                      : row.matchResult === "warning"
                        ? "text-[var(--color-warn)]"
                        : "text-[var(--muted)]")
                }
              >
                {row.matchResult}
              </span>
            </DtDd>
            <DtDd label="対象テーブル / id">
              <span className="font-mono text-xs text-[var(--ink)] break-all">
                {row.targetTable
                  ? `${row.targetTable} / ${row.targetId ?? "-"}`
                  : "-"}
              </span>
            </DtDd>
            <DtDd label="解析値 (parsed_values)">
              <pre
                data-testid="history-detail-parsed"
                className="overflow-x-auto whitespace-pre-wrap break-all border border-[var(--border)] bg-[var(--surface-2)] p-2 font-mono text-xs text-[var(--ink)]"
              >
                {JSON.stringify(row.parsedValues, null, 2)}
              </pre>
            </DtDd>
            <DtDd label="照合明細 (match_detail)">
              <pre className="overflow-x-auto whitespace-pre-wrap break-all border border-[var(--border)] bg-[var(--surface-2)] p-2 font-mono text-xs text-[var(--ink)]">
                {JSON.stringify(row.matchDetail, null, 2)}
              </pre>
            </DtDd>
            <DtDd label="警告">
              {row.warnings.length === 0 ? (
                <span className="text-xs text-[var(--muted)]">なし</span>
              ) : (
                <ul className="flex flex-col gap-1 text-xs text-[var(--color-warn)]">
                  {row.warnings.map((w, i) => (
                    <li key={i} className="font-mono">
                      • {w}
                    </li>
                  ))}
                </ul>
              )}
            </DtDd>
            <DtDd label="エラー理由">
              <span className="font-mono text-xs text-[var(--ink)]">
                {row.errorReason ?? "-"}
              </span>
            </DtDd>
            {isAdmin && rawValue !== null ? (
              <DtDd label="raw_value (admin)">
                <pre
                  data-testid="history-detail-rawvalue"
                  className="overflow-x-auto whitespace-pre-wrap break-all border border-[var(--color-bad)] bg-[var(--surface-2)] p-2 font-mono text-xs text-[var(--ink)]"
                >
                  {rawValue}
                </pre>
              </DtDd>
            ) : null}
          </dl>
          {!isAdmin ? (
            <p className="text-xs text-[var(--muted)]">
              作業者向け表示では raw_value は含まれません (QR_SPEC §7)。
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function DtDd({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
        {label}
      </dt>
      <dd>{children}</dd>
    </>
  );
}
