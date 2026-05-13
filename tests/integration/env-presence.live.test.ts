/**
 * Live env-presence test — Phase F-4 (2026-05-12)
 *
 * Asserts that the kobo dispatch / run-wrapper alias mechanism
 * (`scripts/env-alias.sh`) has populated the canonical Supabase env names
 * in the process that runs vitest:
 *
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   - SUPABASE_SERVICE_ROLE_KEY
 *   - SUPABASE_ACCESS_TOKEN
 *
 * Gated by RUN_LIVE_ENV_PRESENCE=1. Without that flag the test suite is
 * skipped (0 ran / 0 failed), making it CI-safe by default. To run it:
 *
 *   cd workspace/projects/genba
 *   source "$KOBO_HOME/scripts/env-alias.sh" genba
 *   RUN_LIVE_ENV_PRESENCE=1 npm run test -- tests/integration/env-presence.live.test.ts
 *
 * Or, after a kobo dispatch wrapper has sourced env-alias.sh with slug=genba,
 * the same RUN_LIVE_ENV_PRESENCE=1 flag is sufficient.
 *
 * Safety:
 *   - Values are never logged. Error messages list missing NAMES only.
 *   - Only checks defined/present + non-empty; does not validate URL/JWT format.
 */

import { describe, it, expect } from "vitest";

const LIVE = process.env.RUN_LIVE_ENV_PRESENCE === "1";
const describeLive = LIVE ? describe : describe.skip;

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ACCESS_TOKEN",
] as const;

describeLive("dispatch env-alias propagation (live)", () => {
  it("exports the four canonical Supabase env names in the test process", () => {
    const missing: string[] = [];
    for (const name of REQUIRED) {
      const v = process.env[name];
      if (typeof v !== "string" || v.trim().length === 0) {
        missing.push(name);
      }
    }
    if (missing.length > 0) {
      // names only — never echo values
      throw new Error(
        `dispatch env-alias did not propagate canonical names: ${missing.join(", ")}. ` +
          `Run 'source "$KOBO_HOME/scripts/env-alias.sh" genba' before invoking this test, ` +
          `or rely on the dispatch wrapper template (Phase F-4+).`,
      );
    }
    // explicit per-name assertions for nicer failure output
    for (const name of REQUIRED) {
      const v = process.env[name];
      expect(typeof v, `${name} type`).toBe("string");
      expect((v ?? "").length, `${name} length`).toBeGreaterThan(0);
    }
  });
});
