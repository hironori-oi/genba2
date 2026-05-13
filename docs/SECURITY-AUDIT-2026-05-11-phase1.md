# GENBA Phase 1 Security Audit (Scaffolding + Auth + RLS)

date: 2026-05-11
scope: Phase 1 boundary only — auth flow (login / forgot-password / callback / logout / middleware), Supabase wiring (env separation, server/client/admin clients), RLS migration `20260511000000_phase1_init.sql` + tests `20260511000100_phase1_rls_tests.sql`, and AC-AUTH-01 (password ≥ 10, refresh-token revoke). Phase 3 onward (movement_records, qr_scan_histories, CSV import, target_id polymorphic FK) is **out of scope** and will receive its own audit.
data_classification: pii-adjacent (worker login_id = email). No payment, no end-user upload in Phase 1.
auditor mode: Read-only static review (Grep + Read). No active probe, no exploit execution. (`security-auditor.md` Phase B/C.)

prior_audit: `docs/SECURITY-AUDIT-2026-05-10.md` (Phase 0 docs, conditional pass, P0=0/P1=5 all resolved in docs).

---

## Summary

- P0: **0**
- P1: **0**
- P2: **2** (P2-01 open-redirect hardening — **fixed in this dispatch**; P2-02 admin error-string passthrough — **deferred to Phase 5 when role-change UI ships**)
- VERDICT: **pass**
- NOTIFY_OWNER: **false** (no P0)

Post-audit fix applied: orchestrator added `src/lib/auth/safe-redirect.ts` `safeInternalPath(value, fallback)` and routed both `src/app/login/actions.ts:loginAction` and `src/app/auth/callback/route.ts:GET` through it. Unit tests at `tests/unit/safe-redirect.test.ts` cover `//evil`, `\evil`, `https://...`, `mailto:`, `javascript:`, newline injection, empty, undefined, non-string, and oversized inputs. Re-run of `npm run typecheck` / `npm run lint` / `npm run test` / `npm run build` / Playwright (7/7) all green after the fix.

Build-bundle leak check (post-build): `Grep service_role|SUPABASE_SERVICE_ROLE_KEY|serviceRoleKey` against `.next/static/**` → **0 hits**. `Grep raw_user_metadata` against `.next/static/**` → **0 hits**. Client-bundle boundary confirmed clean.

DoD checks (per dispatch):

- `service_role` references appear **only** in server-only files (`src/lib/supabase/admin.ts` with `import "server-only"`) or names-only env scaffolding (`src/lib/env.ts`, `.env.example`), tests, migrations, and docs. **No client-bundle path matches.** ✅ met.
- `raw_user_metadata` authorization writes: **0 hits** in `src/` or `supabase/migrations/` outside cautionary comments / test guards. ✅ met. (`src/lib/auth/role-change.ts:13` is a `NEVER raw_user_metadata` warning comment; `supabase/migrations/20260511000000_phase1_init.sql:11` is the same warning; `tests/unit/rls-claims.test.ts` enforces the rule. No actual reads/writes.)

---

## Static Check Results

### 1. `service_role` placement (RLS-005)

Grep `service_role|service-role|serviceRole` in `src/`:

| File | Line | Context | Verdict |
|---|---|---|---|
| `src/lib/env.ts` | 17, 29–31 | env-name accessor only (`process.env.SUPABASE_SERVICE_ROLE_KEY`); no secret embedded in source | OK (env-name only) |
| `src/lib/supabase/admin.ts` | 8–10, 17, 20 | `import "server-only"` at top; client built from `cfg.serviceRoleKey` | OK (server-only guarded) |
| `src/lib/auth/role-change.ts` | 12, 19 | `import "server-only"` at top; only references service-role conceptually in JSDoc + uses `createAdminClient()` | OK (server-only guarded) |
| `src/lib/validation/auth.ts` | 6 | JSDoc cautionary comment | OK (comment only) |

