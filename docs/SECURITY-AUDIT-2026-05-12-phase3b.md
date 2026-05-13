# GENBA Phase 3b Security Audit (UI + CSV pipeline + scanner — second pass)

date: 2026-05-12
task_id: T-20260512-110000-genba-phase3b-ui-csv-polish
scope: Phase 3b delta — Scanner / ResultOverlay / StepHeader / ManualInputModal / CsvUploadButton / 4 LOGI pages (receiving / picking / inventory / history list + detail) / `src/lib/logi/actions.ts` / `src/lib/csv/{sanitize,encode,import-client}.ts` / `supabase/functions/{movement,inventory}-csv-import` / migration `20260512000600_phase3b_csv_jobs.sql` / new tests (`csv-formula-injection`, `scanner-match`, `scanner-state`, `coverage-gap-closure` RLS-102/105/106/107, `rls-live` RLS-007). Phase 3a foundation tables / trigger / `raw_value` views were audited in the first pass and remain unchanged in Phase 3b.
data_classification: pii-adjacent (worker login_id = email) + business-data (item/order/customer codes inside QR raw_value and CSV row payloads) + tenant-scoped upload metadata. No payment, no end-user image upload.
auditor mode: Read-only static review (Grep + Read). No active probe, no exploit execution.

prior_audits: phase1 (`docs/SECURITY-AUDIT-2026-05-11-phase1.md`, pass), phase2 (`docs/SECURITY-AUDIT-2026-05-12-phase2.md`, conditional pass), phase3a (`docs/SECURITY-AUDIT-2026-05-12-phase3a.md`, pass post-fix; P0=0 P1=0 P2=3).

---

## Summary

- P0: **0**
- P1: **0**
- P2: **3** (one new now resolved docs-only + one Phase 3a carryover now resolved docs-only + one new build-hygiene still open)
- VERDICT: **pass**
- NOTIFY_OWNER: **false**

Phase 3a P2 status this audit:

| ID | Phase 3a P2 | Phase 3b status |
|---|---|---|
| soft-delete trigger permissive on `validate_target_tenant()` | open (product decision) | **resolved (docs only)** — `QR_SPEC §7` documentation note added (soft-deleted targets accepted; scan record retains forensic value); trigger code unchanged. Closed as docs-only product decision. |
| plan_lines parent-tenant drift | open | **CLOSED** by `20260512000600_phase3b_csv_jobs.sql:124-197` (new `enforce_plan_line_tenant()` SECURITY DEFINER trigger on both `movement_plan_lines` and `inventory_plan_lines`). |
| `parsed_values` upper bound | open | **CLOSED at DB layer** by `20260512000600_phase3b_csv_jobs.sql:208-213` (new CHECK `pg_column_size(parsed_values) <= 8192`). Zod still does not cap key/value counts (validators.ts:189), but the DB CHECK is the authoritative gate; storage-bloat vector is closed. |

---

## Static Check Results

### 1. CSV pipeline security — movement / inventory Edge Functions + sanitize.ts

