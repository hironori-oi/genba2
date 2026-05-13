# GENBA Migration Notes (from pick-checker)

作成日: 2026-05-10 / Phase 0 Discovery
依存: `docs/PRODUCT_SPEC.md`、`docs/ARCHITECTURE.md`
参考: `research/genba-discovery/reference/pick-checker/` (**read only / コピー禁止**)

## 1. 位置づけ

pick-checker は GENBA とは別アプリとして区切り、GENBA は仕様 (`GENBA_機能整理.md` + mock) から **新規に再設計**。本書は (1) pick-checker 棚卸 / (2) 差分マトリクス (維持/拡張/廃止/新規) / (3) 移行戦略 を整理する。実装は Phase 1 でゼロから書くが、判断材料として「pick-checker は何を持っていたか」を残す。

## 2. pick-checker 棚卸

**スタック**: Next.js 16 + React 19 + TS 5.7 / Supabase Auth / `@zxing/browser` 0.1.5 / `idb` / Sentry / Tailwind v4。GENBA は Next 15 系で確定 (tech-stack.yaml)、Sentry は approval 必須のため初期不採用。

**画面 (`app/(app)/`)**: `picking/`, `receiving/`, `inventory/`, `manufacturing/` (→ GENBA: `app/(app)/work/{業務}/`)、`scan/` (→ `components/scanner/` 共通化)、`history/`、`settings/` (個人 + 一部運用)、`admin/` (テナント管理者) → 運用設定 8 タブに再構成、`system-admin/` (システム管理者) → テナント管理。

**コンポーネント**: `ScannerView` / `ManualInputModal` / `ResultOverlay` / `CsvExportButton` / `BottomBar` / `BottomSheet` / `TenantSwitcher` / `SyncStatusBadge` / `StepHeader` / `CompleteOverlay` / `ConfirmModal` / `NSettingsModal` (廃止候補)。

**lib**: `qr-parser.ts` / `{業務}-session.ts` × 4 / `csv-utils.ts` / `history.ts` / `tenant/` / `auth/` / `supabase/` / `sync/` / `wakeLock` / `inactivity-timer` / `sound`。

**migrations** (`supabase/migrations/`): `001_initial`, `002_bootstrap` (seed), `003〜006` 業務スキーマ, `007_security_fixes`, `008_seed_test_data`, `009_system_admin`, `010_fix_rls_recursion`, `011_direct_user_management`, `012_worker_app_assignment`, `013_security_search_path`, `014_tenant_max_users`, `015_tenant_enabled_apps`。

## 3. 差分マトリクス (🟢維持 / 🟡拡張 / 🔴廃止 / 🆕新規)

