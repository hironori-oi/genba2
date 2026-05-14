# notify-monthly-cap (deferred — Phase 7)

Architect doc: `docs/ARCHITECTURE-phase6-operational-features.md` §C.6f-4.

## Status: STUB (intentional)

`notification_preferences` (Phase 6f) stores SMTP / webhook config with
column-level revokes on `smtp_password` / `webhook_secret`; only the
service_role + Edge Function path is meant to read those secrets.

This EF is deferred to Phase 7 alongside `monthly-usage-refresh`:

- it depends on the cron refresh to detect the 80% threshold crossing
  reliably,
- it requires a deployed SMTP transport (set via Supabase dashboard or a
  hosted relay), which is not in scope for Phase 6 `auth_tier B`,
- the UI today already surfaces the 80% banner (AppShell-level, Phase 6g)
  and the `/app/admin/usage` warning — operators see the signal without
  the email loop.

## Phase 7 deploy plan

```ts
// supabase/functions/notify-monthly-cap/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer/mod.ts";

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { tenant_id } = await req.json();

  // 1. pull preferences (service_role can SELECT smtp_password)
  // 2. if notify_monthly_cap = false → return { delivery: "skipped" }
  // 3. if smtp_host / smtp_password missing → return { delivery: "degraded" }
  // 4. otherwise: SMTPClient.send({ from, to, subject, content })
  //    + insert into notification_dispatch_log (Phase 7-1 migration)
});
```

- Trigger: invoked by `monthly-usage-refresh` when a tenant crosses 80%.
- Audit: every send is logged to `notification_dispatch_log` (Phase 7-1
  migration, not yet authored).
- Failure mode: errors NEVER raise — the EF returns
  `{ delivery: "degraded" | "error", reason }` so the cron does not retry
  forever on a permanently broken SMTP config.