| Control | Where | Verdict |
|---|---|---|
| Content-Type 415 | `supabase/functions/movement-csv-import/index.ts:56-64,253-256`; same for inventory `:35-43,196-199` | OK — substring allow-list (`text/csv`, `application/vnd.ms-excel`, `spreadsheet`, `application/octet-stream`). `application/octet-stream` is permissive but matches browser drag-and-drop behaviour and the per-row validators still enforce structural correctness. |
| 10 MB size 413 (Content-Length) | `:258-261` (movement), `:201-204` (inventory) | OK |
| 10 MB size 413 (streamed) | `:278-292` (movement), `:217-230` (inventory) | OK — `received += value.byteLength` per chunk, fail-fast if any partial upload exceeds the cap. Closes the "missing Content-Length" bypass. |
| 100k row 413 | `:307-310` (movement), `:245-247` (inventory) | OK — `MAX_ROWS = 100_000`; header row inclusive so `rawLines.length > MAX_ROWS + 1`. |
| Formula injection prepend | `src/lib/csv/sanitize.ts:32-63` | OK — covers `=`, `+`, `-`, `@`, `\t`, `\r` per ARCHITECTURE §4. Negative-number coercion forces prepend (`-3 → '-3`). Unit tests cover every prefix (`tests/unit/csv-formula-injection.test.ts:17-47` + RFC 4180 quoting). |
| Auth (JWT round-trip, NOT in-band parse) | `:66-102` (movement), `:45-79` (inventory) — `readUserAndTenant` calls `anon.auth.getUser()` server-side with the caller's Bearer token | OK — Supabase Auth `getUser()` round-trip ensures revocation list is honored. No local JWT decode. Bearer scheme is hard-checked (`startsWith("bearer ")`, case-insensitive). |
| `tenant_id` from JWT claims (not from CSV / form fields) | `:91-101` (movement) — `meta.tenant_id`; rejects when claim missing → 403 `tenant_missing`. Insert pins `tenant_id: ctx.tenantId` at `:344` and `:363` | OK — caller-supplied `tenant_id` is never trusted. |
| Cross-tenant write prevention | Edge Functions use `service_role` for bulk insert (`:335-337`), but `tenant_id` is forced from JWT context at `:344` (job header) and `:363` (`rowsToInsert.map(r => ({ ...r, tenant_id: ctx.tenantId }))`). | OK — service_role + JWT-pinned tenant_id is the standard EF pattern. |
| `errors` jsonb bounded | `MAX_ERRORS = 200` short-circuit at `:316-320`; row data NOT echoed (only `{row, code, message}`) | OK — no raw cell content stored in `errors`. The row counter (`i+2`) and error codes (`column_count` / `plan_code` / `item_code` / `line_no` / `planned_quantity`) reveal validation outcomes only. |
| File path traversal | EF streams the request body in-process and writes nothing to local fs. `source_storage_path` query param is stored as a metadata string only (no file IO is performed against it). | OK in practice — see P2-1 below for a design-vs-implementation drift note (ARCHITECTURE §4 describes a Storage UUID-rename roundtrip; the current EFs accept the body inline). No exploitable traversal because the EF never opens the path. |
| service_role key never in client bundle | Lives only in Deno EF `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`. Verified no leak (see §6). | OK |

**Anti-DoS observations**:

- `splitCsvRow()` runs in a single forward pass per line. No backtracking, no quadratic blowup.
- The error-array short-circuit at `errors.length >= MAX_ERRORS` runs BEFORE per-row work each iteration, so a 100k-row file with every row invalid stops at 200 errors (`:320`). Confirmed for both EFs.
- The streaming read accumulates chunks into a `Uint8Array` of `received` length — bounded by the 10 MB cap.

### 2. Migration `20260512000600_phase3b_csv_jobs.sql`

| Item | Where | Verdict |
|---|---|---|
| `csv_import_jobs` RLS enabled | `:62` | OK |
| SELECT policy (same-tenant) | `:67-70` | OK — `tenant_id = app.current_tenant_id() or app.is_system_admin()`. Note: ALL same-tenant authenticated users (including non-admin workers) can SELECT job rows; the EF stores no raw cell content in `errors`, so the leak surface is metadata-only (row counts, status, error codes). See P2-2 if a tighter "tenant_admin only" SELECT is desired. |
| INSERT policy (tenant_admin only) | `:75-81` | OK — `with check ((tenant_id = current_tenant_id() and is_tenant_admin()) or is_system_admin())`. The EF bypasses this via service_role but pins tenant_id from JWT claims (see §1). |
| UPDATE policy (tenant_admin only, both USING + WITH CHECK) | `:85-95` | OK — WITH CHECK prevents an admin from moving a job row to another tenant. |
| DELETE policy (tenant_admin only) | `:98-104` | OK |
| `enforce_plan_line_tenant()` SECURITY DEFINER + `search_path=''` | `:124-180` | OK — fully-qualified table refs (`public.%I`); allow-list inside the function (`tg_table_name in ('movement_plan_lines','inventory_plan_lines')`), else 42501; dynamic SELECT uses `format('%I')` quoting, no injection vector. Parent-not-found → 42501; tenant-mismatch → 42501. `revoke all … from public; grant execute to authenticated, service_role` (`:182-183`). |
| Trigger wiring | `:185-197` | OK — `before insert or update of (movement_plan_id|inventory_plan_id), tenant_id`. Includes both column-change paths so an UPDATE that re-parents OR rewrites tenant_id triggers the check. |
| `parsed_values` size CHECK | `:208-213` | OK — `pg_column_size(parsed_values) <= 8192` (binary on-disk size, generous for legit payloads). Idempotent via guarded `drop constraint if exists`. |
| Idempotency | every CREATE TABLE uses IF NOT EXISTS, CREATE POLICY preceded by DROP POLICY IF EXISTS, CREATE TRIGGER by DROP TRIGGER IF EXISTS, CHECK constraint name dropped first | OK |
| New SECURITY DEFINER fn `search_path` discipline | `set search_path = ''` at `:128` | OK — matches the Phase 1 / 3a pattern documented in pick-checker 013. |
| Allow-list duplication if any new switch | Trigger-table allow-list `(movement_plan_lines, inventory_plan_lines)` lives in code only (no DB CHECK). Defensible because the trigger is only attached to those two tables; the `else` branch is a defense-in-depth raise. | OK |

