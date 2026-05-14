import { redirect } from "next/navigation";
export const metadata = { title: "報告書 / 月次" };
export default function MonthlyRedirect() {
  redirect("/app/admin/reports?tab=monthly");
}
