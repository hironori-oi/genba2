# GENBA RUNBOOK

最終更新: 2026-05-15 / Phase 6a foundation (T-20260515-050000-genba-phase6a-foundation)

このドキュメントは genba プロジェクトの開発 / 運用 / 緊急対応 / テスト実行 / 監査ログの **すべての手順** をオーナー + 後続ディスパッチが再現できるように記録する。Phase 1〜4d-deploy の経験を集約。

## 0. 本番情報 (Phase 4d-deploy 確定)

- **Production URL**: <https://genba2-ai.vercel.app/>
- **Hosting**: Vercel (production branch = `main`)。push → 自動 build & deploy。
- **DB / Auth / Storage / Edge Functions**: Supabase (Free tier、Phase 4d-deploy 時点で課金プランは未契約)。
- **Backup 方針**: Supabase 標準 **日次バックアップのみ**。PITR は **本フェーズで採用見送り** (詳細は §3.3 / §6)。
- **Phase 4d-deploy 本番投入の経緯**: 本番デプロイと環境変数設定は **オーナー手動**で完了 (2026-05-14 Slack: 「Vercel deploy + env vars 完了、PITR 使用しない方針」)。本ディスパッチは production deploy / paid signup / PITR enable / migration 適用は一切行わず、read-only smoke test とドキュメント反映のみを担当。
- **Phase 4d-deploy 本番 smoke test (2026-05-14, .kobo/prod-smoke-T-20260514-110000-...)**:
  - `GET /` → HTTP 200 (Next.js HTML, `lang="ja"` 確認、CSS/JS chunks 配信)
  - `GET /login` → HTTP 200 (login page 描画確認)
  - `GET /app/logi` → HTTP 307 → `Location: /login?next=%2Fapp%2Flogi` (Next 15 middleware の auth redirect は標準 307。`302` 期待値の意味的等価)
  - `GET /app/works/manufacturing` → HTTP 307 → `Location: /login?next=%2Fapp%2Fworks%2Fmanufacturing`
  - 5xx = 0 / transport error = 0

---

## 1. Dev environment setup / dev server startup / live env connection

### 1.1 ローカル開発環境の前提

- WSL2 (Ubuntu) 上で WSL bash を使用 (`/mnt/c/Users/hiron/Documents/kobo/...`)。
- Node 22.x (Vercel + Next 15 の対応版)、npm 10.x、Playwright Chromium、Supabase CLI (`/usr/local/bin/supabase`)。
- リポジトリ ルート: `/mnt/c/Users/hiron/Documents/kobo/workspace/projects/genba`。
- kobo ホーム: `/mnt/c/Users/hiron/Documents/kobo` (`KOBO_HOME` 環境変数で参照可)。

### 1.2 シークレット復号 (`.env.local` 生成)

```bash
# kobo ホームで実行 (orchestrator は触らない、オーナー専用)
cd /mnt/c/Users/hiron/Documents/kobo
./scripts/secrets-decrypt.sh
# → workspace/projects/genba/.env.local が生成される。
#   含まれるキー:
#     NEXT_PUBLIC_SUPABASE_URL=
#     NEXT_PUBLIC_SUPABASE_ANON_KEY=
#     SUPABASE_SERVICE_ROLE_KEY=    # service_role は server-only / EF / migration apply 専用
#     SUPABASE_ACCESS_TOKEN=        # supabase CLI / api.supabase.com 用
# `.env.local` は `.gitignore` 済。コミット禁止。
```

### 1.3 依存インストール

```bash
cd /mnt/c/Users/hiron/Documents/kobo/workspace/projects/genba
npm install
npx playwright install --with-deps chromium   # 初回のみ
```

### 1.4 Dev server 起動 (Next 15)

kobo の wrapper 経由で起動 (tmux session 名 `kobo-dev-genba` で隔離):

