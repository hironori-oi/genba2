# GENBA Phase 5 (Admin UI = master CRUD + correction + personal/user settings) Architecture

作成日: 2026-05-14 / Phase 5 architect-only design
TASK_ID: T-20260514-120000-genba-phase5-architect
依存: `docs/ARCHITECTURE.md` (Phase 0)、`docs/ARCHITECTURE-phase4-manufacturing.md` (Phase 4)、`docs/PRODUCT_SPEC.md` §3〜§7、`docs/IMPLEMENTATION_PLAN.md` Phase 5 (14 日 / 140 turn / 二重監査スキップ可)、`docs/RUNBOOK.md` (Phase 4d-deploy 反映)、`docs/SECURITY-AUDIT-2026-05-12-ac-auth-01.md` (AC-AUTH-01 closure / `admin_revoke_refresh_tokens` RPC)、`docs/SECURITY-AUDIT-2026-05-13-phase4.md` (R-P4-17 訂正 DEFERRED 明記)、Phase 2 migration `supabase/migrations/20260512000000_phase2_settings_masters.sql`、Phase 4 final report `.kobo/final-report-T-20260513-180000-genba-phase4-manufacturing-architect.md`

> Status: **architect-only design**. 本 doc 自体は production code / migration / test / config を一切変更しない。実装は owner 確認後の Phase 5a〜5e dispatch で別途。
>
> Source notes (missing source):
> - dispatch `CONTEXT_FILES_AND_DISCOVERY` で示唆された `genba_backlog.md` (長期 Tier C section) は本リポジトリにも kobo memory 配下にも **存在せず** (`Glob "**/*backlog*"` 0 件、kobo `memory:` 直接 Read 不可)。Phase 4 architect doc も同 missing を明記して進めており、Phase 5 でも同じ判断を踏襲する。一次ソースは `docs/PRODUCT_SPEC.md §4 (P1 / Beta)`、`§7 D-02 / D-04 / D-06`、`docs/IMPLEMENTATION_PLAN.md Phase 5 行`、Phase 2 既存 migration、Phase 4 architect doc。
> - Phase 5 で扱う対象スキーマは **すべて Phase 2 で migration 済**。Phase 5 の core 価値は **migration の上に admin UI と server actions を載せる** こと。新規 migration は最小化する設計を §6 で示す。

---

## 1. 既存 architecture 読込結果と Phase 5 整合確認

### 1.1 読み込んだ Phase 1〜4 成果物

| 成果物 | 確認内容 | Phase 5 への含意 |
|---|---|---|
| `docs/ARCHITECTURE.md` §2 ER 図 | 設定/マスタの全テーブル名・FK 関係が確定 (`qr_format_definitions` / `qr_item_definitions` / `match_rules` / `match_rule_lines` / `csv_import_definitions` / `csv_export_definitions` / `work_settings` / `work_input_field_settings` / `standard_field_definitions` / `tenant_field_settings` / `custom_field_definitions`、masters: `work_types` / `processes` / `equipment` / `defect_groups` / `defects`) | Phase 5 は **同じスキーマに admin UI を載せる** だけで足りる。新規 DDL を増やさない |
| `docs/ARCHITECTURE.md` §4 RLS テンプレ | `tenant_id=app.current_tenant_id()` + tenant_admin only modify が Phase 1 で確立 | **無改変で踏襲**。Phase 5 server actions は anon JWT 経由のみ。新規 RLS policy を追加しない (§4) |
| `docs/ARCHITECTURE.md` §4 RLS テスト (RLS-001〜008) | tenant 分離 / `worker_id=他` reject / `raw_user_metadata` grep 0 が Phase 1 で確立 | Phase 5 admin UI / 訂正 UI / user 招待 でも同セット (RLS-501..) を追記 (§7) |
| `supabase/migrations/20260512000000_phase2_settings_masters.sql` | Phase 5 が UI 化する **全テーブル** が DDL + RLS + (一部) seed 済 | Phase 5 は migration 増分ゼロで UI 完結を目指す (§6) |
| `supabase/migrations/20260513000000_phase5_admin_revoke_refresh_tokens.sql` | `admin_revoke_refresh_tokens(p_user_id uuid)` SECURITY DEFINER RPC が production deployed (AC-AUTH-01 closure 済) | Phase 5 の **user 設定 (role / tenant 変更)** から `changeUserRole()` を呼び出せる、**新規 migration / SDK 改修ゼロ** |
| `src/lib/auth/role-change.ts` | `changeUserRole({targetUserId,newRole,newTenantId?})` が service-role + RPC で実装済 | Phase 5 user 設定 UI / server action から **そのまま import** (§3.4) |
| `src/lib/auth/session.ts` | `getAppSession()` が `app_metadata.tenant_id` / `role` を返す | Phase 5 全 server action で gate 利用 (worker / tenant_admin / system_admin) |
| `src/lib/admin/fixtures.ts` (Phase 2 demo data) | 項目 / QR / match-rule の demo fixtures。コメントに「Phase 5 will replace these reads with the real Supabase select + server-action mutations」 | Phase 5 で **demo branch を残しつつ** Supabase select + server-action 経路を実装。Demo branch は env 未設定時の fallback として保持 |
| `src/app/app/admin/{fields,qr,match-rules}/page.tsx` | Phase 2 で 3 画面が demo fixtures ベースで存在 | Phase 5 で:<br>① demo → Supabase select に切替<br>② full CRUD (delete / 複数行 / pagination) 追加<br>③ qr ページに **format CRUD + 読取テスト分離** (現状は読取テストのみ) |
| `src/app/app/admin/match-rules/{actions,MatchRulesEditor}.tsx` | save + delete (soft) + UPSERT pattern が Phase 2 で確立 | Phase 5 全 CRUD のテンプレ。**`{status,message}` envelope を共有 schema 化** (§3.3) |
| `src/app/app/admin/fields/{actions,FieldSettingsForm}.tsx` | tenant_field_settings の UPSERT envelope が存在 | Phase 5 で custom_field_definitions の "意味付け" UI を追加するエントリポイント (§3.2.e) |
| `src/app/app/logi/history/{page,[id]/page}.tsx` | 4-業務統合履歴。Phase 4c で `business_code` filter / detail page まで実装済。`previous_record_id` は **読み取りのみ** | Phase 5 で **訂正書込 UI** を detail page から起動 (§3.5)。新規 route ではなく `/app/logi/history/[id]/correct` などのサブ route を追加 |
| `docs/ARCHITECTURE.md` §4 「実績は `previous_record_id` を持ち、訂正は新 INSERT+旧行 `deleted_at` で表現 (UPDATE 上書き禁止)」 | 訂正フローの方針は Phase 0 で確定済 | Phase 5 訂正 UI は **新 INSERT + 旧 deleted_at** を 1 トランザクション内で行う server action パターンを採る (§3.5) |
| `docs/PRODUCT_SPEC.md §7 D-06` | `work_settings.correction_approval` (boolean、default false) が Phase 2 で導入済、有効テナントのみ Phase 5 でリーダー承認 | 承認フローは **P2 扱い**。Phase 5 標準フローでは無視し、`correction_approval=true` テナント向けの分岐を **5d で 1 経路だけ** 用意 (§3.5.5) |
| `docs/PRODUCT_SPEC.md §7 D-02` | 5 マスタの shift_jis/utf8 空テンプレ CSV を Phase 5 で `docs/csv-templates/` に同梱 | Phase 5d で `docs/csv-templates/` 配下に 10 ファイル (5 マスタ × 2 エンコード) を追加。CSV pipeline は既存 `src/lib/csv/` をそのまま流用 |
| `docs/IMPLEMENTATION_PLAN.md §2 二重監査` | 「Phase 5 スキップ可」と明記 | **二重監査 (security-auditor) は dispatch スコープ外**。ただし権限境界 (tenant_admin invite / role 変更 / 訂正書込 / system_admin マスタ全閲覧) は **reviewer + single-pass audit** で代替 (§7.4) |
| `docs/SECURITY-AUDIT-2026-05-13-phase4.md R-P4-17 DEFERRED` | 製造実績 訂正 (write) は Phase 5 で扱うと明記 | Phase 5 で **「製造入庫を巻き戻すか / 残すか」の判断** を訂正 UI の confirm step として実装 (§3.5.3) |
| `docs/SECURITY-AUDIT-2026-05-12-ac-auth-01.md` | AC-AUTH-01 closure 済 (`admin_revoke_refresh_tokens` + `role-change.ts` 修正済) | Phase 5 user 設定 UI から **既存 server action を呼ぶだけ** で済む。新規 RPC / migration / 監査要件なし |
| `src/components/ui/{Alert,Button,Field}.tsx` | shadcn ベースの最小 primitives | Phase 5 で **DataTable / FormModal / ConfirmDialog** を 3 個だけ新規追加 (§3.1) し、shadcn を増やさない (バンドル増を抑制) |
| `src/lib/csv/{sanitize,encode}.ts` | formula injection 防御 / shift_jis 変換が Phase 3b で確立 | Phase 5 で CSV テンプレ generate の場合も流用。新規 sanitization 不要 |

### 1.2 Phase 5 と既存 architecture の **conflict 検査**

