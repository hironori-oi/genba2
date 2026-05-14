import { redirect } from "next/navigation";

export const metadata = { title: "報告書" };

// Architect §C.6d compatibility route. The admin /app/admin/reports route
// hosts the actual implementation (and the worker gate via admin layout).
export default function ReportsIndex() {
  redirect("/app/admin/reports?tab=daily");
}
