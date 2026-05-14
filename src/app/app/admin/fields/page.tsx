import { Alert } from "@/components/ui/Alert";
import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { isErr } from "@/lib/admin/shared/result";
import {
  DEMO_FIELD_SETTINGS,
  FIELD_PURPOSES,
  type FieldSetting,
  type FieldSettingPurpose,
} from "@/lib/admin/fixtures";
import { FieldSettingsForm } from "./FieldSettingsForm";
import { CustomFieldsForm, type CustomFieldRow } from "./CustomFieldsForm";

/**
 * Phase 5b 項目設定 詳細 UI (architect §3.2.3 / SCOPE_5B_STRICT bullet 3).
 *
 * Switched the upper section from demo fixtures to a Supabase JOIN of
 * standard_field_definitions × tenant_field_settings, and added the minimum
 * custom_field_definitions section (full semantic-binding UI ships in 5c).
 */

type StandardFieldRow = {
  code: string;
  label: string;
  data_type: string;
  sort_order: number;
};

type TenantFieldOverrideRow = {
  field_code: string;
  enabled: boolean;
  purpose: string;
  display_label: string | null;
  sort_order: number;
};

type CustomFieldDefinitionDbRow = {
  id: string;
  column_name: string;
  label: string;
  data_type: string;
  description: string | null;
  enabled: boolean;
  sort_order: number;
};

export default async function FieldSettingsPage() {
  const gate = await ensureTenantAdmin();

  let settings: FieldSetting[] = [];
  let customFields: CustomFieldRow[] = [];
  let liveMode = false;
  let loadError: string | null = null;

  if (!isErr(gate)) {
    liveMode = true;
    const { tenantId, supabase } = gate.data;

    const { data: standardRows, error: stdErr } = await supabase
      .from("standard_field_definitions")
      .select("code, label, data_type, sort_order")
      .is("deleted_at", null)
      .order("sort_order", { ascending: true });
    const { data: tenantRows, error: tErr } = await supabase
      .from("tenant_field_settings")
      .select("field_code, enabled, purpose, display_label, sort_order")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null);

    if (stdErr || tErr) {
      loadError = "項目設定の読み込みに失敗しました。";
    } else if (standardRows) {
      const overrides = new Map<string, TenantFieldOverrideRow>();
      for (const o of tenantRows ?? []) {
        const r = o as TenantFieldOverrideRow;
        overrides.set(r.field_code, r);
      }
      settings = (standardRows as StandardFieldRow[]).map((s) => {
        const ov = overrides.get(s.code);
        return {
          fieldCode: s.code,
          label: s.label,
          dataType: s.data_type as FieldSetting["dataType"],
          enabled: ov?.enabled ?? true,
          purpose: (ov?.purpose ?? "display_only") as FieldSettingPurpose,
          displayLabel: ov?.display_label ?? s.label,
          sortOrder: ov?.sort_order ?? s.sort_order,
        };
      });
    }

    const { data: customRows, error: cErr } = await supabase
      .from("custom_field_definitions")
      .select("id, column_name, label, data_type, description, enabled, sort_order")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .limit(50);
    if (cErr) {
      loadError = loadError ?? "カスタム項目の読み込みに失敗しました。";
    } else if (customRows) {
      customFields = (customRows as CustomFieldDefinitionDbRow[]).map((r) => ({
        id: r.id,
        columnName: r.column_name,
        label: r.label,
        dataType: r.data_type as CustomFieldRow["dataType"],
        description: r.description,
        enabled: r.enabled,
        sortOrder: r.sort_order,
      }));
    }
  } else {
    settings = [...DEMO_FIELD_SETTINGS].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  return (
    <section aria-labelledby="field-settings-heading" className="flex flex-col gap-6">
      <div>
        <h2
          id="field-settings-heading"
          className="text-lg font-semibold text-[var(--ink)]"
        >
          標準項目の利用 / 用途
        </h2>
        <p className="text-sm text-[var(--muted)]">
          標準項目 (system 配布) のテナント上書きと、テナント固有のカスタム項目を編集します。Phase 5b では「最小限のカスタム項目登録」までを提供し、records 系フォームへの連動表示は Phase 7 で行います。
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

      <Alert tone="info" title="5 用途の意味">
        <ul className="space-y-1 text-xs">
          {FIELD_PURPOSES.map((p) => (
            <li key={p.value} className="flex gap-2">
              <span className="min-w-[6rem] font-mono text-[var(--ink)]">{p.label}</span>
              <span>{p.helper}</span>
            </li>
          ))}
        </ul>
      </Alert>

      <FieldSettingsForm settings={settings} />

      <section aria-labelledby="custom-fields-heading" className="flex flex-col gap-3">
        <div>
          <h2
            id="custom-fields-heading"
            className="text-lg font-semibold text-[var(--ink)]"
          >
            カスタム項目 (custom_text_01..10 / custom_number_01..05 / custom_date_01..05)
          </h2>
          <p className="text-sm text-[var(--muted)]">
            テナント固有のカスタム列に意味付けします。各列名は 1 行のみ定義可能 (UNIQUE)。
          </p>
        </div>
        <CustomFieldsForm initial={customFields} liveMode={liveMode} />
      </section>
    </section>
  );
}
