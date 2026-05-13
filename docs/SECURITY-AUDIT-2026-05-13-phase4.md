# GENBA Phase 4 Security Audit (manufacturing — Phase 4a/4b/4c + 4d-prep live exec)

date: 2026-05-13
task_id: T-20260513-240000-genba-phase4d-prep
scope: Phase 4 delta — six manufacturing migrations (20260520000100..600) + `src/lib/works/{actions,validators,types,history,index}.ts` + `src/lib/validation/shared.ts` + `src/lib/auth/server-tenant.ts` + `supabase/functions/manufacturing-plan-csv-import/{index,parser}.ts` + `src/app/app/works/manufacturing/{page,ManufacturingFlow}.tsx` + `src/components/works/{DefectListInput,ProcessSelector,ProduceInflowToggle}.tsx` + tests (`works-validators`, `manufacturing-csv-formula-injection`, `tests/integration/rls/rls-phase3a.test.ts` Phase 4d block, `tests/integration/csv/manufacturing-plan-csv-import.live.test.ts`).
data_classification: pii-adjacent (worker login_id = email) + business-data (item_code / order_no / lot / equipment / defect codes inside QR raw_value / CSV row payloads, plus production schedule headers). No payment data, no end-user image upload.
auditor mode: Read-only static review (Grep + Read) + Phase 4d-prep live RLS execution.

prior_audits: phase1 (`docs/SECURITY-AUDIT-2026-05-11-phase1.md`, pass), phase2 (`docs/SECURITY-AUDIT-2026-05-12-phase2.md`, conditional pass), phase3a (`docs/SECURITY-AUDIT-2026-05-12-phase3a.md`, pass post-fix), phase3b (`docs/SECURITY-AUDIT-2026-05-12-phase3b.md`, pass; P0=0 P1=0 P2=3; updated 2026-05-13 with RLS-301/302).

---

## Summary

- P0: **0**
- P1: **0**
- P2: **2** (two new Phase 4 items below; Phase 3b iconv-lite carryover CLOSED — `package.json:28` now declares `iconv-lite ^0.6.3` directly)
- VERDICT: **conditional pass** — Phase 4 code-side security posture is clean (P0=0 / P1=0); the EF live-envelope evidence remains UNVERIFIED in this dispatch because the `manufacturing-plan-csv-import` Edge Function is not yet deployed to the live Supabase project (HTTP 404 from `/functions/v1/manufacturing-plan-csv-import`). Static envelope review is OK; live exec is owner-gated for the Phase 4d-deploy dispatch.
- NOTIFY_OWNER: **false** — no exploitable findings, deployment-gap is acknowledged Phase 4d-deploy scope.

Phase 3b P2 status this audit:

| ID | Phase 3b P2 | Phase 4 status |
|---|---|---|
| csv-import-edge-function-storage-roundtrip-design-vs-implementation (ARCHITECTURE §4 drift) | open (P2-1 of Phase 3b) | **inherited unchanged** — Phase 4 EF (`manufacturing-plan-csv-import`) follows the same in-process body-stream pattern as Phase 3b movement/inventory EFs (`source_storage_path` is metadata-only, never opened). No new exploit vector. Reconciliation with ARCHITECTURE §4 is still on the Phase 4d-deploy / docs-sweep backlog. |
| soft-delete trigger permissive (`validate_target_tenant()`) | resolved docs-only (Phase 3b) | **unchanged** — Phase 4 added `manufacturing_records` / `manufacturing_plans` / `mfg_processes` to `qr_scan_histories.target_table` allow-list (in fact the allow-list already hard-coded those names from Phase 3a); the same `deleted_at IS NULL` filter is intentionally absent for forensic continuity. `QR_SPEC §7` product-decision note still authoritative. |
| undeclared-direct-dep on `iconv-lite` (P2-3 of Phase 3b) | open | **CLOSED** — `package.json:28` now lists `"iconv-lite": "^0.6.3"` as a direct `dependencies` entry (added in an earlier Phase 4 dispatch). `npm install` no longer relies on transitive hoisting; strict installers (pnpm / yarn berry pnp) will resolve cleanly. P2 build-hygiene carryover resolved. |
| `parsed_values` upper bound (Phase 3a → 3b) | CLOSED at DB layer | **unchanged** — `pg_column_size(parsed_values) <= 8192` CHECK still in effect; Phase 4 WORKS path uses the same `qr_scan_histories` row shape so the cap is inherited. |
| Phase 3b RLS-301 / RLS-302 (csv_import_jobs live coverage) | RESOLVED 2026-05-13 | **regression confirmed** — live exec this dispatch passes 8/8 (RLS-102 / 105×2 / 106 / 107 / 301 / 302 + gating). See §RLS POLICY TEST SQL. |

