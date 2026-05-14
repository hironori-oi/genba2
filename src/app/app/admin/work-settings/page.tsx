import { Alert } from "@/components/ui/Alert";
import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { isErr } from "@/lib/admin/shared/result";
import {
  WorkSettingsEditor,
  type BusinessCode,
  type FieldOption,
  type MatchRuleOption,
  type QrFormatOption,
  type WorkInputFieldRow,
  type WorkSettingsRow,
} from "./WorkSettingsEditor";

/**
 * Phase 5c work_settings + work_input_field_settings page (architect §3.2.5).
 *
 * 4 業務を tab で切替。selected business は URL ?business= 経由。
 * 業務ごとに work_settings (UNIQUE per tenant_id+business_code) + 入力対象項目を編集。
 */

const BUSINESS_CODES: ReadonlyArray<BusinessCode> = [
  "receiving",
  "picking",
  "inventory",
  "manufacturing",
];

function parseBusiness(raw: unknown): BusinessCode {
  if (typeof raw === "string" && BUSINESS_CODES.includes(raw as BusinessCode)) {
    return raw as BusinessCode;
  }
  return "receiving";
}

type WorkSettingsDbRow = {
  id: string;
  business_code: string;
  work_mode: string;
  match_mode: string;
  ng_flow: string;
  correction_approval: boolean;
  header_format_id: string | null;
  line_format_id: string | null;
  label_format_id: string | null;
  match_rule_id: string | null;
  enabled: boolean;
};

type WorkInputFieldDbRow = {
  id: string;
  business_code: string;
  field_code: string;
  enabled: boolean;
  required: boolean;
  sort_order: number;
};

type QrFormatDbRow = {
  id: string;
  qr_type: string;
  format_code: string;
  format_name: string;
  version: number;
};

type MatchRuleDbRow = {
  id: string;
  business_code: string;
  rule_code: string;
  rule_name: string;
};

type StandardFieldDbRow = {
  code: string;
  label: string;
};

type TenantFieldSettingDbRow = {
  field_code: string;
  enabled: boolean;
  display_label: string | null;
};

