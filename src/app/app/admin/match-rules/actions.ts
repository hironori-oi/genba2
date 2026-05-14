"use server";

import { z } from "zod";
import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { err, isErr, ok, type AdminActionResult } from "@/lib/admin/shared/result";
import {
  matchRuleSchema,
  uuidSchema,
  zodIssuesToFieldErrors,
} from "@/lib/admin/shared/validation";
import type { MatchRule } from "@/lib/admin/fixtures";

/**
 * Phase 5b match_rules CRUD server actions
 * (architect §3.2.2 + §9 R-P5-04 / SCOPE_5B_STRICT bullet 2).
 *
 * Key change vs Phase 2: the rule_lines persistence path is now a *diff
 * UPSERT + soft-delete* instead of "delete then insert". The earlier
 * wipe-and-reinsert strategy was flagged by R-P5-04 as breaking parent /
 * audit linkage and rewriting `created_at` for every line on every save.
 *
 * Algorithm:
 *   1. SELECT existing alive lines for the rule.
 *   2. Compute soft-delete set = { existing.sort_order } - { submitted.sort_order }.
 *   3. UPSERT submitted lines onto (match_rule_id, sort_order).
 *
 * Side-effect: `updated_at` advances monotonically (Phase 2 trigger covers
 * it), `created_at` is preserved for unchanged lines, and audit log
 * references remain intact.
 */

const DELETE_INPUT = z.object({ id: z.string().min(1) });

export type SaveMatchRuleResult = AdminActionResult<{ id: string }>;

export async function saveMatchRuleAction(rule: MatchRule): Promise<SaveMatchRuleResult> {
  const parsed = matchRuleSchema.safeParse(rule);
  if (!parsed.success) {
    return err(
      "validation",
      "入力内容を確認してください。",
      zodIssuesToFieldErrors(parsed.error),
    );
  }
  for (const line of parsed.data.lines) {
    if (!line.lineFieldCode || !line.labelFieldCode) {
      return err(
        "validation",
        "全ての比較ラインで明細項目とラベル項目を選択してください。",
      );
    }
  }

  const gate = await ensureTenantAdmin();
  if (isErr(gate)) return gate;
  const { tenantId, supabase } = gate.data;

  const isNew = parsed.data.id.startsWith("new-");
  const headerPayload = {
    tenant_id: tenantId,
    business_code: parsed.data.businessCode,
    rule_code: parsed.data.ruleCode,
    rule_name: parsed.data.ruleName,
    enabled: parsed.data.enabled,
  };

  let ruleId = parsed.data.id;
  if (isNew) {
    const { data, error } = await supabase
      .from("match_rules")
      .insert(headerPayload)
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") {
        return err("conflict", "同じ業務 + ルールコードのルールが既に存在します。");
      }
      return err("unexpected", "ルール作成に失敗しました。");
    }
    ruleId = (data as { id: string }).id;
  } else {
    const idParse = uuidSchema.safeParse(ruleId);
    if (!idParse.success) {
      return err("validation", "ID 形式が不正です。");
    }
    const { error } = await supabase
      .from("match_rules")
      .update(headerPayload)
      .eq("id", ruleId)
      .eq("tenant_id", tenantId);
    if (error) {
      if (error.code === "23505") {
        return err("conflict", "同じ業務 + ルールコードのルールが既に存在します。");
      }
      return err("unexpected", "ルール更新に失敗しました。");
    }
  }

  // ---- diff UPSERT for match_rule_lines (R-P5-04) ---------------------
  const { data: existingLines, error: existingErr } = await supabase
    .from("match_rule_lines")
    .select("id, sort_order")
    .eq("match_rule_id", ruleId)
    .is("deleted_at", null);
  if (existingErr) {
    return err("unexpected", "比較ライン取得に失敗しました。");
  }

  const submittedKeys = new Set(parsed.data.lines.map((l) => l.sortOrder));
  const toSoftDelete = (existingLines ?? []).filter(
    (e) => !submittedKeys.has((e as { sort_order: number }).sort_order),
  );
  if (toSoftDelete.length > 0) {
    const ids = toSoftDelete.map((r) => (r as { id: string }).id);
    const { error: delErr } = await supabase
      .from("match_rule_lines")
      .update({ deleted_at: new Date().toISOString() })
      .in("id", ids);
    if (delErr) {
      return err("unexpected", "比較ライン削除に失敗しました。");
    }
  }

  if (parsed.data.lines.length > 0) {
    const upsertRows = parsed.data.lines.map((l) => ({
      match_rule_id: ruleId,
      sort_order: l.sortOrder,
      line_field_code: l.lineFieldCode,
      label_field_code: l.labelFieldCode,
      compare_type: l.compareType,
      missing_value_action: l.missingValueAction,
      mismatch_action: l.mismatchAction,
      deleted_at: null,
    }));
    // match_rule_lines lacks a UNIQUE(match_rule_id, sort_order) constraint
    // in Phase 2 DDL, so we cannot use upsert(onConflict). Approach: SELECT
    // existing by composite key, then UPDATE matched rows and INSERT new.
    for (const row of upsertRows) {
      const match = (existingLines ?? []).find(
        (e) => (e as { sort_order: number }).sort_order === row.sort_order,
      );
      if (match) {
        const { error: upErr } = await supabase
          .from("match_rule_lines")
          .update({
            line_field_code: row.line_field_code,
            label_field_code: row.label_field_code,
            compare_type: row.compare_type,
            missing_value_action: row.missing_value_action,
            mismatch_action: row.mismatch_action,
            deleted_at: null,
          })
          .eq("id", (match as { id: string }).id);
        if (upErr) {
          return err("unexpected", "比較ライン更新に失敗しました。");
        }
      } else {
        const { error: insErr } = await supabase
          .from("match_rule_lines")
          .insert(row);
        if (insErr) {
          return err("unexpected", "比較ライン追加に失敗しました。");
        }
      }
    }
  }

  return ok({ id: ruleId });
}

export async function deleteMatchRuleAction(id: string): Promise<AdminActionResult<void>> {
  const parse = DELETE_INPUT.safeParse({ id });
  if (!parse.success) {
    return err("validation", "ID が不正です。");
  }
  if (id.startsWith("new-")) return ok();
  const idParse = uuidSchema.safeParse(id);
  if (!idParse.success) {
    return err("validation", "ID 形式が不正です。");
  }

  const gate = await ensureTenantAdmin();
  if (isErr(gate)) return gate;
  const { tenantId, supabase } = gate.data;

  const { error } = await supabase
    .from("match_rules")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", tenantId);
  if (error) return err("unexpected", "削除に失敗しました。");
  return ok();
}