```bash
/mnt/c/Users/hiron/Documents/kobo/scripts/run-dev.sh genba
# 内部で:
#   tmux new-session -d -s kobo-dev-genba 'cd workspace/projects/genba && npm run dev'
#   PORT は .kobo/dev-port.json に書かれる (デフォルト 3000)
# 停止:
tmux kill-session -t kobo-dev-genba
```

直接 `npm run dev` を呼ばない (kobo 統制下のセッション管理を経由するため)。

### 1.5 Live Supabase 接続確認 (シークレット値は出さない)

```bash
node .kobo/env-presence-probe-T-20260513-120000.mjs
# 期待 stdout: 各環境変数が "defined" / "missing" (値は出ない)
```

`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` が `defined` ならライブ接続準備完了。

### 1.6 Lighthouse / a11y チェック (任意)

```bash
/mnt/c/Users/hiron/Documents/kobo/scripts/run-lighthouse.sh genba /login
# 出力: .kobo/lighthouse-T-<TASK_ID>.json
```

---

## 2. Dispatch startup steps (F-6 host fix / WSL bash path)

Phase F-2/F-3/F-6 で確立した dispatch 経路。Claude CLI orchestrator が `--add-dir workspace/projects/genba` で起動される。

### 2.1 Dispatch wrapper の標準形 (`.kobo/run-orchestrator-<TASK_ID>.sh`)

```bash
#!/usr/bin/env bash
set -euo pipefail
TASK_ID="T-..."
SLUG="genba"
export KOBO_HOME="/mnt/c/Users/hiron/Documents/kobo"
export PROJECT_SLUG="$SLUG"
# F-6: WSL bash の絶対 path で起動 (cygwin / git-bash と区別)
BASH=/usr/bin/bash
# .env.local を source して環境変数を populate
set -a; . "$KOBO_HOME/workspace/projects/$SLUG/.env.local"; set +a
# F-2: tmux EXIT trap で dev session を確実に kill
trap '"$KOBO_HOME/scripts/dispatch-lock.sh" release "$SLUG" "$TASK_ID" || true; \
      tmux kill-session -t "kobo-dev-${SLUG}" 2>/dev/null || true' EXIT
# Claude orchestrator (Opus)
claude --add-dir "$KOBO_HOME/workspace/projects/$SLUG" \
       --max-turns 250 \
       --allowedTools "..." \
       --disallowedTools "AskUserQuestion,Bash(vercel:*--prod*),..." \
       < "$KOBO_HOME/workspace/projects/$SLUG/.kobo/orchestrator-prompt-${TASK_ID}.txt"
```

### 2.2 同 slug 排他 (dispatch-lock)

`scripts/dispatch-lock.sh` が `flock` で `kobo-dev-${SLUG}` の同時起動を排他する。重複 dispatch を防ぐ。

### 2.3 Sandbox 観察 (`docs/SANDBOX-BEHAVIOR.md` 参照)

- workdir 外パスは Bash で触れない → **Read tool 経由で読み込む**。
- `tmux:*` は broader pattern で許可。kill-session は wrapper EXIT trap で代行。
- `AskUserQuestion` は `deny_tools` で技術的に禁止。判断必要時は `STATUS: blocked` で完了報告。

---

## 3. Emergency response

### 3.1 kobo-gateway 再起動 (オーナー専用)

kobo の director (Hermes) が応答しない / Slack interactive button が反映されない場合:

```bash
# kobo home から
cd /mnt/c/Users/hiron/Documents/kobo
./scripts/restart-kobo.sh        # graceful: stop → start
# 過酷時:
./scripts/stop-kobo.sh
sleep 2
./scripts/start-kobo.sh
# → director + scheduler + gateway を再起動。
#   `audit-*.jsonl` に restart イベントが記録される。
```

### 3.2 Hermes (director) リカバリ

- Codex/ChatGPT Pro の OAuth セッションが切れた場合は `./scripts/restart-kobo.sh` 後に Slack でオーナーが手動 sign-in を要求される。
- worker dispatch が timeout した場合 (max_turns / max_minutes 到達)、Slack `#kobo-control` に `dispatch_timeout` 通知。残存 tmux セッションは `tmux kill-session -t kobo-dev-genba` で除去。

