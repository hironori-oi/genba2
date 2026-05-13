import { DEMO_MATCH_RULES, DEMO_FIELD_SETTINGS } from "@/lib/admin/fixtures";
import { MatchRulesEditor } from "./MatchRulesEditor";

export default async function MatchRulesPage() {
  const fieldOptions = DEMO_FIELD_SETTINGS.filter((f) => f.enabled).map((f) => ({
    code: f.fieldCode,
    label: f.label,
  }));

  return (
    <section aria-labelledby="match-rules-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="match-rules-heading" className="text-lg font-semibold text-[var(--ink)]">
          照合ルール (簡易)
        </h2>
        <p className="text-sm text-[var(--muted)]">
          2 点照合の line / label フィールド対応と比較方法を編集します。本格 CRUD UI は Phase 5 で導入予定です。Phase 2 では作成・編集・複製・削除のみ提供します。
        </p>
      </div>

      <MatchRulesEditor initial={DEMO_MATCH_RULES} fieldOptions={fieldOptions} />
    </section>
  );
}
