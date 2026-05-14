import type { Metadata } from "next";
import { Alert } from "@/components/ui/Alert";
import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { isErr } from "@/lib/admin/shared/result";
import {
  CorrectionsPendingList,
  type PendingCorrectionRow,
} from "./CorrectionsPendingList";

export const metadata: Metadata = { title: "未承認の訂正" };

/**
 * Phase 5e-3 /app/admin/corrections-pending (architect §3.5.5).
 *
 * Lists corrections_audit rows where approved_by IS NULL for the caller's
 * tenant. Strictly opt-in via work_settings.correction_approval=true; this
 * page is harmless to access when correction_approval is off because the
 * RPCs auto-fill approved_by in that case and the list is empty.
 */
export default async function CorrectionsPendingPage() {
  const guard = await ensureTenantAdmin();
  if (isErr(guard)) {
    return (
      <Alert tone="error" title="アクセスできません">
        {guard.message}
      </Alert>
    );
  }
  const { supabase, tenantId } = guard.data;

  const { data, error } = await supabase
    .from("corrections_audit")
    .select(
      "id, business_code, target_table, old_record_id, new_record_id, actor_id, reason, created_at",
    )
    .eq("tenant_id", tenantId)
    .is("approved_by", null)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return (
      <Alert tone="error" title="読込エラー">
        {error.message}
      </Alert>
    );
  }

  const rows: PendingCorrectionRow[] = (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      businessCode: String(row.business_code ?? ""),
      targetTable: String(row.target_table ?? ""),
      oldRecordId: String(row.old_record_id ?? ""),
      newRecordId: String(row.new_record_id ?? ""),
      actorId: String(row.actor_id ?? ""),
      reason: String(row.reason ?? ""),
      createdAt: String(row.created_at ?? ""),
    };
  });

  return (
    <div className="flex flex-col gap-4" data-page="corrections-pending">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          未承認の訂正
        </h2>
        <p className="text-sm text-[var(--muted)]">
          <code className="font-mono">work_settings.correction_approval=true</code>
          のテナントで、リーダー (tenant_admin) が承認を必要とする訂正の一覧です。承認すると corrections_audit の
          <code className="font-mono"> approved_by</code> / <code className="font-mono">approved_at</code>
          が記録されます。
        </p>
      </header>
      <CorrectionsPendingList rows={rows} />
    </div>
  );
}
