import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { DEMO_QR_FORMATS } from "@/lib/admin/fixtures";
import { InventoryFlow } from "./InventoryFlow";

export const metadata: Metadata = { title: "棚卸" };

export default async function InventoryPage() {
  const result = await getAppSession();
  if (result.kind === "unauthenticated") {
    redirect("/login?next=/app/logi/inventory");
  }

  const labelFormats = DEMO_QR_FORMATS.filter((f) => f.qrType === "label");
  const locationFormats = DEMO_QR_FORMATS.filter(
    (f) => f.qrType === "location",
  );

  return (
    <div className="flex flex-col gap-4" data-testid="inventory-root">
      <InventoryFlow
        labelFormats={labelFormats}
        locationFormats={locationFormats}
      />
    </div>
  );
}