### 3. Server actions `src/lib/logi/actions.ts`

| Check | Where | Verdict |
|---|---|---|
| `"use server"` + `import "server-only"` belt-and-braces | `:1`, `:25` | OK |
| zod `safeParse` before Supabase insert | `:83-92` (movement), `:148-157` (inventory), `:218-229` (qr_scan_history) | OK — uses the Phase 3a `.strict()` schemas. |
| No service_role import | `:27` imports `createClient` from `@/lib/supabase/server` (anon-JWT via SSR cookies). Grep `service_role|createAdminClient` in `src/lib/logi/`: only JSDoc comments (`actions.ts:12`, `history.ts:19`). | OK |
| `tenant_id` pinned via JWT, never from client payload | `resolveTenantAndUser()` at `:58-74` reads `tenant_id` from `app_metadata` (not `user_metadata`). Insert payloads at `:101`, `:166`, `:239` set `tenant_id: ctx.tenantId` (server-derived). The corresponding zod schemas for record inserts (Phase 3a) do not include a `tenant_id` field — only `movementPlanInsertSchema` / `inventoryPlanInsertSchema` do (plan-level inserts not exposed via Phase 3b actions). | OK |
| `worker_id = auth.uid()` pinned | `:102`, `:167`, `:240` — `worker_id: ctx.userId` / `scanned_by: ctx.userId`. RLS WITH CHECK at the DB layer is the canonical gate; the server action just mirrors it. | OK |
| No raw_value in error paths / logs | `:222-229` — zod error returns `parsed.error.issues[0]?.message` only; the schema's `raw_value` `.max(QR_MAX_LENGTH)` / `.refine(noControlChars)` error messages reference the field name, never echo the value. The catch at `:289-297` returns `e.message` from a generic Error; the Supabase insert pre-step never logs `parsed.data.raw_value`. The success path returns the worker-view shape WITHOUT `rawValue` (`:271-287` — `QrScanHistoryRow` deliberately omits the field). | OK |
| Worker view ↔ admin view mixing | `history.ts:98-122` worker fetcher hits `v_qr_scan_histories` (no raw_value); admin fetcher (`:163-182` for id, `:188-215` for list) hits `v_qr_scan_histories_admin`. The detail page chooses ONE path based on `session.role` (`page.tsx:42-66`) — never both for the same caller. | OK |
| No throw across action boundary | All three functions wrap the body in try/catch and return `{ data, error }`. The catch returns `e.message` (safe — a Supabase error message contains no raw_value because raw_value never makes it into a Supabase error response). | OK |

### 4. History detail page `src/app/app/logi/history/[id]/page.tsx`