### 3.3 Database rollback (Supabase Postgres)

**現状 (2026-05-14, Phase 4d-deploy)**: Supabase **Free tier で本番運用開始**。PITR は採用見送り (オーナー判断、詳細は §6)。

- **採用バックアップ**: Supabase Free 標準の **日次バックアップ**のみ (Supabase 側で 1 日 1 回自動取得)。
- **緊急時リストア手順**:
  1. オーナーが Supabase Dashboard → Project → Database → Backups にアクセス。
  2. 最新の日次 snapshot を選択し、Restore を実行 (Supabase 側 UI 操作)。
  3. リストア完了後、`./scripts/secrets-decrypt.sh` 後の `node .kobo/env-presence-probe-T-20260513-120000.mjs` でアプリ起動確認、続いて `node .kobo/run-live-rls-T-20260513-240000-genba-phase4d-prep.mjs` で RLS 38/38 PASS を確認。
  4. データ復旧手順は §3.4 migration rollback と独立 (snapshot は schema + data 一括)。
- **データ損失の最大値 (RPO)**: snapshot 取得時刻からの最大 **24 時間**。1 顧客 MVP 段階としてオーナーが受容済 (2026-05-14)。
- **PITR 再評価トリガ**: 顧客数増、トランザクション量増、または observability 強化と合わせて Phase 9 (性能+バックアップ+観測) または Phase 5/6 で再評価。詳細根拠は §6 と `docs/SECURITY-AUDIT-2026-05-13-phase4.md` の Backup / Disaster Recovery セクション。
- **アプリ側の "soft" rollback**: 該当行に対する `deleted_at = now()` SET (RLS 上 worker は触れず、tenant_admin / system_admin のみ実行可能)。snapshot リストアより低コスト・低リスクなので、行レベル誤入力の訂正にはこちらを優先。

### 3.4 Migration rollback

- **方針**: forward-only。`supabase/migrations/<timestamp>_<name>.sql` を編集せず、後続 migration で訂正。
- **方法**:
  1. 新規 `supabase/migrations/<次の timestamp>_phaseX_revert_Y.sql` を作成。
  2. `drop policy if exists ...` / `drop trigger if exists ...` / `alter table ... drop column ...` / `alter table ... drop constraint ...` を冪等に記述。
  3. `node .kobo/apply-one-T-<TASK_ID>.mjs <filename>` で適用 (`api.supabase.com/v1/projects/{ref}/database/query` 経由)。
  4. 適用ログは `.kobo/run-live-rls-T-<TASK_ID>.log` 系に集約。シークレット値は出力しない。
- **完全に作り直し** (開発環境のみ): `supabase db reset` (Pro 環境では絶対実行しない、データ全消失)。

### 3.5 secrets ローテーション (オーナー専用)

```bash
cd /mnt/c/Users/hiron/Documents/kobo
./scripts/secrets-edit.sh   # SOPS + age で .env.enc を編集
# 編集後 commit → kobo-control チャンネルに自動通知
```

`age` 秘密鍵は `~/.config/sops/age/keys.txt` のみに置く (リポジトリ / クラウド禁止)。

---

## 4. Test execution

### 4.1 Unit test (vitest, 全環境で常時)

```bash
cd /mnt/c/Users/hiron/Documents/kobo/workspace/projects/genba
npm run test                                            # vitest run (default)
# 単体ファイル:
npm run test -- tests/unit/works-validators.test.ts
```

カバー:
- `tests/unit/*.test.ts` (qr-parser / scanner-state / scanner-match / csv-formula-injection / manufacturing-csv-formula-injection / logi-validators / works-validators / auth-validation / safe-redirect / env / rls-claims)。
- Phase 1〜4 で 130+ unit tests / 全て常時 PASS。

### 4.2 Integration test (vitest, live-gated)

