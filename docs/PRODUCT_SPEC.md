# GENBA Product Spec

作成日: 2026-05-10 / Phase 0 Discovery
入力: `research/genba-discovery/spec/GENBA_機能整理.md` + `genba_overall_ui_mock.html`

## 1. プロダクト概要

GENBA は **現場入力に特化した multi-tenant SaaS**。製造・物流現場の **入庫 / ピッキング / 棚卸 / 製造実績** の 4 業務を **QR 中心** に 1 端末で扱い、基幹 (GEN) 連携なしでも **Excel/CSV 取込・出力** のみで導入できる。

**Value**: 紙の指示書と複数アプリに分散していた現場記録を QR と 1 端末に統合し、誤品目・数量間違いを 2 点照合で抑止。**QR バージョン管理** により旧ラベルを貼り替えずに仕様変更を運用継続できる。

**スコープ外 (Phase 0)**: WMS 本体、受発注/会計連携、PLC/MES 直結、BI、ネイティブアプリ (PWA で対応)。

## 2. ペルソナ

| ID | 役割 | 痛点 | GENBA への期待 |
| --- | --- | --- | --- |
| **P-OPE** 現場作業員 | 紙↔現品 照合ミス、手袋でのスマホ操作 | 大型タップ領域、QR を「向ければ読む」、即時 NG 警告 |
| **P-LEAD** 現場リーダー | 進捗・訂正履歴が辿れない | 作業中セッション一覧、訂正前 ID リンク、CSV 即出力 |
| **P-ADM** テナント管理者 | 帳票変更のたびにベンダー依頼 | QR/CSV/作業設定を自分で組替、読取テストで即検証 |
| **P-OWN** システム管理者 | テナント開設・上限管理 | テナント管理画面、月間スキャン上限、プラン (LOGI/WORKS/両方) |

## 3. 主要ユースケース

- **UC-1 ピッキング (P-OPE)**: 帳票ヘッダ QR → 明細 QR → 現品ラベル QR → 2 点照合 → 数量入力 → 登録。`ng_flow` により block / warn を切替。
- **UC-2 入庫 (自由読取)**: 現品ラベル QR → ロケーション補正 → 登録 (`movement_plan_line_id=null`)。
- **UC-3 棚卸**: 棚卸予定を CSV 取込後、ロケーション QR → ラベル QR → 実数量入力。差異あり行のみ CSV 出力。
- **UC-4 製造実績**: 製造指示 QR → 開始/終了 → 製造数・ロット・設備 → 不適合 N → 製造入庫を任意併記。
- **UC-5 QR 設定変更 (P-ADM)**: 既存 V1 を残したまま V2 を追加 (`readable=true, issuable=true, valid_from`)、読取テストで V1/V2 両方解析できることを確認。
- **UC-6 テナント開設 (P-OWN)**: 利用業務 (LOGI/WORKS/両方)・上限を設定し初期管理者を招待。

## 4. 機能優先度

### P0 (Phase 1〜4 / MVP 必須)
Auth + multi-tenant RLS、ユーザー (=作業者) 管理、業務マスタ + 作業設定 (work_mode / match_mode / ng_flow)、QR 読取 (header/line/label) + バージョン管理、2 点照合 (`match_rules` / `match_rule_lines`)、入庫・ピッキング・棚卸・製造実績、CSV 取込/出力 (shift_jis/utf8)、履歴画面、項目設定 (標準+カスタム)、QR 読取履歴。

### P1 (Phase 5〜7 / Beta 検証)
マスタ CRUD UI、カスタム項目意味付け UI、コード照合 (帳票チェック)、テナント管理画面、個人設定、訂正タブ UI、月間スキャン上限の集計と警告。

### P2 (Phase 8〜10 / 本番後拡張)
オフライン (PWA + IndexedDB キュー)、GEN 連携 (REST/SFTP)、監査ログ画面、Sentry 等の有償 observability (approval 必須)、英語 UI、BI/KPI ダッシュボード。

## 5. MVP 境界

