import { Alert } from "@/components/ui/Alert";
import {
  DEMO_FIELD_SETTINGS,
  DEMO_MATCH_RULES,
  type FieldSetting,
} from "@/lib/admin/fixtures";
import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { isErr } from "@/lib/admin/shared/result";
import { MatchRulesEditor } from "./MatchRulesEditor";
import type { MatchRule } from "@/lib/admin/fixtures";

/**
 * Phase 5b 照合ルール CRUD page.
 *
 * Switched from demo fixtures to Supabase select (architect §3.2.2 +
 * SCOPE_5B_STRICT bullet 2). The editor itself is unchanged at the prop
 * level; the underlying server action has been refactored to diff-upsert
 * the match_rule_lines (architect §9 R-P5-04) — `actions.ts` no longer
 * wipes + reinserts.
 */

type MatchRuleDbRow = {
  id: string;
  business_code: string;
  rule_code: string;
  rule_name: string;
  enabled: boolean;
};

type MatchRuleLineDbRow = {
  match_rule_id: string;
  sort_order: number;
  line_field_code: string;
  label_field_code: string;
  compare_type: string;
  missing_value_action: string;
  mismatch_action: string;
};

export default async function MatchRulesPage() {
  const gate = await ensureTenantAdmin();

  let rules: MatchRule[] = [];
  let fieldOptions: Array<{ code: string; label: string }> = [];
  let liveMode = false;
  let loadError: string | null = null;

  if (!isErr(gate)) {
    liveMode = true;
    const { tenantId, supabase } = gate.data;

    const { data: ruleRows, error: ruleErr } = await supabase
      .from("match_rules")
      .select("id, business_code, rule_code, rule_name, enabled")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("rule_code", { ascending: true })
      .limit(500);
    if (ruleErr) {
      loadError = "照合ルールの読み込みに失敗しました。";
    } else if (ruleRows && ruleRows.length > 0) {
      const ids = ruleRows.map((r) => (r as MatchRuleDbRow).id);
      const { data: lineRows } = await supabase
        .from("match_rule_lines")
        .select(
          "match_rule_id, sort_order, line_field_code, label_field_code, compare_type, missing_value_action, mismatch_action",
        )
        .in("match_rule_id", ids)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true });
      const linesByRule = new Map<
        string,
        MatchRule["lines"]
      >();
      for (const l of lineRows ?? []) {
        const r = l as MatchRuleLineDbRow;
        const list = linesByRule.get(r.match_rule_id) ?? [];
        list.push({
          sortOrder: r.sort_order,
          lineFieldCode: r.line_field_code,
          labelFieldCode: r.label_field_code,
          compareType: r.compare_type as MatchRule["lines"][number]["compareType"],
          missingValueAction:
            r.missing_value_action as MatchRule["lines"][number]["missingValueAction"],
          mismatchAction: r.mismatch_action as MatchRule["lines"][number]["mismatchAction"],
        });
        linesByRule.set(r.match_rule_id, list);
      }
      rules = ruleRows.map((r) => {
        const row = r as MatchRuleDbRow;
        return {
          id: row.id,
          ruleCode: row.rule_code,
          ruleName: row.rule_name,
          businessCode: row.business_code as MatchRule["businessCode"],
          enabled: row.enabled,
          lines: linesByRule.get(row.id) ?? [],
        };
      });
    }

    const { data: fieldRows } = await supabase
      .from("tenant_field_settings")
      .select("field_code, display_label, enabled")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .eq("enabled", true)
      .limit(200);
    if (fieldRows && fieldRows.length > 0) {
      fieldOptions = fieldRows.map((f) => {
        const r = f as { field_code: string; display_label: string | null };
        return { code: r.field_code, label: r.display_label ?? r.field_code };
      });
    } else {
      fieldOptions = (DEMO_FIELD_SETTINGS as FieldSetting[])
        .filter((f) => f.enabled)
        .map((f) => ({ code: f.fieldCode, label: f.label }));
    }
  } else {
    rules = DEMO_MATCH_RULES;
    fieldOptions = (DEMO_FIELD_SETTINGS as FieldSetting[])
      .filter((f) => f.enabled)
      .map((f) => ({ code: f.fieldCode, label: f.label }));
  }

  return (
    <section aria-labelledby="match-rules-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="match-rules-heading" className="text-lg font-semibold text-[var(--ink)]">
          照合ルール CRUD
        </h2>
        <p className="text-sm text-[var(--muted)]">
          2 点照合の line / label フィールド対応と比較方法を編集します。比較ラインは差分 UPSERT + 論理削除で保存され、参照整合性 (audit / 履歴) を破壊しません。
        </p>
      </div>

      {!liveMode ? (
        <Alert tone="info" title="プレビューモード">
          Supabase 接続情報が未設定のため、デモデータを表示しています。
        </Alert>
      ) : null}
      {loadError ? (
        <Alert tone="error" title="読み込みエラー">
          {loadError}
        </Alert>
      ) : null}

      <MatchRulesEditor initial={rules} fieldOptions={fieldOptions} />
    </section>
  );
}
