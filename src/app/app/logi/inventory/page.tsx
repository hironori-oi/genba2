import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { DEMO_QR_FORMATS } from "@/lib/admin/fixtures";
import { InventoryFlow } from "./InventoryFlow";

export const metadata: Metadata = { title: "棚卸" };

type SearchParams = { mode?: string | string[] };

export default async function InventoryPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const result = await getAppSession();
  if (result.kind === "unauthenticated") {
    redirect("/login?next=/app/logi/inventory");
  }

  const sp = (await searchParams) ?? {};
  const modeParam = Array.isArray(sp.mode) ? sp.mode[0] : sp.mode;
  const startMode: "scan" | "form" = modeParam === "scan" ? "scan" : "form";

  const labelFormats = DEMO_QR_FORMATS.filter((f) => f.qrType === "label");
  const locationFormats = DEMO_QR_FORMATS.filter(
    (f) => f.qrType === "location",
  );

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="inventory-root"
      data-start-mode={startMode}
    >
      <InventoryFlow
        labelFormats={labelFormats}
        locationFormats={locationFormats}
      />
    </div>
  );
}
