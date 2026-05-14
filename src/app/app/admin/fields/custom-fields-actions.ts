"use server";

import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { err, isErr, ok, type AdminActionResult } from "@/lib/admin/shared/result";
import {
  customFieldDefinitionInputSchema,
  uuidSchema,
  zodIssuesToFieldErrors,
} from "@/lib/admin/shared/validation";

/**
 * Phase 5b custom_field_definitions CRUD (architect §3.2.3 minimum).
 *
 * Only handles the row itself; binding custom columns into the records
 * forms is Phase 5c work.
 */

export type SaveCustomFieldInput = {
  id: string;
  columnName: string;
  label: string;
  dataType: "text" | "numeric" | "date";
  description: string | null;
  enabled: boolean;
  sortOrder: number;
};

export async function saveCustomFieldDefinitionAction(
  input: SaveCustomFieldInput,
): Promise<AdminActionResult<{ id: string }>> {
  const parsed = customFieldDefinitionInputSchema.safeParse({
    columnName: input.columnName,
    label: input.label,
    dataType: input.dataType,
    description: input.description,
    enabled: input.enabled,
    sortOrder: input.sortOrder,
  });
  if (!parsed.success) {
    return err(
      "validation",
      "入力内容を確認してください。",
      zodIssuesToFieldErrors(parsed.error),
    );
  }

  const gate = await ensureTenantAdmin();
  if (isErr(gate)) return gate;
  const { tenantId, supabase } = gate.data;

  const payload = {
    tenant_id: tenantId,
    column_name: parsed.data.columnName,
    label: parsed.data.label,
    data_type: parsed.data.dataType,
    description: parsed.data.description,
    enabled: parsed.data.enabled,
    sort_order: parsed.data.sortOrder,
  };

  if (input.id.startsWith("new-")) {
    const { data, error } = await supabase
      .from("custom_field_definitions")
      .insert(payload)
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") {
        return err("conflict", "この列は既に意味付けされています。");
      }
      return err("unexpected", "カスタム項目の保存に失敗しました。");
    }
    return ok({ id: (data as { id: string }).id });
  }

  const idParse = uuidSchema.safeParse(input.id);
  if (!idParse.success) {
    return err("validation", "ID 形式が不正です。");
  }
  const { error } = await supabase
    .from("custom_field_definitions")
    .update(payload)
    .eq("id", input.id)
    .eq("tenant_id", tenantId);
  if (error) {
    return err("unexpected", "カスタム項目の更新に失敗しました。");
  }
  return ok({ id: input.id });
}

export async function deleteCustomFieldDefinitionAction(
  id: string,
): Promise<AdminActionResult<void>> {
  if (id.startsWith("new-")) return ok();
  const idParse = uuidSchema.safeParse(id);
  if (!idParse.success) return err("validation", "ID 形式が不正です。");

  const gate = await ensureTenantAdmin();
  if (isErr(gate)) return gate;
  const { tenantId, supabase } = gate.data;

  const { error } = await supabase
    .from("custom_field_definitions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) return err("unexpected", "削除に失敗しました。");
  return ok();
}
