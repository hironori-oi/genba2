"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ensureSystemAdmin } from "@/lib/admin/ensure-system-admin";
import { err, ok, isErr, type AdminActionResult } from "@/lib/admin/shared/result";

const subscriptionSchema = z.object({
  tenantId: z.string().uuid(),
  plan: z.enum(["logi", "works", "both"]),
  maxUsers: z.number().int().min(1).max(100_000),
  maxScansPerMonth: z.number().int().min(0).max(100_000_000),
  planStartedAt: z.string().nullable().optional(),
  planEndedAt: z.string().nullable().optional(),
});

export type UpdateSubscriptionResult = AdminActionResult<{ tenantId: string }>;

export async function updateSubscriptionAction(input: {
  tenantId: string;
  plan: "logi" | "works" | "both";
  maxUsers: number;
  maxScansPerMonth: number;
  planStartedAt?: string | null;
  planEndedAt?: string | null;
}): Promise<UpdateSubscriptionResult> {
  const guard = await ensureSystemAdmin();
  if (isErr(guard)) return guard;
  const { supabase } = guard.data;

  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") fieldErrors[key] = issue.message;
    }
    return err("validation", "入力内容を確認してください。", fieldErrors);
  }
  const v = parsed.data;

  const { error } = await supabase
    .from("tenant_subscriptions")
    .update({
      plan: v.plan,
      max_users: v.maxUsers,
      max_scans_per_month: v.maxScansPerMonth,
      plan_started_at: v.planStartedAt || null,
      plan_ended_at: v.planEndedAt || null,
    })
    .eq("tenant_id", v.tenantId);
  if (error) return err("rls", error.message);

  revalidatePath("/app/admin/tenants");
  return ok({ tenantId: v.tenantId });
}
