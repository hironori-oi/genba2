"use server";

import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import {
  err,
  isErr,
  ok,
  type AdminActionResult,
} from "@/lib/admin/shared/result";
import {
  uuidSchema,
  workInputFieldSettingInputSchema,
  workSettingsInputSchema,
  zodIssuesToFieldErrors,
} from "@/lib/admin/shared/validation";

/**
 * Phase 5c work_settings + work_input_field_settings server actions
 * (architect §3.2.5).
 *
 * work_settings は (tenant_id, business_code) で UNIQUE。テナントごとに 4 業務
 * 各 1 行のみ存在しうる。「業務ごとに 1 行を upsert する」のが基本操作。
 */

export type WorkSettingsInput = {
  id: string;
  businessCode: "receiving" | "picking" | "inventory" | "manufacturing";
  workMode: "ticket" | "free";
  matchMode: "double" | "none";
  ngFlow: "block" | "warn" | "approve";
  correctionApproval: boolean;
  headerFormatId: string | null;
  lineFormatId: string | null;
  labelFormatId: string | null;
  matchRuleId: string | null;
  enabled: boolean;
};

export type WorkInputFieldSettingInput = {
  id: string;
  businessCode: "receiving" | "picking" | "inventory" | "manufacturing";
  fieldCode: string;
  enabled: boolean;
  required: boolean;
  sortOrder: number;
};

function mapDbError(code: string | null | undefined): {
  code: "conflict" | "rls" | "unexpected";
  message: string;
} {
  if (code === "23505") {
    return { code: "conflict", message: "同じ業務の設定が既に存在します。" };
  }
  if (code === "42501") {
    return { code: "rls", message: "権限が不足しています。" };
  }
  return { code: "unexpected", message: "保存に失敗しました。" };
}

export async function saveWorkSettingsAction(
  input: WorkSettingsInput,
): Promise<AdminActionResult<{ id: string }>> {
  const parse = workSettingsInputSchema.safeParse(input);
  if (!parse.success) {
    return err(
      "validation",
      "入力内容を確認してください。",
      zodIssuesToFieldErrors(parse.error),
    );
  }
  const data = parse.data;

  const gate = await ensureTenantAdmin();
  if (isErr(gate)) return gate;
  const { tenantId, supabase } = gate.data;

  const payload = {
    tenant_id: tenantId,
    business_code: data.businessCode,
    work_mode: data.workMode,
    match_mode: data.matchMode,
    ng_flow: data.ngFlow,
    correction_approval: data.correctionApproval,
    header_format_id: data.headerFormatId,
    line_format_id: data.lineFormatId,
    label_format_id: data.labelFormatId,
    match_rule_id: data.matchRuleId,
    enabled: data.enabled,
  };

  const isNew = input.id.startsWith("new-");
  if (isNew) {
    const { data: row, error } = await supabase
      .from("work_settings")
      .insert(payload)
      .select("id")
      .single();
    if (error) {
      const m = mapDbError(error.code);
      return err(m.code, m.message);
    }
    return ok({ id: (row as { id: string }).id });
  }

  const idParse = uuidSchema.safeParse(input.id);
  if (!idParse.success) return err("validation", "ID 形式が不正です。");

  const { error } = await supabase
    .from("work_settings")
    .update(payload)
    .eq("id", input.id)
    .eq("tenant_id", tenantId);
  if (error) {
    const m = mapDbError(error.code);
    return err(m.code, m.message);
  }
  return ok({ id: input.id });
}

export async function saveWorkInputFieldSettingAction(
  input: WorkInputFieldSettingInput,
): Promise<AdminActionResult<{ id: string }>> {
  const parse = workInputFieldSettingInputSchema.safeParse(input);
  if (!parse.success) {
    return err(
      "validation",
      "入力内容を確認してください。",
      zodIssuesToFieldErrors(parse.error),
    );
  }
  const data = parse.data;

  const gate = await ensureTenantAdmin();
  if (isErr(gate)) return gate;
  const { tenantId, supabase } = gate.data;

  const payload = {
    tenant_id: tenantId,
    business_code: data.businessCode,
    field_code: data.fieldCode,
    enabled: data.enabled,
    required: data.required,
    sort_order: data.sortOrder,
  };

  const isNew = input.id.startsWith("new-");
  if (isNew) {
    const { data: row, error } = await supabase
      .from("work_input_field_settings")
      .insert(payload)
      .select("id")
      .single();
    if (error) {
      const m = mapDbError(error.code);
      return err(m.code, m.message);
    }
    return ok({ id: (row as { id: string }).id });
  }

  const idParse = uuidSchema.safeParse(input.id);
  if (!idParse.success) return err("validation", "ID 形式が不正です。");

  const { error } = await supabase
    .from("work_input_field_settings")
    .update(payload)
    .eq("id", input.id)
    .eq("tenant_id", tenantId);
  if (error) {
    const m = mapDbError(error.code);
    return err(m.code, m.message);
  }
  return ok({ id: input.id });
}

export async function deleteWorkInputFieldSettingAction(
  id: string,
): Promise<AdminActionResult<void>> {
  if (id.startsWith("new-")) return ok();
  const idParse = uuidSchema.safeParse(id);
  if (!idParse.success) return err("validation", "ID 形式が不正です。");

  const gate = await ensureTenantAdmin();
  if (isErr(gate)) return gate;
  const { tenantId, supabase } = gate.data;

  const { error } = await supabase
    .from("work_input_field_settings")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) return err("unexpected", "削除に失敗しました。");
  return ok();
}