| 観点 | Conflict? | 詳細 |
|---|---|---|
| ER 図 | **0** | 既存テーブル群への UI 追加のみ。スキーマ変更ゼロ |
| RLS テンプレ | **0** | 全テーブルに「same-tenant SELECT / tenant_admin modify」が Phase 2 から付与済。Phase 5 server actions は anon JWT 経由のみで RLS が gate する |
| `app_metadata` JWT claim | **0** | `app_metadata.tenant_id` / `role` のみ参照。`raw_user_metadata` 書込 grep を Phase 5 backend dispatch で再走 (Phase 1 DoD 維持) |
| `service_role` 境界 | **0** | user 招待 / role 変更 / refresh token revoke の 3 箇所だけ service_role を使う。`role-change.ts` 既存パターンを共有 (§3.4)。client bundle leakage は Phase 5d で `service_role` grep 0 hit を再検証 |
| `raw_value` 保護 | **0** | 訂正 UI は `qr_scan_histories` を **読み書きしない**。`v_qr_scan_histories` (worker) / `v_qr_scan_histories_admin` (admin) は Phase 3a 既存のまま |
| formula injection / CSV | **0** | CSV テンプレ 生成 → 既存 `sanitize.ts` を generate 側でも適用 (新規セル値はないが、defensive に通す) |
| polymorphic FK | **0** | 訂正は **同テーブル内の新 INSERT + 旧 deleted_at**。`validate_target_tenant()` の経路を踏まない |
| 56×56 タッチ / WCAG | **0** | Phase 3b/4c 確立済の AC-A11Y-01 を 全 admin 画面 + 訂正 UI でも踏襲 (§3.1) |
| Phase 6 テナント管理 境界 | **0** | システム管理画面 (`tenants` CRUD / `tenant_subscriptions` cap) は **Phase 6**。Phase 5 で実装しない (§5) |
| `correction_approval=true` テナント分岐 | **0** | Phase 2 で boolean だけ追加済。Phase 5d で **enabled 時だけ承認 step を挿入** する分岐を実装し、デフォルト false テナントは現状フローのまま |

**結論**: **既知 conflict = 0**。Phase 5 は Phase 2 が用意した **全 admin テーブル DDL + RLS** に UI と server actions を **そのまま載せる** だけで成立する。新規 architecture 観点は次の 6 件:

1. **マスタ CRUD 共通 component pattern** (DataTable + FormModal + ConfirmDialog) を §3.1 で確立 (5a foundation)
2. **server actions 共通 envelope** (`{status:"ok"|"error", data?, message?}`) を `src/lib/admin/shared/` に切り出す (§3.3)
3. **訂正書込 server action** (`submitMovementCorrection` / `submitInventoryCorrection` / `submitManufacturingCorrection`) を `src/lib/{logi,works}/corrections.ts` に新設 (§3.5)
4. **ユーザー招待 server action** (`inviteUser({email,role})` + tenant_admin 制限) を **新規 server action 1 本** で実装 (`changeUserRole` 同等のセキュリティ階層、§3.4)
5. **個人設定 server actions** (PW 変更 / display_name 変更) を `src/lib/account/` に新設 (§3.4)
6. **CSV テンプレ ダウンロード** route handler (`/api/admin/csv-template/[master]/[encoding]/route.ts`) を **server-side 静的応答** で 1 本追加 (§3.6)

---

## 2. Phase 5 対象機能整理

### 2.1 スコープ確定 (`docs/IMPLEMENTATION_PLAN.md` Phase 5 行 + `docs/PRODUCT_SPEC.md §4 P1` + dispatch SCOPE)

| 区分 | スコープ in (Phase 5) | スコープ out (他フェーズ / 永久) |
|---|---|---|
| マスタ CRUD UI (5 種) | a. `qr_format_definitions` + `qr_item_definitions` (バージョン管理 付)<br>b. `match_rules` + `match_rule_lines` (Phase 2 簡易 UI を本格 CRUD に置換)<br>c. `tenant_field_settings` + `custom_field_definitions` (項目設定 詳細 UI + custom_text_01..10 意味付け)<br>d. `csv_import_definitions` + `csv_export_definitions` (CSV format CRUD)<br>e. `work_settings` + `work_input_field_settings` (業務設定 CRUD) | テナント `tenants` CRUD / `tenant_subscriptions` (上限) → **Phase 6**<br>監査ログ画面 → **Phase 7**<br>外部マスタ (`work_types` / `processes` / `equipment` / `defect_groups` / `defects`) → §2.2 で 「Phase 5 で扱う / 限定範囲」 |
| 製造マスタ CRUD (Phase 4 で seed のみ実装) | `processes` / `equipment` / `defect_groups` / `defects` / `work_types` の **5 master CRUD** | seed は Phase 4 既存テンプレート踏襲 |
| 訂正 UI | 4 業務 records (`movement_records` / `inventory_records` / `manufacturing_records` / `manufacturing_record_defects`) の **「前 ID リンク → 訂正画面 → 新 record (`previous_record_id` 設定) + 旧 record `deleted_at`」** | 訂正承認フロー (`correction_approval=true` テナント向けの leader 承認 step) → **5d で 1 経路だけ** 用意し、デフォルト OFF |
| 個人設定 | PW 変更 / 表示名 (display_name) 変更 / OS-following dark mode 確認 (read-only) / 自分の assigned_businesses 表示 (read-only) | テーマ手動トグル (Phase 1 で OS-following のみと確定済、Phase 5 でも切替しない)、言語切替 (Phase 10) |
| ユーザー設定 | tenant_admin が **同テナント内** で:<br>① worker 招待 (Supabase `admin.auth.admin.inviteUserByEmail` + email confirm)<br>② role 変更 (worker ↔ tenant_admin)<br>③ active / inactive 切替 (= soft-delete profile + refresh token revoke)<br>④ tenant 内 user 一覧 (profile + auth.users join via service_role)<br>system_admin はクロステナント可 (Phase 6 で本格対応、Phase 5 では同テナント内のみ UI を提供) | 他テナント user の閲覧/編集 → Phase 6<br>多段 role 階層 (tenant_admin の上に "tenant_owner" 等) → 採用しない |
| カスタム項目意味付け UI | `custom_field_definitions` (テナント定義) で `custom_text_01..10` / `custom_number_01..05` / `custom_date_01..05` に **業務的な意味と label** を割り当てる UI。`tenant_field_settings` と一覧表示で **「標準 + カスタム」** を統合 | 動的列の追加 (custom_text_11+) → 採用しない (列固定方針) |
| CSV テンプレ ダウンロード | 5 マスタ × 2 エンコード (shift_jis/utf8) = **10 ファイル** の静的応答 | テナントごとの動的テンプレ (列順カスタマイズ) → Phase 7 |

### 2.2 マスタ CRUD UI 5 種の **入力源 / 用途** マップ

`docs/IMPLEMENTATION_PLAN.md` Phase 5 行に列挙された 5 種は、本 doc で「**5 種 + 外部マスタ補完**」として再整理する:

```
Phase 5 マスタ CRUD UI (確定)
  5-a. QR 設定 CRUD             qr_format_definitions + qr_item_definitions (versioned)
  5-b. 照合ルール CRUD          match_rules + match_rule_lines (Phase 2 簡易 UI → 本格 CRUD)
  5-c. 項目設定 詳細 UI         tenant_field_settings + custom_field_definitions
                                + standard_field_definitions (read-only / system 配布)
  5-d. CSV format CRUD          csv_import_definitions + csv_export_definitions
  5-e. 業務設定 CRUD            work_settings + work_input_field_settings
  + (補完) 製造系 master CRUD   work_types / processes / equipment / defect_groups / defects

外部の system 配布: standard_field_definitions (Phase 1 で seed 済) は read-only
                    businesses (Phase 1 trigger で 4 行 seed) は read-only (table の有無 UI のみ)
```

### 2.3 ロール別アクセス

| ロール | マスタ CRUD | 訂正 UI | 個人設定 | ユーザー設定 |
|---|---|---|---|---|
| worker | **見えない** (`/app/admin/*` リダイレクト) | **自己レコード のみ** (`worker_id=auth.uid()`)、`previous_record_id` 経由 | PW 変更 / 表示名 / read-only assigned_businesses | 不可 |
| tenant_admin | 自テナント全マスタ | 自テナント全レコード (RLS の self-or-admin policy) | 同上 | 自テナント内 worker / tenant_admin 招待・変更・無効化 |
| system_admin | 全テナント (system_admin policy) | 全テナント | 同上 | Phase 5 では UI 上 **自テナント内 user のみ操作可** とし、クロステナント user 操作は Phase 6 で別画面 |

worker の `/app/admin/*` アクセスは middleware (`src/middleware.ts` 既存) + page-level redirect で **二重防御**。`worker` role で `/app/admin` → `/app/logi` にリダイレクト (Phase 5a で実装)。

### 2.4 dispatch BACKGROUND で言及されていた未確定項目

| 項目 | 判断 | 根拠 |
|---|---|---|
| `correction_approval=true` 承認フロー | **5d で 1 経路だけ実装** | D-06 (Phase 0 確定)、デフォルト OFF テナントでは UX 増分ゼロ |
| password reset (forgot password) UI | **既存維持** (Phase 1 で `/forgot-password` 実装済) | Phase 5 の "個人設定" は **ログイン済 user の PW 変更** に絞る。ログイン前リセットは Phase 1 既存路 |
| 多言語 (i18n) | **採用しない** | Phase 10 |
| GA / 監査ログ | **採用しない** | Phase 7 (`audit_logs` + trigger) |
| email 招待後 owner が SMTP 設定持っていない場合の fallback | **設計のみ** (§9 R-P5-08) | Supabase Auth dashboard で SMTP / Magic Link 設定が必要。実装は 5d。`AskUserQuestion` 禁止のため、未設定なら 5d 完了報告で `STATUS: degraded` を立てる |

---

## 3. UI / server actions / 共通 component 設計案

### 3.1 ルーティング (`app/(app)/settings/*` route 構造)

