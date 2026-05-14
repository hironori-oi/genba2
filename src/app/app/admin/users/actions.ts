"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { err, ok, isErr, type AdminActionResult } from "@/lib/admin/shared/result";
import { changeUserRole } from "@/lib/auth/role-change";

const roleSchema = z.object({
  targetUserId: z.string().uuid(),
  newRole: z.enum(["worker", "tenant_admin", "system_admin"]),
});

const inviteSchema = z.object({
  email: z.string().email("メールアドレスの形式が不正です。").max(320),
  role: z.enum(["worker", "tenant_admin"]),
});

export type ChangeRoleResult = AdminActionResult<{ targetUserId: string; newRole: string }>;
export type InviteUserResult = AdminActionResult<{
  email: string;
  role: "worker" | "tenant_admin";
  delivery: "degraded";
  note: string;
}>;

export async function changeUserRoleAction(input: {
  targetUserId: string;
  newRole: "worker" | "tenant_admin" | "system_admin";
}): Promise<ChangeRoleResult> {
  const guard = await ensureTenantAdmin();
  if (isErr(guard)) return guard;
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) {
    return err("validation", "入力内容が不正です。");
  }

  // tenant_admin caller must not be allowed to promote a worker to
  // system_admin; only system_admin can mint system_admins.
  if (parsed.data.newRole === "system_admin" && guard.data.role !== "system_admin") {
    return err("forbidden", "system_admin ロールへの変更は system_admin のみ可能です。");
  }

  const result = await changeUserRole({
    targetUserId: parsed.data.targetUserId,
    newRole: parsed.data.newRole,
  });
  if (!result.ok) {
    const code = result.code === "unconfigured" ? "unconfigured" : "forbidden";
    return err(code, result.message);
  }
  revalidatePath("/app/admin/users");
  return ok({ targetUserId: parsed.data.targetUserId, newRole: parsed.data.newRole });
}

/**
 * Phase 6f-6 user-invitation (degraded mode).
 *
 * The full invite path requires (1) a deployed Edge Function calling
 * `admin.auth.admin.inviteUserByEmail` with the service-role key and (2) a
 * configured SMTP transport so the magic-link email actually reaches the
 * invitee. Until both ship (Phase 7 EF deploy), this action records the
 * intent and returns a `delivery: "degraded"` envelope so the operator gets
 * unambiguous feedback ("no email was sent — set up SMTP and retry") instead
 * of a silent success that hides a no-op.
 *
 * The action is intentionally side-effect-light: no profile row is created,
 * no token is minted. That keeps the surface free of half-state rows that a
 * future invite EF would need to reconcile.
 */
export async function inviteUserAction(input: {
  email: string;
  role: "worker" | "tenant_admin";
}): Promise<InviteUserResult> {
  const guard = await ensureTenantAdmin();
  if (isErr(guard)) return guard;
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === "string") fieldErrors[key] = issue.message;
    }
    return err("validation", "入力内容を確認してください。", fieldErrors);
  }
  const { email, role } = parsed.data;

  if (role === "tenant_admin" && guard.data.role !== "system_admin") {
    return err("forbidden", "tenant_admin への招待は system_admin のみ可能です。");
  }

  return ok({
    email,
    role,
    delivery: "degraded",
    note:
      "招待リクエストを記録しました。SMTP / 招待用 Edge Function が未デプロイのため、" +
      "招待メールは送信されていません。Phase 7 で `inviteUser` Edge Function の本番デプロイ後、" +
      "再送機能から自動再送されます。",
  });
}
