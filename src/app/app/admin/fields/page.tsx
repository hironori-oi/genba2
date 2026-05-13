import { Alert } from "@/components/ui/Alert";
import { DEMO_FIELD_SETTINGS, FIELD_PURPOSES, type FieldSetting } from "@/lib/admin/fixtures";
import { FieldSettingsForm } from "./FieldSettingsForm";

export default async function FieldSettingsPage() {
  // Phase 2 ships the screen with demo fixtures. Phase 5 will replace with
  // a Supabase select against tenant_field_settings + standard_field_definitions.
  const settings: FieldSetting[] = [...DEMO_FIELD_SETTINGS].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  return (
    <section aria-labelledby="field-settings-heading" className="flex flex-col gap-4">
      <div>
        <h2
          id="field-settings-heading"
          className="text-lg font-semibold text-[var(--ink)]"
        >
          標準項目の利用 / 用途
        </h2>
        <p className="text-sm text-[var(--muted)]">
          各標準項目について、テナント内での使用可否と 5 種類の用途を選択します。用途は QR 解析後の項目コードと照合ルールに連動します。
        </p>
      </div>

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
    </section>
  );
}