```
src/app/app/
  admin/                                  # 既存: tenant_admin/system_admin のみ
    layout.tsx                            # 既存。Phase 5 で middleware の補助 role gate を強化
    page.tsx                              # 既存。Phase 5 でカード 8 個に拡張 (現 3 → 8)
    fields/                               # 既存 (Phase 2)
      page.tsx                            # Supabase select に切替
      FieldSettingsForm.tsx               # Phase 2 既存 (微改修)
      CustomFieldDefinitionsForm.tsx      # **新規**: custom_text_01..10 意味付け
    qr/                                   # 既存 (Phase 2、現状は読取テストのみ)
      page.tsx                            # Phase 5 で QR format 一覧 + 読取テスト分離
      QrReadTest.tsx                      # 既存
      QrFormatList.tsx                    # **新規**: DataTable で format 一覧
      QrFormatForm.tsx                    # **新規**: format + items (positions) editor
      actions.ts                          # **新規**: format CRUD + version 切替
    match-rules/                          # 既存 (Phase 2)
      page.tsx                            # Supabase select に切替 (現状 Phase 2 で半実装済)
      MatchRulesEditor.tsx                # 既存
      actions.ts                          # 既存。lines wipe-reinsert → diff-INSERT に修正 (§9 R-P5-04)
    csv-formats/                          # **新規**
      page.tsx                            # import / export 両タブ
      CsvFormatList.tsx                   # DataTable
      CsvFormatForm.tsx                   # FormModal
      actions.ts
    work-settings/                        # **新規**
      page.tsx                            # 4 business × per-business 設定
      WorkSettingsForm.tsx                # work_settings + work_input_field_settings
      actions.ts
    masters/                              # **新規** (外部マスタ補完)
      page.tsx                            # 5 master タブ
      MasterCrudTable.tsx                 # 共通 DataTable + FormModal
      actions.ts                          # work_types / processes / equipment / defect_groups / defects
    users/                                # **新規**
      page.tsx                            # tenant 内 user 一覧
      UserInviteForm.tsx                  # 招待
      UserRoleForm.tsx                    # role 変更 + active 切替
      actions.ts                          # inviteUser / changeRole / deactivate
  account/                                # **新規** (worker でもアクセス可)
    page.tsx                              # 個人設定
    PasswordChangeForm.tsx                # PW 変更
    ProfileForm.tsx                       # display_name
    actions.ts                            # 個人設定 server actions
  logi/
    history/
      [id]/
        page.tsx                          # 既存。Phase 5 で "訂正" ボタン追加 (条件: worker self or tenant_admin)
        CorrectionLauncher.tsx            # **新規**: 訂正開始ボタン + 確認モーダル
    correct/                              # **新規** (route base)
      [recordId]/
        page.tsx                          # 訂正フォーム (business 自動判定)
        CorrectionForm.tsx                # 4 業務共通フォーム
        actions.ts                        # submitCorrection
```

**ADR-P5-01**: dispatch instructions では `app/(app)/settings/*` と書かれていたが、本 doc では既存 `app/app/admin/*` を **そのまま拡張** し、`account/` を **同階層に追加** する形を採用する。理由:
- `/app/admin/*` は **すでに layout + role gate が組まれており、Phase 2 で 3 ページ稼働中**。新規 route group `(settings)` を切ると `layout.tsx` と middleware の guard を二重に書く必要があり、リファクタコストが Phase 5 budget の 5% 程度を食う
- `account/` は worker も操作可 (PW / display_name) のため admin guard を持たせない。`admin/` と分離するのが role-gate の自然な境界
- 既存 `/app/admin/fields` / `/app/admin/qr` / `/app/admin/match-rules` の URL を **そのまま温存** することで、Phase 2 既存 e2e (Playwright 構造解析) を破壊しない

### 3.2 マスタ CRUD 共通 component pattern (5 種共通)

#### 3.2.0 DataTable + FormModal + ConfirmDialog 3 primitives

```tsx
// src/components/admin/DataTable.tsx
//   - props: columns / rows / onEdit / onDelete / onCreate / search?
//   - server-rendered initial rows、client-side filter & sort のみ
//   - pagination は per-page=50, max 500 行をサーバから取得し client 側 paginate
//   - 56×56 タッチ / focus ring / aria-rowcount

// src/components/admin/FormModal.tsx
//   - props: open / onClose / title / children (= 業務固有 form)
//   - <dialog> 要素ベース、tab trap / Esc 閉じる / 56×56 タップ
//   - error / loading / empty / normal の 4 state を Form 側で実装する規約

// src/components/admin/ConfirmDialog.tsx
//   - props: open / message / onConfirm / onCancel / variant?
//   - 削除 / 訂正 / role 変更 / refresh token revoke で使用 (5 箇所)
//   - 危険操作は variant="danger" で primary を赤系トーン
```

3 つの primitives は **shadcn を増やさず** Tailwind v4 token のみで実装。既存 `<Alert />` / `<Button />` / `<Field />` を内部で再利用。

#### 3.2.1 5-a. QR 設定 CRUD (`qr_format_definitions` + `qr_item_definitions`、versioned)

要件:
- format 一覧: `qr_type` × `version` で行表示。`readable=false` / `issuable=false` は chip で警告
- format 詳細: position-indexed の items を編集 (position は append-only、既存 position 変更不可 → **新 version 作成のみ可**)
- **バージョン管理**: format 詳細画面に「**この format を V<N+1> として複製**」ボタン。`unique (tenant_id, qr_type, version)` を守るため、server action 内で `max(version)+1` を SELECT FOR UPDATE で取得 (§3.3 共通 envelope の `withVersionLock` ヘルパー)
- **`readable=false` 誤操作**: `qr_scan_histories` の使用件数を SELECT し、0 件でなければ confirm ダイアログで「過去スキャンが残っています。読取不可にすると履歴の照合表示に影響します」と警告 (`docs/ARCHITECTURE.md R-08` 対応)
- 読取テスト: Phase 2 既存 `QrReadTest.tsx` を維持。format 選択 dropdown に admin が編集した format がリアルタイムで反映 (server action 後 `router.refresh()`)

#### 3.2.2 5-b. 照合ルール CRUD (`match_rules` + `match_rule_lines`)

Phase 2 既存 `MatchRulesEditor.tsx` を **そのまま使う + 修正点 2 つ**:
- (修正 1) `lines wipe-and-reinsert` 方式 → **diff-based UPSERT + soft-delete**。理由: Phase 2 既存実装は `delete then insert` で `previous_record_id` 等の参照を破壊する可能性がある (rule_lines は子テーブルだが将来 audit_logs から参照される可能性、§9 R-P5-04)
- (修正 2) `business_code` ごとに **default rule** を強調表示。`work_settings.match_rule_id` で参照されているルールは「使用中」chip を出し、削除前確認

#### 3.2.3 5-c. 項目設定 詳細 UI (`tenant_field_settings` + `custom_field_definitions`)

Phase 2 既存 `FieldSettingsForm.tsx` (demo fixtures) → Supabase select に切替 + **`custom_field_definitions` セクション追加**:

- **standard fields**: `standard_field_definitions` (system 配布、read-only) × `tenant_field_settings` (上書き) を JOIN し、利用 ON/OFF / 用途 5 種 / 表示 label を編集
- **custom fields**: `custom_field_definitions` で `target_column` ∈ {`custom_text_01..10`, `custom_number_01..05`, `custom_date_01..05`} のうち **未使用列のみドロップダウンに表示**。テナントが「意味付け」(label, data_type, sort_order, purpose) を行う
- 「意味付け済 custom column」は records 系 form (Phase 4c の WORKS、Phase 3b の LOGI) に **次フェーズ (Phase 7) で連動表示** する伏線を残す (Phase 5 では設定の保存まで)
- 用途 5 種 (`identify_header` / `identify_line` / `match_source` / `item_label` / `display_only`) は Phase 2 fixtures と一致

#### 3.2.4 5-d. CSV format CRUD (`csv_import_definitions` + `csv_export_definitions`)

要件:
- import / export を **同画面の 2 タブ**で扱う
- column_mapping (jsonb) editor: 行: target_column / CSV 列番号 / required / default。50 行を max とし、超過時はエラー
- encoding は shift_jis / utf8、delimiter は comma/tab/pipe、duplicate_action は skip/update/error (DDL の CHECK と整合)
- **テンプレ ダウンロード**: §3.6 で詳述

#### 3.2.5 5-e. 業務設定 CRUD (`work_settings` + `work_input_field_settings`)

要件:
- 4 business × 1 行 (UNIQUE `(tenant_id, business_code)`) を tab で切替
- `work_mode` / `match_mode` / `ng_flow` / `correction_approval` / `header_format_id` / `line_format_id` / `label_format_id` / `match_rule_id` を編集
- format / rule の dropdown は `qr_format_definitions` (readable=true) / `match_rules` (enabled=true) から SELECT
- `work_input_field_settings`: 業務ごとに 「入力対象の field_code 一覧 / required / sort_order」 を editor。tenant_field_settings.enabled=true の field_code のみドロップダウン
- `ng_flow=block` を選んだ時の影響範囲を inline で説明 (`scanner-state.ts` の現挙動)

#### 3.2.6 補完: 製造系 master CRUD (`work_types` / `processes` / `equipment` / `defect_groups` / `defects`)

`MasterCrudTable.tsx` (§3.2.0) を 5 master で再利用:
- 共通列: code (unique) / name / sort_order / enabled / note
- `defects` は `defect_group_id` (`defect_groups` への FK) を持つ → dropdown
- ※ Phase 4 で `processes` / `equipment` / `defect_groups` / `defects` の DDL は **Phase 2 既存** または **Phase 4a で新規** だが、Phase 2 migration を grep した結果 `public.processes` `public.equipment` `public.defect_groups` `public.defects` `public.work_types` は **Phase 2 で すべて DDL 済 + RLS 適用済**。Phase 4 architect doc が言及している "Phase 4a masters DDL" は **WORKS 用に再作成しただけで Phase 2 と重複** している (migration では `if not exists` で no-op 化)。Phase 5 は **Phase 2 の DDL に CRUD UI を載せる** だけで足りる

