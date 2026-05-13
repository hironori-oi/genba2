"use server";

import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { FieldSetting, FieldSettingPurpose } from "@/lib/admin/fixtures";

const FIELD_SETTING_ROW = z.object({
  fieldCode: z.string().min(1).max(64),
  label: z.string().min(1).max(128),
  dataType: z.enum(["text", "numeric", "date", "boolean"]),
  enabled: z.boolean(),
  purpose: z.enum([
    "identify_header",
    "identify_line",
    "match_source",
    "item_label",
    "display_only",
  ]),
  displayLabel: z.string().max(128).nullable(),
  sortOrder: z.number().int().min(0).max(10_000),
});

const PAYLOAD = z.array(FIELD_SETTING_ROW).min(1).max(200);

export type SaveFieldSettingsResult =
  | { status: "ok" }
  | { status: "error"; message: string };

export async function saveFieldSettingsAction(
  rows: FieldSetting[],
): Promise<SaveFieldSettingsResult> {
  const parsed = PAYLOAD.safeParse(rows);
  if (!parsed.success) {
    return { status: "error", message: "送信されたデータの形式が不正です。" };
  }
  const data = parsed.data;

  // 全てのフィールドコード重複チェック (idempotent set)
  const seen = new Set<string>();
  for (const row of data) {
    if (seen.has(row.fieldCode)) {
      return {
        status: "error",
        message: `項目コード "${row.fieldCode}" が重複しています。`,
      };
    }
    seen.add(row.fieldCode);
  }

  if (!supabaseConfigured()) {
    // Demo / preview path — return ok so the UI can show "saved" without DB.
    return { status: "ok" };
  }

  const session = await getAppSession();
  if (session.kind !== "ok") {
    return { status: "error", message: "認証が必要です。" };
  }
  if (session.session.role === "worker") {
    return { status: "error", message: "tenant_admin 以上の権限が必要です。" };
  }
  if (!session.session.tenantId) {
    return { status: "error", message: "テナントが未割当のため保存できません。" };
  }

  const supabase = await createClient();
  const payload = data.map((row) => ({
    tenant_id: session.session.tenantId!,
    field_code: row.fieldCode,
    enabled: row.enabled,
    purpose: row.purpose satisfies FieldSettingPurpose,
    display_label: row.displayLabel,
    sort_order: row.sortOrder,
  }));

  const { error } = await supabase
    .from("tenant_field_settings")
    .upsert(payload, { onConflict: "tenant_id,field_code" });

  if (error) {
    // Translate Supabase error to a user-facing string; never echo raw codes.
    return { status: "error", message: "DB 更新に失敗しました。時間をおいて再試行してください。" };
  }

  return { status: "ok" };
}