```bash
# 全体:
node .kobo/run-live-rls-T-20260513-240000-genba-phase4d-prep.mjs
# 個別 (env が export 済みのシェルで):
RUN_LIVE_RLS_TESTS=1 npm run test -- tests/integration/rls/rls-live.test.ts
RUN_LIVE_RLS_TESTS=1 npm run test -- tests/integration/rls/rls-phase3a.test.ts
RUN_LIVE_RLS_TESTS=1 npm run test -- tests/integration/rls/coverage-gap-closure.test.ts
RUN_LIVE_EF_TESTS=1 npm run test -- tests/integration/csv/manufacturing-plan-csv-import.live.test.ts
```

live test は `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` + gate 環境変数が揃ったときのみ実行。欠落時は `describe.skip` で gating test がスキップ理由を明示。

#### Phase 4d-prep 時点の live RLS 合計

| ファイル | テスト数 | 状態 |
|---|---:|---|
| `tests/integration/rls/rls-live.test.ts` | 11 (Phase 1+2+3b) | 全 PASS |
| `tests/integration/rls/rls-phase3a.test.ts` | 11 (Phase 3a) + 8 (Phase 4d) = 19 | 全 PASS |
| `tests/integration/rls/coverage-gap-closure.test.ts` | 7 + 1 gating = 8 | 全 PASS |
| **小計 RLS** | **38** | **38 / 0** |
| `tests/integration/csv/manufacturing-plan-csv-import.live.test.ts` | 6 + 1 gating = 7 | **6 fail (HTTP 404 — EF 未デプロイ)** |

EF が未デプロイのため Phase 4d-prep では 6 件失敗。`supabase functions deploy manufacturing-plan-csv-import` 後 (Phase 4d-deploy) に PASS に転じる想定。

### 4.3 E2E test (Playwright)

```bash
# dev server を別 tmux で起動済み or wrapper で同時起動:
/mnt/c/Users/hiron/Documents/kobo/scripts/run-e2e.sh genba
# 個別 spec:
npx playwright test tests/e2e/works-manufacturing.spec.ts --reporter=line
# トレース / スクショ:
npx playwright test --trace=on
```

成果物: `playwright-report/` (HTML) + `test-results/` (artifacts) + `.kobo/test-artifacts-<TASK_ID>/` (dispatch スコープに集約)。

### 4.4 Live migration 適用

```bash
# wrapper を新規作成 (per-dispatch):
cat > .kobo/apply-one-T-<TASK_ID>.mjs <<'EOF'
// 標準テンプレ: supabase/migrations/<filename> を api.supabase.com/v1/projects/{ref}/database/query に POST
// Bearer は process.env.SUPABASE_ACCESS_TOKEN のみ参照。値は echo しない。
EOF
node .kobo/apply-one-T-<TASK_ID>.mjs supabase/migrations/<timestamp>_<name>.sql
# 201 Created を順次確認。
```

### 4.5 E2E auth cookie issuance (`E2E_LOGI_AUTH_COOKIE` / `E2E_WORKER_AUTH_COOKIE`) (Phase 6a 確立)

Phase 6 以降の authed Playwright spec は **storageState 経由の cookie 注入** で sign-in を再現する。発行手順は kobo の Supabase test project に対して **dispatch 内で完結** する (オーナー手動操作は不要、ただし `.env.local` を 1.2 の手順で復号済みであること)。

#### 4.5.1 自動発行 (Playwright global setup, 推奨)

```bash
cd /mnt/c/Users/hiron/Documents/kobo/workspace/projects/genba
# Supabase URL / anon / service-role が export 済 (or .env.local source 済) であること
/mnt/c/Users/hiron/Documents/kobo/scripts/run-e2e.sh genba
# 内部の `tests/e2e/global-setup.ts` が:
#   1. service_role で synthetic tenant (`E2E5e tenant`) を作成
#   2. tenant_admin / worker の 2 ユーザを `auth.admin.createUser` で発行
#   3. `signInWithPassword` 相当を real /login で driven し、`@supabase/ssr`
#      の cookie を Playwright `storageState` に保存
#   4. 成功時に `process.env.E2E_LOGI_AUTH_COOKIE=1` / `E2E_WORKER_AUTH_COOKIE=1`
#      を export し、各 spec の `test.skip(!process.env.E2E_..._AUTH_COOKIE)`
#      gate が active 化
```