---

## Static Check Results

### 1. Migration security (20260520000100..600)

| Migration | Item | Where | Verdict |
|---|---|---|---|
| `20260520000100_phase4_works_masters.sql` | masters alignment — only `add column if not exists note text` on `processes` / `equipment` / `defect_groups` / `defects` | `:36-43` | OK — no new RLS surface; masters' Phase 2 same-tenant SELECT + tenant_admin modify policies remain authoritative. |
| `20260520000200_phase4_manufacturing_plans.sql` | `manufacturing_plans` RLS: SELECT same-tenant + system_admin / modify tenant_admin (WITH CHECK) | `:65-80` | OK |
| | `mfg_processes` RLS: SELECT same-tenant + system_admin / modify tenant_admin (WITH CHECK) | `:118-133` | OK |
| | `enforce_mfg_process_tenant()` SECURITY DEFINER + `set search_path = ''` + `revoke all from public; grant execute to authenticated, service_role` + trigger on `before insert or update of (manufacturing_plan_id, tenant_id)` | `:142-183` | OK — parent-not-found → 42501; parent-tenant mismatch → 42501. Fully-qualified `public.manufacturing_plans` (no `format('%I')` reflection injection vector — the parent table is hard-coded). Matches Phase 3b `enforce_plan_line_tenant` pattern with narrower allow-list (1 parent table, no TG_TABLE_NAME branching). |
| `20260520000300_phase4_manufacturing_records.sql` | `manufacturing_records` RLS: SELECT same-tenant + system_admin / INSERT worker `tenant_id=current AND worker_id=auth.uid()` / UPDATE self-or-admin with WITH CHECK pinning tenant_id / DELETE tenant_admin | `:87-118` | OK — INSERT WITH CHECK pins both `tenant_id` and `worker_id` (closes the RLS-202 / RLS-404 vector in one policy). UPDATE policy preserves the same pins. |
| | `manufacturing_record_defects` RLS: SELECT same-tenant + system_admin / INSERT worker `tenant_id=current AND created_by=auth.uid()` / UPDATE creator-or-admin / DELETE tenant_admin | `:151-182` | OK — `created_by = auth.uid()` is the worker-self gate; tenant_admin can override. |
| | `enforce_manufacturing_record_defect_tenant()` SECURITY DEFINER + `set search_path = ''` + trigger on `before insert or update of (manufacturing_record_id, tenant_id)` | `:190-232` | OK — same hardening as `enforce_mfg_process_tenant`; parent table `public.manufacturing_records` hard-coded; 42501 on drift. |
| `20260520000400_phase4_movement_records_link.sql` | adds `manufacturing_record_id` FK column + partial unique index `where manufacturing_record_id is not null and deleted_at is null` | `:1-45` | OK — partial UNIQUE protects against R-P4-04 (製造入庫 二重記録); soft-deleted rows are exempt so corrections / re-submits remain possible. |
| `20260520000500_phase4_submit_manufacturing_rpc.sql` | `submit_manufacturing_record(jsonb)` — **SECURITY DEFINER** + `set search_path=''` + JWT-pinned tenant_id (from `app.current_tenant_id()`) + JWT-pinned worker_id (from `auth.uid()`) | `:75-241` | OK with documented deviation from architect doc R-P4-16. The architect doc favoured SECURITY INVOKER; the Phase 4a backend dispatch chose SECURITY DEFINER for uniformity with Phase 3a/3b `enforce_*_tenant` triggers (`search_path=''` discipline). Mitigations against the SECURITY DEFINER RLS-bypass surface: (a) the function body reads `tenant_id` and `worker_id` exclusively from JWT (`app.current_tenant_id()`, `auth.uid()`) — never from `p_payload`; (b) the parent `mfg_processes` row is re-checked for tenant match (`:111-123`) before INSERT; (c) the child `manufacturing_record_defects` enforce-trigger is still triggered because triggers fire even under SECURITY DEFINER; (d) `EXECUTE` is granted only to `authenticated` (not `anon` / `public`). See **FINDING P2-A** below for a recommendation to add a comment-level note in the function source restating the JWT-pin contract. |
| `20260520000600_phase4_rls_tests.sql` | docs-only header for live RLS exec | `:1-40` | OK — no DDL/DML; cross-references the vitest live block (this dispatch unskipped). |

