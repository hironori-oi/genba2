import { redirect } from "next/navigation";
export const metadata = { title: "報告書 / 日次" };
export default function DailyRedirect() {
  redirect("/app/admin/reports?tab=daily");
}
