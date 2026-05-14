"use client";

/**
 * Phase 3b — CSV upload button.
 *
 * Thin client over the Edge Function endpoints owned by the BACKEND worker.
 * Path map:
 *   movement-plan       → /functions/v1/movement-csv-import?kind=plan
 *   movement-plan-line  → /functions/v1/movement-csv-import?kind=plan_line
 *   inventory-plan      → /functions/v1/inventory-csv-import?kind=plan
 *   inventory-plan-line → /functions/v1/inventory-csv-import?kind=plan_line
 *
 * The EF is fronted by Supabase auth — the request includes the user's
 * anon JWT cookie (via @supabase/ssr's session). For Phase 3b we expose only
 * the UX shell; if the EF endpoint is missing we surface a graceful error.
 */

import { useId, useRef, useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { validateCsvFile, normalizeImportError } from "@/lib/csv/import-client";

export type CsvKind =
  | "movement-plan"
  | "movement-plan-line"
  | "inventory-plan"
  | "inventory-plan-line";

export type CsvUploadResult = {
  kind: CsvKind;
  fileName: string;
  inserted: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
};

type Props = {
  kind: CsvKind;
  onUploaded?: (result: CsvUploadResult) => void;
  /**
   * Override the supabase function base URL. Defaults to the
   * NEXT_PUBLIC_SUPABASE_URL-driven `/functions/v1/...` path. Useful for
   * tests / local mocking.
   */
  endpointBase?: string;
  /**
   * Skip the network call (used when no Supabase env is configured). The
   * component still validates the file and reports a fake "demo" result so
   * the UI surface remains exercisable in CI.
   */
  demoMode?: boolean;
};

const PATH_FOR_KIND: Record<CsvKind, string> = {
  "movement-plan": "movement-csv-import?kind=plan",
  "movement-plan-line": "movement-csv-import?kind=plan_line",
  "inventory-plan": "inventory-csv-import?kind=plan",
  "inventory-plan-line": "inventory-csv-import?kind=plan_line",
};

const LABEL_FOR_KIND: Record<CsvKind, string> = {
  "movement-plan": "移動計画 CSV を取込",
  "movement-plan-line": "移動計画明細 CSV を取込",
  "inventory-plan": "棚卸計画 CSV を取込",
  "inventory-plan-line": "棚卸計画明細 CSV を取込",
};

function functionBase(override?: string): string {
  if (override) return override.replace(/\/$/, "");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) return "";
  return `${url.replace(/\/$/, "")}/functions/v1`;
}

export function CsvUploadButton({
  kind,
  onUploaded,
  endpointBase,
  demoMode = false,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<CsvUploadResult | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setResult(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const validation = validateCsvFile(file);
    if (!validation.ok) {
      setError({ code: validation.reason, message: validation.message });
      return;
    }

    startTransition(async () => {
      try {
        if (demoMode) {
          // Demo path: simulate a success so QA flows can render the
          // success Alert without provisioning Supabase credentials.
          await new Promise((r) => setTimeout(r, 250));
          const fake: CsvUploadResult = {
            kind,
            fileName: file.name,
            inserted: 0,
            skipped: 0,
            errors: [],
          };
          setResult(fake);
          onUploaded?.(fake);
          return;
        }

        const base = functionBase(endpointBase);
        if (!base) {
          throw new Error("Supabase 接続情報が未設定のため CSV を送信できません");
        }
        const url = `${base}/${PATH_FOR_KIND[kind]}`;
        const form = new FormData();
        form.append("file", file);

        const res = await fetch(url, {
          method: "POST",
          body: form,
          credentials: "include",
        });
        const json = (await res.json().catch(() => ({}))) as unknown;
        if (!res.ok) {
          throw json;
        }
        const parsed = json as Partial<CsvUploadResult>;
        const ok: CsvUploadResult = {
          kind,
          fileName: file.name,
          inserted: typeof parsed.inserted === "number" ? parsed.inserted : 0,
          skipped: typeof parsed.skipped === "number" ? parsed.skipped : 0,
          errors: Array.isArray(parsed.errors) ? parsed.errors : [],
        };
        setResult(ok);
        onUploaded?.(ok);
      } catch (err) {
        setError(normalizeImportError(err));
      } finally {
        // reset the input so re-selecting the same file fires onChange again.
        if (inputRef.current) inputRef.current.value = "";
      }
    });
  };

  return (
    <div className="flex flex-col gap-2" data-testid={`csv-upload-${kind}`}>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="text/csv,.csv,application/vnd.ms-excel"
        onChange={handleChange}
        className="sr-only"
        aria-label={LABEL_FOR_KIND[kind]}
        aria-describedby={`${inputId}-hint`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={handleClick}
          disabled={pending}
          aria-label={LABEL_FOR_KIND[kind]}
        >
          <Upload aria-hidden className="h-5 w-5" />
          {pending ? "アップロード中…" : LABEL_FOR_KIND[kind]}
        </Button>
        {fileName ? (
          <span
            className="font-mono text-xs text-[var(--muted)]"
            data-testid={`csv-upload-filename-${kind}`}
          >
            {fileName}
          </span>
        ) : null}
      </div>
      <p id={`${inputId}-hint`} className="text-xs text-[var(--muted)]">
        UTF-8 / Shift_JIS の CSV を受付けます (最大 10MB)。
      </p>

      {error ? (
        <Alert tone="error" title="取込エラー">
          [{error.code}] {error.message}
        </Alert>
      ) : null}
      {result ? (
        <Alert tone="ok" title="取込完了">
          {result.inserted} 件登録 / {result.skipped} 件スキップ。
          {result.errors.length > 0
            ? ` ${result.errors.length} 件のエラーがあります。`
            : ""}
        </Alert>
      ) : null}
    </div>
  );
}