### 2. Server actions `src/lib/works/actions.ts`

| Check | Where | Verdict |
|---|---|---|
| `"use server"` + `import "server-only"` | `actions.ts:1`, `:39` | OK |
| zod `safeParse` before Supabase insert / RPC | `:131-145` (submit), `:217-228` (defects bulk), `:298-309` (plan from import) | OK — all three paths use strict zod schemas from `validators.ts` / `validation/shared.ts`. |
| No service_role import | grep `service_role|createAdminClient` inside `src/lib/works/`: **1 hit (`actions.ts:14`, JSDoc comment only — "not bypass them and never touch service_role")**. No code reference. | OK |
| `tenant_id` pinned via JWT (anon-JWT client) | `resolveTenantAndUser()` in `src/lib/auth/server-tenant.ts` reads `app_metadata.tenant_id`; insert payloads pin `tenant_id: ctx.tenantId` (server-derived). For `submit_manufacturing_record` RPC, the database function itself reads `app.current_tenant_id()` from JWT — even if the caller injects `tenant_id` into the payload it's ignored. | OK |
| `worker_id` / `created_by` pinned via `auth.uid()` | `submit_manufacturing_record` reads `auth.uid()`; defects bulk insert action sets `created_by: ctx.userId` on every row. | OK |
| No raw_value in error paths / logs | Throughout `actions.ts`: zod errors return `parsed.error.issues[0]?.message`; Supabase errors return `e.message`; no `raw_value` is ever fetched into a WORKS action (`raw_value` lives in `qr_scan_histories` which Phase 4 only reads via `v_qr_scan_histories` for workers and `v_qr_scan_histories_admin` for tenant_admin). | OK |
| `console.log/info/debug` | grep across `src/lib/works/**`: **0 hits**. | OK |

### 3. Edge Function `supabase/functions/manufacturing-plan-csv-import/`

| Control | Where | Verdict (static) |
|---|---|---|
| Content-Type 415 (substring allow-list: `text/csv` / `application/vnd.ms-excel` / `spreadsheet` / `application/octet-stream`) | `index.ts:74-82,141-147` | OK |
| 10 MB size 413 via Content-Length | `:149-152` | OK |
| 10 MB size 413 via streamed byte counter | `:170-184` | OK — fail-fast on chunked uploads. |
| 100k row 413 | `:200-207` | OK — `MAX_ROWS = 100_000`; header inclusive. |
| Per-row validation short-circuit at 200 errors | `:212-226` | OK — errors-array bounded; no raw cell content stored. |
| Formula injection prepend `=`, `+`, `-`, `@`, `\t`, `\r` | `parser.ts:21-40` (FORMULA_PREFIXES + `sanitizeCellForImport`) called in both `validateManufacturingPlanRow` and `validateMfgProcessRow` (`parser.ts:117`, `:195`) | OK |
| Bearer JWT round-trip (Supabase Auth `getUser()` — no local decode) | `index.ts:87-129` | OK — `bearer` prefix is case-insensitive; verification round-trip honours Auth revocation list. |
| `tenant_id` from JWT `app_metadata` only | `:114-127` | OK — `meta.tenant_id`; rejects with 403 `tenant_missing` if claim absent. Caller-supplied `tenant_id` query / form field is never trusted (CSV row schema has no `tenant_id` column). |
| `service_role` for bulk insert with JWT-pinned tenant_id pin | `:228-280` — `admin.from(table).insert(rowsToInsert)` where `rowsToInsert = valid.map(r => ({ ...r, tenant_id: ctx.tenantId }))` | OK — same pattern as Phase 3b movement/inventory EFs. |
| `errors` jsonb shape `{row, code, message}` (no raw cell content) | `:222-226`, `:269-274` | OK — `errors` array never includes raw row data. The bulk-insert failure path adds one `{row:0, code: insErr.code, message: insErr.message}` (Supabase error message — checked: does not include raw_value-like content because the Phase 4 EF inserts no QR raw_value). |
| `console.log/info/debug` in EF | grep `console\.(log|info|debug)` in `supabase/functions/manufacturing-plan-csv-import/**`: **1 hit — comment only** at `index.ts:34` (`// We deliberately log very little: no console.log(rawText) ever, ...`). | OK |
| Secret values never echoed | No `Deno.env.get(...)` is logged. SERVICE_ROLE / ANON_KEY appear only in `createClient(SUPABASE_URL, ...)` literals (`:51-54`, `:102-104`, `:228-230`). | OK |
| File path traversal | `source_storage_path` (query param) is stored as audit metadata only — `csv_import_jobs.source_storage_path` (`:232-247`). The EF never opens the path. | OK (same posture as Phase 3b movement/inventory EFs) |