storageState の保存先:

| ファイル | 用途 |
|---|---|
| `.kobo/playwright-auth/tenant_admin.json` | playwright project `chromium` の `storageState` (admin / 4 業務全画面) |
| `.kobo/playwright-auth/worker.json` | playwright project `chromium-worker` の `storageState` (correction.spec.ts の worker-only 分岐) |
| `.kobo/playwright-auth/tenant_admin.user.json` | 発行済 synthetic user の email / userId / tenantId メタ。**password も含むため `.gitignore` から外さない** (`.kobo/` は git 管理だが値の評価は dispatch 完了で破棄) |
| `.kobo/playwright-auth/worker.user.json` | 同上 (worker) |

#### 4.5.2 手動発行 (CI / debug 用、global setup を bypass する場合)

global setup を skip しつつ既存 storageState を再利用するには:

```bash
SKIP_E2E_GLOBAL_SETUP=1 \
E2E_LOGI_AUTH_COOKIE=1 \
E2E_WORKER_AUTH_COOKIE=1 \
npx playwright test --reporter=line
```

ただし `.kobo/playwright-auth/{tenant_admin,worker}.json` が **すでに存在** する場合のみ意味があり、cookie の有効期限 (Supabase の access token 既定 1h, refresh token 60 日) を超えたら sign-in は失敗する。期限切れ時は SKIP を外して再度 global setup を走らせる。

#### 4.5.3 secret hygiene (重要)

- storageState には Supabase の access/refresh JWT が含まれる。**git commit 禁止**。`.kobo/playwright-auth/` は `.gitignore` 行 57 (`.kobo/`) に包含されるため、`git check-ignore` で **既に ignored** であることを Phase 6a で確認済。
- synthetic user のパスワードは **dispatch 内で生成された乱数** (`E2e5eTest!<rand>!Pw` パターン)。`.kobo/playwright-auth/*.user.json` に保存されるが、test session 終了後に owner が `rm -rf .kobo/playwright-auth` で物理削除して構わない。
- 通常 dispatch では `auth.admin.deleteUser` を `afterAll` で best-effort 削除するため、Supabase 側の synthetic user は残らない。残存が疑われる場合は Supabase Dashboard → Authentication → Users で `rls5-*@example.test` / `e2e5e-*@example.test` / `rls6a-*@example.test` パターンを削除。
- **どの cookie 値 / JWT も RUNBOOK・final-report・コメント・PR 本文に貼り付け禁止** (`SUPABASE_SERVICE_ROLE_KEY` 同様の扱い)。

#### 4.5.4 CI 向け (GitHub Actions secret 経由、Phase 6+ で有効化判断)

GitHub Actions で authed E2E を回す場合:

1. オーナーが Repository Settings → Secrets and variables → Actions に以下を登録:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
2. workflow で `env:` 経由で expose し、`run: npm run e2e` の前段に kobo `secrets-decrypt.sh` 相当を組み込まない (CI では SOPS+age を回さず、直接 secret を env に流す)。
3. `tests/e2e/global-setup.ts` がそのまま synthetic user を発行し storageState を作る。CI artifact として `.kobo/playwright-auth/` を **保持しない** (cookie 漏洩防止)。

CI 向け cookie 永続化 (workflow_dispatch で発行→artifact upload→次 workflow に download) は **採用しない**: 漏洩 surface が増えるため、毎回 global setup で発行し直す方針 (Phase 6a 確定)。

### 4.6 Lighthouse / a11y

