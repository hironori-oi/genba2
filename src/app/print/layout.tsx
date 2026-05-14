import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "印刷プレビュー", template: "%s | GENBA 印刷" },
  robots: { index: false, follow: false },
};

/**
 * Phase 6c — print preview layout.
 *
 * Intentionally bare: no AppShell / sidebar / page nav, so the OS print
 * output contains only the report body. Auth is enforced inside each
 * `[report]/page.tsx` via getAppSession() — the layout itself stays render-
 * only because the printable report does not need a server-side gate at
 * this level.
 */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
