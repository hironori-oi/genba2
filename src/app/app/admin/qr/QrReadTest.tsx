"use client";

import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { parseAcrossVersions, type ParseResult, type QrFormatDefinition, type QrType } from "@/lib/qr";

const FAILURE_REASON_LABEL: Record<string, string> = {
  empty_input: "入力が空です",
  input_too_long: "入力が長すぎます (4096 文字超)",
  control_char: "制御文字が含まれます",
  unreadable_input: "読取不可",
  version_missing: "バージョントークンがありません",
  version_invalid: "バージョントークンが不正です",
  delimiter_missing: "区切り文字が見つかりません",
  unknown_format: "このバージョンの定義が見つかりません",
  format_unreadable: "readable=false のため読取できません",
  column_count_short: "列数が不足しています",
};

const PARSE_FIELD_ERROR_LABEL: Record<string, string> = {
  required_missing: "必須項目が欠落",
  numeric_parse_failed: "数値として解釈できません",
  date_parse_failed: "日付として解釈できません",
};

export function QrReadTest({
  qrType,
  formats,
}: {
  qrType: QrType;
  formats: QrFormatDefinition[];
}) {
  const [raw, setRaw] = useState<string>(qrType === "label" ? "V1|ITEM-2048|12|A-03-15|ORD-20260510" : "");

  const results = useMemo(
    () => (raw.trim().length === 0 ? [] : parseAcrossVersions(raw, qrType, formats)),
    [raw, qrType, formats],
  );

  return (
    <section aria-labelledby="read-test-heading" className="flex flex-col gap-3">
      <header>
        <h3 id="read-test-heading" className="text-base font-semibold text-[var(--ink)]">
          読取テスト (V1/V2 同時解析)
        </h3>
        <p className="text-sm text-[var(--muted)]">
          任意の QR 文字列を入力し、readable=true の全バージョンで一括解析します。新バージョンを追加した直後に旧 QR が引き続き読めることを確認できます。
        </p>
      </header>

      <label htmlFor="qr-raw" className="text-sm font-medium text-[var(--ink)]">
        QR 文字列
      </label>
      <textarea
        id="qr-raw"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={3}
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        className="w-full min-h-[6rem] resize-y border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-base text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        placeholder="例: V1|ITEM-A|12|A-03"
        aria-describedby="qr-raw-help"
      />
      <p id="qr-raw-help" className="text-xs text-[var(--muted)]">
        テキストはサーバへ送信されません。最大 4096 文字までです (QR_SPEC §7)。
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="md" variant="secondary" onClick={() => setRaw("")}>
          クリア
        </Button>
        <Button
          type="button"
          size="md"
          variant="ghost"
          onClick={() => setRaw("V2|ITEM-2048|12|A-03-15|ORD-20260510|LOT-A")}
        >
          サンプル V2 を入れる
        </Button>
      </div>

      <div
        data-testid="qr-read-test-results"
        aria-live="polite"
        role="status"
        className="flex flex-col gap-3"
      >
        {raw.trim().length === 0 ? (
          <p className="text-sm text-[var(--muted)]">QR 文字列を入力すると結果が表示されます。</p>
        ) : results.length === 0 ? (
          <Alert tone="warn" title="readable な定義がありません">
            この種別には readable=true のバージョンがありません。バージョン一覧から readable をオンにしてください。
          </Alert>
        ) : (
          results.map(({ format, result }) => (
            <VersionResult key={format.id} format={format} result={result} />
          ))
        )}
      </div>
    </section>
  );
}

function VersionResult({
  format,
  result,
}: {
  format: QrFormatDefinition;
  result: ParseResult;
}) {
  const versionId = `qr-result-v${format.version}`;
  return (
    <article
      aria-labelledby={versionId}
      data-testid={`qr-result-v${format.version}`}
      data-status={result.ok ? "success" : "failure"}
      className={
        "border bg-[var(--surface)] p-4 " +
        (result.ok ? "border-[var(--color-ok)]" : "border-[var(--color-bad)]")
      }
    >
      <header className="flex flex-wrap items-baseline gap-2">
        <h4 id={versionId} className="font-mono text-base font-semibold text-[var(--ink)]">
          V{format.version}
        </h4>
        <span className="text-sm text-[var(--muted)]">{format.formatName}</span>
        <span
          className={
            "ml-auto inline-flex items-center rounded-full border px-2 py-0.5 text-xs " +
            (result.ok
              ? "border-[var(--color-ok)] text-[var(--color-ok)]"
              : "border-[var(--color-bad)] text-[var(--color-bad)]")
          }
        >
          {result.ok ? "成功" : "失敗"}
        </span>
      </header>

      {result.ok ? (
        <div className="mt-3 flex flex-col gap-2">
          {result.warnings.length > 0 ? (
            <p className="text-xs text-[var(--color-warn)]">
              警告: {result.warnings.map((w) => FAILURE_REASON_LABEL[w] ?? w).join(", ")}
            </p>
          ) : null}
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {result.fields.map((field) => (
              <div key={field.position} className="border border-[var(--border)] bg-[var(--surface-2)] p-2">
                <dt className="font-mono text-xs uppercase tracking-wide text-[var(--muted)]">
                  #{field.position} {field.itemName} ({field.targetColumn})
                </dt>
                <dd
                  className={
                    "mt-1 font-mono text-sm " +
                    (field.status === "error" ? "text-[var(--color-bad)]" : "text-[var(--ink)]")
                  }
                >
                  {field.status === "ok"
                    ? field.value === null
                      ? "(空)"
                      : String(field.value)
                    : `${PARSE_FIELD_ERROR_LABEL[field.reason] ?? field.reason} — raw="${field.rawValue}"`}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-[var(--color-bad)]">
            {FAILURE_REASON_LABEL[result.reason] ?? result.reason}
          </p>
          {result.versionToken ? (
            <p className="mt-1 font-mono text-xs text-[var(--muted)]">
              version_token={result.versionToken}
            </p>
          ) : null}
        </div>
      )}
    </article>
  );
}
