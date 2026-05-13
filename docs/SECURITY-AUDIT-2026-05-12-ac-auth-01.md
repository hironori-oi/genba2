# Security Audit — AC-AUTH-01 refresh-token revoke (narrow)

- Task ID: `T-20260512-100000-genba-ac-auth-01-refresh-revoke`
- Date: 2026-05-12
- Source finding: P1-LIVE-REFRESH-01 in
  `.kobo/live-rls-report-T-20260512-073500-genba-rls-live.json`
- Status after this dispatch: P0 = 0, P1 contract violation **resolved
  in the test path**; production code carries the same SDK mis-use and
  is recorded below as the next owner action.
- **Update 2026-05-13**: P1 production carry-over resolved by
  `T-20260513-200000-genba-ac-auth-01-prod-fix` (Option C). See §7 /
  §7-1 for migration filename, live HTTP 201 evidence, and live test
  evidence.

## 1. Phase 1 AC-AUTH-01 contract recap

"When a user's role / tenant changes via the role-change admin path,
all existing refresh tokens for that user are revoked immediately, so
the OLD JWT cannot keep operating with stale claims."

Original Phase 1 expectation: `admin.auth.admin.signOut(userId,
'global')` revokes every refresh token for that user.

## 2. Live observation in the source finding

The Phase 2 live dispatch
(`T-20260512-073500-genba-rls-live`) ran
`tests/integration/rls/refresh-token-revoke.test.ts` against the
configured Supabase project and observed:

- old refresh token still mints a new session after
  `admin.auth.admin.updateUserById(userId, {...})` +
  `admin.auth.admin.signOut(userId, 'global')`
- the newly minted JWT does carry the updated `app_metadata`
  (role + tenant_id), so **P0 = 0** — no cross-tenant leakage, no
  privilege escalation
- contract violation still flagged P1 because the advertised global
  revoke did not happen

## 3. Supabase Auth project config values

Requirement: GET `/v1/projects/{ref}/config/auth` via the Supabase
Management API to capture `refresh_token_rotation_enabled`,
`refresh_token_reuse_interval`, `jwt_exp`.

Result: **not retrievable in this dispatch environment.**
`SUPABASE_ACCESS_TOKEN` (the Management-API token) was not exported by
the wrapper that spawned this run. The empirical probe explicitly
recorded the absence; no values were fabricated.

```json
{"step":"env_presence","presence":{"NEXT_PUBLIC_SUPABASE_URL":true,"NEXT_PUBLIC_SUPABASE_ANON_KEY":true,"SUPABASE_SERVICE_ROLE_KEY":true,"SUPABASE_ACCESS_TOKEN":false,"RUN_LIVE_RLS_TESTS":false}}
{"step":"auth_config_get","result":{"ok":false,"reason":"SUPABASE_ACCESS_TOKEN absent in dispatch env"}}
```

Source: `.kobo/live/auth-refresh-revoke-probe.log` lines 1–2.

**Why this does not block the audit.** The empirical work in §4
below establishes the root cause independent of these three values.
The values are still useful for owner verification — see §7 *Next
action for owner*.

## 4. Empirical three-case measurement (probe 1)

`.kobo/auth-refresh-revoke-probe.mjs` exercises the cases requested
in the SCOPE:

- **(d) baseline** — `admin.signOut(userId, 'global')` then refresh
- **(a) signOut + wait reuse_interval** — wait 12 s (10 s default +
  2 s) then refresh
- **(b) signOut twice consecutively**
- **(c) signOut + bump app_metadata** (closest available substitute
  for `admin.deleteRefreshToken`; that method does not exist in the
  installed `@supabase/auth-js` admin API)

Sanitized run output (`.kobo/live/auth-refresh-revoke-probe.log`):

