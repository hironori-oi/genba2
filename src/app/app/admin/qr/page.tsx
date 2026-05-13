import Link from "next/link";
import { DEMO_QR_FORMATS } from "@/lib/admin/fixtures";
import { QrReadTest } from "./QrReadTest";

export default async function QrSettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ qr_type?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const selectedType = sp.qr_type === "header" || sp.qr_type === "line" || sp.qr_type === "label"
    ? sp.qr_type
    : "label";

  const formatsForType = DEMO_QR_FORMATS.filter((f) => f.qrType === selectedType).sort(
    (a, b) => a.version - b.version,
  );

  return (
    <section aria-labelledby="qr-settings-heading" className="flex flex-col gap-6">
      <div>
        <h2 id="qr-settings-heading" className="text-lg font-semibold text-[var(--ink)]">
          QR フォーマット + 読取テスト
        </h2>
        <p className="text-sm text-[var(--muted)]">
          現品ラベル / ヘッダー / 明細 ごとにバージョンを追加し、各バージョンの解析結果を同一画面で確認します。
          QR_SPEC §5 に従い、項目順 / 区切り / data_type 変更時は必ず新バージョンを発行してください。
        </p>
      </div>

      <nav aria-label="QR 種別" className="flex flex-wrap gap-2">
        {(
          [
            { key: "header", label: "ヘッダー (header)" },
            { key: "line", label: "明細 (line)" },
            { key: "label", label: "現品ラベル (label)" },
          ] as const
        ).map((t) => (
          <Link
            key={t.key}
            href={`/app/admin/qr?qr_type=${t.key}`}
            aria-current={selectedType === t.key ? "page" : undefined}
            className={
              "inline-flex h-11 items-center border px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] " +
              (selectedType === t.key
                ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-brand-foreground)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--color-brand)]")
            }
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <section aria-labelledby="versions-heading" className="flex flex-col gap-3">
        <h3 id="versions-heading" className="text-base font-semibold text-[var(--ink)]">
          バージョン一覧
        </h3>
        <div className="overflow-x-auto border border-[var(--border)]">
          <table className="min-w-full divide-y divide-[var(--border)] text-sm">
            <thead className="bg-[var(--surface-2)] text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th scope="col" className="px-3 py-2">バージョン</th>
                <th scope="col" className="px-3 py-2">フォーマット名</th>
                <th scope="col" className="px-3 py-2">区切り</th>
                <th scope="col" className="px-3 py-2">readable</th>
                <th scope="col" className="px-3 py-2">issuable</th>
                <th scope="col" className="px-3 py-2">有効日</th>
                <th scope="col" className="px-3 py-2">項目数</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] bg-[var(--surface)]">
              {formatsForType.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-[var(--muted)]">
                    この種別にはまだバージョンが登録されていません。
                  </td>
                </tr>
              ) : (
                formatsForType.map((f) => (
                  <tr key={f.id}>
                    <td className="px-3 py-2 font-mono text-[var(--ink)]">V{f.version}</td>
                    <td className="px-3 py-2 text-[var(--ink)]">{f.formatName}</td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--muted)]">
                      {f.delimiter}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs " +
                          (f.readable
                            ? "border-[var(--color-ok)] text-[var(--color-ok)]"
                            : "border-[var(--color-bad)] text-[var(--color-bad)]")
                        }
                      >
                        {f.readable ? "可" : "不可"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs " +
                          (f.issuable
                            ? "border-[var(--color-ok)] text-[var(--color-ok)]"
                            : "border-[var(--border)] text-[var(--muted)]")
                        }
                      >
                        {f.issuable ? "発行候補" : "発行対象外"}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-[var(--muted)]">
                      {f.validFrom}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-[var(--ink)]">
                      {f.items.length}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <QrReadTest qrType={selectedType} formats={formatsForType} />
    </section>
  );
}
