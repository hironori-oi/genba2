import type { Metadata } from "next";
import Link from "next/link";
import { DEMO_QR_FORMATS } from "@/lib/admin/fixtures";
import { QrReadTest } from "@/app/app/admin/qr/QrReadTest";

export const metadata: Metadata = {
  title: "QR 読取テスト (サンドボックス)",
  description:
    "GENBA QR_SPEC のパーサ実装を、テナント DB を介さずに検証するための公開サンドボックス。tenant データへはアクセスしません。",
  robots: { index: false, follow: false },
};

/**
 * Phase 2 read-test sandbox.
 *
 * This route exists outside /app on purpose: it is the *parser preview*
 * — it never touches Supabase, only the in-memory DEMO_QR_FORMATS fixture.
 * The real tenant-scoped QR Settings page lives at /app/admin/qr and is
 * gated by middleware + admin layout role check.
 *
 * Security note: there is no tenant data here. The fixtures contain only a
 * synthetic tenant id ("00000000-demo-…") and made-up item codes. This route
 * cannot SELECT/INSERT/UPDATE/DELETE anything.
 */
export default function QrReadTestSandbox() {
  const formats = DEMO_QR_FORMATS.filter((f) => f.qrType === "label").sort(
    (a, b) => a.version - b.version,
  );

  return (
    <main
      className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 lg:px-8"
      role="main"
    >
      <nav aria-label="戻る" className="text-sm">
        <Link href="/" className="text-[var(--color-brand)] underline">
          ← ホームへ戻る
        </Link>
      </nav>
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          サンドボックス (テナントデータなし)
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl">
          QR 読取テスト
        </h1>
        <p className="text-sm text-[var(--muted)]">
          QR_SPEC §5 / §8 に準拠したパーサの動作確認ページです。V1/V2 の同時解析、numeric/date エラー、列数不足、未登録 V99、readable=false の挙動を確認できます。
        </p>
      </header>
      <QrReadTest qrType="label" formats={formats} />
    </main>
  );
}
