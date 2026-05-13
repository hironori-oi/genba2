# GENBA Phase 2 Security Audit (QR parser + settings/masters)

date: 2026-05-12
task_id: T-20260511-2349-genba-phase2-resume
scope: Phase 2 boundary only — QR parser/version-matrix (`src/lib/qr/`), settings/masters migration `supabase/migrations/20260512000000_phase2_settings_masters.sql`, RLS tests migration `supabase/migrations/20260512000100_phase2_rls_tests.sql`, integration test files `tests/integration/rls/{rls-live,refresh-token-revoke}.test.ts`, and the Phase 2 sandbox page `src/app/qr-read-test/page.tsx`. Phase 3 (movement_records, qr_scan_histories live INSERT, `validate_target_tenant` trigger) is **out of scope** and will receive its own audit.
data_classification: pii-adjacent (worker login_id = email). No payment, no end-user upload in Phase 2. QR raw_value is parsed client-side in the sandbox only and never persisted in this scope.
auditor mode: Read-only static review (Grep + Read) + best-effort live verification gated by Supabase credentials. No active exploit execution.

prior_audit: `docs/SECURITY-AUDIT-2026-05-11-phase1.md` (Phase 1, P0=0 P1=0 P2=2, VERDICT pass).

---

## Summary

- P0: **0**
- P1: **0**
- P2: **3** (P2-01 light-mode token contrast — **fixed in this dispatch**; P2-02 Live RLS execution against owner Supabase — **blocked** by missing project `.env.local`; P2-03 Supabase Auth rate-limit configuration verification — **owner manual** item, no programmatic dashboard access)
- VERDICT: **conditional pass** (static + E2E + bundle checks pass; Live RLS exec remains pending owner Supabase project as in Phase 1)
- NOTIFY_OWNER: **false** (no P0; blockers documented with resume steps)

Post-audit fix applied during this dispatch: orchestrator narrowed `--color-ok` (`#1e8a5b` → `#0f6e44`, 4.22:1 → ~5.85:1 contrast vs `--surface` `#fcfcfc`) and `--color-warn` (`#c98215` → `#8a5a0e`, 3.10:1 → ~5.87:1) in `src/app/globals.css:23-24`. axe-core `color-contrast` violation on `/qr-read-test` `成功` badge is now 0 (verified by Playwright re-run, see QA evidence below). No other tokens needed adjustment; `--color-bad` (`#c63a2c`) already passes at ~5.15:1.

Build-bundle leak check (post-build): `Grep service_role|SUPABASE_SERVICE_ROLE_KEY|serviceRoleKey` against `.next/static/**` → **0 hits**. `Grep raw_user_metadata` against `.next/static/**` → **0 hits**. Client-bundle boundary remains clean post-Phase-2 additions.

DoD checks (per dispatch):

- `service_role` references appear **only** in server-only files (`src/lib/supabase/admin.ts` with `import "server-only"`) or name-only scaffolding. **No client-bundle path matches.** ✅
- `raw_user_metadata` authorization writes: **0 hits** in `src/` or `supabase/migrations/` outside cautionary comments / test guards. ✅
- QR sandbox `/qr-read-test` cannot SELECT/INSERT tenant data (uses in-memory `DEMO_QR_FORMATS` fixture only, `robots: { index: false, follow: false }`, no Supabase client import). ✅

---

## Static Check Results

### 1. QR parser hardening (QR_SPEC §7)

`src/lib/qr/parser.ts` rejects on every failure path enumerated in QR_SPEC §8:

| Check | Code location | Behaviour |
|---|---|---|
| Empty input | `parser.ts` `empty_input` | returns failure, never throws |
| Length > 4096 (QR_SPEC §7) | `parser.ts` `input_too_long` | server-side validation gate before DB |
| Control chars (`\0` / `\n` / etc.) | `parser.ts` `control_char` | rejected pre-parse — prevents delimiter smuggling |
| `readable=false` definition | `parser.ts` `format_unreadable` | parser returns failure with reason; no INSERT path |
| Unknown version_token (T02) | `parser.ts` `unknown_format` | raw-only persistence path documented (Phase 3 history INSERT) |
| Column count short (T04) | `parser.ts` `column_count_short` | required positions report `required_missing` |
| numeric parse failure (T03) | `parser.ts` `numeric_parse_failed` | field becomes `null` + error annotation |
| date parse failure | `parser.ts` `date_parse_failed` | field becomes `null` + error annotation |

Verified by 13 unit tests in `tests/unit/qr-parser.test.ts` (T01–T12 mapping) — all pass.