### 4. UI / Components

| Surface | Check | Verdict |
|---|---|---|
| `src/app/app/works/manufacturing/page.tsx` | `service_role` grep | **1 hit — JSDoc comment only** ("service_role is never used here — every read flows through the anon-JWT") | OK |
| `ManufacturingFlow.tsx` | uses `useReducer` (pure reducer in `src/lib/works/...`); calls server actions only | OK |
| `<DefectListInput />` / `<ProcessSelector />` / `<ProduceInflowToggle />` | `console.log/info/debug` grep across `src/components/**`: **0 hits** | OK |
| Worker vs admin raw_value rendering | Phase 4 WORKS pages do NOT render `qr_scan_histories.raw_value`. The history detail page (`/app/logi/history/[id]`) is the only raw_value render surface and continues to gate on `session.role` (Phase 3a / 3b posture). | OK |
| `aria-live` / focus / 56×56 touch | Phase 4c UX-reviewer pass confirms `aria-live="polite"` on success Alert, `assertive` on NG Alert, 56×56 buttons on primary actions. No regression of Phase 3b a11y baselines. | OK |

### 5. Bundle leakage grep (Phase 4 delta)

| Grep pattern | Path | Hits | Verdict |
|---|---|---:|---|
| `service_role` | `.next/static/**/*.js` | 0 | OK |
| `SUPABASE_SERVICE_ROLE_KEY` | `.next/static/**/*.js` | 0 | OK |
| `createAdminClient` | `.next/static/**/*.js` | 0 | OK |
| `raw_value` | `.next/static/**/*.js` | 0 | OK |
| `raw_user_metadata` | `.next/static/**/*.js` | 0 | OK |
| `service_role\|createAdminClient` in `src/lib/works/**` | source | 1 (JSDoc-only) | OK |
| `service_role\|createAdminClient` in `src/components/works/**` | source | 0 | OK |
| `console.log/info/debug` in `src/lib/works/**` | source | 0 | OK |
| `console.log/info/debug` in `src/components/works/**` | source | 0 | OK |
| `console.log/info/debug` in `supabase/functions/manufacturing-plan-csv-import/**` | source | 1 (comment text only) | OK |
| `raw_user_metadata` in `src/**` | source | 3 (all warning comments — never read) | OK |

### 6. RPC source (`submit_manufacturing_record`)

| Check | Where | Verdict |
|---|---|---|
| `language plpgsql security definer set search_path = ''` | `20260520000500:77-79` | OK |
| `revoke all from public; grant execute to authenticated` | `:240-241` | OK — `anon` / `public` have no execute privilege. |
| `tenant_id` pinned from `app.current_tenant_id()` (JWT app_metadata) | `:82` | OK |
| `worker_id` pinned from `auth.uid()` | `:83` | OK |
| Parent tenant verification (defense-in-depth) | `:111-123` — even though the function bypasses RLS, it re-checks the parent `mfg_processes.tenant_id` matches the JWT tenant before insert. | OK |
| No `RAISE NOTICE` / `RAISE INFO` of caller-supplied values | Greppd full file: 0 hits of NOTICE/INFO. Only `RAISE EXCEPTION` with field-name strings (no raw payload values echoed). | OK |
| Defects-loop runs the enforce-trigger | `manufacturing_record_defects` `before insert` trigger fires per row even under SECURITY DEFINER caller; tenancy drift would 42501 even if a malformed payload slipped past the function's outer pin. | OK |