```bash
/mnt/c/Users/hiron/Documents/kobo/scripts/run-lighthouse.sh genba /login
# 出力: .kobo/lighthouse-T-<TASK_ID>.json + .kobo/lighthouse-runs-T-<TASK_ID>/
```

PWA / a11y / perf / SEO スコアを取得。Phase 1 で /login = 95+ a11y を確立。

---

## 5. Audit log locations

kobo は **2 系統** の監査ログを保持する。両方とも append-only / 改ざん検知済。

### 5.1 Director decisions (`director-decisions-*.jsonl`)

```
/mnt/c/Users/hiron/Documents/kobo/logs/director-decisions-<YYYY-MM-DD>.jsonl
```

- Hermes (director / Codex GPT-5.5) が下したすべての判断 (dispatch 起案 / プロポーザル / オーナー承認待ち).
- 1 行 1 JSON。フィールド: `ts`, `decision_id`, `task_id`, `agent`, `kind` (`dispatch | propose | approve | reject | timeout`), `summary`, `rationale_snippet` (機密値は出さない), `slack_post_ts` (Slack 連動)。
- 検索:
  ```bash
  /mnt/c/Users/hiron/Documents/kobo/scripts/audit-log.sh dir --task T-20260513-240000-genba-phase4d-prep
  ```

### 5.2 Audit log (`audit-*.jsonl`)

```
/mnt/c/Users/hiron/Documents/kobo/logs/audit-<YYYY-MM-DD>.jsonl
```

- worker dispatch / wrapper / kobo-gateway / secrets-edit / start-kobo / restart-kobo の **すべて** のイベント。
- フィールド: `ts`, `event` (`dispatch_start | dispatch_end | secrets_edit | gateway_restart | tmux_session_kill | permission_denial | ask_user_question_blocked` 等), `slug`, `task_id`, `status`, `details` (機密値は出さない)。
- 検索:
  ```bash
  /mnt/c/Users/hiron/Documents/kobo/scripts/audit-log.sh events --since 2026-05-13
  /mnt/c/Users/hiron/Documents/kobo/scripts/audit-log.sh events --event permission_denial
  ```

### 5.3 Dispatch スコープのローカルログ

`workspace/projects/genba/.kobo/` に dispatch 単位で集約:

| ファイル | 内容 |
|---|---|
| `orchestrator-prompt-<TASK_ID>.txt` | dispatch 入力プロンプト |
| `final-report-<TASK_ID>.md` | dispatch 最終報告 (STATUS / 変更ファイル / テスト結果 / 残課題) |
| `qa-summary-<TASK_ID>.json` | テスト集計 (pass / fail / total / commands run / evidence paths) |
| `ux-review-<TASK_ID>.json` | UI/UX 評価 (P0 / P1 / P2 件数、Lighthouse スコア、screenshot path) |
| `run-live-rls-<TASK_ID>.{mjs,log}` | live RLS wrapper + stdout |
| `apply-one-<TASK_ID>.{mjs,log}` | migration apply wrapper + stdout |
| `playwright-stdout-<TASK_ID>.log` | E2E run stdout |
| `lighthouse-T-<TASK_ID>.json` | Lighthouse 結果 |
| `test-artifacts-<TASK_ID>/` | Playwright trace / screenshot |

すべて `.gitignore` 配下に **入れない** (PR review で監査可能にするため、リポジトリに commit)。シークレット値は echo しない。

---

## 6. Backup strategy (Phase 4d-deploy 確定)

### 6.1 採用方針: PITR は本フェーズで採用しない

- **背景**: Phase 4 architect doc / IMPLEMENTATION_PLAN.md は当初 Phase 3 末で `paid_subscription_signup` 承認 → Phase 4 着手前 PITR 有効化を計画していた。
- **オーナー判断 (2026-05-14 Slack)**: 「Vercel deploy + env vars 完了、PITR 使用しない方針」。PITR 採用は **Phase 5+ または Phase 9 の再評価まで延期**。
- **理由**:
  - 1 顧客 MVP 段階で日次バックアップ (RPO 24h) は受容範囲。
  - Supabase Pro 月額固定費を本番 ARPU 確定後にずらすことで、初期 burn rate を抑える。
  - Phase 4 の RLS / 監査ログ / forward-only migration により、データ破壊系インシデントの **発生確率自体が低い**。