### 3.3 server actions 共通 envelope

```ts
// src/lib/admin/shared/result.ts (新規)
export type AdminActionResult<T = void> =
  | { status: "ok"; data?: T }
  | {
      status: "error";
      code:
        | "validation"            // zod 失敗
        | "forbidden"             // role gate 失敗
        | "not_found"             // 対象なし
        | "conflict"              // unique / FK 違反
        | "rls"                   // 42501 (RLS reject)
        | "unconfigured"          // env 未設定
        | "unexpected";
      message: string;
    };

// src/lib/admin/shared/guard.ts (新規)
//   ensureTenantAdmin(): AppSession | AdminActionResult<never> ("forbidden"/"unconfigured")
//   既存 src/lib/auth/session.ts の getAppSession() を呼び出すラッパ

// src/lib/admin/shared/validation.ts (新規)
//   itemCodeSchema / sortOrderSchema / encodingSchema / delimiterSchema 等
//   src/lib/validation/shared.ts (Phase 4b で切り出し済) を import + 再 export
```

### 3.4 user 管理 server actions

#### 3.4.1 `changeUserRole()` の Phase 5 利用

`src/lib/auth/role-change.ts` (AC-AUTH-01 closure 済) を **そのまま** Phase 5 で利用:

```ts
// src/app/app/admin/users/actions.ts
"use server";
import { changeUserRole } from "@/lib/auth/role-change";

export async function changeRoleAction(
  targetUserId: string,
  newRole: AppRole,
): Promise<AdminActionResult> {
  // 1. ensureTenantAdmin() (caller 検証)
  // 2. zod parse (targetUserId UUID / newRole enum)
  // 3. changeUserRole({targetUserId, newRole}) を呼ぶ
  // 4. result を AdminActionResult に変換
}
```

`changeUserRole` 内の **caller 検証 + service_role + `admin_revoke_refresh_tokens` RPC** はそのまま機能する。**新規 migration ゼロ**、新規 service-role 経路ゼロ。

#### 3.4.2 user 招待 `inviteUserAction()`

```ts
// src/app/app/admin/users/actions.ts
"use server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function inviteUserAction(input: {
  email: string;
  role: "worker" | "tenant_admin";
}): Promise<AdminActionResult<{userId: string}>> {
  // 1. ensureTenantAdmin() (caller = tenant_admin or system_admin)
  // 2. zod: email RFC5322 + role in {worker, tenant_admin}
  // 3. admin = createAdminClient();
  // 4. data = await admin.auth.admin.inviteUserByEmail(email, {
  //      data: { display_name: email },
  //      redirectTo: SITE_URL/auth/callback?next=/account
  //    });
  //    ※ inviteUserByEmail は Supabase Auth dashboard で SMTP / Magic Link
  //       設定が必要。未設定なら "error: SMTP not configured" を返す → §9 R-P5-08
  // 5. app_metadata.tenant_id / role を caller の tenant に固定して updateUserById:
  //      app_metadata = { tenant_id: caller.tenantId, role: input.role }
  // 6. profiles insert (id=data.user.id, tenant_id=caller.tenantId, role)
  //    ↑ Phase 1 profile RLS の "insert_admin_only" policy で gate される
  // 7. 戻り値 = {userId: data.user.id}
}
```

セキュリティ階層 (二重防御):
- (a) ensureTenantAdmin() ← app-layer
- (b) `profiles_insert_admin_only` policy ← RLS (DB layer)
- (c) `admin.auth.admin.inviteUserByEmail` は service_role 必須 ← grant layer

#### 3.4.3 user deactivate / reactivate

「無効化」は **soft-delete + refresh token revoke** で実現:

```ts
export async function deactivateUserAction(targetUserId: string): Promise<AdminActionResult> {
  // 1. ensureTenantAdmin()
  // 2. caller が tenant_admin の場合、対象 user の app_metadata.tenant_id が caller.tenantId と一致するかチェック
  // 3. admin = createAdminClient();
  // 4. sb.from("profiles").update({ deleted_at: new Date().toISOString() }).eq("id", targetUserId)
  //    ↑ profiles_update_self_or_admin policy で tenant_admin が gate
  // 5. admin.rpc("admin_revoke_refresh_tokens", { p_user_id: targetUserId })
  //    ↑ 既存 RPC、新規 migration なし
  // 6. ※ auth.users 自体は **削除しない**。soft-delete のみ
}

export async function reactivateUserAction(targetUserId: string): Promise<AdminActionResult> {
  // profiles.deleted_at を null に戻す
  // refresh token は revoke 済なので、user は再ログインから始まる
}
```

**ADR-P5-02**: `auth.users` の row 削除は Phase 5 では **行わない**。理由:
- `created_by` / `updated_by` 等の FK が auth.users(id) を参照しており、row 削除すると `on delete restrict` または `set null` で参照不整合 / NULL 化が起きる
- soft-delete (`profiles.deleted_at`) + refresh token revoke で実質ログイン不可になる
- 完全削除は GDPR 等で必要になる場合に Phase 6 (テナント管理) または Phase 7 で別途検討

#### 3.4.4 個人設定: PW 変更 / display_name 変更

```ts
// src/app/app/account/actions.ts
"use server";

export async function changePasswordAction(
  currentPassword: string,
  newPassword: string,
): Promise<AdminActionResult> {
  // 1. session = await getAppSession();
  // 2. zod: newPassword min(10), control-char guard
  // 3. const sb = await createClient();   // anon JWT (user session)
  // 4. sb.auth.updateUser({ password: newPassword })
  //    ※ Supabase Auth は 「同セッション」 = user の現在のパスワード保有 を確認しない
  //       Phase 5 では 「現在のパスワード」 を UI に必須入力させ、
  //       内部で signInWithPassword で再確認してから updateUser を呼ぶ
  //       (CSRF / セッションハイジャック対策、ARCHITECTURE §4 RLS-008 と同精神)
  // 5. PW 変更後に **全 refresh token revoke** を呼ぶか?
  //    → 呼ぶ。`admin.rpc("admin_revoke_refresh_tokens", { p_user_id: session.userId })`
  //       理由: 旧 PW を知る攻撃者の旧 session を即無効化
  //    ※ ただし「現在のセッション」もこれで切れる → UI 側で /login にリダイレクト
}

export async function changeDisplayNameAction(displayName: string): Promise<AdminActionResult> {
  // 1. session = await getAppSession();
  // 2. zod: displayName 1..64 / control-char guard
  // 3. sb = await createClient();
  // 4. sb.from("profiles").update({ display_name: displayName, updated_at: now() }).eq("id", session.userId)
  //    ↑ profiles_update_self_or_admin policy で self update gate
}
```

### 3.5 訂正 UI 設計 (`previous_record_id` 経由)

#### 3.5.1 履歴 → 訂正起動

`/app/logi/history/[id]/page.tsx` (既存) に **訂正ボタン** を追加:

- 表示条件: `recorded_at` から 72 h 以内 (work_settings から拡張可。Phase 5 デフォルト)
- 表示条件 (権限): worker は self のみ、tenant_admin は全レコード
- ボタン押下 → `/app/correct/[recordId]?from=history` へ navigate
- `previous_record_id != null` のレコード (= 既に訂正済) は **「訂正済」chip + 訂正後レコードへのリンク** を出し、訂正ボタンは出さない (二重訂正を抑止、ただし訂正後レコードから更に訂正は可能)

#### 3.5.2 訂正フォーム

`/app/correct/[recordId]/page.tsx`:

- 旧レコードを Supabase から SELECT (anon JWT、RLS で gate される)
- business_code を判定し、対応するフォーム (movement / inventory / manufacturing) をレンダ
- 入力 default は旧レコードの値。各フィールドの **「変更前 → 変更後」** を inline で表示
- footer に「**訂正の理由**」 free-text (256 文字)、必須

#### 3.5.3 訂正 server action `submitCorrection`

```ts
// src/lib/logi/corrections.ts (新規)
export async function submitMovementCorrection(input: {
  previousRecordId: string;
  newPayload: MovementRecordInput;   // 既存 movement validators
  reason: string;
}): Promise<ActionResult<{newRecordId: string}>> {
  // 1. session = await getAppSession();
  // 2. zod: previousRecordId UUID / newPayload は既存 movement schema / reason 1..256
  // 3. sb = await createClient();   // anon JWT
  // 4. Phase 4 で submit_manufacturing_record RPC を導入したのと同パターンで
  //    Phase 5 では submit_movement_correction RPC を追加 (§6)
  //    RPC は 1 transaction で:
  //      a. SELECT 旧 row (RLS gate、self or tenant_admin only)
  //      b. UPDATE 旧 row SET deleted_at = now()
  //      c. INSERT new row with previous_record_id = 旧.id, worker_id=auth.uid()
  //      d. (任意) INSERT into corrections_audit (新テーブル、§6 で決定する)
  //      e. RETURN new row id
  //   SECURITY INVOKER (RLS が gate)
  // 5. 戻り値 = {newRecordId}
}

// inventory / manufacturing も同パターン
export async function submitInventoryCorrection(...) { /* RPC: submit_inventory_correction */ }
export async function submitManufacturingCorrection(...) { /* RPC: submit_manufacturing_correction */ }
```