---

## RLS POLICY TEST SQL — Phase 4 live execution

Phase 4d-prep this dispatch (T-20260513-240000) live-executed RLS-401..408 with `RUN_LIVE_RLS_TESTS=1` against the same Supabase project that Phase 3a/3b regression runs on. Wrapper: `.kobo/run-live-rls-T-20260513-240000-genba-phase4d-prep.mjs`. Log: `.kobo/run-live-rls-T-20260513-240000-genba-phase4d-prep-v2.log`.

| ID | Table / surface | Scenario | Static review | Live exec (Phase 4d-prep) |
|---|---|---|---|---|
| RLS-401 | `manufacturing_plans` | T2 worker SELECT of T1 row returns 0 rows | ✅ same-tenant SELECT policy | ✅ PASS 2026-05-13 |
| RLS-402 | `mfg_processes` | worker INSERT rejected (tenant_admin-only modify policy) | ✅ tenant_admin-only modify policy | ✅ PASS 2026-05-13 |
| RLS-403 | `mfg_processes` | parent tenant drift INSERT (parent T2, denormalised T1) rejected by `enforce_mfg_process_tenant` | ✅ SECURITY DEFINER + `set search_path=''` | ✅ PASS 2026-05-13 |
| RLS-404 | `manufacturing_records` | worker INSERT with `worker_id != auth.uid()` rejected by WITH CHECK on insert policy | ✅ WITH CHECK pins both `tenant_id` and `worker_id` | ✅ PASS 2026-05-13 |
| RLS-405 | `manufacturing_records` | worker A updating worker B's row (same tenant) rejected by USING / WITH CHECK | ✅ self-or-admin policy | ✅ PASS 2026-05-13 |
| RLS-406 | `manufacturing_record_defects` | parent tenant drift INSERT rejected by `enforce_manufacturing_record_defect_tenant` | ✅ SECURITY DEFINER + `set search_path=''` | ✅ PASS 2026-05-13 |
| RLS-407 | `manufacturing_record_defects` | T2 worker cross-tenant SELECT returns 0 rows | ✅ same-tenant SELECT policy | ✅ PASS 2026-05-13 |
| RLS-408 | `qr_scan_histories` (target_table=`manufacturing_records`) | cross-tenant `target_id` rejected by Phase 3a `validate_target_tenant()` trigger (allow-list already includes manufacturing_records) | ✅ Phase 3a trigger code unchanged | ✅ PASS 2026-05-13 |

Combined live regression total this dispatch:

- `rls-live.test.ts` (Phase 1+2+3b): **11 PASS / 0 fail**
- `rls-phase3a.test.ts` (Phase 3a 11 + Phase 4d 8): **19 PASS / 0 fail**
- `coverage-gap-closure.test.ts` (Phase 2 carry-overs + Phase 3b 301/302): **8 PASS / 0 fail** (7 RLS cases + 1 gating)
- Total: **38 PASS / 0 fail / 0 regression**

EF live envelope (`manufacturing-plan-csv-import.live.test.ts`): **0 PASS / 6 fail (HTTP 404 from Supabase — function not deployed)**. See UNVERIFIED_ITEM #1.

---

## FINDINGS

### [P2-A — new, Phase 4] submit_manufacturing_record-rpc-security-definer-deviation