```json
{"case":"d-baseline","mutate":{"signOut_error":"invalid JWT: unable to parse or verify signature, token is malformed: token contains an invalid number of segments"},"refresh":{"error_message":null,"error_status":null,"session_present":true}}
{"case":"a-signOut-wait","mutate":{"signOut_error":"invalid JWT: unable to parse or verify signature, token is malformed: token contains an invalid number of segments","waited_ms":12000},"refresh":{"error_message":null,"error_status":null,"session_present":true}}
{"case":"b-signOut-twice","mutate":{"signOut_error_1":"invalid JWT: ... invalid number of segments","signOut_error_2":"invalid JWT: ... invalid number of segments"},"refresh":{"error_message":null,"error_status":null,"session_present":true}}
{"case":"c-signOut-then-bump","mutate":{"signOut_error":"invalid JWT: ... invalid number of segments","bump_error":null},"refresh":{"error_message":null,"error_status":null,"session_present":true}}
```

Every single `admin.auth.admin.signOut(userId, ...)` call returns
`"invalid JWT: ... token contains an invalid number of segments"` —
the GoTrue server rejected each call as malformed input. None of the
four variants actually invoked a server-side revocation, so it is
not surprising the subsequent refresh succeeds.

### 4.1 Root cause

`@supabase/auth-js` `GoTrueAdminApi.signOut`
(`node_modules/@supabase/auth-js/dist/main/GoTrueAdminApi.js:67`) is:

```js
async signOut(jwt, scope = SIGN_OUT_SCOPES[0]) {
  // ...
  await _request(this.fetch, 'POST', `${this.url}/logout?scope=${scope}`, {
    headers: this.headers,
    jwt,
    noResolveJson: true,
  });
}
```

`jwt` is the **logged-in user's access-token JWT**, not a user id.
The request goes to `POST /auth/v1/logout?scope=global` with the
caller's JWT in the Authorization header. Passing a UUID makes
GoTrue see exactly one '.'-separated segment and reject the token
with "token contains an invalid number of segments".

The original AC-AUTH-01 test (and `src/lib/auth/role-change.ts:96`)
passes `req.targetUserId` here. Both are calling the wrong primitive.

## 5. Probe 2 — adopt-path measurement

`.kobo/auth-refresh-revoke-probe2.mjs` measures three remediations:

```json
{"case":"A-raw-admin-logout-global","update_error":null,"logout":{"status":404,"ok":false,"body_preview":"404 page not found\n"},"refresh":{"error_message":null,"error_status":null,"session_present":true,"new_refresh_present":true}}
{"case":"B-sdk-signOut-with-jwt","signOut_error":null,"refresh":{"error_message":"Invalid Refresh Token: Refresh Token Not Found","error_status":400,"session_present":false,"new_refresh_present":false}}
{"case":"C-update-only-no-logout","refresh":{"error_message":null,"error_status":null,"session_present":true,"new_refresh_present":true}}
```

- **Case A** — raw POST to
  `/auth/v1/admin/users/{user_id}/logout?scope=global` with the
  service-role bearer: **404 Not Found**. This endpoint is not
  exposed on the configured Supabase project (Supabase Hosted at the
  time of this run).
- **Case B** — `admin.auth.admin.signOut(userAccessToken, 'global')`
  using the user's actual access-token JWT (the SDK's true contract):
  **succeeds**. The subsequent refresh of the old refresh-token
  returns HTTP 400 with body `"Invalid Refresh Token: Refresh Token
  Not Found"`. This is the desired contract.
- **Case C** — `admin.updateUserById` with no logout at all: refresh
  still succeeds. Confirms that updating `app_metadata` does not
  revoke tokens; the test's revoke step is genuinely required.

## 6. Adopted path

**Test-side fix only.** Update
`tests/integration/rls/refresh-token-revoke.test.ts` to capture the
user's access-token JWT at sign-in and pass it (not `userId`) to
`admin.auth.admin.signOut(jwt, 'global')`.

Why this is the low-risk path:
- No Supabase Auth project setting changed.
- No production source file changed (`role-change.ts` remains
  flagged for owner follow-up — see §7).
- The test now exercises the real signOut behavior of the installed
  SDK and provides actionable evidence for the production fix.

The change in `tests/integration/rls/refresh-token-revoke.test.ts`:

