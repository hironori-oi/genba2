/**
 * Environment variable accessors for GENBA.
 *
 * Phase 1: the Supabase project is created by the owner; secrets live in
 * `.env.enc` (SOPS+age) and are decrypted to `.env.local`. This module only
 * references env-var NAMES — it never embeds secret values — and surfaces a
 * graceful "missing" state so local builds and tests can proceed without
 * owner-provided credentials.
 */

export type PublicSupabaseConfig = {
  url: string;
  anonKey: string;
};

export type ServerSupabaseConfig = PublicSupabaseConfig & {
  serviceRoleKey: string;
};

export function getPublicSupabaseConfig(): PublicSupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function getServerSupabaseConfig(): ServerSupabaseConfig | null {
  const pub = getPublicSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!pub || !serviceRoleKey) return null;
  return { ...pub, serviceRoleKey };
}

export function getAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000")
  );
}

export function supabaseConfigured(): boolean {
  return getPublicSupabaseConfig() !== null;
}