| Check | Where | Verdict |
|---|---|---|
| raw_value rendered only when `isAdmin` | `:42-46` — `isAdmin = role === 'tenant_admin' || role === 'system_admin'`; render gate at `:193` — `isAdmin && rawValue !== null`. | OK |
| Worker code path never sets `rawValue` | `:62-66` calls `fetchScanHistoryByIdForWorker` which returns `QrScanHistoryRow` (no `rawValue` field). The page-level `rawValue` variable stays `null` for workers. | OK |
| Not-found UX uniform across "wrong tenant" / "deleted" / "never existed" | `:105-109` — single Alert "該当履歴がありません" shown when `configured && !fetchError && !row`. RLS + view filter both yield `null` from `maybeSingle()` for cross-tenant ids → identical UX to a true 404. No row-existence oracle. | OK |
| 56×56 back button | `:77` — `h-14 w-14` (Tailwind 14 = 3.5rem = 56px). | OK |
| Auth redirect | `:38-40` redirects unauthenticated users to `/login?next=...` (the next param echoes the id slug verbatim; safe because Next router treats it as a relative path and the login route validates `next` server-side). | OK |
| ID parameter validation | The `id` slug is consumed by `eq("id", id).maybeSingle()` — Supabase JS serialises it as a parameterised filter, no SQL injection. If a non-UUID slug is passed, Postgres returns a parse error → `fetchError` is rendered as a generic Alert (`:99-103`). The error message comes from Supabase and does not include raw row data. | OK |

### 5. Scanner `src/components/scanner/Scanner.tsx`

| Check | Where | Verdict |
|---|---|---|
| Camera permission UX | `:115-118` — `getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })`. `NotAllowedError` / `SecurityError` mapped to `denied` state with explicit UI Alert (`:159-160`, `:294-297`). No auto-retry-to-grant attack path. | OK |
| 30s timeout → manual fallback | `:45` `SCAN_TIMEOUT_MS = 30_000`; `:152-156` stops camera, sets `timeout` state, opens manual modal. D-03 compliant. | OK |
| No raw QR payload logged | Grep `console\.log|console\.info|console\.debug` in `src/components/scanner/`: **0 hits**. Detector callback at `:140-149` calls `onResult(raw)` once and swallows detector errors silently. | OK |
| Manual fallback empty-string guard | `ManualInputModal.tsx:67-69` — `setTouched(true); if (v.trim().length === 0) return;` and an aria-live error message at `:130-137`. Submit button never bypasses the trim check. | OK |
| Stream cleanup on cancel / unmount | `stopCamera()` at `:77-93` clears interval, clears timeout, stops every MediaStream track, releases `srcObject`. Wired to component unmount at `:174-181` and to the cancel button at `:337-340`. No track-leak path. | OK |
| autoplay / fullscreen escape | `:127-128` — `playsInline = true; muted = true` per iOS Safari requirement. Prevents fullscreen player takeover. | OK |
| Detector formats restricted to QR | `:136` — `new detectorCtor({ formats: ["qr_code"] })`. Cannot be tricked into reading PDF417 / DataMatrix / etc. | OK |

### 6. Bundle leakage grep (Phase 3b delta)

| Grep pattern | Path | Hits | Verdict |
|---|---|---:|---|
| `service_role` | `.next/static/**/*.js` | 0 | OK |
| `SUPABASE_SERVICE_ROLE_KEY` | `.next/static/**/*.js` | 0 | OK |
| `raw_value` | `.next/static/**/*.js` | 0 | OK |
| `rawValue` | `.next/static/**/*.js` | 0 | OK |
| `raw_user_metadata` | `.next/static/**/*.js` | 0 | OK |
| `service_role\|createAdminClient` in `src/lib/logi/**` | source | 2 (JSDoc-only, no code) | OK |
| `service_role\|createAdminClient` in `src/lib/csv/**` | source | 0 | OK |
| `console.log/info/debug` in `src/components/scanner/**` | source | 0 | OK |
| `console.log/info/debug` in `src/lib/logi/**` | source | 0 | OK |
| `console.log/info` in `supabase/functions/**` | source | 0 | OK |

### 7. npm audit delta (Phase 3b)

`package.json` dependencies / devDependencies are unchanged vs. Phase 3a. Baseline `npm audit` from Phase 2 stands (7 moderate / 0 high / 0 critical, all build-time / dev-time). Not blocking.