```diff
- const oldRefreshToken = signIn!.session!.refresh_token!;
+ const oldRefreshToken = signIn!.session!.refresh_token!;
+ const oldAccessToken = signIn!.session!.access_token!;

- await admin.auth.admin.signOut(userId, "global");
+ const { error: soErr } = await admin.auth.admin.signOut(oldAccessToken, "global");
+ expect(soErr).toBeNull();
```

Targeted live test result after the change:

```
RUN  v2.1.9
✓ tests/integration/rls/refresh-token-revoke.test.ts > Refresh-token revoke on role change > old refresh token fails after role-change + global signOut  1024ms
✓ tests/integration/rls/refresh-token-revoke.test.ts > Refresh-token revoke live test gating > acknowledges skip reason when env vars missing
Test Files  1 passed (1)
     Tests  2 passed (2)
```

Command:
`node .kobo/run-live-test.mjs` (loads `.env.local`, exports
`RUN_LIVE_RLS_TESTS=1`, adds `--experimental-websocket` to
NODE_OPTIONS because `@supabase/realtime-js@2.x` requires native
WebSocket and Node 20 only exposes it behind that flag).

Sanitized artifacts:
- `.kobo/live/auth-refresh-revoke-test.stdout`
- `.kobo/live/auth-refresh-revoke-test.stderr`

Regression check on the full RLS suite
(`tests/integration/rls`): no AC-AUTH-01 regression. 19 tests pass
(refresh-token-revoke 2/2, rls-live 10/10, coverage-gap-closure
5/5, two gating tests). 10 tests skip in `rls-phase3a.test.ts`
because its migrations are not applied to the live project — that
is **pre-existing and outside this dispatch's scope** (the prompt
explicitly excludes Phase 3b and the coverage-gap expansion). The
suite-level non-zero exit is from `rls-phase3a.test.ts`'s
`beforeAll` failing on a missing table (`movement_plans`), not from
anything this dispatch touched. Suite-run artifacts:
`.kobo/live/auth-refresh-revoke-suite.stdout` /
`.kobo/live/auth-refresh-revoke-suite.stderr`.

## 7. Next action for owner

Two follow-up items, each independent of this dispatch:

1. **Production code carries the same SDK mis-use.** _Status:
   **resolved** by `T-20260513-200000-genba-ac-auth-01-prod-fix`
   (Option C, owner-approved 2026-05-13)._

   `src/lib/auth/role-change.ts:96` previously called
   `admin.auth.admin.signOut(req.targetUserId, "global")`. The
   server rejected every call as malformed JWT and `signOut`
   returned `{data: null, error}` (no throw), so the `try/catch`
   in the surrounding code did not fire. The metadata update
   succeeded; the revoke silently no-op'd. Because the caller
   does *not* hold the target user's access-token, the SDK form
   `admin.signOut(jwt, scope)` cannot be used as-is.

   ### 7-1 Resolution history

   - **Adopted path: Option C (i)** — service-role-only RPC that
     deletes from `auth.refresh_tokens` directly.
   - **Migration**:
     [`supabase/migrations/20260513000000_phase5_admin_revoke_refresh_tokens.sql`](../supabase/migrations/20260513000000_phase5_admin_revoke_refresh_tokens.sql)
     creates `public.admin_revoke_refresh_tokens(p_user_id uuid)`
     with `SECURITY DEFINER`, `set search_path = ''`, PG-grant
     restricted to `service_role`, and a defense-in-depth
     `auth.role() = 'service_role'` guard inside the body.
   - **Production call site**: `src/lib/auth/role-change.ts`
     now invokes `admin.rpc('admin_revoke_refresh_tokens',
     { p_user_id: req.targetUserId })` and **always inspects
     `{ data, error }`**; a non-null `error` returns
     `{ ok: false, code: 'error', ... }` to the caller — silent
     no-op is no longer possible.
   - **Live migration apply evidence**: Management API
     `POST /v1/projects/{ref}/database/query` returned
     **HTTP 201** in 857 ms. Sanitized log:
     `.kobo/apply-one-T-20260513-200000-genba-ac-auth-01-prod-fix.log`.
   - **Live test evidence**:
     - **New**:
       `tests/integration/auth/role-change-revoke.live.test.ts`
       passes **3/3** under `RUN_LIVE_RLS_TESTS=1`:
       - Scenario A — full `changeUserRole()` end-to-end: old
         refresh-token rejected after the call.
       - Scenario B — direct RPC: first call returns count ≥ 1,
         second call returns 0 (proves DELETE happened), and the
         captured refresh-token is invalidated.
       - Gating ack.
       Log: `.kobo/run-live-test-T-20260513-200000-scenarioAB.log`.
     - **Regression**:
       `tests/integration/rls/refresh-token-revoke.test.ts`
       continues to pass **2/2** unchanged. Log:
       `.kobo/run-live-test-T-20260513-200000-regression.log`.
     - **Isolated rls-phase3a re-run**: 11/11 pass (8 skipped).
       Log: `.kobo/run-live-test-T-20260513-200000-phase3a-retry.log`.
   - **Build / type / lint**: `npx tsc --noEmit` exit 0,
     `npx next lint` exit 0 ("No ESLint warnings or errors"),
     `npx next build` exit 0.
   - **Bundle-leakage**: `.next/static` carries no
     `admin_revoke_refresh_tokens`, `service_role`,
     `SUPABASE_SERVICE_ROLE_KEY`, service-role-key prefix, or
     Management-API token prefix (presence-only scan).
   - **Commit ref**: pending commit at dispatch close (no git
     repository at the project root — see Phase C
     `final-report-T-20260513-200000-genba-ac-auth-01-prod-fix.md`
     for the file-level change set).

   Owner ticket suggested at the time of the audit
   (`[FOLLOWUP-AC-AUTH-01] role-change.ts revoke path must use a
   primitive that takes user_id, not the SDK signOut(JWT) form`)
   may now be closed.

