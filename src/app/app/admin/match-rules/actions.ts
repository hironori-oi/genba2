"use server";

import { z } from "zod";
import { getAppSession } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { MatchRule } from "@/lib/admin/fixtures";

const LINE = z.object({
  sortOrder: z.number().int().min(1).max(100),
  lineFieldCode: z.string().min(1).max(64),
  labelFieldCode: z.string().min(1).max(64),
  compareType: z.enum(["equals", "numeric_equals"]),
  missingValueAction: z.enum(["ng", "warning", "skip"]),
  mismatchAction: z.enum(["ng", "warning"]),
});

const RULE = z.object({
  id: z.string().min(1),
  ruleCode: z
    .string()
    .min(1, "ルールコードは必須です。")
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "ルールコードは英数字 / - / _ のみ使用できます。"),
  ruleName: z.string().min(1, "ルール名は必須です。").max(128),
  businessCode: z.enum(["receiving", "picking", "inventory", "manufacturing"]),
  enabled: z.boolean(),
  lines: z.array(LINE).max(50),
});

export type SaveMatchRuleResult = { status: "ok" } | { status: "error"; message: string };

export async function saveMatchRuleAction(rule: MatchRule): Promise<SaveMatchRuleResult> {
  const parsed = RULE.safeParse(rule);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? "入力データが不正です。";
    return { status: "error", message: first };
  }
  for (const line of parsed.data.lines) {
    if (!line.lineFieldCode || !line.labelFieldCode) {
      return { status: "error", message: "全ての比較ラインで明細項目とラベル項目を選択してください。" };
    }
  }

  if (!supabaseConfigured()) {
    return { status: "ok" };
  }

  const session = await getAppSession();
  if (session.kind !== "ok") return { status: "error", message: "認証が必要です。" };
  if (session.session.role === "worker") {
    return { status: "error", message: "tenant_admin 以上の権限が必要です。" };
  }
  if (!session.session.tenantId) {
    return { status: "error", message: "テナントが未割当のため保存できません。" };
  }

  const sb = await createClient();
  const isNew = parsed.data.id.startsWith("new-");
  const payload = {
    tenant_id: session.session.tenantId,
    business_code: parsed.data.businessCode,
    rule_code: parsed.data.ruleCode,
    rule_name: parsed.data.ruleName,
    enabled: parsed.data.enabled,
  };
  let ruleId = parsed.data.id;
  if (isNew) {
    const { data, error } = await sb
      .from("match_rules")
      .insert(payload)
      .select("id")
      .single();
    if (error) return { status: "error", message: "ルール作成に失敗しました。" };
    ruleId = data.id;
  } else {
    const { error } = await sb.from("match_rules").update(payload).eq("id", ruleId);
    if (error) return { status: "error", message: "ルール更新に失敗しました。" };
    // Wipe and reinsert lines (simple approach for Phase 2 prototype).
    const { error: delErr } = await sb.from("match_rule_lines").delete().eq("match_rule_id", ruleId);
    if (delErr) return { status: "error", message: "比較ライン更新に失敗しました。" };
  }
  const lineRows = parsed.data.lines.map((l) => ({
    match_rule_id: ruleId,
    sort_order: l.sortOrder,
    line_field_code: l.lineFieldCode,
    label_field_code: l.labelFieldCode,
    compare_type: l.compareType,
    missing_value_action: l.missingValueAction,
    mismatch_action: l.mismatchAction,
  }));
  if (lineRows.length > 0) {
    const { error } = await sb.from("match_rule_lines").insert(lineRows);
    if (error) return { status: "error", message: "比較ライン保存に失敗しました。" };
  }
  return { status: "ok" };
}

export async function deleteMatchRuleAction(id: string): Promise<SaveMatchRuleResult> {
  if (!z.string().min(1).safeParse(id).success) {
    return { status: "error", message: "ID が不正です。" };
  }
  if (!supabaseConfigured()) {
    return { status: "ok" };
  }
  const session = await getAppSession();
  if (session.kind !== "ok") return { status: "error", message: "認証が必要です。" };
  if (session.session.role === "worker") {
    return { status: "error", message: "tenant_admin 以上の権限が必要です。" };
  }
  const sb = await createClient();
  const { error } = await sb.from("match_rules").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) return { status: "error", message: "削除に失敗しました。" };
  return { status: "ok" };
}
