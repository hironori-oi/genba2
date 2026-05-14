"use server";

import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { err, isErr, ok, type AdminActionResult } from "@/lib/admin/shared/result";
import {
  qrFormatDefinitionSchema,
  uuidSchema,
  zodIssuesToFieldErrors,
} from "@/lib/admin/shared/validation";
import type { QrFormatDefinition } from "@/lib/qr/types";

/**
 * Phase 5b QR formats CRUD server actions
 * (architect §3.2.1 / SCOPE_5B_STRICT bullet 1).
 *
 * Surface:
 *   * saveQrFormatAction — create or update a format + its items.
 *     Items are diff-upserted (soft-delete missing positions) per
 *     architect §9 R-P5-04 (parallel discipline with match_rule_lines).
 *   * cloneAsNewVersionAction — copy a format with version+1 and a fresh
 *     UUID; items are duplicated as `new`. The new version is created
 *     `readable=true, issuable=false` so it can be inspected before going
 *     live (architect §3.2.1).
 *   * deleteQrFormatAction — soft-delete a format (deleted_at).
 *   * setFormatReadableBulkAction — flip readable on every format whose
 *     id is in the supplied list. Guards R-P5-05 by requiring the caller
 *     to send `acknowledged: true` (the UI fires it after a two-step
 *     ConfirmDialog with requireExplicit).
 */

type FormatPayload = Omit<QrFormatDefinition, "items" | "tenantId">;

function rowToFormatPayload(
  tenantId: string,
  fmt: FormatPayload,
): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    qr_type: fmt.qrType,
    format_code: fmt.formatCode,
    format_name: fmt.formatName,
    version: fmt.version,
    delimiter: fmt.delimiter,
    delimiter_char: fmt.delimiterChar ?? null,
    encoding: fmt.encoding,
    readable: fmt.readable,
    issuable: fmt.issuable,
    valid_from: fmt.validFrom,
    description: fmt.pattern ?? null,
  };
}

export async function saveQrFormatAction(
  fmt: QrFormatDefinition,
): Promise<AdminActionResult<{ id: string }>> {
  const parse = qrFormatDefinitionSchema.safeParse({
    id: fmt.id,
    qrType: fmt.qrType,
    formatCode: fmt.formatCode,
    formatName: fmt.formatName,
    version: fmt.version,
    delimiter: fmt.delimiter,
    delimiterChar: fmt.delimiterChar ?? null,
    encoding: fmt.encoding,
    readable: fmt.readable,
    issuable: fmt.issuable,
    validFrom: fmt.validFrom,
    description: fmt.pattern ?? null,
    items: fmt.items,
  });
  if (!parse.success) {
    return err(
      "validation",
      "入力内容を確認してください。",
      zodIssuesToFieldErrors(parse.error),
    );
  }

  const gate = await ensureTenantAdmin();
  if (isErr(gate)) return gate;
  const { tenantId, supabase } = gate.data;

  const isNew = fmt.id.startsWith("new-");
  const payload = rowToFormatPayload(tenantId, parse.data as FormatPayload);

  let formatId = fmt.id;
  if (isNew) {
    const { data, error } = await supabase
      .from("qr_format_definitions")
      .insert(payload)
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") {
        return err("conflict", "同じ QR タイプ・バージョンが既に存在します。");
      }
      return err("unexpected", "QR フォーマットの登録に失敗しました。");
    }
    formatId = (data as { id: string }).id;
  } else {
    const idParse = uuidSchema.safeParse(fmt.id);
    if (!idParse.success) {
      return err("validation", "ID 形式が不正です。");
    }
    const { error } = await supabase
      .from("qr_format_definitions")
      .update(payload)
      .eq("id", fmt.id)
      .eq("tenant_id", tenantId);
    if (error) {
      if (error.code === "23505") {
        return err("conflict", "同じ QR タイプ・バージョンが既に存在します。");
      }
      return err("unexpected", "QR フォーマットの更新に失敗しました。");
    }
  }

  // ---- items: diff-upsert + soft-delete (architect §9 R-P5-04 parallel) ----
  // Read existing items, soft-delete any whose position is absent in the
  // submitted set, then upsert by (format_id, position).
  const { data: existing } = await supabase
    .from("qr_item_definitions")
    .select("id, position")
    .eq("qr_format_definition_id", formatId)
    .is("deleted_at", null);

  const submittedPositions = new Set(parse.data.items.map((i) => i.position));
  const toSoftDelete = (existing ?? []).filter(
    (e) => !submittedPositions.has((e as { position: number }).position),
  );
  if (toSoftDelete.length > 0) {
    const ids = toSoftDelete.map((e) => (e as { id: string }).id);
    const { error: delErr } = await supabase
      .from("qr_item_definitions")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", ids);
    if (delErr) {
      return err("unexpected", "QR 項目の削除に失敗しました。");
    }
  }

  const itemRows = parse.data.items.map((it) => ({
    qr_format_definition_id: formatId,
    position: it.position,
    qr_item_name: it.qrItemName,
    target_column: it.targetColumn,
    required: it.required,
    data_type: it.dataType,
    date_format: it.dateFormat ?? null,
    missing_value_action: it.missingValueAction,
    deleted_at: null,
  }));
  if (itemRows.length > 0) {
    const { error: upErr } = await supabase
      .from("qr_item_definitions")
      .upsert(itemRows, { onConflict: "qr_format_definition_id,position" });
    if (upErr) {
      return err("unexpected", "QR 項目の保存に失敗しました。");
    }
  }

  return ok({ id: formatId });
}