### 2. QR sandbox route surface (`/qr-read-test`)

- Page is a **server component** that imports the in-memory `DEMO_QR_FORMATS` fixture only — no `createServerClient` / `createAdminClient` import. No Supabase tenant data is read or written.
- `metadata.robots = { index: false, follow: false }` prevents search-engine surfacing.
- No middleware match (the route lives outside `/app`); but it never touches tenant data, so this is a deliberate sandbox.
- The reusable client component `src/app/app/admin/qr/QrReadTest.tsx` accepts `formats: QrFormatDefinition[]` as a prop, so the in-page state never leaks tenant identifiers.
- Header / footer copy makes the sandbox nature explicit ("サンドボックス (テナントデータなし)"), reducing the chance an operator mistakes it for the real settings screen.

### 3. Migration `20260512000000_phase2_settings_masters.sql` review

(Read-only review of declared policies — execution status in §5 below.)

- All new tables (`qr_format_definitions`, `qr_item_definitions`, `match_rules`, `match_rule_lines`, `tenant_field_settings`, `standard_field_definitions`, etc.) declare `enable row level security`.
- Tenant-scoped tables (`qr_format_definitions`, `qr_item_definitions`, `match_rules`, `match_rule_lines`, `tenant_field_settings`) gate SELECT/INSERT/UPDATE/DELETE via `app.current_tenant_id()` and `app.is_tenant_admin()` for writes.
- System catalog `standard_field_definitions` is read-only for all tenants and write-restricted to `app.is_system_admin()` — verified by RLS-108 test.
- Helper functions `app.current_tenant_id`, `app.is_tenant_admin`, `app.is_system_admin` are reused from Phase 1 with `SECURITY DEFINER` + `set search_path = ''` discipline; no new helpers added.
- No `auth.users` join in any new policy USING / WITH CHECK clause (recursion lesson from pick-checker `010_fix_rls_recursion`).
- All Phase 2 tables include `created_by` / `updated_by` columns with `references auth.users(id)` consistency.

### 4. Migration `20260512000100_phase2_rls_tests.sql` review

Declares pgTAP-style assertions for RLS-101..108 covering:

- RLS-101: cross-tenant SELECT on `qr_format_definitions` returns 0 rows.
- RLS-103: worker INSERT into `qr_format_definitions` is rejected.
- RLS-104: worker UPDATE on `tenant_field_settings` is rejected (admin-only).
- RLS-108: worker UPDATE on `standard_field_definitions` is rejected (system-wide catalog).

These mirror Phase 1's RLS-001..006 pattern. Execution of both this migration and the integration tests requires the owner-provisioned Supabase project — see §5.

### 5. Live RLS verification (RLS-001..008 + RLS-101..108)

| Test | Static review verdict | Live exec status |
|---|---|---|
| RLS-001 cross-tenant SELECT tenants/profiles → 0 rows | ✅ policies use `app.current_tenant_id()` only | **blocked** (no project `.env.local`) |
| RLS-002 worker INSERT into tenant_subscriptions → reject | ✅ `tenant_subs_modify_system_admin` requires `is_system_admin()` | **blocked** (no project `.env.local`) |
| RLS-003 worker reassign `profiles.role` → no JWT effect | ✅ JWT authoritative; `profiles.role` is display-only (see Phase 1 audit §3) | **blocked** (no project `.env.local`) |
| RLS-004 cross-tenant UPDATE SET tenant_id → reject | ✅ WITH CHECK gates `tenant_id = app.current_tenant_id()` | **blocked** (no project `.env.local`) |
| RLS-005 `service_role` outside server-only paths → 0 hits | ✅ verified via Grep (this audit + Phase 1) | ✅ static |
| RLS-006 same-tenant worker A → worker B UPDATE → 0 rows | ✅ self-only branch requires `id = auth.uid()` | **blocked** (no project `.env.local`) |
| RLS-007 qr_scan_histories cross-tenant target_id (`validate_target_tenant`) | n/a — Phase 3 scope | deferred to Phase 3 audit |
| RLS-008 `raw_user_metadata` auth read/write → 0 hits | ✅ verified via Grep (this audit + Phase 1) | ✅ static |
| RLS-101 qr_format_definitions cross-tenant SELECT → 0 rows | ✅ policy `qr_format_definitions_tenant_isolation` | **blocked** |
| RLS-103 worker INSERT qr_format_definitions → reject | ✅ admin-only write policy | **blocked** |
| RLS-104 worker UPDATE tenant_field_settings → reject | ✅ admin-only write policy | **blocked** |
| RLS-108 worker UPDATE standard_field_definitions → reject | ✅ system-admin-only write policy | **blocked** |

