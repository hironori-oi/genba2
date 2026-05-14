import { Alert } from "@/components/ui/Alert";
import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { isErr } from "@/lib/admin/shared/result";
import { CsvTemplateDownloads } from "./CsvTemplateDownloads";
import {
  CsvFormatsEditor,
  type CsvExportRow,
  type CsvImportRow,
} from "./CsvFormatsEditor";

/**
 * Phase 5c CSV format CRUD page (architect §3.2.4).
 *
 * Renders csv_import_definitions + csv_export_definitions in a single screen
 * with a 2-way tab. Both tables are tenant-scoped (RLS-503/-504 from Phase 2);
 * server-side cap is 500 rows per architect R-P5-17.
 */

type ImportDbRow = {
  id: string;
  business_code: string;
  target_table: string;
  definition_code: string;
  definition_name: string;
  encoding: string;
  delimiter: string;
  start_row: number;
  duplicate_action: string;
  enabled: boolean;
  column_mapping: unknown;
};

type ExportDbRow = {
  id: string;
  business_code: string;
  source_table: string;
  definition_code: string;
  definition_name: string;
  encoding: string;
  delimiter: string;
  include_header: boolean;
  enabled: boolean;
  column_selection: unknown;
};

type MappingDb = {
  csv_column_index?: number;
  target_column?: string;
  required?: boolean;
  default_value?: string | null;
};

type SelectionDb = {
  source_column?: string;
  header_label?: string;
  sort_order?: number;
};

function toImportRow(r: ImportDbRow): CsvImportRow {
  const rawMapping = Array.isArray(r.column_mapping)
    ? (r.column_mapping as MappingDb[])
    : [];
  return {
    id: r.id,
    businessCode: r.business_code as CsvImportRow["businessCode"],
    targetTable: r.target_table,
    definitionCode: r.definition_code,
    definitionName: r.definition_name,
    encoding: (r.encoding as CsvImportRow["encoding"]) ?? "utf8",
    delimiter: (r.delimiter as CsvImportRow["delimiter"]) ?? "comma",
    startRow: r.start_row ?? 1,
    duplicateAction:
      (r.duplicate_action as CsvImportRow["duplicateAction"]) ?? "error",
    enabled: r.enabled,
    columnMapping: rawMapping.map((m) => ({
      csvColumnIndex: m.csv_column_index ?? 1,
      targetColumn: m.target_column ?? "",
      required: Boolean(m.required),
      defaultValue: m.default_value ?? null,
    })),
  };
}

function toExportRow(r: ExportDbRow): CsvExportRow {
  const rawSel = Array.isArray(r.column_selection)
    ? (r.column_selection as SelectionDb[])
    : [];
  return {
    id: r.id,
    businessCode: r.business_code as CsvExportRow["businessCode"],
    sourceTable: r.source_table,
    definitionCode: r.definition_code,
    definitionName: r.definition_name,
    encoding: (r.encoding as CsvExportRow["encoding"]) ?? "utf8",
    delimiter: (r.delimiter as CsvExportRow["delimiter"]) ?? "comma",
    includeHeader: Boolean(r.include_header),
    enabled: r.enabled,
    columnSelection: rawSel.map((c) => ({
      sourceColumn: c.source_column ?? "",
      headerLabel: c.header_label ?? "",
      sortOrder: c.sort_order ?? 0,
    })),
  };
}

export default async function CsvFormatsPage() {
  const gate = await ensureTenantAdmin();

  let imports: CsvImportRow[] = [];
  let exports_: CsvExportRow[] = [];
  let liveMode = false;
  let loadError: string | null = null;

  if (!isErr(gate)) {
    liveMode = true;
    const { supabase, tenantId } = gate.data;

    const [{ data: importData, error: importErr }, { data: exportData, error: exportErr }] =
      await Promise.all([
        supabase
          .from("csv_import_definitions")
          .select(
            "id, business_code, target_table, definition_code, definition_name, encoding, delimiter, start_row, duplicate_action, enabled, column_mapping",
          )
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .order("definition_code", { ascending: true })
          .limit(500),
        supabase
          .from("csv_export_definitions")
          .select(
            "id, business_code, source_table, definition_code, definition_name, encoding, delimiter, include_header, enabled, column_selection",
          )
          .eq("tenant_id", tenantId)
          .is("deleted_at", null)
          .order("definition_code", { ascending: true })
          .limit(500),
      ]);

    if (importErr || exportErr) {
      loadError = "CSV 定義の読み込みに失敗しました。";
    } else {
      imports = ((importData ?? []) as unknown as ImportDbRow[]).map(toImportRow);
      exports_ = ((exportData ?? []) as unknown as ExportDbRow[]).map(toExportRow);
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
          id="csv-formats-heading"
          className="text-lg font-semibold text-[var(--ink)]"
        >
          CSV フォーマット
        </h2>
        <p className="text-sm text-[var(--muted)]">
          インポート / エクスポートの 2 種類の CSV 定義を、業務別 (入庫 / ピッキング / 棚卸 / 製造) に管理します。エンコード・区切り文字・列マッピングを編集できます。
        </p>
      </header>

      {!liveMode ? (
        <Alert tone="info" title="プレビューモード">
          Supabase 接続情報が未設定のため、登録は保存されません。
        </Alert>
      ) : null}

      {loadError ? (
        <Alert tone="error" title="読み込みエラー">
          {loadError}
        </Alert>
      ) : null}

      <CsvTemplateDownloads />

      <CsvFormatsEditor
        initialImports={imports}
        initialExports={exports_}
        liveMode={liveMode}
      />
    </section>
  );
}