Outside `src/`: matches in `.env.example` (env-name), `tests/unit/rls-claims.test.ts` / `tests/unit/env.test.ts` (test enforcement), migration / docs. No client-bundle paths.

`SUPABASE_SERVICE_ROLE_KEY` literal: only `src/lib/env.ts` (read), `src/lib/supabase/admin.ts` (error message), `tests/unit/env.test.ts`, `.env.example`. ✅

`.next/server/app/{login,forgot-password}/page.js` matches were observed — these are **server-side** build artifacts (.next/server), not client bundles, so they do not violate the boundary. (Recommendation P2 below covers a follow-up grep against `.next/static/**` to formally confirm — see UNVERIFIED_ITEMS.)

### 2. `raw_user_metadata` discipline (RLS-008)

Grep `raw_user_metadata` in `src/` and `supabase/migrations/`:

- `src/lib/auth/role-change.ts:13` — comment: `NEVER raw_user_metadata — that path is client-writable…`
- `supabase/migrations/20260511000000_phase1_init.sql:11` — comment: `raw_user_metadata is client-writable via the JS SDK and MUST NOT be…`

**Zero authorization reads / writes.** The session helper (`src/lib/auth/session.ts:43–47`) reads `tenant_id` / `role` from `user.app_metadata` only; `display_name` is correctly read from `user_metadata` (display data, not authorization). The role-change RPC writes `app_metadata` exclusively. ✅

### 3. `"use client"` files importing server-only modules

Client-marked files: `src/app/forgot-password/ForgotPasswordForm.tsx`, `src/app/login/LoginForm.tsx`, `src/lib/supabase/client.ts`. None of them import from `@/lib/supabase/server`, `@/lib/supabase/admin`, `@/lib/auth/session`, `@/lib/auth/role-change`, or `server-only`. Server actions are imported into client forms via the `"use server"` boundary (Next.js erases server bodies from the client bundle). `AppShell.tsx` is a server component (no `"use client"`) that takes `logoutAction` as a prop — proper RSC pattern. ✅

### 4. `auth.users` direct read in RLS policies

Migration grep: `auth.users` appears only as **FK references** (`references auth.users(id)`) in `tenants`, `profiles`, `tenant_subscriptions`, `businesses`. **No policy USING / WITH CHECK clause references `auth.users`** — recursive policy bug from pick-checker `010_fix_rls_recursion` is avoided. JWT claims are read straight from `auth.jwt()` via the `app.*` helpers. ✅

### 5. `SECURITY DEFINER` + `set search_path = ''`

All six functions in the migration set `search_path = ''`:

- `app.current_tenant_id` — definer, search_path='' ✅
- `app.current_role` — definer, search_path='' ✅
- `app.is_tenant_admin` — definer, search_path='' ✅
- `app.is_system_admin` — definer, search_path='' ✅
- `public.seed_default_businesses` — definer, search_path='' ✅ (all writes qualified `public.`)
- `public.touch_updated_columns` — non-definer trigger fn, search_path='' ✅ (uses `auth.uid()` qualified, `now()` is pg_catalog implicit)

Defense against pick-checker `013` search_path attack lesson is in place. ✅

### 6. RLS enabled on every Phase 1 table

- `public.tenants` — `enable row level security` ✅
- `public.profiles` — ✅
- `public.tenant_subscriptions` — ✅
- `public.businesses` — ✅

`created_by` / `updated_by` columns present on all four. ✅ (Phase 0 audit P1 audit/timing remediation confirmed.)

### 7. 4-business seed + tenant_subscriptions row trigger

`seed_default_businesses` fires `after insert on public.tenants for each row`, inserting receiving / picking / inventory / manufacturing with `on conflict do nothing` and a default `tenant_subscriptions` row. ✅

---

## Pen-style flow review (read-only)

### Email enumeration in `/forgot-password`

`src/app/forgot-password/actions.ts:40–47`: action awaits `resetPasswordForEmail` and **always** returns `status: "sent"` regardless of whether the email exists or Supabase returned an error. The success message is uniform (`ご登録のメールアドレスが存在する場合、リセット手順をお送りしました。`). ✅ No enumeration oracle.