**ADR-P5-03 — corrections_audit テーブルの要否**:
- **採用 (Phase 5a で migration 追加)**: `previous_record_id` だけでは「**訂正の理由**」「**誰がいつ操作したか**」「**承認者**」が記録できない。`corrections_audit` テーブルを 1 本追加:
  ```sql
  create table public.corrections_audit (
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id) on delete cascade,
    business_code text not null check (business_code in ('receiving','picking','inventory','manufacturing')),
    target_table text not null check (target_table in (
      'movement_records','inventory_records','manufacturing_records','manufacturing_record_defects'
    )),
    previous_record_id uuid not null,
    new_record_id uuid not null,
    actor_id uuid not null references auth.users(id),
    reason text not null,
    approved_by uuid references auth.users(id),    -- correction_approval=true 時のみ
    approved_at timestamptz,
    created_at timestamptz not null default now()
  );
  -- RLS: select same-tenant + tenant_admin or actor=self、insert RPC 経由のみ
  ```
- Phase 7 (`audit_logs` + trigger) と統合する選択肢もあるが、訂正は business 別の文脈情報 (reason / 承認者) を持つため **専用テーブル** を持たせる方が data モデルが clean
- `target_table` allow-list + `target_id` の組合せは Phase 3a `validate_target_tenant()` と相似形だが、**訂正は同一テナント内に閉じる** ため新規 trigger は不要 (RPC が SELECT で旧 row の tenant_id を読んで NEW.tenant_id にコピーする)

#### 3.5.4 製造実績訂正の特例 (R-P4-17 closure)

製造実績の訂正は **製造入庫 (`movement_records.manufacturing_record_id`) との整合** が課題:

- 訂正前の `manufacturing_records` 行 → 製造入庫 1 件が紐付いている可能性
- 訂正時の挙動 (UI confirm step):
  - 選択肢 A: **製造入庫もロールバック** (旧 `movement_records` を soft-delete + 新 `manufacturing_records` から再生成)
  - 選択肢 B: **製造入庫はそのまま残す** (在庫を動かさない、`manufacturing_record_id` の参照は orphan ↔ ただし `on delete set null` ではなく `is null` 残し)
- デフォルトは **B (在庫を動かさない)**。安全側 (在庫数の意図しない変動を防ぐ)
- A を選んだ場合は `submit_manufacturing_correction` RPC 内で `movement_records` も同トランザクションで soft-delete + 必要なら再 INSERT

R-P4-17 (Phase 4 SECURITY-AUDIT で DEFERRED) はこの 5d で closure。

#### 3.5.5 `correction_approval=true` テナント分岐

- 通常フロー: 訂正フォーム submit → 即座に新 record INSERT + 旧 deleted_at + corrections_audit INSERT (approved_by=actor_id 自動 / approved_at=now())
- 承認フロー (`work_settings.correction_approval=true` のみ): 訂正フォーム submit → `corrections_audit` を **pending** で 1 行 INSERT (approved_by=null, new_record_id=null)、新 record はまだ INSERT しない。leader (tenant_admin) が `/app/admin/users` 隣に新設の `/app/admin/corrections-pending` で **承認** すると、その時点で新 record INSERT + corrections_audit を update
- Phase 5d で **承認 UI は最小実装** (一覧 + 承認ボタンのみ)。否認 / 差戻し UX は Phase 7

### 3.6 CSV テンプレ ダウンロード

```
src/app/api/admin/csv-template/[master]/[encoding]/route.ts (新規)

  GET /api/admin/csv-template/work_types/utf8
  GET /api/admin/csv-template/work_types/shift_jis
  ... 5 master × 2 encoding = 10 endpoint

  - tenant_admin only (Cookie session を読んで getAppSession)
  - Static header CSV (列名のみ、行データなし)
  - shift_jis は src/lib/csv/encode.ts (iconv-lite) で encode
  - sanitize.ts は header 列名にも適用 (formula injection 防御の defensive 適用)
  - Content-Disposition: attachment; filename="<master>_template_<encoding>.csv"
  - Content-Type: text/csv; charset=<encoding>
```

ファイル本体 (列名定義) は `docs/csv-templates/` 配下に **README + 10 ファイル** を Phase 5d で同梱。route handler は README に書かれた定義を import (or hard-code) して返す。

---

## 4. RLS 確認: 既存 RLS で master CRUD が適切に gate されるか

### 4.1 既存 RLS の Phase 5 適用性 一覧

| テーブル | Phase 5 操作 | 既存 RLS | 追加要否 |
|---|---|---|---|
| `qr_format_definitions` | tenant_admin CRUD | `qr_format_select_same_tenant` + `qr_format_modify_tenant_admin` (Phase 2) | **不要** |
| `qr_item_definitions` | tenant_admin CRUD (parent FK 経由 gate) | `qr_item_select_same_tenant` + `qr_item_modify_tenant_admin` (Phase 2 で `exists` joined) | **不要** |
| `match_rules` | tenant_admin CRUD | `match_rules_*` (Phase 2) | **不要** |
| `match_rule_lines` | tenant_admin CRUD (parent FK 経由) | `match_rule_lines_*` (Phase 2 で `exists` joined) | **不要** |
| `tenant_field_settings` | tenant_admin CRUD | `tenant_field_settings_*` (Phase 2) | **不要** |
| `custom_field_definitions` | tenant_admin CRUD | `custom_field_definitions_*` (Phase 2) | **不要** |
| `csv_import_definitions` | tenant_admin CRUD | `csv_import_*` (Phase 2) | **不要** |
| `csv_export_definitions` | tenant_admin CRUD | `csv_export_*` (Phase 2) | **不要** |
| `work_settings` | tenant_admin CRUD | `work_settings_*` (Phase 2) | **不要** |
| `work_input_field_settings` | tenant_admin CRUD | `work_input_field_*` (Phase 2) | **不要** |
| `work_types` / `processes` / `equipment` / `defect_groups` / `defects` | tenant_admin CRUD | 全 master `*_select_same_tenant` + `*_modify_tenant_admin` (Phase 2 + Phase 4a で if not exists 経由) | **不要** |
| `profiles` | tenant_admin invite / role change / soft-delete | `profiles_insert_admin_only` + `profiles_update_self_or_admin` + `profiles_delete_admin_only` (Phase 1) | **不要** |
| `movement_records` / `inventory_records` / `manufacturing_records` / `manufacturing_record_defects` (訂正書込) | worker self correction / tenant_admin correction | 既存 self-or-admin policy (Phase 3a/4a) で、`worker_id=auth.uid()` で INSERT + 旧 row UPDATE は self or tenant_admin | **不要 (ただし RPC SECURITY INVOKER で wrap、§4.2)** |
| `corrections_audit` (新規) | system insert via RPC + select same-tenant | **新規 policy 追加** (§4.3) | **要追加 (Phase 5a migration)** |

### 4.2 訂正 RPC の SECURITY モード

`submit_movement_correction` / `submit_inventory_correction` / `submit_manufacturing_correction` の 3 RPC は **SECURITY INVOKER** で書く:

- 理由: RLS が caller の権限を gate する。RPC 内の SELECT/UPDATE/INSERT すべて caller の権限で実行され、tenant 境界 / self-only 制約が **そのまま効く**
- SECURITY DEFINER にする必要は **ない** (auth.refresh_tokens のような特権テーブルを触らない)
- Phase 4 `submit_manufacturing_record` と同方針 (`docs/ARCHITECTURE-phase4-manufacturing.md §5.2 / §10 R-P4-16`)

### 4.3 `corrections_audit` の RLS policy 案

```sql
alter table public.corrections_audit enable row level security;

create policy corrections_audit_select_same_tenant
on public.corrections_audit for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

create policy corrections_audit_insert_via_rpc
on public.corrections_audit for insert to authenticated
with check (
  tenant_id = app.current_tenant_id()
  and actor_id = auth.uid()
);

create policy corrections_audit_update_tenant_admin
on public.corrections_audit for update to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- DELETE policy は意図的に作らない (audit は不変)
```

### 4.4 raw_value 経路は触らない

訂正 UI は `qr_scan_histories` を読み書きしない (=raw_value 経路に触れない)。Phase 3a の `v_qr_scan_histories` / `v_qr_scan_histories_admin` dual-view は **そのまま** で OK。

### 4.5 `service_role` 利用箇所の Phase 5 増分

| 利用箇所 | 既存 / 新規 | 用途 |
|---|---|---|
| `src/lib/auth/role-change.ts` (`changeUserRole`) | 既存 (AC-AUTH-01 closure) | role / tenant_id metadata 書換 + refresh token revoke |
| `src/lib/supabase/admin.ts` (`createAdminClient`) | 既存 | service_role client factory |
| `inviteUserAction` (新規 `src/app/app/admin/users/actions.ts`) | **新規** | `admin.auth.admin.inviteUserByEmail` (service_role 必須) |
| `deactivateUserAction` / `reactivateUserAction` | **新規** | `admin_revoke_refresh_tokens` RPC + profiles update (anon でも可だが session 切断のため admin 経由が一貫) |
| `changePasswordAction` | **新規** | refresh token revoke (任意。Phase 5b で再判断) |

Phase 5d security audit で `service_role` / `SUPABASE_SERVICE_ROLE_KEY` の `.next/static/**/*.js` grep 0 hit を再検証 (Phase 4d と同方法)。

### 4.6 worker の `/app/admin/*` block

`src/middleware.ts` (既存) を Phase 5a で拡張:

```ts
// 既存: 未認証は /login へ
// Phase 5a 追加: /app/admin/* かつ role=worker は /app/logi へ
//                /app/admin/users/* かつ role=worker は同上
//                /app/correct/* は worker でも到達可 (self レコード訂正)
//                /app/account/* は worker でも到達可
```

これにより worker は admin URL を直接叩いても 307 リダイレクト (Phase 4d 本番 smoke と同方針)。RLS の二重防御で **DB レベルでも tenant_admin 不在の admin INSERT は reject** される。

---

## 5. Phase 5 / Phase 6 / Phase 7 / Phase 8 境界