export async function deleteQrFormatAction(
  id: string,
): Promise<AdminActionResult<void>> {
  if (id.startsWith("new-")) return ok();
  const idParse = uuidSchema.safeParse(id);
  if (!idParse.success) return err("validation", "ID 形式が不正です。");

  const gate = await ensureTenantAdmin();
  if (isErr(gate)) return gate;
  const { tenantId, supabase } = gate.data;

  const { error } = await supabase
    .from("qr_format_definitions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) return err("unexpected", "削除に失敗しました。");
  return ok();
}

export async function cloneAsNewVersionAction(
  sourceFormatId: string,
): Promise<AdminActionResult<{ id: string; version: number }>> {
  const idParse = uuidSchema.safeParse(sourceFormatId);
  if (!idParse.success) return err("validation", "ID 形式が不正です。");

  const gate = await ensureTenantAdmin();
  if (isErr(gate)) return gate;
  const { tenantId, supabase } = gate.data;

  const { data: src, error: srcErr } = await supabase
    .from("qr_format_definitions")
    .select(
      "qr_type, format_code, format_name, delimiter, delimiter_char, encoding, version",
    )
    .eq("id", sourceFormatId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .single();
  if (srcErr || !src) return err("not_found", "複製元のフォーマットが見つかりません。");

  const { data: maxRow } = await supabase
    .from("qr_format_definitions")
    .select("version")
    .eq("tenant_id", tenantId)
    .eq("qr_type", (src as { qr_type: string }).qr_type)
    .order("version", { ascending: false })
    .limit(1)
    .single();
  const nextVersion =
    ((maxRow as { version: number } | null)?.version ?? (src as { version: number }).version) + 1;

  const insertPayload = {
    tenant_id: tenantId,
    qr_type: (src as { qr_type: string }).qr_type,
    format_code: (src as { format_code: string }).format_code,
    format_name: `${(src as { format_name: string }).format_name} (V${nextVersion})`,
    version: nextVersion,
    delimiter: (src as { delimiter: string }).delimiter,
    delimiter_char: (src as { delimiter_char: string | null }).delimiter_char,
    encoding: (src as { encoding: string }).encoding,
    readable: true,
    issuable: false,
    valid_from: new Date().toISOString().slice(0, 10),
  };
  const { data: ins, error: insErr } = await supabase
    .from("qr_format_definitions")
    .insert(insertPayload)
    .select("id")
    .single();
  if (insErr || !ins) {
    if (insErr?.code === "23505") {
      return err("conflict", "同じ QR タイプ・バージョンが既に存在します。");
    }
    return err("unexpected", "新バージョンの作成に失敗しました。");
  }
  const newFormatId = (ins as { id: string }).id;

  const { data: srcItems } = await supabase
    .from("qr_item_definitions")
    .select("position, qr_item_name, target_column, required, data_type, date_format, missing_value_action")
    .eq("qr_format_definition_id", sourceFormatId)
    .is("deleted_at", null)
    .order("position", { ascending: true });
  if (srcItems && srcItems.length > 0) {
    const itemRows = srcItems.map((it) => ({
      qr_format_definition_id: newFormatId,
      position: (it as { position: number }).position,
      qr_item_name: (it as { qr_item_name: string }).qr_item_name,
      target_column: (it as { target_column: string }).target_column,
      required: (it as { required: boolean }).required,
      data_type: (it as { data_type: string }).data_type,
      date_format: (it as { date_format: string | null }).date_format,
      missing_value_action: (it as { missing_value_action: string }).missing_value_action,
    }));
    const { error: itemErr } = await supabase
      .from("qr_item_definitions")
      .insert(itemRows);
    if (itemErr) {
      return err("unexpected", "新バージョンの項目複製に失敗しました。");
    }
  }

  return ok({ id: newFormatId, version: nextVersion });
}

export async function setFormatReadableBulkAction(input: {
  ids: string[];
  readable: boolean;
  acknowledged: boolean;
}): Promise<AdminActionResult<{ updated: number }>> {
  if (!input.acknowledged) {
    return err(
      "validation",
      "読取可否一括変更には明示的な確認 (二重確認) が必要です。",
    );
  }
  for (const id of input.ids) {
    const idParse = uuidSchema.safeParse(id);
    if (!idParse.success) {
      return err("validation", "ID 形式が不正です。");
    }
  }
  if (input.ids.length === 0) return ok({ updated: 0 });

  const gate = await ensureTenantAdmin();
  if (isErr(gate)) return gate;
  const { tenantId, supabase } = gate.data;

  const { error, count } = await supabase
    .from("qr_format_definitions")
    .update({ readable: input.readable }, { count: "exact" })
    .in("id", input.ids)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);
  if (error) return err("unexpected", "一括更新に失敗しました。");
  return ok({ updated: count ?? 0 });
}