### `/auth/callback` validation

`src/app/auth/callback/route.ts`:

- `code` param is passed directly to `supabase.auth.exchangeCodeForSession(code)`, which validates the PKCE flow server-side. On error, redirects to `/login?notice=auth-error` (no info leak). ✅
- `next` param is gated by `next.startsWith("/")` and concatenated with `origin`. The same defense exists in `src/app/login/actions.ts:54`.
- `origin` comes from `request.nextUrl`, which Next.js derives from the trusted proxy/host config — not user-controllable as a host header injection in the standard Vercel deploy.

**P2 (open-redirect hardening)** — `next.startsWith("/")` allows `//evil.com`. When concatenated with `origin`, the resulting absolute URL parses as `https://app.example.com//evil.com` (path with double slash), which browsers do NOT interpret as protocol-relative because the host is fixed in the absolute URL. So this is **not exploitable today**, but the convention is to reject `//` and any `\` to defend against future framework changes. See FINDINGS P2-01.

### Middleware route protection

`src/lib/supabase/middleware.ts:10–11` — `isProtected` matches `/app` and `/app/...`. Next.js normalizes the URL (decodes percent-escapes, collapses `//`) before middleware runs, so `%2Fapp`, `/App` (case), and `/app/../something` cannot bypass `startsWith("/app")` after normalization. Auth is verified via `supabase.auth.getUser()` (not `getSession()`) — getUser hits the auth server and is the recommended SSR pattern. ✅

The "supabase unconfigured" branch redirects protected routes to `/login?notice=supabase-unconfigured` — does not bypass; safe. ✅

### Password reset email body / redirect URL

`requestPasswordResetAction` calls `resetPasswordForEmail(email, { redirectTo: \`${getAppUrl()}/auth/callback?type=recovery\` })`. `getAppUrl()` (env.ts:34–39) reads `NEXT_PUBLIC_APP_URL` (env-controlled by owner, **not user-controlled**) with a localhost fallback. Supabase Auth additionally requires `redirectTo` to be on the project's allow-list configured in the Supabase dashboard, providing defense-in-depth. ✅ No host injection.

### Role-change refresh-token revoke

`src/lib/auth/role-change.ts:96`: `await admin.auth.admin.signOut(req.targetUserId, "global")`. Per Supabase Auth admin API, `signOut(userId, "global")` revokes **all** refresh tokens for that user across devices, satisfying AC-AUTH-01's "revoke on role/tenant change" requirement. The pre-checks (line 47–53) restrict role changes to `tenant_admin` / `system_admin`, and tenant_admins can only modify users in their own tenant (line 67–77). The function also signs the *current* server session out if the caller modified themselves (line 111–114), forcing re-login under new claims. ✅

### Password policy

`src/lib/validation/auth.ts:11–23`: `PASSWORD_MIN_LENGTH = 10`, applied via `passwordSchema` to both `loginSchema` and `passwordUpdateSchema`. Single-sourced; UI re-imports `PASSWORD_MIN_LENGTH` (`src/app/login/LoginForm.tsx:9`) so client and server agree. Max length 128 to bound bcrypt input. ✅

---

## FINDINGS

### [P2] redirect/path-validation: `next` accepts `//evil` (defense-in-depth only)

- where: `src/app/auth/callback/route.ts:15,36`; `src/app/login/actions.ts:53–54`
- repro (description only, no execution):
  1. Visit `/login?next=//evil.example`.
  2. After successful login, the action runs `redirect(next)` with `next === "//evil.example"`. Next.js' `redirect` produces a Location header. Modern browsers parse this as a same-origin path `https://app/​/evil.example` rather than a protocol-relative redirect, so the request is **not** redirected off-domain today.