Live exec result: `npm test -- --run tests/integration/rls` produced **10 skipped** (`describe.skip` because `RUN_LIVE_RLS_TESTS=1` + `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` are not present in this dispatch environment). 55 non-live tests pass.

**Blocker reason**: project `.env.local` does not exist at `/mnt/c/Users/hiron/Documents/kobo/workspace/projects/genba/.env.local`. Decryption from `/mnt/c/Users/hiron/Documents/kobo/.env.enc` requires owner-controlled `secrets-decrypt.sh` + age key (`~/.config/sops/age/keys.txt`), which is outside this dispatch's `secrets操作` guardrail. The Phase 1 audit recorded the same status (pending Supabase project).

**Resume steps (for owner)**:
1. `./scripts/secrets-decrypt.sh` to produce `${KOBO_HOME}/.env.local`.
2. Copy `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `RUN_LIVE_RLS_TESTS=1` into `${KOBO_HOME}/workspace/projects/genba/.env.local` (chmod 600).
3. Apply migrations `20260512000000_phase2_settings_masters.sql` then `20260512000100_phase2_rls_tests.sql` to the project.
4. `RUN_LIVE_RLS_TESTS=1 npm test -- --run tests/integration/rls` and append pass/fail per test ID into this file's §5 table.
5. Flip P2-02 → resolved when 8/8 Phase 1 cases + 4/4 Phase 2 cases pass.

### 6. Supabase Auth rate-limit verification

DoD requires recording rate-limit values from the Supabase dashboard / API.

**Programmatic check attempted**: not feasible from this dispatch — Supabase Management API requires `SUPABASE_ACCESS_TOKEN` + `project_ref`, which are not provisioned in this environment, and the Auth API itself (`/auth/v1/settings`) only exposes a subset (`mailer_secure_email_change_enabled` etc., not the `rate_limit_*` configuration). No way to read `rate_limit_email_sent` / `rate_limit_sms_sent` / `rate_limit_token_refresh` / `rate_limit_otp` / `rate_limit_sign_up_sign_in_sms` / `rate_limit_anonymous_users` without the Management API token.

**Owner manual check**: Supabase Dashboard → Project → Authentication → Rate Limits. Record actual values for:

- `rate_limit_email_sent` (target: default 30/hour or stricter for production)
- `rate_limit_token_refresh` (target: default 1800/5min, used by `signOut(userId, 'global')` revoke path)
- `rate_limit_otp` (target: default 30/hour)
- `rate_limit_sign_up_sign_in_sms` (n/a unless SMS auth enabled)

Append values + screenshot link to §6 of this file once obtained. (Same blocker as Phase 1 — recorded then as "deferred to owner Supabase project".)

**Static defence-in-depth review** in lieu of live values:

- Server action `src/app/login/actions.ts` does not retry on Supabase `auth.signInWithPassword` failure — single attempt per submit, error returned to UI uniformly (`ログイン情報が正しくありません`) → no brute-force amplification.
- `src/app/forgot-password/actions.ts:40-47` always returns success regardless of email existence → no enumeration oracle (Phase 1 §99).
- Password ≥ 10 chars enforced both client (HTML5 `minLength`) and server (`zod` schema in `src/lib/validation/auth.ts`) → reduces brute-force search space.
- Refresh-token revoke uses `signOut(userId, 'global')` (see §7) → compromise of one device invalidates all sessions.

### 7. Refresh-token revoke (Phase 1 residual)

`src/lib/auth/role-change.ts` invokes `createAdminClient().auth.admin.signOut(userId, 'global')` after the role change RPC succeeds. The Phase 1 audit recorded "live verification: pending Supabase project" for this path.

**Static**: ✅ `'global'` scope is the correct Supabase parameter (revokes all refresh tokens, not just the current session). The call is wrapped in a try/catch in `role-change.ts` so a partial failure does not roll back the role change (acceptable — the change is already committed, and the orphaned token will still be rejected on next refresh because the JWT claim `app_metadata.role` is now stale once a *new* JWT issues).

**Live**: blocked by the same Supabase credential gate as RLS. Resume step: with `.env.local` set and `RUN_LIVE_RLS_TESTS=1`, the `tests/integration/rls/refresh-token-revoke.test.ts` case runs end-to-end (sign in → role-change → assert revoked refresh-token cannot mint new JWT). Currently skipped.

### 8. Service-role bundle boundary (re-check post-Phase-2 build)

| Grep | Path | Hits | Verdict |
|---|---|---|---|
| `service_role\|SUPABASE_SERVICE_ROLE_KEY\|serviceRoleKey` | `.next/static/**` | 0 | ✅ |
| `raw_user_metadata` | `.next/static/**` | 0 | ✅ |

Phase 2 added `src/lib/qr/**` (parser, pure functions, no Supabase import) and `src/app/qr-read-test/page.tsx` (sandbox, no Supabase import). Neither introduces a client-bundle path that could leak secrets.

---

## Findings

### P2-01 light-mode token contrast (FIXED this dispatch)

- **Found**: axe-core `color-contrast` violation on `/qr-read-test` 成功 badge (`#1e8a5b` on `#fcfcfc` = 4.22:1, below WCAG AA 4.5:1 for 12px text).
- **Fix**: `src/app/globals.css:23-24` `--color-ok` → `#0f6e44`, `--color-warn` → `#8a5a0e`. Both now ≥5.85:1.
- **Verified**: 9/9 Playwright tests pass including the axe-core scan (run `T-20260512-000037`).
- **Status**: closed.

### P2-02 Live RLS execution (BLOCKED — owner action)

- **Found**: 10 integration tests (RLS-001..008 + RLS-101/103/104/108 + refresh-token revoke) are gated by `RUN_LIVE_RLS_TESTS=1` + Supabase env vars and skip in this dispatch.
- **Static verdict**: all 12 enumerated cases pass static review (see §5 table).
- **Resume**: §5 owner steps 1–5.
- **Status**: blocked, not P0/P1 (no observed cross-tenant data exposure in static review; live test exists and will run once credentials land).

### P2-03 Supabase Auth rate-limit programmatic verification (OWNER MANUAL)

- **Found**: DoD wants rate-limit values from dashboard/API; this dispatch has no Management API token and the public Auth settings endpoint does not expose rate-limit numbers.
- **Resume**: §6 owner manual values list.
- **Status**: owner-manual, not P0/P1.

---

## UNVERIFIED_ITEMS

1. Live two-JWT RLS test execution (RLS-001/-002/-003/-004/-006 from Phase 1 + RLS-101/103/104/108 from Phase 2). Requires owner-provisioned Supabase project. See §5 resume steps.
2. Live refresh-token revoke E2E (`tests/integration/rls/refresh-token-revoke.test.ts`). Same gate as #1.
3. Supabase Auth rate-limit configuration values. Requires dashboard access or Management API token. See §6.
4. `validate_target_tenant()` trigger on `qr_scan_histories` (RLS-007). **Phase 3 scope** — deferred until movement records + history INSERT lands.

---

## Phase 1 residual issues — status

| Phase 1 residual | Phase 2 status | Note |
|---|---|---|
| Live RLS exec (RLS-001..006) | still blocked (same Supabase gate) | escalated to Phase 2 P2-02 with explicit resume steps |
| Refresh-token revoke live verify | still blocked | static path unchanged (`signOut('global')`); integration test ready |
| Supabase Auth rate-limit values | still blocked (owner-manual) | escalated to Phase 2 P2-03 |
| P2-01 open-redirect hardening (Phase 1) | resolved in Phase 1 | unchanged |
| P2-02 admin error-string passthrough (Phase 1) | deferred to Phase 5 | unchanged (role-change UI not yet shipping) |

---

## Recommendations (non-blocking)

1. Once `.env.local` is provisioned, add `npm run test:live` script that exports `RUN_LIVE_RLS_TESTS=1` and runs `tests/integration/rls` so the gate is explicit per CI step.
2. Add a Tailwind / globals.css comment noting the WCAG 4.5:1 minimum, so a future contributor changing `--color-ok` / `--color-warn` retains the contrast budget. (Out of scope for this dispatch; tracking as documentation-only TODO.)
3. Phase 3 audit must verify `validate_target_tenant()` trigger + `target_table` allow-list CHECK constraint (QR_SPEC §6) on first `qr_scan_histories` INSERT path.

---

## Sign-off

- E2E (Playwright + axe-core): **9/9 pass**, no serious/critical a11y violations.
- Unit + integration (vitest): **55 pass, 10 skipped** (skips are the live-gated suite, see §5).
- Lighthouse (3-run median, dev mode): a11y=98 / bp=100 / seo=100, perf=71 (dev mode expected ≪ prod).
- Service-role + raw_user_metadata bundle grep: **0 hits**.
- Static review: **P0=0, P1=0, P2=3** (one fixed this dispatch, two blocked on owner Supabase / dashboard access).
- VERDICT: conditional pass, NOTIFY_OWNER: false.