| 機能 | Phase 5 in | Phase 6 (tenant 管理) | Phase 7 (履歴強化+監査) | Phase 8 (オフライン) |
|---|---|---|---|---|
| マスタ CRUD 5 種 + 製造系 master 5 種 | **in** | — | — | — |
| 訂正 UI (4 業務) | **in** | — | 監査ログ画面で訂正履歴を一覧 | — |
| 個人設定 (PW / display_name) | **in** | — | — | — |
| 同テナント内 user 管理 (招待 / role / active) | **in** | クロステナント user 管理 | — | — |
| `tenants` CRUD / `tenant_subscriptions` cap | — | **in** | — | — |
| 月間スキャン上限 | — | **in** | — | — |
| カスタム項目意味付け UI | **in** | — | records 系 form で連動表示 | — |
| `audit_logs` + trigger | — | — | **in** | — |
| コード照合 (帳票チェック) | — | — | **in** | — |
| 履歴 CSV 出力 | Phase 3b 既存維持 | — | より高速な絞込 | — |
| オフライン PWA | — | — | — | **in** |
| `correction_approval=true` 承認フロー | **最小 in (5d 1 経路)** | — | 完全 UX (否認 / 差戻し) | — |

---

## 6. 想定 migration 一覧

Phase 5 の **新規 migration は最小 2 本** を想定:

| # | ファイル名 (案) | 目的 | 必要性 |
|---|---|---|---|
| 1 | `20260528000100_phase5_corrections_audit.sql` | `public.corrections_audit` テーブル + RLS + index `(tenant_id, business_code, created_at desc)` | 訂正の理由 / 承認者 / actor を残す監査基盤 (§3.5 ADR-P5-03) |
| 2 | `20260528000200_phase5_correction_rpcs.sql` | `public.submit_movement_correction(...)` / `public.submit_inventory_correction(...)` / `public.submit_manufacturing_correction(...)` の **3 RPC** (SECURITY INVOKER, search_path='') | 訂正を 1 transaction で実行する (旧行 deleted_at + 新行 INSERT + corrections_audit INSERT) |

**新規不要なもの**:
- `qr_format_definitions` / `match_rules` / `tenant_field_settings` / `custom_field_definitions` / `csv_*_definitions` / `work_settings` / `work_input_field_settings` の DDL → **Phase 2 既存**
- `processes` / `equipment` / `defect_groups` / `defects` / `work_types` の DDL → **Phase 2 既存** (Phase 4a の `if not exists` no-op で重複)
- `profiles_*` RLS / `admin_revoke_refresh_tokens` RPC → **Phase 1 + Phase 5 既存** (`20260513000000_phase5_admin_revoke_refresh_tokens.sql` は production 適用済)
- `validate_target_tenant()` allow-list 更新 → **不要** (`corrections_audit` は polymorphic FK を持たない、`target_table` を持つが allow-list は独自に CHECK 制約で記載)

**Forward-only 移行ポリシー**: Phase 1〜4 と同方針。

**Live migration 適用 strategy**: Phase 4 同様、`node .kobo/apply-one-T-<TASK_ID>.mjs <filename>` で REST API 経由 (`POST /v1/projects/{ref}/database/query`)、secret 値は echo しない。

---

## 7. 想定 test 一覧

### 7.1 種別マップ

| 種別 | テストファイル (案) | カバー対象 | gate |
|---|---|---|---|
| Unit | `tests/unit/admin-validators.test.ts` | qr_format / match_rule / csv_format / work_settings の各 zod schema (control-char / max length / required FK / version >= 1) | 常時 |
| Unit | `tests/unit/correction-validators.test.ts` | 訂正 zod (reason 1..256 / previousRecordId UUID / new payload は既存 movement/inventory/manufacturing schema 再利用) | 常時 |
| Unit | `tests/unit/admin-action-result.test.ts` | `AdminActionResult` envelope の判別共用体動作、`ensureTenantAdmin` の早期 return パス | 常時 |
| Unit | `tests/unit/csv-template-generator.test.ts` | CSV テンプレ 列名生成 + sanitize.ts 通過 (formula injection 防御) | 常時 |
| Integration RLS (live-gated) | `tests/integration/rls/admin-crud-rls.test.ts` | RLS-501..506 (下記 §7.2) | `RUN_LIVE_RLS_TESTS=1` |
| Integration RLS (live-gated) | `tests/integration/rls/corrections-rls.test.ts` | RLS-507..510 (下記 §7.2) | `RUN_LIVE_RLS_TESTS=1` |
| Integration auth (live-gated) | `tests/integration/auth/user-invite.live.test.ts` | invite → app_metadata pin → profile insert → 招待後 magic link 到達 (SMTP 設定済 dev tenant) | `RUN_LIVE_AUTH_TESTS=1` (新規 gate) |
| Integration auth (live-gated) | `tests/integration/auth/password-change.live.test.ts` | PW 変更 → refresh token revoke → 旧 session 切断 | `RUN_LIVE_AUTH_TESTS=1` |
| E2E | `tests/e2e/admin-master-crud.spec.ts` | 5 マスタ × create / update / soft-delete のスモーク + axe | Playwright 構造解析 + 認証 cookie |
| E2E | `tests/e2e/admin-users.spec.ts` | invite UI → role 変更 → deactivate のスモーク (live env でなく、構造解析 + form validation のみ) | 同上 |
| E2E | `tests/e2e/correction-flow.spec.ts` | 4 業務 訂正フロー (history → 訂正起動 → reason 入力 → submit → 新 record 表示) | 同上 |
| E2E | `tests/e2e/account-settings.spec.ts` | PW 変更フォーム validation / display_name 更新 | 同上 |
| Security audit (read-only, 単監査) | `docs/SECURITY-AUDIT-<date>-phase5.md` | service_role 漏洩 grep / raw_user_metadata 書込 grep / admin route の middleware gate 静的レビュー / 訂正 RPC SECURITY INVOKER 確認 / inviteUser の email injection (zod 拒否) | Phase 5e |

### 7.2 新規 RLS テスト (RLS-501..510)

| ID | テーブル / 操作 | 期待 |
|---|---|---|
| RLS-501 | `qr_format_definitions` worker INSERT (tenant_admin only) | 42501 |
| RLS-502 | `qr_format_definitions` cross-tenant UPDATE | 0 rows affected (RLS filter) |
| RLS-503 | `match_rule_lines` parent rule のテナントが違う INSERT | 42501 (parent join policy で reject) |
| RLS-504 | `tenant_field_settings` worker UPDATE | 42501 |
| RLS-505 | `csv_import_definitions` cross-tenant SELECT | 0 rows |
| RLS-506 | `profiles` tenant_admin が他テナント user の role 変更を試行 | reject (app-layer + RLS の二重防御。`changeUserRole` は app-layer で reject、RLS は profile update gate) |
| RLS-507 | `corrections_audit` cross-tenant SELECT | 0 rows |
| RLS-508 | `corrections_audit` INSERT で `actor_id != auth.uid()` | 42501 |
| RLS-509 | `corrections_audit` worker UPDATE | 42501 (tenant_admin only) |
| RLS-510 | `submit_movement_correction` RPC 経由で他テナントの previousRecordId を渡す | RPC 内 SELECT が RLS で 0 rows → RPC が `not_found` を返す |

### 7.3 A11y / a11y 拡張

- 全 admin 画面で axe 違反 0 (Phase 3b/4c 確立済)
- DataTable の動的 row 操作 (削除 / 編集 trigger) に `aria-live="polite"` 通知
- FormModal は `<dialog>` 要素ベースで focus trap (DialogJS 不使用、ブラウザ native)
- ConfirmDialog の primary は危険操作で `variant="danger"` (色 + icon + pattern の 3 チャンネル)
- 56×56 タッチ違反 0

### 7.4 二重監査スキップの代替

`docs/IMPLEMENTATION_PLAN.md §2` に「Phase 5 スキップ可」と明記。本 doc では:

- **reviewer (single-pass)** で 4 領域を gate:
  1. 権限境界 (tenant_admin invite / role change / 訂正書込 / system_admin マスタ閲覧)
  2. CSV テンプレ生成の formula injection 防御
  3. `service_role` 漏洩 grep
  4. 訂正 RPC の SECURITY INVOKER + search_path
- security-auditor を呼び出すのは **5e で 1 回のみ** (single pass、二重監査ではない)
- Phase 6 (tenant 管理) で二重監査が再び必須化されるため、Phase 5 の権限境界に問題があれば Phase 6 着手前に catch される構造

---

## 8. Phase 5 全体 budget 試算 + dispatch 分割 (4-5 分割)

`docs/IMPLEMENTATION_PLAN.md` Phase 5 行: **14 日 / 140 turn / 二重監査スキップ可**。本 doc では Phase 5 を **5 dispatch** に分割。

### 8.1 dispatch 一覧

