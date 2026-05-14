import {
  CSV_TEMPLATE_LABELS,
  CSV_TEMPLATE_MASTERS,
  type CsvTemplateMaster,
} from "@/lib/csv/templates";

/**
 * Phase 5e-3 CSV template download links (architect §3.6).
 *
 * Each link points at /api/admin/csv-template/[master]/[encoding] and
 * relies on the route handler's Content-Disposition: attachment header
 * to trigger a download. Native <a download> is sufficient — no client
 * JS — so this component stays a server component.
 *
 * 56×56 touch targets are preserved (h-14 / px-4); each link's
 * aria-label spells out master + encoding for screen readers.
 */

const ENCODINGS: ReadonlyArray<{
  value: "utf8" | "shift_jis";
  label: string;
}> = [
  { value: "utf8", label: "UTF-8" },
  { value: "shift_jis", label: "Shift_JIS" },
];

export function CsvTemplateDownloads() {
  return (
    <section
      aria-labelledby="csv-templates-heading"
      className="flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)] p-4"
      data-component="csv-template-downloads"
    >
      <header className="flex flex-col gap-1">
        <h3
          id="csv-templates-heading"
          className="text-base font-semibold text-[var(--ink)]"
        >
          マスタ CSV テンプレ ダウンロード
        </h3>
        <p className="text-sm text-[var(--muted)]">
          5 マスタ × 2 エンコード (UTF-8 / Shift_JIS) のヘッダ専用 CSV
          をダウンロードできます。Excel で開いて行を追加し、再インポートする運用を想定しています。
        </p>
      </header>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {CSV_TEMPLATE_MASTERS.map((master: CsvTemplateMaster) => (
          <li
            key={master}
            className="flex flex-col gap-2 border border-[var(--border)] bg-[var(--surface-2)] p-3"
          >
            <h4 className="text-sm font-semibold text-[var(--ink)]">
              {CSV_TEMPLATE_LABELS[master]}
              <span className="ml-2 font-mono text-[11px] text-[var(--muted)]">
                {master}
              </span>
            </h4>
            <div className="flex flex-wrap gap-2">
              {ENCODINGS.map((enc) => (
                <a
                  key={enc.value}
                  href={`/api/admin/csv-template/${master}/${enc.value}`}
                  data-testid={`csv-template-${master}-${enc.value}`}
                  aria-label={`${CSV_TEMPLATE_LABELS[master]} (${enc.label}) のテンプレ CSV をダウンロード`}
                  download
                  className="inline-flex h-14 min-h-14 min-w-14 items-center justify-center gap-2 border border-[var(--border)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--ink)] hover:border-[var(--color-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                >
                  <span aria-hidden>⬇</span>
                  {enc.label}
                </a>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