export default async function WorkSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ business?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const activeBusiness = parseBusiness(sp.business);

  const gate = await ensureTenantAdmin();

  let settings: WorkSettingsRow[] = [];
  let inputFields: WorkInputFieldRow[] = [];
  let qrFormatOptions: QrFormatOption[] = [];
  let matchRuleOptions: MatchRuleOption[] = [];
  let fieldOptions: FieldOption[] = [];
  let liveMode = false;
  let loadError: string | null = null;

  if (!isErr(gate)) {
    liveMode = true;
    const { supabase, tenantId } = gate.data;

    const [
      { data: settingsData, error: settingsErr },
      { data: fieldsData, error: fieldsErr },
      { data: qrData, error: qrErr },
      { data: ruleData, error: ruleErr },
      { data: stdFieldData, error: stdErr },
      { data: tenantFieldData, error: tErr },
    ] = await Promise.all([
      supabase
        .from("work_settings")
        .select(
          "id, business_code, work_mode, match_mode, ng_flow, correction_approval, header_format_id, line_format_id, label_format_id, match_rule_id, enabled",
        )
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .limit(50),
      supabase
        .from("work_input_field_settings")
        .select(
          "id, business_code, field_code, enabled, required, sort_order",
        )
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
        .limit(500),
      supabase
        .from("qr_format_definitions")
        .select("id, qr_type, format_code, format_name, version")
        .eq("tenant_id", tenantId)
        .eq("readable", true)
        .is("deleted_at", null)
        .order("qr_type", { ascending: true })
        .order("version", { ascending: false })
        .limit(200),
      supabase
        .from("match_rules")
        .select("id, business_code, rule_code, rule_name")
        .eq("tenant_id", tenantId)
        .eq("enabled", true)
        .is("deleted_at", null)
        .limit(200),
      supabase
        .from("standard_field_definitions")
        .select("code, label")
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
        .limit(200),
      supabase
        .from("tenant_field_settings")
        .select("field_code, enabled, display_label")
        .eq("tenant_id", tenantId)
        .eq("enabled", true)
        .is("deleted_at", null)
        .limit(200),
    ]);

    if (settingsErr || fieldsErr || qrErr || ruleErr || stdErr || tErr) {
      loadError = "業務設定の読み込みに失敗しました。";
    } else {
      settings = ((settingsData ?? []) as unknown as WorkSettingsDbRow[]).map(
        (r) => ({
          id: r.id,
          businessCode: r.business_code as BusinessCode,
          workMode: r.work_mode as WorkSettingsRow["workMode"],
          matchMode: r.match_mode as WorkSettingsRow["matchMode"],
          ngFlow: r.ng_flow as WorkSettingsRow["ngFlow"],
          correctionApproval: r.correction_approval,
          headerFormatId: r.header_format_id,
          lineFormatId: r.line_format_id,
          labelFormatId: r.label_format_id,
          matchRuleId: r.match_rule_id,
          enabled: r.enabled,
        }),
      );
      inputFields = ((fieldsData ?? []) as unknown as WorkInputFieldDbRow[]).map(
        (r) => ({
          id: r.id,
          businessCode: r.business_code as BusinessCode,
          fieldCode: r.field_code,
          enabled: r.enabled,
          required: r.required,
          sortOrder: r.sort_order,
        }),
      );
      qrFormatOptions = ((qrData ?? []) as unknown as QrFormatDbRow[])
        .filter(
          (q) =>
            q.qr_type === "header" || q.qr_type === "line" || q.qr_type === "label",
        )
        .map((q) => ({
          id: q.id,
          qrType: q.qr_type as QrFormatOption["qrType"],
          formatCode: q.format_code,
          formatName: q.format_name,
          version: q.version,
        }));
      matchRuleOptions = ((ruleData ?? []) as unknown as MatchRuleDbRow[]).map(
        (r) => ({
          id: r.id,
          businessCode: r.business_code as BusinessCode,
          ruleCode: r.rule_code,
          ruleName: r.rule_name,
        }),
      );

      const stdRows = (stdFieldData ?? []) as unknown as StandardFieldDbRow[];
      const tenantRows = (tenantFieldData ?? []) as unknown as TenantFieldSettingDbRow[];
      const enabledCodes = new Set(tenantRows.map((t) => t.field_code));
      // If no tenant override rows exist, fall back to "all standard fields"
      // so the picker isn't empty for fresh tenants.
      fieldOptions = stdRows
        .filter((s) => enabledCodes.size === 0 || enabledCodes.has(s.code))
        .map((s) => {
          const override = tenantRows.find((t) => t.field_code === s.code);
          return {
            fieldCode: s.code,
            label: override?.display_label ?? s.label,
          };
        });
    }
  } else if (gate.code === "forbidden") {
    return (
      <Alert tone="error" title="権限不足">
        この画面には tenant_admin 権限が必要です。
      </Alert>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h2
          id="work-settings-heading"
          className="text-lg font-semibold text-[var(--ink)]"
        >
          業務設定
        </h2>
        <p className="text-sm text-[var(--muted)]">
          4 業務 (入庫 / ピッキング / 棚卸 / 製造) ごとに、作業モード・照合モード・NG フロー・各 QR フォーマット・照合ルール・入力対象項目を設定します。
        </p>
      </header>

      {loadError ? (
        <Alert tone="error" title="読み込みエラー">
          {loadError}
        </Alert>
      ) : null}

      <WorkSettingsEditor
        activeBusiness={activeBusiness}
        settings={settings}
        inputFields={inputFields}
        qrFormatOptions={qrFormatOptions}
        matchRuleOptions={matchRuleOptions}
        fieldOptions={fieldOptions}
        liveMode={liveMode}
      />
    </section>
  );
}