- **Where**: `supabase/migrations/20260520000500_phase4_submit_manufacturing_rpc.sql:75-79,82-83,109-123,240-241`.
- **Observed**: The Phase 4 architect doc (R-P4-16) called for `SECURITY INVOKER` so the RLS layer would self-enforce on every row written. The Phase 4a backend dispatch chose `SECURITY DEFINER` for parity with the Phase 3a/3b `enforce_*_tenant()` trigger pattern (uniform `set search_path = ''` discipline). The function compensates by (a) reading `tenant_id` from `app.current_tenant_id()` (JWT-only) and `worker_id` from `auth.uid()` — never from the caller payload, (b) re-checking the parent `mfg_processes.tenant_id` before INSERT, (c) granting `execute` only to `authenticated`, (d) not bypassing the per-table `enforce_manufacturing_record_defect_tenant` trigger which still fires.
- **Why P2**: design-vs-implementation divergence from the architect doc. Not exploitable today (all the pin sources are JWT-derived), but if a future PR adds a new INSERT path inside the function that reads `tenant_id` from `p_payload`, the SECURITY DEFINER bypass becomes load-bearing.
- **Fix (Phase 4d-deploy / hygiene sweep)**: either (a) reflect the dispatch decision in `docs/ARCHITECTURE-phase4-manufacturing.md` R-P4-16 with a one-line "**revised in Phase 4a backend dispatch — SECURITY DEFINER + JWT-pin contract**" note, or (b) re-write the function as SECURITY INVOKER (lower risk, also viable given the RLS policies already pin tenant_id + worker_id on every INSERT). Recommendation: (a) — the current pattern is consistent and tested.
- **Confidence**: high (the contract is enforced; the finding is design-doc drift only).

### [P2-B — new, Phase 4] manufacturing-plan-csv-import-undeployed-live-envelope-unverified

