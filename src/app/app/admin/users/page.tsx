import type { Metadata } from "next";
import { Alert } from "@/components/ui/Alert";
import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { isErr } from "@/lib/admin/shared/result";
import { UsersList, type UserRow } from "./UsersList";
import { UserInviteForm } from "./UserInviteForm";

export const metadata: Metadata = { title: "ユーザー管理" };
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const guard = await ensureTenantAdmin();
  if (isErr(guard)) {
    return (
      <Alert tone="error" title="アクセスできません">
        {guard.message}
      </Alert>
    );
  }
  const { supabase, tenantId, userId, role } = guard.data;

  // RLS handles cross-tenant filtering: `profiles_select_same_tenant`
  // restricts SELECT to rows where tenant_id = current. Adding the
  // explicit equality here gives a deterministic query plan.
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, display_name, tenant_id")
    .eq("tenant_id", tenantId)
    .order("display_name", { ascending: true });

  if (error) {
    return (
      <Alert tone="error" title="読込エラー">
        {error.message}
      </Alert>
    );
  }

  const profiles = (data ?? []) as Array<{
    id: string;
    role: string;
    display_name: string | null;
    tenant_id: string;
  }>;

  const rows: UserRow[] = profiles.map((p) => ({
    id: p.id,
    displayName: p.display_name,
    role:
      p.role === "tenant_admin" || p.role === "system_admin"
        ? (p.role as "tenant_admin" | "system_admin")
        : "worker",
    email: null,
    isSelf: p.id === userId,
  }));

  // SMTP availability is gated on smtp_host (a non-secret column the client
  // CAN read). smtp_password is column-revoked (RLS-606) so it cannot be
  // probed from the page renderer; we treat host presence as the canonical
  // "configured" signal because the Edge Function path will error out
  // without one regardless of password presence.
  const smtpRes = await supabase
    .from("notification_preferences")
    .select("smtp_host")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const smtpConfigured = Boolean(
    smtpRes.data && (smtpRes.data as { smtp_host?: string | null }).smtp_host,
  );

  return (
    <section className="flex flex-col gap-4" data-page="admin-users">
      <header className="flex flex-col gap-1">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          Phase 6f
        </p>
        <h2 className="text-xl font-semibold text-[var(--ink)]">ユーザー管理</h2>
        <p className="text-sm text-[var(--muted)]">
          自テナントのユーザー一覧です。ロール変更時はリフレッシュトークンを失効させ、
          対象ユーザーは次回ログインで新ロールを取得します。
          他テナントのユーザーは RLS によって表示されません。
        </p>
      </header>
      <UserInviteForm
        smtpConfigured={smtpConfigured}
        canPromoteTenantAdmin={role === "system_admin"}
      />
      <UsersList rows={rows} canPromoteSystemAdmin={role === "system_admin"} />
    </section>
  );
}
