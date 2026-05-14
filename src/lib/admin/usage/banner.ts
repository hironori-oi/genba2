import "server-only";

import { createClient } from "@/lib/supabase/server";
import { selectMonthlyUsage } from "@/lib/admin/usage/select";
import type { AppRole } from "@/lib/auth/session";

export type UsageBannerSignal = {
  warning: "warn" | "exceeded";
  percent: number;
  used: number;
  cap: number;
};

/**
 * Resolve the AppShell-level monthly scan-cap banner for the caller's tenant.
 *
 * Returns null when:
 *  - role is worker (banner is admin-facing only)
 *  - tenantId is unresolved
 *  - cap is unset / 0 (treated as unlimited)
 *  - utilisation is below 80%
 *  - any error: AppShell must never crash on a side-channel signal
 */
export async function resolveUsageBannerSignal(
  role: AppRole,
  tenantId: string | null,
): Promise<UsageBannerSignal | null> {
  if (!tenantId) return null;
  if (role !== "tenant_admin" && role !== "system_admin") return null;
  try {
    const supabase = await createClient();
    const { summary, error } = await selectMonthlyUsage(supabase, tenantId);
    if (error || !summary) return null;
    if (summary.warning === "ok") return null;
    if (!summary.cap || summary.cap <= 0) return null;
    return {
      warning: summary.warning,
      percent: summary.percent,
      used: summary.totalScans,
      cap: summary.cap,
    };
  } catch {
    return null;
  }
}
