import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { DEMO_QR_FORMATS } from "@/lib/admin/fixtures";
import { ReceivingFlow } from "./ReceivingFlow";
import { ReceivingScanShell } from "./ReceivingScanShell";

export const metadata: Metadata = { title: "入庫" };

type SearchParams = { mode?: string | string[] };

export default async function ReceivingPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const result = await getAppSession();
  if (result.kind === "unauthenticated") {
    redirect("/login?next=/app/logi/receiving");
  }

  const sp = (await searchParams) ?? {};
  const modeParam = Array.isArray(sp.mode) ? sp.mode[0] : sp.mode;
  const scanMode = modeParam === "scan";

  // Phase 3b uses the demo formats as the candidate set; Phase 4 will fetch
  // the tenant's qr_format_definitions via the anon JWT.
  const labelFormats = DEMO_QR_FORMATS.filter((f) => f.qrType === "label");

  return (
    <div className="flex flex-col gap-4" data-testid="receiving-root">
      {scanMode ? (
        <ReceivingScanShell labelFormats={labelFormats} startMode="scan" />
      ) : (
        <ReceivingFlow labelFormats={labelFormats} />
      )}
    </div>
  );
}
