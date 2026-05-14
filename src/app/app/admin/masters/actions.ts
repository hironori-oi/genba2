"use server";

import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { err, isErr, ok, type AdminActionResult } from "@/lib/admin/shared/result";
import {
  masterKindSchema,
  masterRowInputSchema,
  uuidSchema,
  zodIssuesToFieldErrors,
  type MasterKind,
  type MasterRowInput,
} from "@/lib/admin/shared/validation";

/**
 * Phase 5b 製造系 master CRUD server actions
 * (architect §3.2.6 / DEFINITION_OF_DONE bullet 1, 7).
 *
 * 5 masters: work_types / processes / equipment / defect_groups / defects.
 * Each maps to a Phase 2 table that already has tenant_admin-modify RLS
 * (architect §4.1). Server actions add zod gate + ensureTenantAdmin + soft-
 * delete; the underlying RLS is the real DB-level boundary.
 */

const MASTER_TABLE: Record<MasterKind, string> = {
  work_types: "work_types",
  processes: "processes",
  equipment: "equipment",
  defect_groups: "defect_groups",
  defects: "defects",
};

type DbRow = {
  id: string;
  code: string;
  name: string;
  sort_order: number;
  enabled: boolean;
  business_code?: string | null;
  process_id?: string | null;
  defect_group_id?: string | null;
  severity?: string | null;
};

function rowToPayload(
  kind: MasterKind,
  tenantId: string,
  input: MasterRowInput,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    tenant_id: tenantId,
    code: input.code,
    name: input.name,
    sort_order: input.sortOrder,
    enabled: input.enabled,
  };
  if (kind === "work_types") {
    base.business_code = input.businessCode ?? null;
  } else if (kind === "equipment") {
    base.process_id = input.processId ?? null;
  } else if (kind === "defects") {
    base.defect_group_id = input.defectGroupId ?? null;
    base.severity = input.severity ?? "minor";
  }
  return base;
}

export type SaveMasterRowInput = {
  kind: MasterKind;
  id: string;
  row: MasterRowInput;
};

export async function saveMasterRowAction(
  input: SaveMasterRowInput,
): Promise<AdminActionResult<{ id: string }>> {
  const kindParse = masterKindSchema.safeParse(input.kind);
  if (!kindParse.success) {
    return err("validation", "対象マスタが不正です。");
  }
  const rowParse = masterRowInputSchema.safeParse(input.row);
  if (!rowParse.success) {
    return err(
      "validation",
      "入力内容を確認してください。",
      zodIssuesToFieldErrors(rowParse.error),
    );
  }

  const gate = await ensureTenantAdmin();
  if (isErr(gate)) return gate;
  const { tenantId, supabase } = gate.data;

  const table = MASTER_TABLE[input.kind];
  const payload = rowToPayload(input.kind, tenantId, rowParse.data);

  const isNew = input.id.startsWith("new-");
  if (isNew) {
    const { data, error } = await supabase
      .from(table)
      .insert(payload)
      .select("id")
      .single();
    if (error) {
      const code = error.code === "23505" ? "conflict" : "unexpected";
      return err(code, mapSupabaseError(error.code, error.message));
    }
    return ok({ id: (data as { id: string }).id });
  }

  const idParse = uuidSchema.safeParse(input.id);
  if (!idParse.success) {
    return err("validation", "ID 形式が不正です。");
  }
  const { error } = await supabase
    .from(table)
    .update(payload)
    .eq("id", input.id)
    .eq("tenant_id", tenantId);
  if (error) {
    const code = error.code === "23505" ? "conflict" : "unexpected";
    return err(code, mapSupabaseError(error.code, error.message));
  }
  return ok({ id: input.id });
}

export type DeleteMasterRowInput = {
  kind: MasterKind;
  id: string;
};

export async function deleteMasterRowAction(
  input: DeleteMasterRowInput,
): Promise<AdminActionResult<void>> {
  const kindParse = masterKindSchema.safeParse(input.kind);
  if (!kindParse.success) {
    return err("validation", "対象マスタが不正です。");
  }
  const idParse = uuidSchema.safeParse(input.id);
  if (!idParse.success) {
    return err("validation", "ID 形式が不正です。");
  }

  const gate = await ensureTenantAdmin();
  if (isErr(gate)) return gate;
  const { tenantId, supabase } = gate.data;

  const table = MASTER_TABLE[input.kind];
  const { error } = await supabase
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("tenant_id", tenantId);
  if (error) {
    return err("unexpected", "削除に失敗しました。");
  }
  return ok();
}

function mapSupabaseError(code: string | null | undefined, message: string): string {
  if (code === "23505") return "同じコードが既に登録されています。";
  if (code === "42501") return "権限が不足しています。";
  // Avoid leaking raw DB messages.
  return message?.includes("violates") ? "保存に失敗しました。" : "DB 更新に失敗しました。";
}

export type MasterRow = DbRow;
