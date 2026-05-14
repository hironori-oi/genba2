import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { DEMO_QR_FORMATS, DEMO_MATCH_RULES } from "@/lib/admin/fixtures";
import { PickingFlow } from "./PickingFlow";

export const metadata: Metadata = { title: "ピッキング" };

type SearchParams = { mode?: string | string[] };

export default async function PickingPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const result = await getAppSession();
  if (result.kind === "unauthenticated") {
    redirect("/login?next=/app/logi/picking");
  }

  const sp = (await searchParams) ?? {};
  const modeParam = Array.isArray(sp.mode) ? sp.mode[0] : sp.mode;
  const startMode: "scan" | "form" = modeParam === "scan" ? "scan" : "form";

  const headerFormats = DEMO_QR_FORMATS.filter((f) => f.qrType === "header");
  const lineFormats = DEMO_QR_FORMATS.filter((f) => f.qrType === "line");
  const labelFormats = DEMO_QR_FORMATS.filter((f) => f.qrType === "label");
  const matchRule =
    DEMO_MATCH_RULES.find((r) => r.businessCode === "picking") ?? null;

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="picking-root"
      data-start-mode={startMode}
    >
      <PickingFlow
        headerFormats={headerFormats}
        lineFormats={lineFormats}
        labelFormats={labelFormats}
        matchRuleLines={matchRule?.lines ?? []}
      />
    </div>
  );
}