- **Where**: `supabase/functions/manufacturing-plan-csv-import/{index,parser}.ts` + `tests/integration/csv/manufacturing-plan-csv-import.live.test.ts`.
- **Observed**: The Edge Function source-of-truth implements the full envelope (415 / 10 MB / 100 k rows / formula injection prepend / JWT round-trip / `errors` shape) and is statically clean (§3). Phase 4d-prep added a live-gated envelope test that POSTs against the deployed `/functions/v1/manufacturing-plan-csv-import` endpoint. Live execution this dispatch returned HTTP 404 from Supabase (`{"code":"NOT_FOUND","message":"Requested function was not found"}`) — the function has not been deployed via `supabase functions deploy`. RLS-401..408 confirms the database-side surface; the network-edge envelope (415 / 413 / 413 / formula round-trip / 401) cannot be empirically confirmed until the deploy lands.
- **Why P2**: not exploitable (the function does not exist live; there is no surface to attack), but the MVP gate requires that the EF's CSV-injection-defense envelope is empirically observed at least once. Static analysis is high-confidence (mirrors Phase 3b movement/inventory EFs that have the same code shape), but a "static-only" sign-off would leave Phase 3b UNVERIFIED_ITEM #3 unresolved for the WORKS path.
- **Fix (Phase 4d-deploy)**: owner-authorised dispatch to (1) `supabase functions deploy manufacturing-plan-csv-import --project-ref <ref>` from the kobo home shell (backend role; dispatch's `Bash(supabase:*)` allowance), (2) re-run `node .kobo/run-live-rls-T-20260513-240000-genba-phase4d-prep.mjs` — should observe `415 + 413 + 413 + 200(formula prepended) + 401×2` on the EF block while RLS-401..408 stays green. Until then, the Phase 4 EF is gated to local-only behaviour (the UI degrades gracefully via `CsvUploadButton.demoMode`).
- **Confidence**: high — root cause = function not deployed (HTTP 404 is unambiguous).

### [P2 — Phase 3b carryover, CLOSED] undeclared-direct-dependency-on-iconv-lite

- **Where**: `package.json:28`.
- **Observed**: A pre-Phase-4d-prep dispatch added `"iconv-lite": "^0.6.3"` directly to `dependencies`. `src/lib/csv/encode.ts:19` now resolves via the explicit direct dep; strict installers (pnpm default / yarn berry pnp) will succeed without relying on transitive hoisting.
- **Resolution**: CLOSED.
- **Confidence**: high.

---

## Phase 4 risk-register reconciliation (architect doc §10 R-P4-01..20)

| Risk ID | Phase 4 closure status |
|---|---|
| R-P4-01 mfg_processes denorm drift | **CLOSED** by `enforce_mfg_process_tenant()` (RLS-403 live PASS). |
| R-P4-02 manufacturing_record_defects denorm drift | **CLOSED** by `enforce_manufacturing_record_defect_tenant()` (RLS-406 live PASS). |
| R-P4-03 qr_scan_histories.target_id cross-tenant | **CLOSED** by Phase 3a `validate_target_tenant()` (RLS-408 live PASS — manufacturing_records branch). |
| R-P4-04 製造入庫 二重記録 | **CLOSED** by `movement_records_manufacturing_unique_alive` partial UNIQUE (Phase 4a migration #4). |
| R-P4-05 部分書き込み (record vs defect) | **CLOSED** by `submit_manufacturing_record()` single-transaction RPC. |
| R-P4-06 offline 二重 submit | **DEFERRED** to Phase 8 (offline PWA). Phase 4 does not introduce a client-side idempotency token; risk acknowledged. |
| R-P4-07 QR spoofing / malformed scan | **MITIGATED** by Phase 3a `src/lib/qr/parser.ts` length / control-char / version guards. No new code path. |
| R-P4-08 raw_value worker exposure | **CLOSED** — WORKS pages do not render raw_value; history detail unchanged. |
| R-P4-09 CSV-import EF formula injection / DoS / path traversal | **CLOSED statically**, **UNVERIFIED live** (P2-B above). |
| R-P4-10 service_role bundle leakage | **CLOSED** — bundle grep clean (§5). |
| R-P4-11 多階層 access YAGNI | **ENFORCED** — no factory/line scoping landed; tenant_id remains the sole horizontal boundary. |
| R-P4-12 a11y regression in DefectListInput | **CLOSED** by Phase 4c axe pass (no regression vs Phase 3b). |
| R-P4-13 4業務統合履歴の情報過多 | **DEFERRED** — Phase 4c shipped business_code filter; UX polish continues in Phase 7. |
| R-P4-14 PITR / production_deploy 承認 遅延 | **OPEN (owner)** — Phase 4d-prep does not deploy. PITR + production_deploy authorisation is the Phase 4d-deploy entry condition. |
| R-P4-15 N=50 不適合 UI 劣化 | **DEFERRED** — virtualised list explicitly out of scope per architect doc; N≤20 assumption holds. |
| R-P4-16 submit_manufacturing_record RPC SECURITY INVOKER | **DEVIATED** — see P2-A. Mitigated in-line. |
| R-P4-17 訂正と製造入庫の整合 | **DEFERRED** — Phase 4 訂正 UI is read-only; write 訂正 is Phase 5. |
| R-P4-18 qr_scan_histories index degradation | **NO REGRESSION** — `qr_scan_histories_tenant_business_created_idx` covers `business_code='manufacturing'`. |
| R-P4-19 demo seed 本番混在 | **DEFERRED** — to be enforced via dedicated `tenants.slug='demo-mfg'` isolation at Phase 4d-deploy. |
| R-P4-20 命名差 (mfg_processes vs manufacturing_plan_processes) | **DOCUMENTED** in migration header + ADR-P4-01. |

---

## UNVERIFIED_ITEMS

1. **Live exec of `tests/integration/csv/manufacturing-plan-csv-import.live.test.ts`** — blocked this dispatch because the EF returns 404 (not yet deployed to the Supabase project). The test file lands with full coverage (415 / 413 / 413 / formula round-trip / 401×2) and is correctly gated on `RUN_LIVE_EF_TESTS=1` + the 3 Supabase env-vars. Resume steps (Phase 4d-deploy):
   1. From the kobo home shell (`.env.local` sourced), `cd workspace/projects/genba`.
   2. `supabase functions deploy manufacturing-plan-csv-import --project-ref <ref>` (backend role — owner-authorised under `paid_subscription_signup` / `production_deploy` umbrella).
   3. `node .kobo/run-live-rls-T-20260513-240000-genba-phase4d-prep.mjs` — RLS stays 38/38 PASS, EF flips to 6/6 PASS.
   4. Append the PASS marks to the table above (§RLS POLICY TEST SQL) and to P2-B `Fix` section.

2. **Live exec of `submit_manufacturing_record` RPC under a real authenticated session** — Phase 4d-prep verified RPC tenancy and defects insertion via the underlying RLS surface (RLS-401..408), but did NOT call the RPC end-to-end with an authenticated client. The full UC-4 round-trip (worker calls RPC → row + defects + optional movement_record inserted in one transaction) is exercised by the Phase 4c E2E `tests/e2e/works-manufacturing.spec.ts` which ships green in the Phase 4c run. Resume step: include an RPC-direct vitest in a future Phase 5 dispatch if test isolation is desired.

3. **Live exec of `movement_records_manufacturing_unique_alive` partial UNIQUE** — Phase 4a migration #4 lands the constraint; live regression has not yet exercised the "second alive INSERT rejected" path. Recommended: add to the Phase 4d-deploy live block (RLS-409 candidate).

4. **Supabase Auth rate-limit values** — Phase 4d-prep observed the project's auth-signIn rate limit hit at ~28 sign-ins per vitest run; the Phase 4d block now caches authenticated clients per user (4 sign-ins instead of 8) to stay under the limit. The exact rate-limit value (project-side dashboard) was not consulted in this dispatch (owner-side Supabase Auth dashboard read). Recommended: at Phase 4d-deploy, owner records the current Auth dashboard `email_signins_per_5min` value in `RUNBOOK.md` §emergency.

5. **iconv-lite direct-dep declaration** — Phase 3b P2-3 CLOSED in a pre-Phase-4d-prep hygiene dispatch (`package.json:28`).

---

## Recommendations (non-blocking)

1. **Deploy `manufacturing-plan-csv-import` EF + re-run live envelope test** (closes P2-B / UNVERIFIED_ITEM #1).
2. **Reflect the SECURITY DEFINER deviation** in `docs/ARCHITECTURE-phase4-manufacturing.md` R-P4-16 (closes P2-A).
3. **Reconcile ARCHITECTURE §4 with the inline-body EF flow** (Phase 3b P2-1 carryover) — same recommendation as Phase 3b; Phase 4 strengthens the case because three EFs now follow the inline pattern.
4. **Phase 4d-deploy live block additions**:
   - RLS-409: `movement_records_manufacturing_unique_alive` partial UNIQUE — second alive INSERT rejected; soft-deleted re-INSERT accepted.
   - EF envelope on the deployed `manufacturing-plan-csv-import` (this dispatch's test file, unmodified).
   - Bundle leakage grep re-run after a `npm run build` against the production Vercel branch (closes the "static grep was from local build artefacts" caveat).

---

## VERDICT

**conditional pass**.

Justification:

- **P0 = 0; P1 = 0**.
- **P2 = 2** (P2-A SECURITY DEFINER deviation — documented & mitigated by JWT-pin contract; P2-B EF undeployed live-envelope unverified — empirical evidence pending deploy). Phase 3b iconv-lite carryover CLOSED.
- **RLS-401..408 live PASS 8/8** + Phase 1–3b regression `rls-live 11 + rls-phase3a 11 + coverage-gap-closure 8 + rls-phase3a Phase 4d 8 = 38 PASS / 0 regression**.
- **Bundle leakage grep clean**: 0 hits of `service_role` / `SUPABASE_SERVICE_ROLE_KEY` / `raw_value` / `raw_user_metadata` / `createAdminClient` across `.next/static/**/*.js`.
- **Static envelope review of `manufacturing-plan-csv-import` matches Phase 3b movement / inventory EFs** — same code shape, same sanitiser, same JWT round-trip, same `errors` jsonb pattern. Live confirmation is gated on owner-authorised EF deploy (Phase 4d-deploy).
- **Phase 3a allow-list (`qr_scan_histories.target_table`) already covers manufacturing_*** — zero allow-list migration was required for RLS-408 live PASS.

The "conditional" qualifier applies only to the empirical EF envelope evidence. The codebase itself is at P0=0 / P1=0 with all Phase 4 RLS surfaces live-verified.

## NOTIFY_OWNER

**false** — no P0 / P1; deployment-gap is acknowledged Phase 4d-deploy entry condition, not a Phase 4d-prep blocker.

---

## Revision history

| date | revision | author |
|---|---|---|
| 2026-05-13 | Phase 4 first double-audit pass — 6 manufacturing migrations + WORKS server actions + `manufacturing-plan-csv-import` EF + WORKS UI + Phase 4d-prep RLS-401..408 live exec. P0=0 P1=0 P2=3. EF live envelope blocked on owner-authorised deploy. VERDICT conditional pass. | security-auditor (dispatch T-20260513-240000-genba-phase4d-prep, Read-only) |
