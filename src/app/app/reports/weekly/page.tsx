import { redirect } from "next/navigation";
export const metadata = { title: "報告書 / 週次" };
export default function WeeklyRedirect() {
  redirect("/app/admin/reports?tab=weekly");
}