**MVP = P0 のみ**。Phase 4 完了時点で 1 テナント・3 ユーザー・4 業務すべて、QR V1 + 2 点照合、CSV 取込/出力、過去 30 日履歴検索が動作。マスタ CRUD UI / コード照合 / テナント管理画面 / オフライン / 訂正専用タブは MVP 外。

## 6. 受け入れ基準 (Definition of Done at MVP)

- **AC-AUTH-01** ログイン: 正資格でログイン可、誤資格で bypass 不可、24h で失効。**パスワード最低 10 文字** (UI/zod 双方で強制)。**role / tenant 変更時は service_role で対象 user の refresh token を revoke** (server-only RPC、client へ service_role を露出しない)。Supabase Auth 標準の rate limit に従う (Phase 1 着手後に dashboard 値を SECURITY-AUDIT に記録)。
- **AC-RLS-01** テナント分離: T1 ユーザーは T2 行を select/update/delete 不可 (ARCHITECTURE §8.3 テスト SQL 対応)。
- **AC-QR-01** 2 点照合: `item_code` 不一致で `match_result=ng` + `match_detail` 記録。`ng_flow=block` で登録 disabled。
- **AC-QR-02** バージョン管理: V1/V2 共 readable なら両方解析可、`issuable=false` の V1 は新規発行候補に出ない。
- **AC-CSV-01** 取込: shift_jis/utf8 で文字化けなし、`start_row` 指定可、重複動作 (skip/update/error) が設定どおり。
- **AC-HIST-01** 履歴: 業務/期間/ユーザー/削除済の絞込が効く、CSV 出力は絞込結果のままダウンロード。
- **AC-A11Y-01** WCAG 2.2 AA: 4.5:1+ コントラスト、focus ring、主要操作タップ領域 56×56 px。
- **AC-PERF-01**: 履歴初期描画 < 1.5s (1k 件)、QR 解析 < 300ms、CSV 1k 行で 5s。

## 7. 非機能 / 確定方針 (旧オープン論点)

NFR: WCAG 2.2 AA、`primary_locale: ja-JP` (英語 UI は P2)、iOS Safari 17+/Android Chrome 120+、論理削除のみ、`previous_record_id` で訂正履歴。**Supabase PITR は Phase 3〜4 境界で有効化** (`paid_subscription_signup` 承認は Phase 3 末 / Phase 4 着手前に取得、MVP 本番稼働開始時に PITR ON)。

確定方針 (Phase 0 owner レビュー結果、2026-05-11 反映):

- **D-01 GEN 連携プラン明示**: プラン UI には出さず、Phase 10 で REST/SFTP オプションとして提供。`tenant_subscriptions` の `enabled_features` jsonb に `gen_integration` フラグを置き有効テナントのみ表示。
- **D-02 マスタ CSV テンプレ標準提供**: 5 マスタ (`work_types`/`processes`/`equipment`/`defect_groups`/`defects`) について shift_jis / utf8 双方の空テンプレ CSV を Phase 5 で `docs/csv-templates/` 配下に同梱。
- **D-03 手入力フォールバック**: **4 業務全てに必須**。`@zxing/browser` 失敗 / 端末カメラ不在 / `getUserMedia` 拒否 / 30s タイムアウト時に手入力モーダルへ遷移 (`ManualInputModal`)。タップ領域 56×56 px 維持。
- **D-04 訂正履歴の出し方**: `previous_record_id` チェーン + 履歴画面で「訂正前 ID」リンク表示 (Phase 4 で読み取り、Phase 5 で訂正 UI 提供)。UPDATE 上書き禁止 / 旧行は `deleted_at` で残す。
- **D-05 オフラインのスコープ**: Phase 8 で PWA + IDB キュー。**記録系のみ** (movement/inventory/manufacturing records)、設定 / マスタ / QR 定義変更はオンライン必須。IDB に PII / 認証情報を残さない (同期成功で即削除、ログアウト時全削除)。
- **D-06 訂正承認フロー**: 標準は不要。`work_settings.correction_approval` (boolean、default false) を Phase 2 で導入し、有効テナントのみ Phase 5 でリーダー承認ステップを追加 (P2 機能)。