- **受容するリスク**: 最大 24 時間分のデータ損失 (RPO 24h)。Phase 4 で扱うデータは **製造実績入力 + QR スキャン履歴**のみで、決済データ・PII (氏名/住所/電話) は含まれない。

### 6.2 現行バックアップ運用

| 項目 | 値 |
|---|---|
| プラン | Supabase Free |
| 自動バックアップ | 日次 (Supabase 側自動取得) |
| 保持期間 | Free tier 標準 (Supabase 仕様による。オーナーが Dashboard で随時確認) |
| 取得時刻 | Supabase 側スケジュール (オーナー側でも変更不可) |
| リストア手順 | §3.3 参照 |
| RPO (Recovery Point Objective) | **最大 24 時間** |
| RTO (Recovery Time Objective) | Supabase 側リストア所要時間 + 環境変数確認 30 分以内目安 (実測は初回リストア時に記録) |

### 6.3 PITR 再評価トリガ

以下のいずれかが発生した時点でオーナーが Supabase Pro + PITR 切替を再評価する:

1. **顧客数 ≥ 3** (Beta 卒業手前 / Phase 7 想定)。
2. **月次トランザクション量** が 24h 損失を許容できない水準に達したとき (定量基準は Phase 9 の性能観測で決定)。
3. **観測 / アラート整備 (Phase 9)** で SLA 99.5% を担保する文脈に PITR が含まれることが確定したとき。
4. オーナーまたは顧客から **明示要求** があったとき (1 件でも)。
5. Sentry / Datadog などの有料 observability 導入承認 (`paid_subscription_signup`) と同時に検討。

トリガが発火したら Phase 9 dispatch (または前倒し dispatch) で:
- Supabase Pro 切替 (`paid_subscription_signup` 再承認)
- PITR 有効化
- RUNBOOK §3.3 / §6 を「Pro + PITR 運用」版に書き換え
- staging リストア演習 (Phase 9 DoD と整合)

### 6.4 関連 doc

- `docs/SECURITY-AUDIT-2026-05-13-phase4.md` Backup / Disaster Recovery セクション (本判断のセキュリティ観点記録)
- `docs/IMPLEMENTATION_PLAN.md` Phase 4 行 (PITR 再評価フェーズの参照)
- `docs/ARCHITECTURE-phase4-manufacturing.md` §7 (R-P4-14 のステータス更新)

---

## 7. Deploy 手順 (Vercel auto-deploy)

### 7.1 標準フロー (current = Phase 4d-deploy)

- **Production branch**: `main`。
- **トリガ**: GitHub `main` ブランチへの push を Vercel が検知し、自動 build & deploy。
- **環境変数管理**: Vercel Project Settings → Environment Variables にオーナーが手動登録 (Production / Preview / Development の 3 environment 別)。リポジトリには `.env.enc` (SOPS+age) で暗号化版のみ存在。
- **キー (Production 必須)**:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (server-only — Edge Function / API Route のみ参照)
  - `SUPABASE_ACCESS_TOKEN` (CLI / migration 適用用、必要時のみ)
- **Preview branch**: feature branch push で Vercel が preview URL を発行 (`*.vercel.app`)。staging-like 確認に使用。

### 7.2 オーナー手動オペレーションの境界 (重要)

| 操作 | 担当 |
|---|---|
| 初回 Vercel プロジェクト作成 | **オーナー手動** (本ディスパッチでは実施しない) |
| 本番環境変数の登録 / 更新 | **オーナー手動** (Vercel Dashboard) |
| 本番デプロイ実行 | **オーナー手動 (`git push origin main`) または Vercel 側自動 trigger** |
| ロールバック (Vercel) | **オーナー手動** (Vercel Dashboard → Deployments → "Promote to Production" で過去 build を選択) |
| PITR 有効化 / paid signup | **オーナー手動 + 承認** (現状未実施 / §6 参照) |
| 開発 dispatch (worker) | `Bash(vercel:*--prod*)` は `deny_tools` で技術的に禁止 — worker は本番デプロイを起動できない |