**However**, `src/lib/csv/encode.ts:19` imports `iconv-lite` and `iconv-lite` is NOT listed in `package.json` (it exists in `node_modules` at v0.6.3 only as a transitive dependency, surfaced via npm hoisting of e.g. `whatwg-encoding` → `iconv-lite`). This is a **build-fragility hazard** under strict installers (pnpm without hoisting, npm with `--strict-peer-deps`, yarn berry). Flagged as P2-3 below.

---

## FINDINGS

### [P2 — new, resolved (docs only)] csv-import-edge-function-storage-roundtrip-design-vs-implementation

- **Where**: `supabase/functions/movement-csv-import/index.ts:264-298` and `supabase/functions/inventory-csv-import/index.ts:206-238` (request body streamed in-process); `ARCHITECTURE.md §4` (Storage `imports/<tenant>/<uuid>.csv` 30-day retention + server-side UUID rename described as the canonical CSV flow).
- **Observed**: ARCHITECTURE §4 documents a flow where the client uploads to Supabase Storage at a UUID-renamed path, and the Edge Function reads from Storage. The Phase 3b implementation instead accepts the file as the request body directly. The `source_storage_path` field stored on `csv_import_jobs` (`:340-346`) is a caller-supplied query parameter and is never validated, never used to open a file, and never serves traffic — purely audit metadata. There is therefore **no exploitable path traversal** today.
- **Why P2 (now resolved docs-only)**: design-vs-implementation drift. If a future iteration begins reading from `source_storage_path` (e.g. to support resumable / async imports per the original §4 design), the lack of UUID-rename and the lack of path normalisation would become a path-traversal vector. Documenting the drift now prevents that regression.
- **Resolution**: `ARCHITECTURE.md §4` now contains an explicit "CSV 取込 実装状況 (Phase 3b 以降)" paragraph stating that (a) the current EF uses the inline body stream flow adopted in Phase 3b, (b) the Storage UUID-rename roundtrip is retained as a Phase 4+ future pointer for >10 MB / async-retry use cases, and (c) `csv_import_jobs.source_storage_path` is audit-only metadata with no read path today. No code, migration, or Edge Function change required; closure is administrative.
- **Future-Phase carry-over (informational, NOT blocking this closure)**: if/when the Storage roundtrip is re-introduced under (b), enforce `path = ${tenant_id}/${gen_random_uuid()}.csv` server-side and validate `path` against a strict regex before any Storage read. Tracked against Phase 4+ ARCHITECTURE §4 evolution.
- **Confidence**: high.

### [P2 — Phase 3a carryover, resolved (docs only)] soft-delete/trigger-permissive (`validate_target_tenant()`)

- **Where**: `supabase/migrations/20260512000300_phase3a_target_tenant_trigger.sql:57-62` (unchanged in Phase 3b).
- **Observed**: trigger does not filter by `deleted_at IS NULL` — a scan can reference a soft-deleted target so long as `target_tenant_id = NEW.tenant_id`. Product decision per Phase 3a audit; documentation note added to `QR_SPEC.md §7` ("target_tenant trigger の soft-delete 許容方針") in this dispatch.
- **Why P2 (now resolved docs-only)**: not exploitable; same risk profile as Phase 3a (permissive design choice). The behaviour change would be product-driven, not security-driven. Closed administratively via the docs note; trigger code unchanged.
- **Resolution**: `QR_SPEC.md §7` now records the product decision and cites the migration line range (57-62). No code change required.
- **Confidence**: medium (product call).

### [P2 — new, build hygiene] undeclared-direct-dependency-on-iconv-lite

