import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getPublicSupabaseConfig,
  getServerSupabaseConfig,
  supabaseConfigured,
} from "@/lib/env";

const KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

describe("env wiring", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      original[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it("returns null when public vars are missing", () => {
    expect(getPublicSupabaseConfig()).toBeNull();
    expect(supabaseConfigured()).toBe(false);
  });

  it("returns the public config when both public vars are set", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    const cfg = getPublicSupabaseConfig();
    expect(cfg).toEqual({
      url: "https://example.supabase.co",
      anonKey: "anon-key",
    });
    expect(supabaseConfigured()).toBe(true);
  });

  it("server config requires the service-role key in addition to public vars", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    expect(getServerSupabaseConfig()).toBeNull();
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    expect(getServerSupabaseConfig()?.serviceRoleKey).toBe("service-role");
  });
});
