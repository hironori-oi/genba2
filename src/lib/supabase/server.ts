import "server-only";

import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig } from "@/lib/env";

export async function createClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const cfg = getPublicSupabaseConfig();
  if (!cfg) {
    throw new Error(
      "Supabase env vars are missing on the server. Populate NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY before invoking server Supabase clients.",
    );
  }
  return createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components cannot set cookies; the middleware handles
          // session refresh. This catch lets us reuse the same client.
        }
      },
    },
  });
}