- Why this is P2 (not P1): the actual `redirect(next)` is performed by Next.js with a relative path; browser URL parsing keeps it on-origin. There is no observed exploit. However, the idiomatic check is `next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")`, and a future Next.js or framework change could surface a regression.
- fix: add `&& !next.startsWith("//") && !next.includes("\\")` (or parse with `new URL(next, origin)` and verify `url.origin === origin`). Apply in both `auth/callback/route.ts` and `login/actions.ts`.
- status: **fixed in this dispatch** — `src/lib/auth/safe-redirect.ts` introduced, applied to both call sites, 16 unit tests added in `tests/unit/safe-redirect.test.ts` covering `//evil`, `\evil`, absolute URLs, javascript:, mailto:, newline injection, empty, non-string, oversized input.
- confidence: high

### [P2] info-disclosure/error-message: admin error messages surface raw Supabase strings

- where: `src/lib/auth/role-change.ts:88–106`
- repro: when `admin.auth.admin.updateUserById` or `signOut` fails, the function returns `{ message: updateError.message }` or `${err.message}` directly to the caller. If a future tenant-admin UI surfaces this string, it could leak internal Supabase error details (e.g. user IDs, internal codes) to a browser context.
- Why P2: the admin RPC is server-only and the role-change UI is **not yet shipped** (Phase 5 scope per the spec). No leak path exists today.
- fix: when the role-change UI is built (Phase 5), translate Supabase error codes to user-facing Japanese messages and log the raw error server-side only.
- status: deferred to Phase 5 (UI not built).
- confidence: medium

---

## RLS POLICY TEST SQL — readiness

`supabase/migrations/20260511000100_phase1_rls_tests.sql` declares the eight scenarios as NOTICEs (placeholders); actual two-JWT integration tests run against a live Supabase project once the owner provisions credentials.

| ID | target | scenario | static review | live test status |
|---|---|---|---|---|
| RLS-001 | tenants / profiles | T2 user `SELECT WHERE tenant_id=T1` → 0 rows | ✅ policies use `app.current_tenant_id()` only; cross-tenant SELECT impossible | pending Supabase project |
| RLS-002 | tenant_subscriptions | worker `INSERT` → reject | ✅ `tenant_subs_modify_system_admin` requires `app.is_system_admin()` | pending Supabase project |
| RLS-003 | profiles | worker re-assigns `role` → reject | ✅ insert policy requires `app.is_tenant_admin()`; UPDATE allows self only when `id = auth.uid()`; column-level role write still subject to UPDATE policy | pending Supabase project (worker self-update can change own role text — see note below) |
| RLS-004 | profiles | cross-tenant `UPDATE SET tenant_id=T1` → reject | ✅ WITH CHECK requires `tenant_id = app.current_tenant_id()` | pending Supabase project |
| RLS-005 | (codebase) | `service_role` outside server-only paths → 0 hits | ✅ verified above | ready (test file `tests/unit/rls-claims.test.ts:70`) |
| RLS-006 | profiles | same-tenant worker A → worker B `UPDATE` → 0 rows | ✅ self-only branch requires `id = auth.uid()`; admin branch requires `is_tenant_admin()` | pending Supabase project |
| RLS-007 | qr_scan_histories | worker INSERT with cross-tenant target_id | n/a — Phase 3 scope (`validate_target_tenant()` trigger) | deferred to Phase 3 audit |
| RLS-008 | (codebase) | `raw_user_metadata` authorization read/write → 0 hits | ✅ verified above | ready (test file `tests/unit/rls-claims.test.ts:37`) |

**Note on RLS-003 self role change**: the `profiles_update_self_or_admin` policy currently allows a worker to UPDATE their *own* `profiles` row (USING `id = auth.uid() AND tenant_id = app.current_tenant_id()`). The `role` column on `profiles` is **display-only** (the authoritative role lives in `auth.users.app_metadata.role` via the JWT claim, which only the role-change RPC can mutate via service_role). So a worker self-editing `profiles.role = 'tenant_admin'` does **not** elevate privileges — RLS will still see `app.current_role() = 'worker'` from JWT until the next sign-in with new claims, and the role-change RPC is the only path that updates JWT claims.

