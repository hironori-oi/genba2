import "server-only";

import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/env";

export type AppRole = "worker" | "tenant_admin" | "system_admin";

export type AppSession = {
  userId: string;
  email: string | null;
  tenantId: string | null;
  role: AppRole;
  displayName: string | null;
};

export type SessionResult =
  | { kind: "ok"; session: AppSession }
  | { kind: "unauthenticated" }
  | { kind: "unconfigured" };

function readClaim(meta: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!meta) return null;
  const v = meta[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function parseRole(value: string | null): AppRole {
  if (value === "tenant_admin" || value === "system_admin") return value;
  return "worker";
}

export async function getAppSession(): Promise<SessionResult> {
  if (!supabaseConfigured()) return { kind: "unconfigured" };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return { kind: "unauthenticated" };

  const user = data.user;
  // Authorization claims live in app_metadata (`raw_app_meta_data` on the DB
  // side). NEVER read tenant_id/role from user_metadata — that path is
  // client-writable via the Supabase JS SDK and is a privilege-escalation
  // sink. See ARCHITECTURE §4 RLS-008 and SECURITY-AUDIT-2026-05-10.
  const appMeta = (user.app_metadata ?? null) as Record<string, unknown> | null;
  const tenantId = readClaim(appMeta, "tenant_id");
  const role = parseRole(readClaim(appMeta, "role"));
  const displayName =
    readClaim(user.user_metadata as Record<string, unknown>, "display_name") ?? null;

  return {
    kind: "ok",
    session: {
      userId: user.id,
      email: user.email ?? null,
      tenantId,
      role,
      displayName,
    },
  };
}
