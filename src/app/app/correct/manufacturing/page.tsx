import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/env";
import { ManufacturingCorrectionsList } from "./CorrectionsList";
import type { ManufacturingRow } from "./CorrectionsList";

export const metadata: Metadata = { title: "製造実績 訂正" };

type SearchParams = Promise<{ prefill?: string | string[] }>;

export default async function ManufacturingCorrectionPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const session = await getAppSession();
  const resolved = searchParams ? await searchParams : undefined;
  const prefillRaw = resolved?.prefill;
  const prefillId = Array.isArray(prefillRaw) ? prefillRaw[0] : prefillRaw;
  if (session.kind === "unauthenticated") {
    redirect("/login?next=/app/correct/manufacturing");
  }

  const configured = supabaseConfigured();
  let rows: ManufacturingRow[] = [];
  let fetchError: string | null = null;

  if (configured && session.kind === "ok") {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("manufacturing_records")
      .select(
        "id, work_date, actual_quantity, good_quantity, defect_quantity, lot, started_at, ended_at, notes, recorded_at, previous_record_id",
      )
      .eq("worker_id", session.session.userId)
      .is("deleted_at", null)
      .order("recorded_at", { ascending: false })
      .limit(30);
    if (error) {
      fetchError = "履歴の読み込みに失敗しました。";
    } else {
      rows = (data ?? []).map((r) => {
        const row = r as Record<string, unknown>;
        return {
          id: String(row.id),
          workDate: String(row.work_date ?? ""),
          actualQuantity: Number(row.actual_quantity ?? 0),
          goodQuantity:
            row.good_quantity === null || row.good_quantity === undefined
              ? null
              : Number(row.good_quantity),
          defectQuantity: Number(row.defect_quantity ?? 0),
          lot: (row.lot as string | null) ?? null,
          startedAt: (row.started_at as string | null) ?? null,
          endedAt: (row.ended_at as string | null) ?? null,
          notes: (row.notes as string | null) ?? null,
          recordedAt: String(row.recorded_at ?? ""),
          previousRecordId: (row.previous_record_id as string | null) ?? null,
        };
      });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          訂正 / 製造実績
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl">
          製造実績の訂正
        </h1>
        <p className="text-sm text-[var(--muted)]">
          自分が登録した直近 30 件の製造実績を表示します。実数量・良品数量・不適合数量・時刻を訂正できます。製造入庫 (movement_records) を残すかどうかも選べます。
        </p>
      </header>

      <nav aria-label="訂正パンくず" className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/app/correct"
          data-testid="correct-back-to-index"
          className="inline-flex h-12 items-center border border-[var(--border)] bg-[var(--surface)] px-3 text-[var(--ink)] hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          ← 訂正トップへ戻る
        </Link>
      </nav>

      {!configured ? (
        <Alert tone="info" title="プレビューモード">
          Supabase 接続情報が未設定のため、訂正は実行されません。
        </Alert>
      ) : null}

      {fetchError ? (
        <Alert tone="error" title="読み込みエラー">
          {fetchError}
        </Alert>
      ) : null}

      <ManufacturingCorrectionsList rows={rows} prefillId={prefillId ?? null} />
    </div>
  );
}