| dispatch | scope | DoD | budget (max_turns / max_minutes) | 必須 role |
|---|---|---|---|---|
| **5a foundation** | <ul><li>`src/middleware.ts` の admin / account route gate 拡張 (worker→/app/logi リダイレクト)</li><li>`src/lib/admin/shared/{result,guard,validation}.ts` (server actions 共通 envelope)</li><li>`src/components/admin/{DataTable,FormModal,ConfirmDialog}.tsx` 3 primitives</li><li>`src/app/app/admin/page.tsx` をカード 8 個に拡張</li><li>migration 1: `corrections_audit` テーブル + RLS</li><li>migration 2: `submit_movement_correction` / `submit_inventory_correction` / `submit_manufacturing_correction` の 3 RPC (SECURITY INVOKER, search_path='')</li><li>2 migration を live apply (HTTP 201)</li><li>RLS-507..510 の静的 SQL を README に追記 (live exec は 5e)</li></ul> | build/lint/vitest pass / 2 migration live applied / DataTable / FormModal / ConfirmDialog の Storybook (もしくは raw render test) green / middleware redirect の playwright structure test green | **30 turn / 70 min** | architect (本 doc) → backend (migration + RPC) + frontend (primitives) |
| **5b master CRUD core** | <ul><li>5-a QR 設定 CRUD (`qr_format_definitions` + `qr_item_definitions` + version 複製)</li><li>5-b 照合ルール CRUD (Phase 2 既存 → diff UPSERT + soft-delete 修正)</li><li>5-c 項目設定 詳細 UI (`tenant_field_settings` の demo → Supabase select 切替、custom_field_definitions 追加)</li><li>製造系 master CRUD 5 種 (`MasterCrudTable.tsx` で共通化)</li><li>unit + e2e admin-master-crud.spec.ts (5 マスタ × create/update/soft-delete スモーク)</li></ul> | 全 5 画面で create / update / soft-delete が live env で動作 / RLS-501..505 静的 SQL README 追記 / e2e structure pass / axe 違反 0 / 56×56 タッチ違反 0 | **35 turn / 80 min** | frontend (主) + backend (server actions) + reviewer |
| **5c advanced master + field semantics** | <ul><li>5-d CSV format CRUD (`csv_import_definitions` + `csv_export_definitions` + column_mapping editor)</li><li>5-e 業務設定 CRUD (`work_settings` + `work_input_field_settings`)</li><li>カスタム項目意味付け UI 仕上げ (`custom_field_definitions` × `tenant_field_settings` 統合)</li><li>CSV テンプレ ダウンロード route `/api/admin/csv-template/[master]/[encoding]/route.ts` + `docs/csv-templates/` 配下 10 ファイル + README</li><li>unit csv-template-generator.test.ts</li></ul> | CSV format CRUD live env で動作 / CSV テンプレ 10 ファイル ダウンロード可 / shift_jis encode + formula injection sanitize regression なし / work_settings の format / rule dropdown が `qr_format_definitions.readable=true` のみ表示 | **30 turn / 70 min** | frontend (主) + backend + reviewer |
| **5d correction + personal/user settings** | <ul><li>`src/lib/{logi,works}/corrections.ts` (`submitMovementCorrection` / `submitInventoryCorrection` / `submitManufacturingCorrection`)</li><li>`/app/correct/[recordId]/page.tsx` + `CorrectionForm.tsx`</li><li>`/app/logi/history/[id]` に訂正ボタン追加</li><li>`/app/admin/users/*` (invite / role 変更 / deactivate / reactivate)</li><li>`/app/account/*` (PW 変更 / display_name 変更)</li><li>`correction_approval=true` テナント分岐 + `/app/admin/corrections-pending` 最小実装</li><li>製造実績訂正の "製造入庫を残す/巻き戻す" confirm step (R-P4-17 closure)</li><li>integration auth live tests (`RUN_LIVE_AUTH_TESTS=1` 新 gate)</li><li>e2e correction-flow.spec.ts / admin-users.spec.ts / account-settings.spec.ts</li></ul> | 訂正 e2e 4 業務 pass / invite e2e structure pass / PW 変更 → refresh token revoke 動作 / R-P4-17 closure ("製造入庫を残す" デフォルト) / `correction_approval=true` テナントで承認 step が出る | **35 turn / 80 min** | frontend + backend + reviewer |
| **5e polish + single-pass audit** | <ul><li>RLS-501..510 live exec (`RUN_LIVE_RLS_TESTS=1`)</li><li>`RUN_LIVE_AUTH_TESTS=1` で invite / PW change live regression</li><li>security-auditor single pass (read-only): service_role 漏洩 grep / raw_user_metadata 書込 grep / admin route gate static review / 訂正 RPC SECURITY INVOKER 確認 / inviteUser email injection 拒否確認</li><li>`docs/SECURITY-AUDIT-<date>-phase5.md` 生成 (P0=0 / P1=0 期待)</li><li>`docs/RUNBOOK.md` Phase 5 セクション追記 (admin 操作 / 訂正 / user 招待 の runbook)</li><li>`docs/PRODUCT_SPEC.md` の P1 (Phase 5〜7 / Beta 検証) を `[shipped 2026-MM-DD]` マーク</li><li>`docs/csv-templates/README.md` を user-facing tone で仕上げ</li><li>UX レビュー (Phase 3b の 4 軸スコア = 学習しやすさ / 操作効率 / エラー回復 / a11y を 4/5+ 維持)</li></ul> | live RLS 全 PASS / security-auditor single-pass pass (P0=0 P1=0) / SECURITY-AUDIT-phase5.md 存在 / RUNBOOK 更新 / PRODUCT_SPEC AC-CSV-02 (テンプレ 10 ファイル) / AC-CORR-01 (訂正 e2e 4 業務) / AC-USER-01 (invite + role + deactivate) を新規 AC として明示 | **10 turn / 50 min** | security-auditor (single pass) + reviewer + ops (RUNBOOK) |
| **合計** | — | — | **140 turn / 350 min** (= 5.8 h 実時間、並列で短縮可) | architect + backend + frontend + reviewer + security-auditor + ops |

### 8.2 並列化想定 (Phase F-3 dogfood 継続)

- 5b と 5c は **frontend / backend を真並列** 投入可。5a でテンプレ (DataTable + FormModal + AdminActionResult envelope) が確立しているため、5b/5c は disjoint 領域
- 5d は frontend / backend / reviewer の 3 並列。訂正 RPC は 5a で migration 済のため、5d 内は UI 寄り
- 5e は security-auditor + reviewer + ops の 3 並列

### 8.3 risk / contingency

- Phase 5 は **14 日 / 140 turn / 二重監査スキップ可** = MVP 後の最初の "脇道整備" フェーズ。実装ボリュームは大きい (5 マスタ + 訂正 + 個人/user) が、Phase 2 既存 DDL に乗るため新規 risk は少ない
- 並列投入で実時間を短縮できる前提だが、CSV format CRUD (5c) と 訂正 UI (5d) のいずれかが想定外に大きくなったら **5c を 5c-1 / 5c-2 に再分割** (CSV format / work_settings / カスタム項目意味付け)
- SMTP 未設定で invite が動かない場合 (R-P5-08) は 5d 完了報告に `STATUS: degraded` を立て、Phase 5e で owner にエスカレート

---

## 9. 既知 risk と回避策

