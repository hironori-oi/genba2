# GENBA RUNBOOK

最終更新: 2026-05-13 / Phase 4d-prep (T-20260513-240000-genba-phase4d-prep)

このドキュメントは genba プロジェクトの開発 / 運用 / 緊急対応 / テスト実行 / 監査ログの **すべての手順** をオーナー + 後続ディスパッチが再現できるように記録する。Phase 1〜4d-prep の経験を集約。

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

**現状**: Supabase Pro + PITR 有効化は **Phase 4d-deploy で承認待ち** (Phase 4d-prep 時点では未契約)。

- **Pro 契約後 (Phase 4d-deploy 以降)**: Supabase Dashboard → Project → Database → Backups → Point-in-time recovery で任意の時刻にロールバック。
- **Free tier 現在 (Phase 4d-prep)**: 日次バックアップのみ (Supabase Free)。PITR 不可。緊急時は最新 daily snapshot からのリストア (RPO 24h)。
- **アプリ側の "soft" rollback**: 該当行に対する `deleted_at = now()` SET (RLS 上 worker は触れず、tenant_admin / system_admin のみ実行可能)。

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

### 4.5 Lighthouse / a11y

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

## 6. References

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

## 7. Revision history

| date | revision | author |
|---|---|---|
| 2026-05-13 | 初版 — Phase 4d-prep dispatch で作成。Phase 1〜4 経験を集約。EF deploy / PITR 有効化は Phase 4d-deploy で更新予定。 | orchestrator (dispatch T-20260513-240000-genba-phase4d-prep) |