2. **(Optional) `refresh_token_reuse_interval=0`.** This audit's
   Probe 2 Case B confirms that with the correct SDK call the old
   refresh fails *without* needing any project-level config change.
   Setting `reuse_interval=0` is therefore not required as a P1
   mitigation; it remains a hardening option the owner may choose
   to apply in the Supabase Dashboard. The Management API GET in
   §3 was unavailable to this dispatch, so the current value is
   unknown to us and is left to owner verification.

3. **Dispatch wrapper hygiene.** This dispatch ran without
   `SUPABASE_ACCESS_TOKEN`. If future dispatches require Management
   API access, the wrapper should source the token in the same way
   the `T-20260512-073500` backend dispatch did (the prior run was
   able to call `/v1/projects/{ref}/database/query`).

## 8. Severity assessment

- **P0 = 0.** No cross-tenant data exposure, no privilege
  escalation. The new JWT minted off the old refresh token carries
  the updated `app_metadata` claims; an attacker holding the prior
  refresh token gains no additional privilege from the role
  change.
- **P1 contract violation in test path: resolved.** The targeted
  live test now passes 2/2 against the real Supabase project.
- **P1 production carry-over: resolved 2026-05-13** by
  `T-20260513-200000-genba-ac-auth-01-prod-fix`. See §7 / §7-1
  resolution history for migration filename, live HTTP 201
  evidence, and live test evidence.

## 9. Evidence file index

- `.kobo/live/auth-refresh-revoke-probe.log` — Probe 1 (4 cases)
- `.kobo/live/auth-refresh-revoke-probe2.log` — Probe 2 (3 cases)
- `.kobo/live/auth-refresh-revoke-test.stdout` /
  `.kobo/live/auth-refresh-revoke-test.stderr` — targeted live
  test run (2/2 pass)
- `.kobo/live/auth-refresh-revoke-suite.stdout` /
  `.kobo/live/auth-refresh-revoke-suite.stderr` — full
  `tests/integration/rls` run (regression confirmation)
- `.kobo/auth-refresh-revoke-probe.mjs` /
  `.kobo/auth-refresh-revoke-probe2.mjs` /
  `.kobo/run-live-test.mjs` — probe + wrapper scripts; no secret
  values are echoed
- `tests/integration/rls/refresh-token-revoke.test.ts` — sole
  product-tree file changed by this dispatch