| 領域 | pick-checker | GENBA | 区分 |
| --- | --- | --- | --- |
| コア技術 | Next 16 + React 19 + Supabase + zxing + Tailwind v4 | Next 15 + 同 | 🟢 (バージョン揃え) |
| 観測 | Sentry built-in | Vercel built-in | 🟡 (Sentry は Phase 8+ 再検討、approval 必須) |
| 業務構成 | 4 業務独立 session module | 4 業務 + `work_settings` 駆動 | 🟡 (LOGI/WORKS プラン分離) |
| 業務種類 | 4 種 | 4 種 | 🟢 |
| 作業設定 (`work_mode`/`match_mode`/`ng_flow`) | hardcode 相当 | `work_settings` テーブル駆動 | 🆕 |
| 項目設定 (標準/カスタム) | 暗黙 | `tenant_field_settings` + `custom_text_01..` | 🆕 |
| QR フォーマット | `qr-parser.ts` 固定 | `qr_format_definitions` + `qr_item_definitions` バージョン管理 | 🆕 (差別化) |
| 照合ルール | hardcode | `match_rules` + `match_rule_lines` 駆動 | 🆕 |
| CSV 取込 | `csv-utils.ts` | `csv_import_definitions` + 列定義駆動、shift_jis | 🟡 |
| CSV 出力 | `CsvExportButton` | `csv_export_definitions` 駆動 (項目/ブランク/固定値) | 🟡 |
| スキャン UX | `ScannerView` (1D/QR、S/M/L、ズーム、手入力) | 同等 + 業務色フラッシュ + 56px タップ | 🟢 |
| オフライン | `sync/` + IDB | P2 (Phase 8+) で再導入 | 🔴 (Phase 0〜7) |
| 訂正 | "新規/訂正" タブ | `previous_record_id`、UI は Phase 5 (P1) | 🟡 |
| 個人設定 | `settings/` 一部 | アカウント / 表示名 / パスワード / 端末 / 同期 (mock 準拠) | 🟡 |
| マスタ設定 | テナント管理者画面の一部 | 運用設定 → マスタタブ (work_types / processes / equipment / defect_groups / defects) | 🆕 |
| テナント管理 | `system-admin/` | プラン (LOGI/WORKS/両方) + 上限 (ユーザー / 月間スキャン) | 🟡 |
| コード照合 (帳票チェック) | (ありそう、未確認) | 補助機能 P1 | 🟢 |
| 多テナント RLS | `007`, `010_fix_rls_recursion` | テンプレ + JWT claim 再設計 | 🟡 (再帰問題を先回り) |
| ロール | worker / tenant_admin / system_admin | 同等 | 🟢 |
| 業務別 worker 割当 | `012` | `users.assigned_businesses jsonb` | 🟢 |
| テナント上限 | `014` | `tenant_subscriptions` テーブル | 🟢 |
| テナント利用業務 | `015` | `tenant_subscriptions.enabled_businesses` | 🟢 |

## 4. 移行戦略

**コード**: コピーしない。`workspace/projects/genba/` にゼロから書く。理由は (a) `work_settings` 駆動の概念がない、(b) 「新仕様 + 旧構造」の不整合が長く残る、(c) 同じスタックなので「思想を読みながら書き直す」コストが中程度。**例外**: `tsconfig.json` / `tailwind.config.ts` / `next.config.mjs` の構造のみ参考にして新規作成 (paste 禁止)。

**データ**: Phase 0 時点で pick-checker 顧客は存在しない前提 (2026-05-11 owner 判断で確定。将来発生時は別 dispatch を起こす)。移行スクリプトは作らない。将来発生時は (1) 旧→新マッピング表、(2) 1 回限りの Edge Function INSERT、(3) 旧データに `imported_file_name='pick-checker-migration-YYYY-MM-DD.csv'` で識別、(4) QR フォーマット定義は手動で V1 として登録、(5) 照合ルールも手動再定義。

**ナレッジ (security-auditor / reviewer に共有)**:
- **RLS 再帰問題** (`010_fix_rls_recursion`) — `auth.users` を join せず `auth.jwt()` のみ使用、`search_path` を厳密固定 (`013_security_search_path`)
- **service_role 漏洩リスク** (`007`) — client コードに含めない、server only env で確認
- **iOS Safari `getUserMedia`** — 知見を Phase 1 の対応端末リスト固定に反映
- **`idb` の使い方** (`lib/sync/`, `lib/storage/`) — Phase 8 オフライン化の参考

**Phase 0〜1 でやらないこと**: ソースコピー / pick-checker リポジトリへの書込 (read only) / 互換テーブル名・カラム名採用 / DB 移行 (顧客なし前提)。

## 5. オープン論点

| ID | 論点 | 推奨 |
| --- | --- | --- |
| M-01 | pick-checker のリポジトリを GENBA に変えるか | **別物として残す** (履歴保全) |
| M-02 | 既存運用テナントを巻き取るか | **確定 (2026-05-11 owner 判断): pick-checker の既存顧客は存在しない前提で進行**。発生した場合は別 dispatch (`full_implementation_kickoff` 相当) で §4 手順を起こす。Phase 1〜10 は移行スクリプトを作成しない。 |
| M-03 | Sentry プロジェクト流用 | しない (新規 SaaS として観測も分離) |
| M-04 | `@zxing/browser` バージョン | 0.1.5 で開始、Phase 1 で最新確認 |
| M-05 | テストコード流用 | しない (仕様が異なるため Phase 1 で TDD) |
