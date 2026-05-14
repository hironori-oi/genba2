import type { Metadata } from "next";
import { Alert } from "@/components/ui/Alert";
import { ensureSystemAdmin } from "@/lib/admin/ensure-system-admin";
import { isErr } from "@/lib/admin/shared/result";
import { TenantsEditor, type TenantRow } from "./TenantsEditor";

export const metadata: Metadata = { title: "テナント管理" };
export const dynamic = "force-dynamic";

/**
 * Phase 6f-5 — /app/admin/tenants (system_admin only).
 *
 * Defense in depth: middleware blocks tenant_admin at the route prefix
 * (`SYSTEM_ADMIN_ONLY_PREFIXES`), and the server component re-checks
 * here via ensureSystemAdmin. Server actions in this directory must
 * also call ensureSystemAdmin (architect §C.6f-5).
 */
export default async function AdminTenantsPage() {
  const guard = await ensureSystemAdmin();
  if (isErr(guard)) {
    return (
      <Alert tone="error" title="アクセスできません">
        {guard.message}
      </Alert>
    );
  }
  const { supabase } = guard.data;

  const [tenantsRes, subsRes] = await Promise.all([
    supabase.from("tenants").select("id, name, slug, created_at").order("created_at", { ascending: true }),
    supabase
      .from("tenant_subscriptions")
      .select(
        "tenant_id, plan, max_users, max_scans_per_month, plan_started_at, plan_ended_at",
      ),
  ]);

  if (tenantsRes.error) {
    return (
      <Alert tone="error" title="読込エラー">
        {tenantsRes.error.message}
      </Alert>
    );
  }
  if (subsRes.error) {
    return (
      <Alert tone="error" title="読込エラー">
        {subsRes.error.message}
      </Alert>
    );
  }

  const subsByTenant = new Map<string, Record<string, unknown>>();
  for (const s of subsRes.data ?? []) {
    const row = s as Record<string, unknown>;
    subsByTenant.set(String(row.tenant_id), row);
  }

  const rows: TenantRow[] = (tenantsRes.data ?? []).map((t) => {
    const tenant = t as Record<string, unknown>;
    const tenantId = String(tenant.id);
    const sub = subsByTenant.get(tenantId);
    const planRaw = String(sub?.plan ?? "logi");
    const plan: TenantRow["plan"] =
      planRaw === "works" || planRaw === "both" ? planRaw : "logi";
    return {
      tenantId,
      name: String(tenant.name ?? ""),
      slug: String(tenant.slug ?? ""),
      plan,
      maxUsers: Number(sub?.max_users ?? 10),
      maxScansPerMonth: Number(sub?.max_scans_per_month ?? 50_000),
      planStartedAt: sub?.plan_started_at ? String(sub.plan_started_at) : null,
      planEndedAt: sub?.plan_ended_at ? String(sub.plan_ended_at) : null,
    };
  });

  return (
    <section className="flex flex-col gap-4" data-page="admin-tenants">
      <header className="flex flex-col gap-1">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          Phase 6f — system_admin only
        </p>
        <h2 className="text-xl font-semibold text-[var(--ink)]">テナント管理</h2>
        <p className="text-sm text-[var(--muted)]">
          テナントの利用業務 / ユーザー上限 / 月間スキャン上限 / プラン期間を管理します。
          tenant_admin はこの画面にアクセスできません (middleware で system_admin only にハードゲート)。
        </p>
      </header>
      <TenantsEditor rows={rows} />
    </section>
  );
}
