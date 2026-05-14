"use server";

import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import {
  err,
  isErr,
  ok,
  type AdminActionResult,
} from "@/lib/admin/shared/result";
import {
  csvExportDefinitionInputSchema,
  csvImportDefinitionInputSchema,
  uuidSchema,
  zodIssuesToFieldErrors,
} from "@/lib/admin/shared/validation";

/**
 * Phase 5c CSV format CRUD server actions (architect §3.2.4).
 *
 * Two tables — csv_import_definitions / csv_export_definitions — share the
 * same shape envelope (business_code + definition_code unique per tenant +
 * jsonb column_mapping). We expose one server action per table to keep the
 * zod boundary explicit; both reuse ensureTenantAdmin + AdminActionResult.
 */

export type CsvImportDefinitionInput = {
  id: string;
  businessCode: "receiving" | "picking" | "inventory" | "manufacturing";
  targetTable: string;
  definitionCode: string;
  definitionName: string;
  encoding: "utf8" | "shift_jis";
  delimiter: "comma" | "tab" | "pipe";
  startRow: number;
  duplicateAction: "skip" | "update" | "error";
  enabled: boolean;
  columnMapping: ReadonlyArray<{
    csvColumnIndex: number;
    targetColumn: string;
    required: boolean;
    defaultValue: string | null;
  }>;
};

export type CsvExportDefinitionInput = {
  id: string;
  businessCode: "receiving" | "picking" | "inventory" | "manufacturing";
  sourceTable: string;
  definitionCode: string;
  definitionName: string;
  encoding: "utf8" | "shift_jis";
  delimiter: "comma" | "tab" | "pipe";
  includeHeader: boolean;
  enabled: boolean;
  columnSelection: ReadonlyArray<{
    sourceColumn: string;
    headerLabel: string;
    sortOrder: number;
  }>;
};

function mapDbError(code: string | null | undefined): {
  code: "conflict" | "rls" | "unexpected";
  message: string;
} {
  if (code === "23505") {
    return { code: "conflict", message: "同じ定義コードが既に登録されています。" };
  }
  if (code === "42501") {
    return { code: "rls", message: "権限が不足しています。" };
  }
  return { code: "unexpected", message: "保存に失敗しました。" };
}

export async function saveCsvImportDefinitionAction(
  input: CsvImportDefinitionInput,
): Promise<AdminActionResult<{ id: string }>> {
  const parse = csvImportDefinitionInputSchema.safeParse(input);
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
    target_table: data.targetTable,
    definition_code: data.definitionCode,
    definition_name: data.definitionName,
    encoding: data.encoding,
    delimiter: data.delimiter,
    start_row: data.startRow,
    duplicate_action: data.duplicateAction,
    enabled: data.enabled,
    column_mapping: data.columnMapping.map((m) => ({
      csv_column_index: m.csvColumnIndex,
      target_column: m.targetColumn,
      required: m.required,
      default_value: m.defaultValue,
    })),
  };

  const isNew = input.id.startsWith("new-");
  if (isNew) {
    const { data: row, error } = await supabase
      .from("csv_import_definitions")
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
    .from("csv_import_definitions")
    .update(payload)
    .eq("id", input.id)
    .eq("tenant_id", tenantId);
  if (error) {
    const m = mapDbError(error.code);
    return err(m.code, m.message);
  }
  return ok({ id: input.id });
}

export async function saveCsvExportDefinitionAction(
  input: CsvExportDefinitionInput,
): Promise<AdminActionResult<{ id: string }>> {
  const parse = csvExportDefinitionInputSchema.safeParse(input);
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
    source_table: data.sourceTable,
    definition_code: data.definitionCode,
    definition_name: data.definitionName,
    encoding: data.encoding,
    delimiter: data.delimiter,
    include_header: data.includeHeader,
    enabled: data.enabled,
    column_selection: data.columnSelection.map((c) => ({
      source_column: c.sourceColumn,
      header_label: c.headerLabel,
      sort_order: c.sortOrder,
    })),
  };

  const isNew = input.id.startsWith("new-");
  if (isNew) {
    const { data: row, error } = await supabase
      .from("csv_export_definitions")
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
    .from("csv_export_definitions")
    .update(payload)
    .eq("id", input.id)
    .eq("tenant_id", tenantId);
  if (error) {
    const m = mapDbError(error.code);
    return err(m.code, m.message);
  }
  return ok({ id: input.id });
}

export async function deleteCsvDefinitionAction(input: {
  kind: "import" | "export";
  id: string;
}): Promise<AdminActionResult<void>> {
  if (input.kind !== "import" && input.kind !== "export") {
    return err("validation", "種別が不正です。");
  }
  if (input.id.startsWith("new-")) return ok();
  const idParse = uuidSchema.safeParse(input.id);
  if (!idParse.success) return err("validation", "ID 形式が不正です。");

  const gate = await ensureTenantAdmin();
  if (isErr(gate)) return gate;
  const { tenantId, supabase } = gate.data;

  const table =
    input.kind === "import" ? "csv_import_definitions" : "csv_export_definitions";
  const { error } = await supabase
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("tenant_id", tenantId);
  if (error) return err("unexpected", "削除に失敗しました。");
  return ok();
}
