import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { Alert } from "@/components/ui/Alert";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/env";
import { MovementsCorrectionsList } from "./CorrectionsList";
import type { MovementRow } from "./CorrectionsList";

export const metadata: Metadata = { title: "入庫 / ピッキング 訂正" };

type SearchParams = Promise<{ prefill?: string | string[] }>;

export default async function MovementsCorrectionPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const session = await getAppSession();
  const resolved = searchParams ? await searchParams : undefined;
  const prefillRaw = resolved?.prefill;
  const prefillId = Array.isArray(prefillRaw) ? prefillRaw[0] : prefillRaw;
  if (session.kind === "unauthenticated") {
    redirect("/login?next=/app/correct/movements");
  }

  const configured = supabaseConfigured();
  let rows: MovementRow[] = [];
  let fetchError: string | null = null;

  if (configured && session.kind === "ok") {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("movement_records")
      .select(
        "id, business_code, item_code, quantity, lot, location_code, notes, recorded_at, previous_record_id",
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
          businessCode: (row.business_code as "receiving" | "picking") ?? "receiving",
          itemCode: (row.item_code as string) ?? "",
          quantity: Number(row.quantity ?? 0),
          lot: (row.lot as string | null) ?? null,
          locationCode: (row.location_code as string | null) ?? null,
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
          訂正 / 入庫・ピッキング
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl">
          入庫 / ピッキング 記録の訂正
        </h1>
        <p className="text-sm text-[var(--muted)]">
          自分が登録した直近 30 件のうち、未訂正のものを表示します。訂正対象を選び、変更内容と理由を入力して送信してください。
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

      <MovementsCorrectionsList rows={rows} prefillId={prefillId ?? null} />
    </div>
  );
}