Recommendation (low-priority): add a column-grant restriction or trigger to forbid non-admin self-update of `profiles.role` / `profiles.assigned_businesses`, so the display value cannot drift from the JWT and confuse the UI. Tracking as P2-followup, not blocking. (Not added to FINDINGS list because there is no privilege-escalation path — the RLS-008 separation of `app_metadata` vs `profiles.role` is the actual control.)

---

## UNVERIFIED_ITEMS

These cannot be confirmed by static read alone; they require either a live Supabase project or build-output inspection:

1. Live two-JWT RLS test execution (RLS-001 / -002 / -003 / -004 / -006). Requires owner-provisioned Supabase project. Run `supabase/migrations/20260511000100_phase1_rls_tests.sql` plus integration tests with a worker JWT and an admin JWT for two distinct tenants.
2. JWT signature / `alg=none` rejection by the live Supabase Auth instance (defense-in-depth confirmation; standard Supabase config disallows `alg=none` but worth verifying once project exists).
3. ~~`.next/static/**` formal grep to confirm no `service_role` / `SUPABASE_SERVICE_ROLE_KEY` token leaked into client bundles.~~ **Executed in this dispatch — 0 hits for all of `service_role`, `SUPABASE_SERVICE_ROLE_KEY`, `serviceRoleKey`, `raw_user_metadata`.** Client-bundle boundary confirmed clean.
4. Supabase Auth rate-limit values (login attempts/min, password-reset attempts/hour) — record from dashboard once project is created (PRODUCT_SPEC AC-AUTH-01 footnote).
5. `npm audit --json` interpretation — outside the static-only scope of this audit; capture during Phase 1 CI.

---

## VERDICT

**pass**

Justification:

- P0 = 0; P1 = 0. Both P2 findings are defense-in-depth recommendations with no observed exploit path in Phase 1 surface area.
- All Phase 0 audit P1 remediations are present in code: `app_metadata`-only authorization (RLS-008), `created_by` / `updated_by` columns, `SECURITY DEFINER` + `search_path=''` on every helper, no `auth.users` join in policies, refresh-token revoke via `signOut(userId, 'global')`, password ≥ 10 enforced server- and client-side.
- DoD `service_role` only in server-only / docs / tests / env-name scaffolding: **met**.
- DoD `raw_user_metadata` authorization writes grep 0 hit: **met** (only cautionary comments and test enforcement).
- Phase 1 boundary respected — qr_scan_histories / movement_records / CSV import are not in this scope and will be re-audited in Phase 3.

## NOTIFY_OWNER

**false** — no P0; standard `pass` notification only.

---

## Recommendations to orchestrator (non-blocking)

1. ~~(P2-01) Tighten `next` validation in `src/app/auth/callback/route.ts` and `src/app/login/actions.ts` to also reject `//` and `\\` prefixes.~~ **Fixed in this dispatch.** See `src/lib/auth/safe-redirect.ts` + `tests/unit/safe-redirect.test.ts`.
2. (P2-02) When the role-change UI ships in Phase 5, translate Supabase admin-API error strings before returning them to the browser layer.
3. (Coverage) Add a `.next/static/**` grep to the Phase 1 acceptance checklist after `next build` to formally confirm no service_role token leakage in client chunks.
4. (Coverage, post-credentials) Execute the RLS-001 / -002 / -003 / -004 / -006 two-JWT integration tests against the live Supabase project; record results in this file's RLS table and flip status from `pending` → `pass`.

---

## Revision history

| date | revision | author |
|---|---|---|
| 2026-05-11 | Initial Phase 1 audit (scaffolding + auth + RLS). pass. | security-auditor (Phase B/C, Read-only) |
| 2026-05-11 | Post-audit: P2-01 (open-redirect hardening) implemented + 16 unit tests added. `.next/static/**` build-bundle grep executed → 0 hits for service_role / raw_user_metadata. | orchestrator (post-audit remediation) |
