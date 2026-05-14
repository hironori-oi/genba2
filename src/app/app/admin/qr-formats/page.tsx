import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { isErr } from "@/lib/admin/shared/result";
import type { QrFormatDefinition, QrItemDefinition, QrType } from "@/lib/qr/types";
import { QrFormatsEditor } from "./QrFormatsEditor";

/**
 * Phase 5b QR formats CRUD page (architect §3.2.1).
 *
 * Server-renders the format list for the selected qr_type. Each row carries
 * its items so the editor's modal can open without a follow-up fetch.
 *
 * Routing decision: this is a NEW route (`/app/admin/qr-formats`) alongside
 * the legacy `/app/admin/qr` (read-only テスト). The brief lists the new
 * path explicitly under SCOPE_5B_STRICT bullet 1; the legacy read-test page
 * stays untouched so Phase 2 e2e (qr-read-test) is not broken.
 */

const QR_TYPES: ReadonlyArray<{ key: QrType; label: string }> = [
  { key: "header", label: "ヘッダー (header)" },
  { key: "line", label: "明細 (line)" },
  { key: "label", label: "現品ラベル (label)" },
];

function parseQrType(raw: unknown): QrType {
  if (raw === "header" || raw === "line" || raw === "label") return raw;
  return "label";
}

function parseReadableFilter(raw: unknown): "all" | "readable" | "unreadable" {
  if (raw === "readable" || raw === "unreadable") return raw;
  return "all";
}

type QrFormatDbRow = {
  id: string;
  tenant_id: string;
  qr_type: string;
  format_code: string;
  format_name: string;
  version: number;
  delimiter: string;
  delimiter_char: string | null;
  encoding: string;
  readable: boolean;
  issuable: boolean;
  valid_from: string;
};

type QrItemDbRow = {
  qr_format_definition_id: string;
  position: number;
  qr_item_name: string;
  target_column: string;
  required: boolean;
  data_type: string;
  date_format: string | null;
  missing_value_action: string;
};

function toQrItem(row: QrItemDbRow): QrItemDefinition {
  return {
    position: row.position,
    qrItemName: row.qr_item_name,
    targetColumn: row.target_column,
    required: row.required,
    dataType: row.data_type as QrItemDefinition["dataType"],
    dateFormat: row.date_format,
    missingValueAction: row.missing_value_action as QrItemDefinition["missingValueAction"],
  };
}

function toQrFormat(
  row: QrFormatDbRow,
  items: QrItemDefinition[],
): QrFormatDefinition {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    qrType: row.qr_type as QrType,
    version: row.version,
    formatCode: row.format_code,
    formatName: row.format_name,
    delimiter: row.delimiter as QrFormatDefinition["delimiter"],
    delimiterChar: row.delimiter_char,
    encoding: row.encoding as QrFormatDefinition["encoding"],
    readable: row.readable,
    issuable: row.issuable,
    validFrom: row.valid_from,
    items,
  };
}

export default async function QrFormatsPage({
  searchParams,
}: {
  searchParams?: Promise<{ qr_type?: string; readable?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const qrType = parseQrType(sp.qr_type);
  const readableFilter = parseReadableFilter(sp.readable);

  const gate = await ensureTenantAdmin();

  let formats: QrFormatDefinition[] = [];
  let liveMode = false;
  let loadError: string | null = null;

  if (!isErr(gate)) {
    liveMode = true;
    const { tenantId, supabase } = gate.data;
    const query = supabase
      .from("qr_format_definitions")
      .select(
        "id, tenant_id, qr_type, format_code, format_name, version, delimiter, delimiter_char, encoding, readable, issuable, valid_from",
      )
      .eq("tenant_id", tenantId)
      .eq("qr_type", qrType)
      .is("deleted_at", null)
      .order("version", { ascending: true })
      .limit(500);
    if (readableFilter === "readable") query.eq("readable", true);
    if (readableFilter === "unreadable") query.eq("readable", false);
    const { data: formatRows, error: formatErr } = await query;
    if (formatErr) {
      loadError = "QR フォーマットの読み込みに失敗しました。";
    } else if (formatRows && formatRows.length > 0) {
      const ids = formatRows.map((f) => (f as { id: string }).id);
      const { data: itemRows } = await supabase
        .from("qr_item_definitions")
        .select(
          "qr_format_definition_id, position, qr_item_name, target_column, required, data_type, date_format, missing_value_action",
        )
        .in("qr_format_definition_id", ids)
        .is("deleted_at", null)
        .order("position", { ascending: true });
      const itemsByFmt = new Map<string, QrItemDefinition[]>();
      for (const it of itemRows ?? []) {
        const r = it as QrItemDbRow;
        const list = itemsByFmt.get(r.qr_format_definition_id) ?? [];
        list.push(toQrItem(r));
        itemsByFmt.set(r.qr_format_definition_id, list);
      }
      formats = formatRows.map((f) => {
        const r = f as QrFormatDbRow;
        return toQrFormat(r, itemsByFmt.get(r.id) ?? []);
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
        <h2 className="text-lg font-semibold text-[var(--ink)]">QR 設定 CRUD</h2>
        <p className="text-sm text-[var(--muted)]">
          QR フォーマット (バージョン管理) と項目位置を編集します。項目順や data_type を変えるときは
          「新バージョンとして複製」を使用し、既存バージョンは温存してください (QR_SPEC §5)。
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

      <nav aria-label="QR 種別" className="flex flex-wrap gap-2">
        {QR_TYPES.map((t) => (
          <Link
            key={t.key}
            href={`/app/admin/qr-formats?qr_type=${t.key}&readable=${readableFilter}`}
            aria-current={qrType === t.key ? "page" : undefined}
            data-testid={`qr-type-tab-${t.key}`}
            className={
              "inline-flex h-12 items-center border px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] " +
              (qrType === t.key
                ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-brand-foreground)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--color-brand)]")
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="qr-readable-filter" className="text-sm font-medium text-[var(--ink)]">
          読取可否で絞り込み
        </label>
        <form action="" className="flex gap-2">
          <input type="hidden" name="qr_type" value={qrType} />
          <select
            id="qr-readable-filter"
            name="readable"
            defaultValue={readableFilter}
            className="h-12 border border-[var(--border)] bg-[var(--surface)] px-3 text-base text-[var(--ink)]"
            data-testid="qr-readable-filter"
          >
            <option value="all">すべて</option>
            <option value="readable">読取可 (work_settings 連携可能)</option>
            <option value="unreadable">読取不可</option>
          </select>
          <button
            type="submit"
            className="inline-flex h-12 items-center border border-[var(--border)] bg-[var(--surface-2)] px-4 text-sm font-medium hover:border-[var(--color-brand)]"
          >
            適用
          </button>
        </form>
      </div>

      <QrFormatsEditor qrType={qrType} initial={formats} />
    </section>
  );
}
