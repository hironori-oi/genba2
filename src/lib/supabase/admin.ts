import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabaseConfig } from "@/lib/env";

/**
 * Service-role client. Server-only — see `import "server-only"` above and the
 * `"server-only"` package guard. Never expose this client (or
 * SUPABASE_SERVICE_ROLE_KEY) to client bundles. Used by tenant_admin role
 * change RPC, refresh-token revoke flows, and admin scripts.
 */
export function createAdminClient(): SupabaseClient {
  const cfg = getServerSupabaseConfig();
  if (!cfg) {
    throw new Error(
      "Service-role Supabase env vars are missing. SUPABASE_SERVICE_ROLE_KEY must be provided by the owner via .env.enc → .env.local for admin-only flows.",
    );
  }
  return createClient(cfg.url, cfg.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