| ID | risk | 影響 | 回避策 |
|---|---|---|---|
| **R-P5-01** | `submit_*_correction` RPC を **誤って SECURITY DEFINER** で書く | RLS bypass / tenant 境界全壊 | Phase 5a migration の SQL レビューで `security invoker` を grep。Phase 5e single-pass audit でも再確認 |
| **R-P5-02** | invite された user の `app_metadata.tenant_id` が pin されないまま auth.users.row が作られる | クロステナント escalation の足場 | `inviteUserAction` 内で **必ず** `admin.auth.admin.updateUserById(userId, { app_metadata: {tenant_id, role}})` を呼んでから profile INSERT。`raw_user_metadata` は **絶対に書かない** (Phase 1 RLS-008 不変) |
| **R-P5-03** | `correction_approval=true` テナントで承認待ち corrections_audit が滞留 | 訂正レコードが永久 pending | Phase 5d の `/app/admin/corrections-pending` で件数バナー。Phase 7 で audit cron が pending > 7 日を leader にメール通知 (将来) |
| **R-P5-04** | `match_rule_lines` の wipe-and-reinsert (Phase 2 既存) で参照を破壊 | 監査ログ / Phase 7 連携の broken FK | Phase 5b で `actions.ts` を diff-based UPSERT + soft-delete に修正。`updated_at` の monotonic 性を維持 |
| **R-P5-05** | `qr_format_definitions.readable=false` を誤操作で全 format に適用 | 業務継続停止 | 5b で `qr_scan_histories` 使用件数 > 0 の format に対する `readable=false` は ConfirmDialog で 2 回確認 (Phase 0 R-08 対応) |
| **R-P5-06** | 訂正 UI で worker が他人の record を訂正試行 | self-only 違反 | RPC 内の SELECT 旧 row が RLS で 0 rows → RPC は `not_found` を返す。app-layer でも `previous.worker_id !== auth.uid()` を二重チェック |
| **R-P5-07** | tenant_admin が **自分自身** を deactivate して全 admin が unreachable | テナント lock-out | `deactivateUserAction` の caller 検証で `targetUserId === caller.session.userId` の場合は reject。tenant 内 last admin チェックは Phase 6 で本格対応 (Phase 5 では self-deactivate のみ防御) |
| **R-P5-08** | Supabase Auth dashboard で SMTP / Magic Link 未設定 → `inviteUserByEmail` が email 送信失敗 | invite 機能 全停止 | `inviteUserAction` は email 送信失敗時に `AdminActionResult.error{code:"unconfigured"}` を返す。UI でその旨を表示。5e 完了報告で owner に `STATUS: degraded` を立てる |
| **R-P5-09** | `custom_field_definitions` で同 `target_column` への二重 mapping (例: `custom_text_01` に 2 つの label) | データ整合性破壊 | Phase 2 既存 `UNIQUE (tenant_id, target_column)` を確認 (Phase 5 architect で migration 再走不要、Phase 5a の sanity check で確認)。違反したら zod でも拒否 |
| **R-P5-10** | CSV テンプレ ダウンロードの formula injection | テンプレ を Excel で開いた user の端末上で式実行 | `src/lib/csv/sanitize.ts` の `'` prepend を **header 列名にも適用**。Phase 5c unit test 必須 |
| **R-P5-11** | `account/page.tsx` (個人設定) の PW 変更フォームに **現 PW** 入力欄を忘れる | CSRF / セッションハイジャック耐性 低下 | Phase 5d で UI / server action 双方に required。`signInWithPassword` で再確認 (§3.4.4) |
| **R-P5-12** | service_role client が `src/app/api/admin/csv-template/...` の route handler に **誤って** 出現 | bundle leakage | テンプレ route handler は anon JWT で完結 (session 検証だけで OK)。Phase 5c の reviewer grep で 0 hit を確認 |
| **R-P5-13** | `tenant_field_settings` UPSERT が `field_code` の存在チェックを怠り、`standard_field_definitions` にない code を insert | dangling reference | Phase 2 DDL の `references public.standard_field_definitions(code)` で FK 違反 → 42P01 を `AdminActionResult.error{code:"conflict"}` に変換 |
| **R-P5-14** | 訂正 UI が **製造入庫の二重ロールバック** を起こす (旧 movement_records + 新 movement_records の両方が在庫を動かす) | 在庫数 inflate / deflate | 5d 訂正 RPC で「製造入庫を残す」 default を採り、user が opt-in した時のみ movement_records も soft-delete。`movement_records` の partial unique index (alive) が二重 INSERT を弾く |
| **R-P5-15** | Phase 5 で `correction_approval=true` を導入したテナントで MVP デプロイ済の現場 user が「訂正ボタンを押しても保存されない」と混乱 | UX 悪化 | UI に「**承認待ちです**」chip + 承認者 / 経過時間を表示 (5d 最小実装) |
| **R-P5-16** | `inviteUserByEmail` の `redirectTo` を悪意ある URL に誘導される | open redirect | Phase 1 既存 `src/lib/auth/safe-redirect.ts` を `inviteUserAction` でも import。`SITE_URL` (`NEXT_PUBLIC_SITE_URL` env) と同 origin のみ許可 |
| **R-P5-17** | DataTable の client-side filter が **全テナント行を fetch する設計** に bug → 行数増で初期描画 > 1.5s (AC-PERF-01 違反) | perf 違反 | sever-side で max 500 行 LIMIT。500 件超は admin が search/filter で絞り込む UI を 5b で前提化 |
| **R-P5-18** | Phase 5e single-pass audit が二重監査の代替として **不十分** で、Phase 6 着手時に再監査が必要 | budget 増 / Phase 6 遅延 | 5e で security-auditor が **権限境界 + service_role 漏洩 + 訂正 RPC** の 3 領域だけは "二重監査 相当の depth" でレビュー (single pass だが深く)。Phase 6 (テナント管理) で発見されたら hot-fix dispatch で対応 |
| **R-P5-19** | `corrections_audit` テーブルが Phase 7 `audit_logs` と統合される将来移行で命名 conflict | データ移行コスト | 5a migration コメントで「Phase 7 で `audit_logs` 統合候補」を明記 (`ADR-P5-03`)。命名は `corrections_audit` のまま、Phase 7 で view を切る判断 |
| **R-P5-20** | dispatch instructions の `app/(app)/settings/*` route 構造を採用しなかったことが **Phase 6 で再設計コスト** | Phase 6 リファクタ | §3.1 ADR-P5-01 で根拠を明示。Phase 6 で `settings/` group を新設する場合でも、Phase 5 `admin/` / `account/` は **そのまま温存**して新 route を別に切れば破壊なし |

---

## 付録 A: Phase 4 / Phase 5 / Phase 6 の境界 (再確認)

| 機能 | Phase 4 (deployed) | Phase 5 (本 doc) | Phase 6 (未着手) |
|---|---|---|---|
| 4 業務 records 系 CRUD UI | **DONE** (worker 入力) | 訂正書込追加 | — |
| 履歴 detail UI | **DONE** (4 業務統合履歴) | 訂正起動ボタン追加 | — |
| マスタ DDL + RLS | Phase 2 (P2 既存) + Phase 4a (no-op で重複) | UI 化のみ | — |
| マスタ CRUD UI | — | **本 doc 主役** | — |
| user 招待 / role / active | AC-AUTH-01 server action のみ | UI + 招待 + active 切替 | クロステナント user 管理 |
| 個人設定 | — | PW / display_name | — |
| `tenants` CRUD | — | — | **Phase 6** |
| `tenant_subscriptions` cap | — | — | **Phase 6** |
| 月間スキャン上限 | — | — | **Phase 6** |
| `audit_logs` + trigger | — | corrections_audit のみ局所追加 | — / Phase 7 で本格 |
| `correction_approval=true` 承認 | — | **最小 in (5d)** | — / Phase 7 で完全 UX |

---

## 付録 B: 採用しないが議論された選択肢

| 案 | 不採用根拠 |
|---|---|
| dispatch instructions の `app/(app)/settings/*` 新規 route group | 既存 `/app/admin/*` を温存する方が migration コストゼロ・既存 e2e 非破壊 (§3.1 ADR-P5-01) |
| `auth.users` row の hard delete | FK 参照 (`created_by` / `updated_by`) 破壊。soft-delete + refresh token revoke で実質ログイン不可 (§3.4 ADR-P5-02) |
| 訂正フローを `UPDATE` で実装 | ARCHITECTURE §4 で 「UPDATE 上書き禁止」と Phase 0 で確定 (§3.5) |
| `corrections_audit` を Phase 7 `audit_logs` に統合 | 訂正は business 文脈 (reason / approved_by) を持つため専用テーブルが clean。Phase 7 で view 統合可 (§3.5 ADR-P5-03) |
| `correction_approval=true` 完全 UX (否認 / 差戻し / コメント) | Phase 7 P2 機能扱い。Phase 5d では最小 (一覧 + 承認のみ) (§3.5.5) |
| 多階層 role (tenant_owner / line_lead / worker) | YAGNI、Phase 0 ロール定義 (`worker` / `tenant_admin` / `system_admin`) で十分 |
| マスタ CRUD の動的列追加 (`custom_text_11` 以降) | スキーマ固定方針 (Phase 1 `custom_text_01..10` / `custom_number_01..05` / `custom_date_01..05` 上限) |
| user 一覧の全件取得 + client-side filter | RLS だけでは tenant_admin が他テナントを見えないが、API 経由 paginate を 5b 共通 DataTable で実装する方が a11y / perf 上 strictly better |
| `qr_format_definitions` の position 編集 (in-place) | QR_SPEC §3 §5 で 「position 変更 = 新 version」 と確定 (§3.2.1) |

---

## 付録 C: 既存 architecture doc への follow-up 提案 (本 dispatch では `docs/ARCHITECTURE.md` を編集しない)

Phase 5a 着手前または着手と同じ dispatch で、owner 承認の上 `docs/ARCHITECTURE.md` に追記する候補:

1. §2 ER 図に `corrections_audit` を明示追加 (Phase 5a 後)
2. §4 RLS テンプレに **訂正 RPC SECURITY INVOKER パターン** を 1 行追加 (Phase 5a 後)
3. §4 RLS テストに RLS-501..510 を追加 (Phase 5e closure 後)
4. §5 リスクに R-P5-07 (tenant lock-out 防御) と R-P5-14 (製造入庫 二重ロールバック) を要約追加

これらは本 dispatch スコープ外 (`docs/ARCHITECTURE.md` 編集禁止) のため、本 doc では提案のみ。

---

## 付録 D: dispatch 完了基準 trace

dispatch DEFINITION_OF_DONE との対応:

- (1) `docs/ARCHITECTURE-phase5-admin-ui.md` が完成し、1-9 を網羅 → **本 doc §1-§9 で網羅**
- (2) Phase 5 を 4-5 dispatch に分割提案、各 scope / DoD / budget を含む → **§8.1 で 5 dispatch、各 budget (turn/min) を明記**
- (3) 既存 docs と整合性 conflict 0 → **§1.2 で conflict 検査 (8 観点で 0)、付録 C に follow-up 提案のみ**
- (4) code/migration/UI/test/package/config 変更なし → 本 doc は docs/ のみへの書込
- (5) `.kobo/final-report-T-20260514-120000-genba-phase5-architect.md` に STATUS / 変更ファイル / 読んだ資料 / missing source / risk / 次 dispatch 推奨 → 別 file
- (6) 完了報告 prefix `[genba]` → final report 冒頭
- (7) 完了通知文に「Phase 5 architect 完了、Phase 5a foundation dispatch を director が起案予定」 → 最終応答に追記

---

## 終わりに

Phase 5 は **Phase 2 が用意した admin 系 DDL + Phase 1 が用意した auth RPC** に **UI と server actions を載せる** ことで成立する "脇道整備 + 訂正書込" フェーズである。新規 migration は **2 本 (corrections_audit + 3 訂正 RPC)** のみで、scheme の新規 attack surface は訂正 RPC の SECURITY INVOKER 維持のみに集約される。

dispatch instructions の `app/(app)/settings/*` route 構造は本 doc で **採用見送り** (§3.1 ADR-P5-01)、既存 `/app/admin/*` を温存しつつ `/app/account/*` `/app/correct/[recordId]/*` を新設する形を採用した。これにより Phase 2 既存 e2e の破壊コストはゼロ、Phase 6 でテナント管理画面を新設する際の追加コストも実質ゼロに抑えられる。

Phase 5 全体を 5 dispatch (5a foundation / 5b master CRUD core / 5c advanced master + field semantics / 5d correction + personal/user settings / 5e polish + single-pass audit) に分割した 140 turn 予算は `docs/IMPLEMENTATION_PLAN.md` Phase 5 行と整合し、5b/5c の frontend × backend 真並列投入で実時間を約 40% 短縮できる前提に立つ。

architect 完了、owner 確認後に Phase 5a (foundation) dispatch を director が起案予定。