- **Where**: `src/lib/csv/encode.ts:19` (`import iconv from "iconv-lite";`) imports a package not listed in `package.json`. `node_modules/iconv-lite/package.json` reports v0.6.3 — present only as a transitive dep (e.g. via `whatwg-encoding`).
- **Observed**: today's `npm install` succeeds thanks to hoisting; under strict installers (pnpm default, yarn berry's `nodeLinker: pnp`, npm `--legacy-peer-deps=false` + `--strict-peer-deps`) the import would fail at module-resolution time. Not a runtime security finding, but a build-supply-chain hazard (transitive resolution can pin a different version next install, including a vulnerable one without showing in `npm audit`'s direct-dep view).
- **Why P2**: dependency-supply integrity. No exploit today.
- **Fix**: add `"iconv-lite": "^0.6.3"` to `dependencies` in `package.json` and re-run `npm install` so the lockfile records the direct intent.
- **Confidence**: high.

---

## Phase 3a P2 residuals — status this audit

| ID | Phase 3a P2 | Phase 3b status | Citation |
|---|---|---|---|
| soft-delete trigger (validate_target_tenant) | open | **resolved (docs only)** — `QR_SPEC.md §7` product-decision note landed this dispatch | `supabase/migrations/20260512000300_phase3a_target_tenant_trigger.sql:57-62` |
| plan_lines tenant drift | open | **CLOSED** | `supabase/migrations/20260512000600_phase3b_csv_jobs.sql:124-197` — `enforce_plan_line_tenant()` SECURITY DEFINER trigger on both plan_lines tables. |
| parsed_values upper bound | open | **CLOSED at DB layer** (zod-side tightening optional — DB CHECK is authoritative) | `supabase/migrations/20260512000600_phase3b_csv_jobs.sql:208-213` — `CHECK (pg_column_size(parsed_values) <= 8192)`. |

---

## RLS POLICY TEST SQL (Phase 3b additions)

Live-gated tests added in Phase 3b (all `RUN_LIVE_RLS_TESTS=1`):

| ID | Table / surface | Scenario | Static review | Live exec |
|---|---|---|---|---|
| RLS-007 (live mirror) | qr_scan_histories | cross-tenant target_id INSERT rejected by `validate_target_tenant()` — present in BOTH `rls-phase3a.test.ts` and `rls-live.test.ts:267-301` | ✅ trigger code matches spec | ✅ PASS 2026-05-13 |
| RLS-102 | tenant_field_settings | T2 worker cross-tenant SELECT returns 0 rows | ✅ same-tenant policy | ✅ PASS 2026-05-13 |
| RLS-105 | qr_format_definitions | worker INSERT + UPDATE rejected | ✅ tenant_admin-only INSERT / UPDATE policies | ✅ PASS 2026-05-13 |
| RLS-106 | match_rules | tenant_admin UPDATE SET tenant_id=other rejected by WITH CHECK | ✅ WITH CHECK pins tenant_id | ✅ PASS 2026-05-13 |
| RLS-107 | csv_import_definitions | worker UPDATE rejected (tenant_admin only) | ✅ tenant_admin-only UPDATE policy | ✅ PASS 2026-05-13 |
| RLS-301 | csv_import_jobs | T2 worker cross-tenant SELECT returns 0 rows; T1 admin same-tenant SELECT returns the seeded row | ✅ same-tenant SELECT policy (migration 600 :67-70) | ✅ PASS 2026-05-13 (added in dispatch T-20260513-250000) |
| RLS-302 | csv_import_jobs | worker INSERT rejected (tenant_admin-only INSERT policy) | ✅ tenant_admin-only INSERT (migration 600 :75-81) | ✅ PASS 2026-05-13 (added in dispatch T-20260513-250000) |

Live regression total this phase (post-2026-05-13 dispatch): `rls-live` 11 + `rls-phase3a` 11 + `coverage-gap-closure` 8 = **30 pass / 0 regression**.

---

## UNVERIFIED_ITEMS

These cannot be confirmed by static read alone — they require either the live Supabase project, a live HTTP request to the Edge Function, or a browser-equivalent runtime check:

1. **Live exec of Phase 3a regression (`tests/integration/rls/rls-phase3a.test.ts`) and Phase 3b coverage-gap (`coverage-gap-closure.test.ts`) + Phase 3b new RLS-007 in `rls-live.test.ts:267-301`** — same gate as Phase 3a audit. Blocked in this dispatch because the canonical Supabase env-vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are not exported under their canonical names in this shell (only `SUPABASE_ACCESS_TOKEN` is). Resume steps:
   1. From the kobo home shell where `.env.local` is sourced, `cd workspace/projects/genba`.
   2. `node .kobo/apply-migrations.mjs` to apply migration `20260512000600_phase3b_csv_jobs.sql` (the four Phase 3a migrations are already applied per Phase 3a audit).
   3. `RUN_LIVE_RLS_TESTS=1 npm run test -- tests/integration/rls/rls-phase3a.test.ts` — flips RLS-007 / 201..208 from pending to PASS.
   4. `RUN_LIVE_RLS_TESTS=1 npm run test -- tests/integration/rls/coverage-gap-closure.test.ts` — flips RLS-102 / 105 / 106 / 107.
   5. `RUN_LIVE_RLS_TESTS=1 npm run test -- tests/integration/rls/rls-live.test.ts` — confirms Phase 1/2 regression + the live mirror of RLS-007.
   6. Append PASS/FAIL per case to §3 of the audit doc.

2. **No live RLS test exists for `csv_import_jobs`** — **RESOLVED 2026-05-13** by dispatch `T-20260513-250000-genba-csv-import-jobs-rls-301-302`.
   - RLS-301 (T2 worker SELECT csv_import_jobs of T1 → 0 rows; T1 admin same-tenant SELECT returns 1 row sanity check) and RLS-302 (worker INSERT into csv_import_jobs rejected by the tenant_admin-only INSERT policy at migration `20260512000600:75-81`) added to `tests/integration/rls/coverage-gap-closure.test.ts`.
   - Live execution: `RUN_LIVE_RLS_TESTS=1 npm test -- tests/integration/rls/coverage-gap-closure.test.ts` → 8 pass / 0 fail (RLS-102 / 105×2 / 106 / 107 / 301 / 302 + gating).
   - Combined regression `rls-live` (11) + `rls-phase3a` (11) + `coverage-gap-closure` (8) = 30 pass / 0 regression.
   - Evidence: `.kobo/qa-summary-T-20260513-250000-genba-csv-import-jobs-rls-301-302.json` and `.kobo/final-report-T-20260513-250000-genba-csv-import-jobs-rls-301-302.md`.

3. **Live Edge Function envelope test (Content-Type 415 / size 413 / row 413 / formula injection round-trip)** — `tests/unit/csv-formula-injection.test.ts` covers the in-process sanitiser; an end-to-end test that POSTs malformed multipart to the deployed EF and asserts response codes is not in this dispatch. Recommended: add a `tests/integration/csv/edge-function.live.test.ts` analogue (gated like the RLS tests) for Phase 4.

4. **Live Storage policy (if Phase 4 introduces the documented `imports/<tenant>/<uuid>.csv` flow)** — N/A for Phase 3b because the EFs stream the body inline. Surface to revisit at Phase 4.

5. **Postgres `pg_column_size(jsonb) <= 8192` semantics on Supabase** — the CHECK at `20260512000600:212` evaluates on every INSERT/UPDATE. Cost is negligible for normal payloads; verify under the live project at first deploy that no existing row violates the new constraint (Phase 3a-seeded scan-history rows should all be well under 8 KB binary).

6. **Phase 1 / 2 prior carryovers** (refresh-token revoke P1; Supabase Auth rate-limit values) — unchanged this audit; tracked in Phase 5 backlog.

---

## Recommendations (non-blocking)

1. **Resolve the iconv-lite undeclared direct dep** (P2-3 above): add `iconv-lite` to `dependencies` in `package.json` and update the lockfile in a tiny dispatch.
2. ~~**Document the soft-delete-target product call** in `QR_SPEC.md §7`~~ — **DONE** in this dispatch. `QR_SPEC.md §7` now contains the product decision ("soft-deleted targets are accepted; scan record retains forensic value") with a citation to `supabase/migrations/20260512000300_phase3a_target_tenant_trigger.sql:57-62`. Phase 3a P2 #1 closed administratively; trigger code unchanged.
3. **Add `csv_import_jobs` live RLS coverage** (RLS-301 cross-tenant SELECT zero rows; RLS-302 worker INSERT rejected) — closes UNVERIFIED_ITEM #2 cheaply.
4. ~~**Reconcile ARCHITECTURE §4 with the inline-body EF implementation**~~ — **DONE** in dispatch `T-20260514-050000-genba-architecture-csv-flow-reconcile`. `ARCHITECTURE.md §4` now carries the "CSV 取込 実装状況 (Phase 3b 以降)" paragraph documenting the inline body stream as current, the Storage UUID-rename roundtrip as a Phase 4+ future pointer, and `source_storage_path` as audit-only metadata. The corresponding P2 FINDINGS entry is closed administratively (docs only); no code change.
5. **Tighten `parsed_values` zod cap** (defensive layering; the DB CHECK already protects storage). One-line addition to `qrScanHistoryInsertSchema` at `src/lib/logi/validators.ts:189`: `.refine(v => Object.keys(v).length <= 64, 'parsed_values は最大64キーです')`.
6. **Phase 4 audit should re-verify** that the `csv_import_jobs.errors` jsonb continues to hold only `{row, code, message}` shapes and never inadvertently captures raw cell content from CSVs (today's EFs honour this; a future bulk-insert retry path could regress).

---

## VERDICT

**pass**.

Justification:

- P0 = 0; P1 = 0.
- 3 P2 items: one new (architecture-vs-implementation drift on CSV path traversal — currently *not* exploitable because the EFs stream inline), one carryover (soft-delete documentation note), one new build-hygiene (iconv-lite direct-dep declaration). None are exploitable today; all have explicit non-blocking fixes.
- All three Phase 3a P2 items are now closed: plan_lines tenant drift and parsed_values upper bound CLOSED by migration `20260512000600_phase3b_csv_jobs.sql`; the soft-delete trigger item is RESOLVED (docs only) — `QR_SPEC.md §7` now records the product decision and trigger code is unchanged.
- The full LOGI surface (Scanner + UI screens + CSV pipeline + server actions + history detail) was reviewed against STRIDE / OWASP categories relevant to this delta: bundle leakage (clean), service_role boundary (clean), JWT-pinned tenant_id (clean), formula injection (covered + unit-tested), DoS guards (10MB + 100k row + 200-error short-circuit, all enforced), raw_value role-gated rendering (clean — admin-only path via session.role).
- DoD criteria met: `service_role` outside server-only paths = 0 hits in `src/lib/logi/` (JSDoc comments only); `raw_value` / `rawValue` / `raw_user_metadata` in `.next/static/**/*.js` = 0 hits each; `console.log` in scanner + logi + supabase functions = 0 hits.

## NOTIFY_OWNER

**false** — no P0 remains; P2 items are non-blocking with documented Phase-4 / docs-sweep remediation paths.

---

## Revision history

| date | revision | author |
|---|---|---|
| 2026-05-12 | Phase 3b second double-audit pass — Scanner / UI / CSV / EFs / migration 600 / new tests. P0=0 P1=0 P2=3. 2 of 3 Phase 3a P2 carryovers closed by migration 600. VERDICT pass. | security-auditor (Phase B/C, Read-only) |
| 2026-05-13 | UNVERIFIED_ITEMS-2 resolved: csv_import_jobs live RLS coverage added (RLS-301 / 302) and live-executed. RLS POLICY TEST SQL table refreshed with PASS marks for all Phase 3b cases. No code/policy/migration change. | backend (dispatch T-20260513-250000-genba-csv-import-jobs-rls-301-302) |
| 2026-05-14 | FINDINGS P2 `csv-import-edge-function-storage-roundtrip-design-vs-implementation` resolved (docs only) via `ARCHITECTURE.md §4` "CSV 取込 実装状況 (Phase 3b 以降)" paragraph: inline body stream is current; Storage UUID-rename is a Phase 4+ future pointer; `source_storage_path` is audit-only. Summary breakdown and Recommendation #4 updated to match. No code / migration / EF / `source_storage_path` read-path change. | architect (dispatch T-20260514-050000-genba-architecture-csv-flow-reconcile) |
