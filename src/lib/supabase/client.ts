"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicSupabaseConfig } from "@/lib/env";

let cached: SupabaseClient | null = null;

export function createClient(): SupabaseClient {
  if (cached) return cached;
  const cfg = getPublicSupabaseConfig();
  if (!cfg) {
    throw new Error(
      "Supabase env vars are missing. Owner must populate NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY via .env.enc → .env.local before client-side Supabase calls.",
    );
  }
  cached = createBrowserClient(cfg.url, cfg.anonKey);
  return cached;
}