`config/permissions.yaml` の deny_tools (`Bash(vercel:*--prod*)` / `Bash(npm:publish*)` / `Bash(gh:repo:create*)` 等) によって、worker は本番デプロイ・公開操作を一切実行できない多層防御。

### 7.3 デプロイ後の smoke 確認 (本ディスパッチで標準化)

オーナーまたは後続 dispatch が、デプロイ後に最低限の read-only smoke を実行:

```bash
node .kobo/prod-smoke-T-<TASK_ID>.mjs
# 期待:
#   GET /                          => HTTP 200
#   GET /login                     => HTTP 200
#   GET /app/logi                  => HTTP 307 -> /login?next=...
#   GET /app/works/manufacturing   => HTTP 307 -> /login?next=...
#   5xx = 0
```

- 本テストは **未認証 read-only** で、SSR / middleware の auth gate と Next.js 配信が生きていることを確認するだけの最小チェック。
- 認証付きフローは Playwright E2E (`tests/e2e/works-manufacturing.spec.ts` 等) を local / preview で実行し、本番では実施しない (現場入力データ汚染回避)。

---

## 8. References

- `docs/ARCHITECTURE.md` — Phase 0 ER 図 + RLS テンプレ + データフロー
- `docs/ARCHITECTURE-phase4-manufacturing.md` — Phase 4 設計 (4a/4b/4c/4d 分割 / R-P4-01..20 リスク)
- `docs/PRODUCT_SPEC.md` — UC-1..4 + AC
- `docs/IMPLEMENTATION_PLAN.md` — Phase 1〜10 工程
- `docs/SECURITY-AUDIT-2026-05-13-phase4.md` — Phase 4 二重監査 (最新)
- `/mnt/c/Users/hiron/Documents/kobo/docs/SANDBOX-BEHAVIOR.md` — dispatch sandbox 観察と回避策
- `/mnt/c/Users/hiron/Documents/kobo/docs/DESIGN-PRINCIPLES.md` — kobo デザイン憲章
- `/mnt/c/Users/hiron/Documents/kobo/config/permissions.yaml` — worker 権限境界
- `/mnt/c/Users/hiron/Documents/kobo/config/approval-rules.yaml` — オーナー承認ルール
- `/mnt/c/Users/hiron/Documents/kobo/config/tech-stack.yaml` — 標準スタック (Next 15 / Supabase / Vercel)

---

## 9. Revision history

| date | revision | author |
|---|---|---|
| 2026-05-13 | 初版 — Phase 4d-prep dispatch で作成。Phase 1〜4 経験を集約。EF deploy / PITR 有効化は Phase 4d-deploy で更新予定。 | orchestrator (dispatch T-20260513-240000-genba-phase4d-prep) |
| 2026-05-14 | Phase 4d-deploy 反映 — §0 Production URL / §3.3 PITR 不採用前提のリストア手順 / §6 Backup strategy (PITR skip 根拠+再評価トリガ) / §7 Vercel auto-deploy 手順 / smoke test テンプレ追加。本番デプロイ + 環境変数登録はオーナー手動完了。本ディスパッチは read-only smoke + docs only。 | orchestrator (dispatch T-20260514-110000-genba-phase4d-deploy-verify) |
| 2026-05-15 | Phase 6a foundation 反映 — §4.5 E2E auth cookie (`E2E_LOGI_AUTH_COOKIE` / `E2E_WORKER_AUTH_COOKIE`) 発行・storageState 保存・secret hygiene・CI 方針を追加 (Lighthouse は §4.6 にリナンバリング)。 | orchestrator (dispatch T-20260515-050000-genba-phase6a-foundation) |
