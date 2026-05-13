import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { DEMO_QR_FORMATS } from "@/lib/admin/fixtures";
import { ReceivingFlow } from "./ReceivingFlow";

export const metadata: Metadata = { title: "入庫" };

export default async function ReceivingPage() {
  const result = await getAppSession();
  if (result.kind === "unauthenticated") {
    redirect("/login?next=/app/logi/receiving");
  }

  // Phase 3b uses the demo formats as the candidate set; Phase 4 will fetch
  // the tenant's qr_format_definitions via the anon JWT.
  const labelFormats = DEMO_QR_FORMATS.filter((f) => f.qrType === "label");

  return (
    <div className="flex flex-col gap-4" data-testid="receiving-root">
      <ReceivingFlow labelFormats={labelFormats} />
    </div>
  );
}
