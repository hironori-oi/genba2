# monthly-usage-refresh (deferred — Phase 7)

Architect doc: `docs/ARCHITECTURE-phase6-operational-features.md` §C.6f-4.

## Status: STUB (intentional)

The migration prerequisites are live as of Phase 6f (HTTP 201):

- `supabase/migrations/20260531000100_phase6f_tenant_subscriptions_ext.sql`
- `supabase/migrations/20260531000200_phase6f_admin_audit_log.sql`
- `supabase/migrations/20260531000300_phase6f_notification_preferences.sql`

The Edge Function itself is deferred to Phase 7 because:

1. No new EF infrastructure was authorised in the Phase 6f / 6g `auth_tier B`
   dispatch (no production deploys, no paid services, no SaaS sign-up).
2. The architect spec calls for a cron-driven `REFRESH MATERIALIZED VIEW
   CONCURRENTLY monthly_scan_usage` exactly once per day; that requires a
   scheduled trigger config that lives in the Supabase dashboard, which has
   not been performed.
3. The `/app/admin/usage` page reads the live MV synchronously via
   `selectMonthlyUsage()` and is functional today. The cron refresh is an
   optimisation (and a precondition for `notify-monthly-cap`) — not a
   correctness gate.

## Phase 7 deploy plan

```ts
// supabase/functions/monthly-usage-refresh/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { error } = await supabase.rpc("refresh_monthly_scan_usage");
  if (error) return new Response(JSON.stringify({ error }), { status: 500 });
  return new Response(JSON.stringify({ refreshed_at: new Date().toISOString() }));
});
```

- Cron: `0 19 * * *` (UTC) ≈ 04:00 JST.
- RLS: the MV itself has tenant_id partitioning; the EF runs as service_role
  and refreshes all rows in one transaction.
- Idempotency: `REFRESH MATERIALIZED VIEW CONCURRENTLY` is idempotent.

When the EF ships, `selectMonthlyUsage()` should still treat the MV as the
source of truth — the cron is purely a freshness optimisation.
