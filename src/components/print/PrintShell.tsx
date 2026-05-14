"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PaperSize, PrintReportKind } from "@/lib/print/types";

/**
 * Phase 6c — on-screen chrome for the print preview routes.
 *
 * Server pages render this client component once around the body. It exposes
 * the paper-size toggle (A4 / 80mm), the OS print button, and a back link.
 * The `<style>` block here emits the dynamic `@page` rule so changing the
 * paper toggle re-renders the @page sizing without a full client bundle.
 *
 * Everything inside `.print-screen-only` is hidden by `@media print` (see
 * print.css), so the OS-driven print output contains only the report body.
 */
export function PrintShell({
  paper,
  reportKind,
  basePath,
  searchString,
  children,
}: {
  paper: PaperSize;
  reportKind: PrintReportKind;
  basePath: string;
  searchString: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  const pageSizeRule =
    paper === "80mm"
      ? "@page { size: 80mm auto; margin: 4mm; }"
      : "@page { size: A4 portrait; margin: 12mm; }";

  const setPaper = useCallback(
    (next: PaperSize) => {
      const params = new URLSearchParams(searchString);
      params.set("paper", next);
      router.replace(`${basePath}?${params.toString()}`);
    },
    [basePath, router, searchString],
  );

  const onPrint = useCallback(() => {
    if (typeof window !== "undefined") window.print();
  }, []);

  return (
    <div data-paper={paper} data-testid={`print-root-${reportKind}`}>
      <style
        // Dynamic @page rule. The static print.css keeps the default A4
        // declaration; this one wins because it is emitted after print.css
        // in the document order.
        dangerouslySetInnerHTML={{ __html: pageSizeRule }}
      />
      <div
        className="print-screen-only"
        role="region"
        aria-label="印刷操作"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          alignItems: "center",
          padding: "0.75rem 1rem",
          borderBottom: "1px solid var(--border, #d3d8db)",
          background: "var(--surface-2, #f5f7f5)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <fieldset
          style={{
            border: "1px solid var(--border, #d3d8db)",
            padding: "0.25rem 0.5rem",
            display: "inline-flex",
            gap: "0.5rem",
            alignItems: "center",
          }}
          aria-label="用紙サイズ"
        >
          <legend style={{ padding: "0 0.25rem", fontSize: "0.75rem" }}>用紙</legend>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 56,
              minWidth: 56,
              padding: "0 0.5rem",
              gap: "0.25rem",
            }}
          >
            <input
              type="radio"
              name="paper"
              value="a4"
              checked={paper === "a4"}
              onChange={() => setPaper("a4")}
              data-testid="print-paper-a4"
              aria-label="A4 用紙"
              style={{ width: 24, height: 24 }}
            />
            <span>A4</span>
          </label>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              minHeight: 56,
              minWidth: 56,
              padding: "0 0.5rem",
              gap: "0.25rem",
            }}
          >
            <input
              type="radio"
              name="paper"
              value="80mm"
              checked={paper === "80mm"}
              onChange={() => setPaper("80mm")}
              data-testid="print-paper-80mm"
              aria-label="80mm サーマル"
              style={{ width: 24, height: 24 }}
            />
            <span>80mm</span>
          </label>
        </fieldset>
        <button
          type="button"
          onClick={onPrint}
          data-testid="print-button"
          aria-label="印刷ダイアログを開く"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 56,
            minWidth: 56,
            padding: "0 1rem",
            background: "var(--color-brand, #16715d)",
            color: "var(--color-brand-foreground, #ffffff)",
            border: "1px solid var(--color-brand, #16715d)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          印刷
        </button>
        <Link
          href="/app/logi/history"
          data-testid="print-back-link"
          aria-label="履歴一覧へ戻る"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 56,
            minWidth: 56,
            padding: "0 1rem",
            border: "1px solid var(--border, #d3d8db)",
            color: "var(--ink, #14191c)",
            background: "var(--surface, #ffffff)",
            textDecoration: "none",
          }}
        >
          戻る
        </Link>
      </div>
      <main id="main" className="print-page">
        {children}
      </main>
    </div>
  );
}
