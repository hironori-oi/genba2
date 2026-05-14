import { err, type AdminActionResult } from "@/lib/admin/shared/result";

/**
 * Phase 5d 訂正 RPC エラーマッピング.
 *
 * submit_movement_correction / submit_inventory_correction /
 * submit_manufacturing_correction (migration 20260528000200) は以下の
 * sqlstate を `raise exception` する:
 *
 *   42501 — 認証されていない / RLS reject
 *   22023 — 引数 invalid (p_old_id null / reason length)
 *   02000 — 旧 row が見つからない (RLS が SELECT で 0 rows、または既に訂正済)
 *
 * Supabase の postgrest 経由では `error.code` に sqlstate がそのまま入る。
 */
export function mapCorrectionRpcError<T = never>(
  code: string | null | undefined,
  message: string | null | undefined,
): AdminActionResult<T> {
  switch (code) {
    case "42501":
      return err("forbidden", "この記録を訂正する権限がありません。");
    case "22023":
      return err("validation", "入力内容を確認してください。");
    case "02000":
      return err(
        "not_found",
        "対象の記録が見つからないか、既に訂正済みです。",
      );
    case "23503":
      return err("conflict", "参照先のレコードが存在しません。");
    default:
      return err(
        "unexpected",
        message && message.length > 0
          ? "訂正処理でエラーが発生しました。"
          : "訂正処理に失敗しました。",
      );
  }
}
