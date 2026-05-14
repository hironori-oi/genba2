# GENBA Phase 6 (Operational Features) Architecture

作成日: 2026-05-15 / Phase 6 architect-only design
TASK_ID: T-20260515-040000-genba-phase6-architect
依存:
- `docs/ARCHITECTURE.md` (Phase 0 / 全体)
- `docs/ARCHITECTURE-phase5-admin-ui.md` (Phase 5 admin UI)
- `docs/PRODUCT_SPEC.md` §3〜§7
- `docs/IMPLEMENTATION_PLAN.md` (Phase 6 行 = 旧「テナント管理+上限」、本 doc で再スコープ)
- `docs/RUNBOOK.md` (Phase 4d-deploy 反映)
- `.kobo/final-report-T-20260514-{190000,200000,210000}-genba-phase5{b,c,d}-*.md`
- `.kobo/security-audit-phase5-final.md`
- `supabase/migrations/2026{0511,0512,0513,0520,0528}*.sql`

> Status: **architect-only design / planning-only**。本 doc 自体は production code / migration / test / config を一切変更しない。実装は owner 確認後の Phase 6a〜6f dispatch で別途。
>
> Re-scope note: `docs/IMPLEMENTATION_PLAN.md` の旧 Phase 6 (テナント管理+上限) は本 doc で **operational features 全体 (scan UX / 帳票 / 報告書 / i18n / dark mode / admin 残機能)** に再スコープする。テナント管理 + 上限の部分は §C-6f に取り込み、 既存 Phase 7-10 計画 (audit_logs, offline, PITR, i18n) のうち **owner が "進められるところを進める" と指示した surface area を Phase 6 に前倒し** する設計。Phase 9 / 10 計画は §D ADR-P6-08 で残スコープを再整理。
>
> Source notes (missing source):
> - dispatch `SOURCE_CONTEXT_FILES_READ_ONLY` で示された `docs/SECURITY-AUDIT-phase4.md` は `docs/SECURITY-AUDIT-2026-05-13-phase4.md` として存在。Phase 5e の最終 security-audit は `.kobo/security-audit-phase5-final.md` に集約。
> - `tenant_user_preferences` テーブルは **DB 上に存在しない**。Phase 5d の preferences は `auth.users.user_metadata.preferences` (jsonb) に保存されている (`src/app/app/account/preferences/page.tsx:53`, `src/lib/admin/shared/validation.ts preferencesInputSchema`)。本 doc は新規テーブル化の要否を §B-4 / §B-5 で判断する。

---

## A. 現状理解 (read-only evidence)

### A.1 既存 docs 由来の Phase 6 範囲

| 出典 (path:line / section) | Phase 6 含意 |
|---|---|
| `docs/IMPLEMENTATION_PLAN.md` §1 Phase 6 (10 日 / 100 turn / 二重監査必須) | 「システム管理者画面、`tenant_subscriptions` (利用業務/ユーザー上限/月間スキャン上限)、月次集計 EF cron、80% 到達バナー、上限チェック」 → **本 doc では 6f に取り込み**、operational 系を追加 |
| `docs/IMPLEMENTATION_PLAN.md` §1 Phase 7 (10 日) | 「QR 履歴詳細、コード照合 (帳票チェック)、`audit_logs`+trigger、履歴 CSV 出力」 → **報告書/集計 (§C-6d) と `audit_logs` UI 表示 (§C-6f) は Phase 6 へ前倒し** |
| `docs/IMPLEMENTATION_PLAN.md` §1 Phase 8 (14 日 / 二重監査必須) | オフライン (PWA + IDB queue) → **Phase 6 には含めない** (scope explosion)、§D ADR-P6-08 で deferred |
| `docs/IMPLEMENTATION_PLAN.md` §1 Phase 10 (14 日) | i18n / GEN 連携 / GA → **i18n を 6e に前倒し**、GEN 連携 / GA は据置 |
| `docs/PRODUCT_SPEC.md` §4 P1 (Phase 5〜7 Beta 検証) | 「マスタ CRUD UI、カスタム項目意味付け UI、コード照合 (帳票チェック)、テナント管理画面、個人設定、訂正タブ UI、月間スキャン上限の集計と警告」 → **Phase 5 で 5d まで closure 済**。残るは「**テナント管理画面**」「**月間スキャン上限 集計+警告**」「**コード照合 (帳票チェック)**」を Phase 6 で扱う |
| `docs/PRODUCT_SPEC.md` §4 P2 (Phase 8〜10 本番後拡張) | 「オフライン、GEN 連携、監査ログ画面、Sentry、英語 UI、BI/KPI ダッシュボード」 → **監査ログ画面 / 英語 UI / BI 簡易版** を Phase 6 へ前倒し (owner 指示「進められるところを進める」) |
| `docs/PRODUCT_SPEC.md` §3 UC-1..6 | UC-1〜5 は Phase 4 までで P0 完了。UC-6 (テナント開設、P-OWN) は Phase 6 で 6f に実装 |
| `docs/PRODUCT_SPEC.md` §7 D-05 オフライン | 「Phase 8 で PWA + IDB queue」 → Phase 6 では **手を入れない**。AppShell へ "オフライン未対応" status chip を残す |
| `docs/PRODUCT_SPEC.md` §6 AC-A11Y-01 / AC-PERF-01 | 56×56 タッチ / WCAG / 履歴 < 1.5s / QR < 300ms → Phase 6 UI 増分でも維持 |
| `docs/ARCHITECTURE.md` §5 R-02 | `qr_scan_histories` 爆発 → Phase 6 で partition / archive **検討** (ただし 6d 報告書の対象になるので index 戦略は §E-3 で言及) |
| `.kobo/final-report-T-20260514-210000-genba-phase5d-correction-personal.md` §「Remaining issues / 5e carry-over」 UX-5D-P3-01 | 「`theme` / `language` preferences は user_metadata に保存されているが AppShell render では未適用」 → **6e で wire-up** |
| `.kobo/final-report-T-20260514-210000...` UX-5D-P2-02 | 「`/app/logi/history/[id]` deep-link 訂正 button」 → Phase 5e で実装済との記載 (`README.md` Phase 5e 行で要確認)。万一未済なら 6 系統で 1 行追補。本 doc では **6b の dependency 前提** として「実装済」と仮置 |
| `.kobo/security-audit-phase5-final.md` 「Aggregated findings」 P3-AUDIT-PHASE5-01 / P2-AUDIT-PHASE5-01 | client bundle に "service_role" JSDoc 残存 (cosmetic) / RLS-505/506 admin-CRUD 統合テスト未着 → Phase 6 ではいずれも **cosmetic / coverage 拡張** 扱い。本 doc は §F-3 で 6a 着手時の 1 commit で同時 close を推奨 |
| `docs/RUNBOOK.md` §6 / §3.3 | Supabase Free tier + 日次バックアップ運用中。PITR は Phase 9 で再評価 → Phase 6 で **PITR 関連は触らない**。ただし scan 急増で trigger される可能性は §E-7 で「再評価条件のひとつ」として明記 |

### A.2 既存 src/app/app/* inventory (route / 主 component / dependency)

| Route | 主 component | DB / RPC 経由 | role gate | Phase 6 関連 |
|---|---|---|---|---|
| `/app/logi/page.tsx` | LOGI dashboard (Link cards) | none | worker+ | 6a でナビ強化 (報告書リンク追加) |
| `/app/logi/receiving/page.tsx` | LOGI receiving (Scanner + ResultOverlay + form) | `movement_records` (INSERT via server action) | worker+ | 6b scan first flow の baseline |
| `/app/logi/picking/page.tsx` | LOGI picking (Scanner header→line→label) | `movement_records` (INSERT) + match_rules / qr_format_definitions read | worker+ | 6b で match overlay polish |
| `/app/logi/inventory/page.tsx` | LOGI inventory | `inventory_records` (INSERT) | worker+ | 6b scan polish + 6c diff 帳票 |
| `/app/logi/history/page.tsx` | 4-業務統合履歴 (filter + 50 件) | `movement_records` / `inventory_records` / `manufacturing_records` SELECT (anon JWT, RLS gate) | worker self / tenant_admin all | 6c (履歴 PDF 帳票 source)、6d (集計 source) |
| `/app/logi/history/[id]/page.tsx` | 履歴詳細 (前 ID リンク / 訂正 deep-link launcher) | 上記同 SELECT + corrections_audit lookup | worker self / tenant_admin all | 6c (個票印刷の launcher) |
| `/app/works/manufacturing/page.tsx` | 製造実績 (process / defect / produce inflow) | `mfg_processes`, `defects`, `submit_manufacturing_record` RPC, `movement_records` INSERT (任意) | worker+ | 6b scan + 6c 製造日報 source |
| `/app/admin/page.tsx` | admin index (現在 8 card) | none | tenant_admin / system_admin | 6a で報告書 / 監査 / テナント / 通知 設定の 4 card 追加 |
| `/app/admin/layout.tsx` | admin tab nav + role gate | session | tenant_admin / system_admin | 6a 同上 |
| `/app/admin/fields,qr,qr-formats,match-rules,masters,csv-formats,work-settings` | Phase 5b/5c master CRUD | 各 settings/masters テーブル | tenant_admin | 変更なし |
| `/app/admin/corrections-pending/page.tsx` | 訂正承認待ち一覧 | `corrections_audit` SELECT + UPDATE | tenant_admin | 6f で UX 拡張 (件数 chip / SMTP 通知連動) |
| `/app/correct/{movements,inventory,manufacturing}` | 訂正フォーム + RPC submit | `submit_{movement,inventory,manufacturing}_correction` RPC | worker self / tenant_admin all | 変更なし (依存先のみ) |
| `/app/account/{profile,preferences}` | 個人設定 (display_name / theme / language / notification) | `auth.users.user_metadata.preferences` (jsonb) | self | **6e で AppShell wire-up + persisted column 化を判断 (§B-4)** |
| **未存在** `/app/admin/tenants`, `/app/admin/users`, `/app/admin/audit-logs`, `/app/admin/notifications`, `/app/admin/usage`, `/app/scan/*`, `/app/reports/*`, `/app/print/*`, `/api/print/*`, `/api/reports/*` | — | — | — | **Phase 6 で新規** |

### A.3 既存 DB schema / RPC inventory

#### A.3.1 Master tables (Phase 6 で新規 migration なしで参照可)

`production_lines` ／ `shifts` ／ `quality_check_items` ／ `manufacturing_record_defect_codes` ／ `processes` ／ `equipment` ／ `defect_groups` ／ `defects` ／ `qr_format_definitions` ／ `csv_format_definitions` (= `csv_import_definitions` + `csv_export_definitions`) ／ `work_settings` ／ `tenant_field_settings` ／ `custom_field_definitions`

Phase 6 dependency: **どれも追加 DDL を増やさず使用**。scan UX (6b) は work_settings + qr_format_definitions、製造日報 (6c) は production_lines + shifts + processes + equipment + defects、報告書 (6d) は集計 source として全 transactional 系。

#### A.3.2 Transactional tables

`movement_records` ／ `inventory_records` ／ `manufacturing_records` (+ `manufacturing_record_defects`) ／ `corrections_audit` ／ `qr_scan_histories` (Phase 3a)。Phase 6 で追加 DDL なしで集計可。

#### A.3.3 RPC

`submit_manufacturing_record` (Phase 4) ／ `submit_movement_correction` ／ `submit_inventory_correction` ／ `submit_manufacturing_correction` (Phase 5a) ／ `admin_revoke_refresh_tokens` (Phase 5)。

#### A.3.4 Phase 6 で新規追加が必要な DB 要素 (候補)

| 候補 | 必要性 | 採用判断 | 根拠 |
|---|---|---|---|
| `tenant_subscriptions` (利用業務 + user 上限 + 月間スキャン上限 + plan) | **必須** (P-OWN UC-6) | **6f で新規 migration** | 旧 Phase 6 計画 / PRODUCT_SPEC §4 P1。`tenants` テーブル拡張ではなく新規テーブルが clean (`plan_started_at` / `plan_ended_at` を持つため) |
| `audit_logs` (settings 変更履歴) | **必須** (PRODUCT_SPEC §4 P2 / Phase 7 計画) | **6f で新規 migration + trigger** | 「設定変更で audit_logs が増加」を 6f DoD 化 |
| `notification_preferences` (テナント単位 SMTP / webhook 設定) | **必須** (R-P5-08 / SMTP) | **6f で新規 migration** | `tenants` に jsonb 列追加 vs 新規テーブルは ADR-P6-04 で議論 |
| `tenant_user_preferences` テーブル化 (現状 user_metadata jsonb) | **不要 (Phase 6 範囲では維持)** | **採用しない** | 既存実装は jsonb で動作中、移行コストに見合わない (§B-4 ADR-P6-03)。AppShell wire-up は jsonb 読み出しで可能 |
| `monthly_scan_usage` (集計マテリアライズドビュー or テーブル) | **必須** (Phase 6 上限 + 月次 cron) | **6d または 6f で MV (Materialized View) + Edge Function cron** | MV は読み取り高速。Refresh は EF cron (1 日 1 回 03:00 JST 程度) |
| `report_templates` (帳票テンプレ定義) | **不要 (MVP では hard-coded で良い)** | **採用しない** | テナントカスタム帳票は Phase 7+ の検討。6c では 4 種類を server-side で hard-code |
| `daily_manufacturing_summary` view | **不要 (`movement_records` / `manufacturing_records` から動的 SELECT で十分)** | **採用しない** | 1 日 1k 行 程度のスケールでは index で satisfy |
| `qr_scan_histories` partition (Phase 6 で実施?) | **任意** (R-02 対応) | **見送り (§E-7)** | Free tier では partitioning オーバヘッドが大きい。Phase 9 性能 phase で本格判断 |

### A.4 Phase 4-5 defer / P3 / carry-over の Phase 6 取扱い

| 出典 | item | 6 取扱い | sub-phase |
|---|---|---|---|
| Phase 5d final §「Remaining issues」 P3 | UX-5D-P3-01 `theme` / `language` preferences AppShell wire-up | **6e で実装 (i18n + dark mode と同時)** | 6e |
| Phase 5d final §「Remaining issues」 P3 | UX-5D-P3-02 corrections-pending min UI | **5e で実装済 (`/app/admin/corrections-pending/page.tsx` 存在)**、6f で件数 chip + SMTP 通知連動 | 6f |
| Phase 5e final | P3-AUDIT-PHASE5-01 client bundle 「service_role」 JSDoc 残存 | **6a 着手時の 1 commit で同時 close** (cosmetic) | 6a |
| Phase 5e final | P2-AUDIT-PHASE5-01 admin-CRUD RLS 統合テスト未着 | **6a で `tests/integration/rls/admin-crud-rls.test.ts` 追加** | 6a |
| Phase 5b/5c carry-over | E2E_LOGI_AUTH_COOKIE 未発行 / Lighthouse / axe authed | **6a の foundation で発行**、以後の 6b〜6f で再利用 | 6a |
| PRODUCT_SPEC §4 P1 | コード照合 (帳票チェック) | **6c で帳票 PDF 内のコード照合 (PO 照合 / 計画-実績差分) を含める** | 6c |
| PRODUCT_SPEC §4 P2 | 英語 UI | **6e で ja/en 最小実装** | 6e |
| PRODUCT_SPEC §4 P2 | 監査ログ画面 | **6f で `/app/admin/audit-logs` 実装** | 6f |
| PRODUCT_SPEC §4 P2 | BI/KPI ダッシュボード | **6d で daily/weekly/monthly の最小ダッシュボード実装** | 6d |
| PRODUCT_SPEC §7 D-06 / R-P5-08 | SMTP 通知 (correction approval / completion) | **6f で notification_preferences + Edge Function notifier** | 6f |
| Phase 1 design tokens | OS-following dark via `prefers-color-scheme` のみ。手動トグルなし | **6e で `data-theme` 手動トグル追加 (auto / light / dark の 3 値)** | 6e |
| Phase 8 計画 | オフライン (PWA + IDB queue) | **Phase 6 では着手しない (deferred to Phase 8)** | — |
| Phase 9 計画 | PITR / Sentry / 観測 | **Phase 6 では着手しない (deferred to Phase 9)** | — |
| Phase 10 計画 | GEN 連携 (REST/SFTP) | **Phase 6 では着手しない (deferred to Phase 10)** | — |

---

## B. Phase 6 全体構造設計

### B.1 scan 系画面 (6b core)

#### B.1.1 設計目標

- **scan-first** = 「業務を選び、業務トップから即座にスキャンを開始できる」 UX。現状の LOGI receiving / picking / inventory / WORKS manufacturing はそれぞれ独自フローで scan 起動するが、**起動 UX を統一**しつつ既存ロジックを破壊しない。
- 「**マスタ選択 → QR scan → 数量入力 → 完了**」の 4 step を **全業務共通の Step shell** で表現。各業務は step config を渡すだけで shell が描画する。
- 56×56 タッチ / 手袋入力 / 片手操作 / aria-live を全画面で維持 (AC-A11Y-01)。

#### B.1.2 ルート戦略の比較

| 案 | 利点 | 欠点 | 結論 |
|---|---|---|---|
| A. `/app/logi/*` / `/app/works/*` の既存 route を **強化のみ**、`/app/scan/*` は作らない | route 増加ゼロ、既存 e2e/Playwright を破壊しない、既存 deep-link が温存 | scan UX が業務ごとに微妙に違うリスク (Phase 3b の独自実装と Phase 4c の独自実装の差分が温存) | **採用 (ADR-P6-01)**。**6b は既存 page に "scan-first" mode を追加** する形で実装。`?mode=scan` query で起動時に Scanner 起動の状態を default にする shell パターンを `src/components/scanner/StepShell.tsx` (新規) として共通化 |
| B. 新規 `/app/scan/{receiving,picking,inventory,manufacturing}` を作り、既存 page を残す | scan-first UX を専用ルートで純化できる | route 倍増 + middleware の追加 gate + 既存 e2e の参照先増加 | **不採用**。Phase 6 budget 内で 4 ルート分の e2e を新規に書く負荷が大きい |
| C. 既存ルートを `/app/scan/*` に移管 (rename) | scan-first がデフォルトに | 既存 URL / e2e / production の bookmark を全て壊す | **不採用**。本番 (https://genba2-ai.vercel.app/) ですでに稼働中の URL を壊さない (RUNBOOK §0) |

→ **採用 = A**。6b の core は `src/components/scanner/StepShell.tsx` (新規) を 4 業務の既存 page で **オプトイン import** する。

#### B.1.3 共通 Step shell の API

```tsx
// src/components/scanner/StepShell.tsx (新規、Phase 6b)
type StepDef<TPayload> = {
  id: string;                          // "header" | "line" | "label" | "qty" ...
  title: string;                        // "ヘッダ QR を読取"
  helper?: string;                      // "(現品ラベル QR / 56×56 ボタンで手入力)"
  kind: "scan" | "select" | "input";
  // scan: Scanner を起動 (既存 component を再利用)
  // select: master / list から 1 件選択 (DataTable-like)
  // input: 数量 / コメント等のフリー入力
  validate: (raw: string | TPayload) => Promise<TPayload | { error: string }>;
};

type StepShellProps<TPayload> = {
  steps: StepDef<TPayload>[];           // 順序付き
  onComplete: (collected: TPayload[]) => Promise<void>;  // server action へ
  startMode?: "scan" | "form";          // ?mode=scan で "scan"
  business: "receiving" | "picking" | "inventory" | "manufacturing";
  // aria-live region は内部で描画。glove input は底面 sticky の primary CTA を必須 (h-14 min-h-14)
};
```

各 4 業務 page は **既存ロジックを `validate` callback に閉じ込めるだけ** で StepShell に差し替え可能 (incremental migration)。Phase 6b の DoD は **少なくとも 1 業務 (受入が最小依存) で StepShell 採用**、残 3 業務は Phase 6b 内で順次 (時間が許せば全 4 業務、最低 1 業務)。

#### B.1.4 a11y / 手袋 / 片手操作

- **56×56 タッチ最小**: 全 step の primary CTA / 戻る / 中止 / 手入力切替 ボタン。既存 `Button size="lg"` (h-14 / min-h-14) を使う。
- **片手操作**: primary CTA は viewport 底面 sticky (`position: sticky; bottom: 0`)、副ボタンは 上部 header に配置。親指リーチを優先。
- **glove input**: Scanner の `bottomOverlay` (既存) を使った result sheet で、確認ボタン領域を 56×56 + 上下 padding 16px 以上。
- **aria-live**: step transition は `aria-live="polite"`、エラーは `aria-live="assertive"`。Scanner status は既存実装 (`scanner-status`) を踏襲。
- **focus management**: scan 成功時 → confirm CTA に auto-focus。input step は最初の field に auto-focus。

### B.2 帳票印刷 (6c)

#### B.2.1 スコープ確定 (4 種)

| 帳票 | source | 用途 |
|---|---|---|
| 製造実績日報 | `manufacturing_records` (1 日範囲) + `manufacturing_record_defects` JOIN | 現場リーダー日次振返 |
| 不適合報告 | `manufacturing_record_defects` (期間指定) + `defects` master JOIN | 品質会議資料 |
| 棚卸結果 | `inventory_records` + `v_inventory_diff` (Phase 3a で計画 vs 実数量) | 棚卸監査資料 |
| 出荷一覧 (= ピッキング実績) | `movement_records` (`business_code='picking'` 範囲) | 出荷確認控え |

#### B.2.2 PDF vs print-friendly HTML

| 案 | 利点 | 欠点 |
|---|---|---|
| A. **server-side PDF (`@react-pdf/renderer`)** | バイト確定の PDF 出力。A4 / 80mm thermal もページサイズで切替可。ファイル送付・保管に堪える | bundle size +400KB 程度 (server-only なら client bundle に来ない)。React コンポーネントツリーが別 (`PDF` namespace) |
| B. **print-friendly HTML + `window.print()`** | 追加 dependency ゼロ、CSS `@page` で A4/80mm 制御、画面 preview とそのまま一致 | 端末/ブラウザの印刷ダイアログ依存。サーバー保管用バイト確定が無い (PDF として保存するのは user 側操作) |
| C. **両方** (HTML preview + PDF download) | UX 最良 | 実装コスト 1.5x |

→ **採用 = C (HTML preview + 6c-late で PDF endpoint)** **ADR-P6-02**。実装順は HTML print (`@page` + `print:` Tailwind variant) を **6c-core** で完成させ、`@react-pdf/renderer` 経由の server-side PDF endpoint (`/api/print/[report]/route.ts`) を **6c-PDF** で追加 (任意 sub-step、時間が許す範囲)。最低 DoD は HTML print のみ。

#### B.2.3 A4 / 80mm thermal switching

```css
/* src/app/print/[report]/print.css (6c) */
@media print {
  @page { size: A4 portrait; margin: 12mm; }
}
@media print and (max-width: 80mm) {
  @page { size: 80mm auto; margin: 4mm; }
}
```

UI 上は print preview 画面に「A4 / 80mm」のトグル (radio) を出し、`data-paper="a4"|"80mm"` を root に付け CSS で分岐。

#### B.2.4 server-only print endpoint vs client-side print()

- **HTML preview** = `/app/print/[report]?from=...&to=...` (server-rendered RSC、Cookie session 経由で role / tenant_id pin)。client-side `window.print()` ボタンで OS の印刷ダイアログ起動。
- **PDF endpoint** (任意) = `/api/print/[report]/pdf` (server-only route handler, ensureAuthenticatedSession gate, `@react-pdf/renderer` で stream)。Content-Type: `application/pdf`、Content-Disposition: `attachment; filename="..."`。
- **どちらも `service_role` を使わない**。RLS が gate する anon JWT (cookie session) で SELECT のみ。

#### B.2.5 印刷スプール / queue

- **採用しない (Phase 6 範囲では)**。理由: 単一テナント MVP では同時印刷需要が低い。bulk PDF (例: 100 枚の不適合報告) は **手動 1 回ずつ** で対応する。
- Phase 7+ で bulk export EF (CSV と同等の Storage 30 日 + 非同期 job) を検討。

### B.3 報告書 / 集計・分析 (6d)

#### B.3.1 ダッシュボード 3 レベル

| レベル | 対象 | refresh |
|---|---|---|
| daily | 当日の入庫件数 / ピッキング件数 / 棚卸差異 / 製造数 / 不適合数 | リアルタイム (anon JWT SELECT 直叩き) |
| weekly | 7 日移動平均 + 日別棒グラフ | リアルタイム |
| monthly | 30/90 日トレンド + 月次集計 + テナント上限残量 | MV (1 日 1 回 cron refresh) + リアルタイム差分 |

ルート: `/app/reports/{daily,weekly,monthly}` (新規)。role gate = **tenant_admin 以上**。worker には KPI 開示しない方針 (情報露出最小化)。

#### B.3.2 集計対象 KPI

| カテゴリ | KPI | source |
|---|---|---|
| 製造 output | 1 時間あたり完成数、計画達成率、設備稼働 | `manufacturing_records` (`actual_qty` / `manufacturing_plans.target_qty`) |
| 不適合率 | 不適合数 / 完成数 (defect_code 別 breakdown) | `manufacturing_record_defects` |
| 在庫差異 | 計画 vs 実数量 差異率 (location別 / item別) | `v_inventory_diff` (Phase 3a) |
| corrections audit | 訂正件数 / 訂正理由 top5 / 訂正者 ranking | `corrections_audit` |
| QR scan usage | スキャン件数 (上限 % 表示)、業務別 breakdown | `qr_scan_histories` (Phase 3a) + `tenant_subscriptions.monthly_scan_cap` |
| pick / receive 件数 | 業務別 1 日件数 | `movement_records` |

#### B.3.3 chart library 比較

| ライブラリ | bundle | 強み | 弱み |
|---|---|---|---|
| `recharts` | ~90KB gzip | shadcn 流の見た目、React 親和、SSR 可 | line / bar / area 中心、複雑グラフは弱い |
| `chart.js` + `react-chartjs-2` | ~120KB gzip | 種類豊富、長年運用 | Canvas ベース (PDF 印刷時の再描画注意)、a11y はやや弱め |
| `@tremor/react` | ~200KB gzip | Tailwind 親和、Dashboard UI 部品込み | bundle 重め、Tailwind v4 互換は要検証 |
| `@observablehq/plot` | ~150KB gzip | 表現力高い | API が React 流ではない、SSR 設定が要工夫 |
| 自作 SVG (d3-shape のみ) | ~30KB gzip | bundle 最小、PDF 印刷に強い (SVG はそのまま埋込可) | 開発工数高い |

→ **採用 = `recharts`** **ADR-P6-05**。理由: ① bundle ~90KB は許容範囲、② SSR 可 (PDF endpoint 内でも `react-pdf` の `Svg` に変換可能経路がある)、③ shadcn / Tailwind v4 と相性良し、④ 4 種類のグラフ (line / bar / pie / area) で十分。
Tailwind v4 互換性は 6d 着手前に POC で確認 (1 dispatch 内のうち 30 turn まで)、不一致なら自作 SVG にフォールバック (ADR-P6-05 fallback)。

#### B.3.4 aggregate query 設計

- **リアルタイム集計**: 各 daily / weekly view は **anon JWT SELECT + 集計関数** (`count(*) filter (...)`, `sum(...)`) で 1〜3 query で済む。RLS は `tenant_id = current` で自動 gate。
- **MV (monthly)**: 1 日 1 回 cron でリフレッシュ。Edge Function `monthly-usage-refresh` (新規、6f で実装) が `refresh materialized view concurrently public.monthly_scan_usage` を service_role で実行。
- **performance**: index `(tenant_id, created_at)` は Phase 3 で全 records 系に既設。新規 index は不要だが、`manufacturing_record_defects (tenant_id, defect_code, created_at)` だけ 6d で追加検討 (defect breakdown 高速化、§E-3)。

### B.4 i18n 完成版 (6e)

#### B.4.1 既存 preferences との接続

- `user_metadata.preferences.language` ∈ {`"ja"`, `"en"`} は **Phase 5d で persisted 済**。AppShell render 時に **未読込**なのが UX-5D-P3-01。
- 6e で **`getAppSession()` を拡張** (or AppShell server-component で `auth.getUser()` を 1 回 SELECT) し、`preferences.language` を AppShell の `<html lang={...}>` と messages provider に流す。
- `tenant_user_preferences` テーブル化は **見送り (ADR-P6-03)**。理由: 既存 jsonb 経路が動作中、Phase 6 budget に新規 migration + データ移行 + RLS テスト を含めると 6e が肥大化。Phase 7+ で再評価。

#### B.4.2 next-intl vs react-intl 比較

| ライブラリ | App Router 親和 | bundle | server / client 共有 | message format |
|---|---|---|---|---|
| `next-intl` (v3.x) | **公式 App Router サポート**、middleware 統合、static 配信可 | ~30KB gzip | server / client 両対応 | ICU MessageFormat |
| `react-intl` (formatjs) | App Router は手動配線 | ~80KB gzip + cldr data | client 中心 | ICU |
| 自作 (key-value JSON + helper) | 0 dependency | <5KB | server only / client only を別実装 | 単純差し替えのみ (複数形は手動) |

→ **採用 = `next-intl`** **ADR-P6-06**。Next 15 + App Router で公式サポートあり (Vercel ホスティングと親和的)、server component / client component 両対応、middleware で URL prefix (`/ja/*` / `/en/*`) をオプトイン可。`next-intl` は **subpath routing** と **domain routing** の両方を持つが、Phase 6 では「**URL prefix を使わず Cookie / accept-language で切替**」モードを採用 (既存 URL を温存)。

#### B.4.3 ja/en 最小範囲と用語集

- **対象**: AppShell ナビ / admin tab / Buttons / Alerts / Form labels / 4 業務トップ / 訂正フォーム / 個人設定 / 報告書タイトル / 帳票タイトル。
- **対象外 (Phase 6 では ja 固定)**: master 名 (テナント入力)、defect_code (テナント入力)、CSV 列名 (テナント入力)、エラーメッセージのうち server-side validation 文言の一部 (zod 由来は Phase 7+ で改修)。
- **製造用語集**: `messages/{ja,en}/manufacturing.json` を **owner-reviewable な glossary doc** (`docs/i18n-glossary-manufacturing.md`、6e 新規) と並べる。例:
  - 入庫 → "Receiving", ピッキング → "Picking", 棚卸 → "Inventory count", 製造実績 → "Manufacturing record", 不適合 → "Defect", 工程 → "Process", 設備 → "Equipment", 訂正 → "Correction", 帳票 → "Report"。
- **fallback**: en の翻訳欠落キーは ja に fallback (next-intl 標準動作)。

### B.5 dark mode 完成版 (6e)

#### B.5.1 既存基盤

- Phase 1 で **`prefers-color-scheme` 自動切替の OKLCH tokens** が `src/app/globals.css` 内に整備済 (Phase 1 doc 参照)。手動トグルは Phase 1 では実装せず。
- Phase 5d で `user_metadata.preferences.theme` ∈ {`"light"`, `"dark"`, `"auto"`} が persisted 済。

#### B.5.2 wire-up plan

- **AppShell server component** で `theme` を読み出し、`<html data-theme={theme}>` (`auto` の場合は属性なしで `prefers-color-scheme` に委譲) を出力。
- CSS は既存 OKLCH tokens を `:root` (light) + `[data-theme="dark"]` (manual dark) + `@media (prefers-color-scheme: dark)` + `:root:not([data-theme])` (auto) の 3 ブロックで重ね描き。
- **client side flash 回避**: `<html data-theme="...">` を server で confirmed 値で出すため、hydration 時の theme flicker は発生しない (Phase 1 設計を踏襲)。
- 個人設定 (`/app/account/preferences`) の theme radio (現状動く) → 保存後 `revalidatePath('/app')` で AppShell が再 render され theme が反映。

#### B.5.3 design tokens dark variant 検証

- 既存 OKLCH tokens (`--ink`, `--surface`, `--surface-2`, `--border`, `--color-brand`, `--color-ok`, `--color-warn`, `--color-bad`, `--color-func-receive/pick/inventory/manufact` 等) の dark variant が `globals.css` に **既存** (Phase 1)。6e ではこれを **そのまま使う + 不足分のみ追加**:
  - 不足が予想されるトークン: scan viewfinder の `--color-scan-frame` / `--color-scan-frame-strong` / `--color-step-active`。dark 用に明度を 0.85 ↑ に再設定。
  - 帳票 print 出力では `prefers-color-scheme` を問わず **強制 light** を `@media print` で適用 (印刷で黒背景にしない)。

#### B.5.4 axe contrast verification plan

- 6e の DoD: **axe-core で contrast 違反 = 0** を ja-light / ja-dark / en-light / en-dark の **4 mode × 全主要 route** で実行。
- 既存 e2e suite に `theme: light|dark` matrix を追加。Phase 6a で発行する `E2E_LOGI_AUTH_COOKIE` を再利用して authed route まで axe 通す。
- 違反検出時は OKLCH の `L` を ±0.05 ステップで調整。primary CTA だけは 4.5:1 を確実に超える色設定を優先 (AC-A11Y-01)。

### B.6 その他検討項目 (6f + recommendations)

| 項目 | 推奨 | 根拠 | sub-phase |
|---|---|---|---|
| SMTP 通知 (correction approval / completed) | **include in Phase 6 (6f)** | R-P5-08 deferred、5d で SMTP 未設定だと invite/notify が degraded、6f で `notification_preferences` + EF notifier。テナント単位 ON/OFF | 6f |
| 監査ログ表示 UI (`/app/admin/audit-logs`) | **include in Phase 6 (6f)** | PRODUCT_SPEC §4 P2 + Phase 7 計画前倒し。`audit_logs` migration + trigger も 6f で migrations | 6f |
| ロール管理 UI (tenant_admin が worker / tenant_admin を切替) | **include in Phase 6 (6f)** | Phase 5 architect §3.4 で設計済、Phase 5b/5c では未実装。`changeUserRole()` 既存 RPC を活用、`/app/admin/users` 1 ルート | 6f |
| テナント管理 UI (system_admin のみ) | **include in Phase 6 (6f)** | 旧 Phase 6 plan の中核。`/app/admin/tenants` + `tenant_subscriptions` CRUD。**二重監査必須 (system_admin 境界)** | 6f |
| 印刷スプール / queue for bulk printing | **defer (Phase 7+)** | 単一テナント MVP では需要低い。6c では 1 件ずつ印刷で十分 | — |
| `qr_scan_histories` partition (R-02) | **defer (Phase 9 性能)** | scan 量が増えてから判断。Phase 6 で MV cron に組み込むのみ | — |
| PWA offline (D-05) | **defer (Phase 8)** | 大きすぎる scope、Phase 6 budget では収まらない | — |
| Sentry 等 observability | **defer (Phase 9, owner approval 必須)** | 有償 + secret 管理。本 dispatch は導入しない | — |
| GEN 連携 | **defer (Phase 10)** | Phase 6 scope 外 | — |
| 月次スキャン上限 80% バナー | **include in Phase 6 (6f)** | 旧 Phase 6 plan の DoD。MV + AppShell に banner 表示 | 6f |
| Bulk CSV export (期間指定で全業務) | **defer (Phase 7+)** | 既存単票 CSV export で MVP 足りる。bulk は 6 ではなく Phase 7 で `Storage 30 日` 経由 | — |

---

## C. Phase 6 sub-phase plan (6a〜6f, 6 sub-phases)

### Sub-phase 6a — Foundation + E2E auth + carry-over closure (5 日 / 60 turn)

- **Goal**: Phase 6 全体で再利用する E2E auth cookie / Lighthouse baseline / nav 拡張 を確立し、Phase 5e P2/P3 を closure。
- **Owner value**: 後続 6b〜6f の dispatch が「authed E2E + Lighthouse」を即実行できる体制ができる。Phase 5e の積み残しを 1 commit で kill。
- **Exact scope**:
  - 6a-1 `E2E_LOGI_AUTH_COOKIE` / `E2E_WORKER_AUTH_COOKIE` 発行手順を `docs/RUNBOOK.md` に追加 (Phase 5d で書きかけ)。発行は kobo Supabase project の test tenant に worker / tenant_admin / system_admin を作って `signInWithPassword` の access token を取得し Playwright fixture に保存。
  - 6a-2 admin nav (`AppShell.tsx` + `admin/layout.tsx` + `admin/page.tsx`) に 4 card 追加 (報告書 / 監査ログ / テナント管理 / 通知設定 — placeholder route で「Phase 6 進行中」chip)。
  - 6a-3 `tests/integration/rls/admin-crud-rls.test.ts` (P2-AUDIT-PHASE5-01 closure) — RLS-505 / 506 stanza 追加。
  - 6a-4 client bundle JSDoc cosmetic fix (P3-AUDIT-PHASE5-01)。`src/lib/validation/auth.ts:6` の `service_role` 単語 を別語 (例: "elevated admin RPC") に置換するか、Next.js compiler で JSDoc strip 有効化。
- **Non-scope**: 実機能 (scan / 帳票 / 報告書 / i18n / dark / admin 追加) は **何も実装しない**。Foundation のみ。
- **Files / areas**:
  - `src/components/AppShell.tsx` (nav 拡張)
  - `src/app/app/admin/{page,layout}.tsx`
  - `src/lib/validation/auth.ts` (JSDoc 修正)
  - `tests/integration/rls/admin-crud-rls.test.ts` (新規)
  - `docs/RUNBOOK.md` (E2E cookie 発行手順)
  - `playwright.config.ts` (storageState 経由で cookie 注入)
- **DB / RPC**: なし。
- **QA**: 既存 unit + e2e 全件 green を維持。新規 admin-crud RLS test は `RUN_LIVE_RLS_TESTS=1` で kobo Supabase test project に向けて実行。
- **Security / RLS**: RLS-505 / 506 live 実行で `csv_import_definitions` / `profiles` の admin-only 境界を確認。
- **Dependencies**: Phase 5e closure (Phase 5e final report が手元にある前提)。
- **Risk**: E2E cookie 発行は **secret 値を git に commit してはいけない**。`.env.local` または GitHub Actions secret に格納 (RUNBOOK 追記)。
- **DoD**: ① admin nav 4 card 追加、② RLS-505/506 live test green、③ JSDoc cosmetic 修正、④ E2E cookie 手順が RUNBOOK に追加、⑤ 既存 e2e 19 + 新規 2 件以上 = 21+ 件 pass。
- **Suggested dispatch role**: `orchestrator` (foundation 系の単一 role で完結)。

### Sub-phase 6b — Scan-first UX (StepShell + 4 業務 wiring) (7 日 / 80 turn)

- **Goal**: scan-first 業務フロー (master 選択 → QR scan → 数量入力 → 完了) を `StepShell` で共通化し、4 業務 page に導入する。
- **Owner value**: 現場作業員 (P-OPE) の 1 端末操作が直感的になり、業務切替時の学習コストが下がる。
- **Exact scope**:
  - 6b-1 `src/components/scanner/StepShell.tsx` 新規 (§B.1.3 の API)。既存 `Scanner.tsx` を内部 import。
  - 6b-2 `?mode=scan` query parameter を全 4 業務 page で解釈。`startMode="scan"` を渡せば Scanner が即起動。
  - 6b-3 4 業務 page を **incremental migration** (最低 1 業務 = 受入 = `/app/logi/receiving/page.tsx`、時間が許せば 4 業務全て)。
  - 6b-4 LOGI / WORKS トップ (`/app/logi/page.tsx`) の業務カードに「スキャンで開始」secondary CTA を追加 (主 CTA は既存「ヘッダから順に開始」)。
  - 6b-5 axe / 56×56 / glove input / aria-live を `tests/e2e/phase6b-scan-shell.spec.ts` で検証 (authed)。
- **Non-scope**: 帳票 / 報告書 / i18n / dark / admin 系。
- **Files / areas**:
  - `src/components/scanner/StepShell.tsx` (新規)
  - `src/app/app/logi/receiving/page.tsx` (mode=scan 対応)
  - `src/app/app/logi/picking/page.tsx` (任意)
  - `src/app/app/logi/inventory/page.tsx` (任意)
  - `src/app/app/works/manufacturing/page.tsx` (任意)
  - `src/app/app/logi/page.tsx` (cards)
  - `tests/e2e/phase6b-scan-shell.spec.ts` (新規)
- **DB / RPC**: なし。
- **QA**: authed Playwright で 4 業務それぞれの scan-mode 起動 → manual fallback → 完了 まで 1 シナリオ。Lighthouse mobile 3-run median, axe = 0、56×56 タッチ = 0 violation。
- **Security / RLS**: 既存 server action + RLS で gate される変更なし。`raw_value` は引き続き scan 後即破棄 (Phase 3a 既存)。
- **Dependencies**: 6a 完了 (E2E cookie)。
- **Risk**: 既存 4 業務の独自フロー (Phase 3b / 4c) を破壊しないこと。**incremental migration** で 1 業務ずつ + feature flag 不要 (`mode` query で off-ramp 可能)。
- **DoD**: ① StepShell 新規、② 最低 1 業務 (受入) で `mode=scan` 動作、③ 既存 e2e 既存通り pass、④ 6b 新規 spec で 5+ authed test pass、⑤ Lighthouse mobile median performance ≥ 80。
- **Suggested dispatch role**: `frontend` + `designer` (Step shell の glove / sticky bottom CTA は designer review 推奨) + `qa_e2e`。

### Sub-phase 6c — 帳票印刷 (HTML print + optional PDF) (6 日 / 60 turn)

- **Goal**: 4 帳票 (製造実績日報 / 不適合報告 / 棚卸結果 / 出荷一覧) を HTML print preview + (任意) server-side PDF で出力可能にする。
- **Owner value**: テナント管理者 (P-ADM) が当日 / 当週の業務記録を紙 / PDF で保管・配布できる。品質会議資料の自動化。
- **Exact scope**:
  - 6c-1 `src/app/print/[report]/page.tsx` 4 ルート (`manufacturing-daily`, `defect-report`, `inventory-result`, `picking-list`) を `/app/print` (worker+ 到達可、tenant_admin 推奨) で server-render。Cookie session 経由で role / tenant_id pin。
  - 6c-2 `src/app/print/[report]/print.css` で A4 / 80mm thermal の `@page` 切替 + `print:` Tailwind variant。
  - 6c-3 `/app/logi/history/page.tsx` から「印刷」launcher を期間 + 業務絞込で起動。`/app/logi/history/[id]/page.tsx` から「この 1 件を印刷」launcher を deep-link。
  - 6c-4 (任意) `src/app/api/print/[report]/pdf/route.ts` で `@react-pdf/renderer` を server-only で stream。`Content-Disposition: attachment`。
  - 6c-5 帳票内の **コード照合** (PRODUCT_SPEC §4 P1): 製造実績日報で `manufacturing_plans.target_qty` vs `manufacturing_records.actual_qty` 差分を red highlight。出荷一覧で `movement_plan_lines.expected_qty` vs `movement_records.actual_qty` 差分 highlight。
  - 6c-6 4 業務 print preview + 1 PDF download の e2e `tests/e2e/phase6c-print.spec.ts`。
- **Non-scope**: bulk print queue / 印刷スプール / テナントカスタム帳票テンプレ。
- **Files / areas**:
  - `src/app/print/[report]/{page,print.css}.tsx` (新規)
  - `src/app/api/print/[report]/pdf/route.ts` (任意)
  - `src/lib/print/{templates,csv-bridge}.ts` (任意 / 集計クエリ)
  - `src/app/app/logi/history/{page,[id]/page}.tsx` (launcher 追加)
  - `tests/e2e/phase6c-print.spec.ts`
  - `package.json` (`@react-pdf/renderer` 追加、PDF endpoint 採用時のみ)
- **DB / RPC**: 既存テーブル SELECT のみ。新規 view は **作らない** (Phase 3a の `v_inventory_diff` を再利用)。
- **QA**: ① HTML preview を authed で 4 帳票 render、② print preview の visual snapshot (要 fixture data)、③ axe = 0、④ Lighthouse print page で performance 確認 (重要度低)、⑤ PDF download MIME assertion。
- **Security / RLS**: anon JWT SELECT + RLS で tenant 分離。**worker は自テナント全件 SELECT 可だが、本 doc では帳票 print は tenant_admin に限定 (information_exposure 最小化)** → ADR-P6-07。worker は **自分のレコードのみ** print 可、tenant_admin は全件可。
- **Dependencies**: 6a 完了。
- **Risk**: PDF endpoint で `@react-pdf/renderer` の server-only 分離が崩れて client bundle に流れると bundle +400KB。`server-only` directive + dynamic import で必ず分離する。
- **DoD**: ① 4 HTML preview ルート live、② A4 / 80mm 切替、③ コード照合 highlight、④ tenant_admin / worker role gate、⑤ axe = 0、⑥ 6c spec 8+ pass、⑦ (任意) PDF endpoint stream 動作確認。
- **Suggested dispatch role**: `frontend` + `backend` (集計クエリ + PDF endpoint) + `designer` (帳票レイアウト) + `qa_e2e`。

### Sub-phase 6d — 報告書 / 集計ダッシュボード (daily / weekly / monthly) (7 日 / 80 turn)

- **Goal**: tenant_admin 向けの 3 レベル (daily / weekly / monthly) ダッシュボードを `recharts` で実装し、月次 KPI の MV cron を整備。
- **Owner value**: tenant_admin が 1 ヶ月の現場稼働を一目で把握でき、不適合トレンド / 在庫差異 / corrections audit ranking を可視化できる。
- **Exact scope**:
  - 6d-1 `recharts` の Tailwind v4 互換 POC (30 turn 以内)。NG なら自作 SVG fallback (ADR-P6-05)。
  - 6d-2 `/app/reports/{daily,weekly,monthly}` route 3 本 + `/app/reports/page.tsx` index。tenant_admin gate。
  - 6d-3 集計クエリヘルパ `src/lib/reports/aggregate.ts` (server-only) を `count(*) filter (...)` ベースで実装。
  - 6d-4 monthly view の MV `public.monthly_scan_usage` migration (新規)。リフレッシュは 6f の EF cron で。
  - 6d-5 `manufacturing_record_defects (tenant_id, defect_code, created_at)` 部分 index 追加 (§E-3) — defect breakdown 高速化。
  - 6d-6 e2e `tests/e2e/phase6d-reports.spec.ts` — chart render 確認、tenant_admin gate、worker は 403 redirect。
- **Non-scope**: PDF 報告書 (6c 範囲)、テナント上限警告 banner (6f)、Sentry / observability (Phase 9)。
- **Files / areas**:
  - `src/app/app/reports/{page,daily,weekly,monthly}/page.tsx` (新規)
  - `src/components/reports/{LineChart,BarChart,PieChart}.tsx` (新規)
  - `src/lib/reports/aggregate.ts` (新規)
  - `supabase/migrations/2026{xxxx}_phase6d_monthly_mv.sql` (新規)
  - `supabase/migrations/2026{xxxx}_phase6d_defect_breakdown_idx.sql` (新規)
  - `tests/e2e/phase6d-reports.spec.ts`
  - `package.json` (`recharts` 追加)
- **DB / RPC**: ① MV 1 本、② 部分 index 1 本。RPC 不要。
- **QA**: ① 4 ルート authed で render、② chart の data-test-id (line / bar / pie) 検証、③ worker 403 redirect、④ MV クエリの EXPLAIN 確認 (10k rows tenant で < 1.5s)、⑤ axe = 0。
- **Security / RLS**: 全集計クエリは anon JWT SELECT + RLS。MV は service_role でリフレッシュするが、SELECT は anon JWT で RLS 越し (MV を直接 RLS gate するのは Postgres の制限で複雑なので **MV を view でラップして view に RLS** 適用、または MV を **テナント別 query で WHERE 必須化** する関数 wrap)。詳細は 6d dispatch architect step で詰める。
- **Dependencies**: 6a 完了。
- **Risk**: ① recharts × Tailwind v4 非互換 → POC fallback、② MV refresh の race condition → `concurrently` オプション必須、③ tenant 跨ぎ集計のリーク → MV 設計時に確実に tenant_id を partition key 化。
- **DoD**: ① 3 ダッシュボード live、② chart render 確認、③ MV cron は 6f で繋ぐ前提で SQL のみ migration、④ worker gate、⑤ axe = 0、⑥ 6d spec 8+ pass、⑦ Lighthouse mobile median performance ≥ 75 (chart 描画で performance budget 緩和)。
- **Suggested dispatch role**: `backend` (集計クエリ + MV migration) + `frontend` (chart 配線) + `designer` (chart 配色 / token 整合) + `qa_e2e` + `security` (MV RLS 設計レビュー)。

### Sub-phase 6e — i18n + dark mode 完成 (5 日 / 50 turn)

- **Goal**: `next-intl` 導入 + `user_metadata.preferences.{language,theme}` を AppShell wire-up し、ja/en + light/dark/auto の 4 mode を完成させる。axe contrast 違反 = 0 を 4 mode × 全主要 route で達成。
- **Owner value**: 海外 worker / 海外現場 へのデプロイ余地が開ける (Phase 10 GA への前倒し)。dark mode は屋内/暗所の手袋運用での疲労軽減。
- **Exact scope**:
  - 6e-1 `next-intl` 追加 + `messages/{ja,en}/` ディレクトリ整備 + glossary doc。
  - 6e-2 AppShell server component で `auth.users.user_metadata.preferences` を 1 回 SELECT し、`<html lang={...} data-theme={...}>` に流す。
  - 6e-3 主要 string を `useTranslations()` 経由に置換 (nav / button / alert / form labels / 4 業務 トップ / 訂正フォーム / 個人設定 / 報告書タイトル / 帳票タイトル)。
  - 6e-4 `globals.css` の dark variant を確認 + 不足トークン (scan viewfinder dark / etc) を追加。
  - 6e-5 print preview は強制 light を `@media print` で適用。
  - 6e-6 e2e `tests/e2e/phase6e-i18n-dark.spec.ts` — ja-light / ja-dark / en-light / en-dark の 4 mode 切替 + axe = 0 + visual snapshot。
- **Non-scope**: master 名 / defect_code / CSV 列名 / server-side zod エラー文言の i18n (Phase 7+)。テナント単位の言語強制 (個人設定優先)。
- **Files / areas**:
  - `package.json` (`next-intl` 追加)
  - `src/i18n.ts` (request config)
  - `messages/{ja,en}/{common,admin,scan,reports,print,correction,account}.json` (新規)
  - `docs/i18n-glossary-manufacturing.md` (新規)
  - `src/components/AppShell.tsx` (lang / theme wire-up)
  - `src/app/globals.css` (dark tokens 補完 + print 強制 light)
  - `tests/e2e/phase6e-i18n-dark.spec.ts`
- **DB / RPC**: なし。
- **QA**: axe contrast 違反 = 0 を 4 mode × 主要 route で確認。visual snapshot で hydration flicker = 0 を assert。
- **Security / RLS**: なし (UI のみ)。
- **Dependencies**: 6a 完了。i18n の string 化作業量が大きいので 6c / 6d の text と並行作業可能 (6e 着手時に 6c / 6d で増えた text を含めて i18n 化)。
- **Risk**: ① string 化漏れ (e2e で en 切替時に日本語が残る) → `tests/e2e/phase6e-i18n-dark.spec.ts` で英語 mode 時に日本語マッチを `not.toContain` 形式で検出、② print 時 dark theme の混入 → `@media print` で強制 light、③ next-intl v3 と Next 15 + Tailwind v4 の互換 → 6e 着手前に 1 day spike。
- **DoD**: ① ja / en 切替 work、② light / dark / auto 切替 work、③ axe contrast = 0 × 4 mode、④ visual flicker = 0、⑤ 6e spec 8+ pass、⑥ glossary doc レビュー済。
- **Suggested dispatch role**: `frontend` + `designer` (dark token contrast 調整) + `qa_e2e` + `i18n_reviewer` (英訳監修 — owner 自身 or 外部)。

### Sub-phase 6f — admin remaining: tenants / users / audit-logs / notifications / usage (10 日 / 110 turn / 二重監査必須)

- **Goal**: 旧 Phase 6 計画 (テナント管理 + 上限) + Phase 7 計画 (audit_logs UI) + R-P5-08 (SMTP 通知) + ロール管理 UI を 1 phase に統合し、admin operational features を完成させる。
- **Owner value**: system_admin がテナント開設 (UC-6)・上限管理 (80% banner) を SaaS として運営できる状態になる。tenant_admin が worker のロール変更・無効化・audit log 監視を自前で扱える。
- **Exact scope**:
  - 6f-1 `tenant_subscriptions` migration (新規) — `plan` (LOGI / WORKS / both) / `monthly_scan_cap` / `user_cap` / `enabled_features` (jsonb) / `plan_started_at` / `plan_ended_at`、RLS は **system_admin のみ modify**、tenant_admin は self-tenant SELECT 可。
  - 6f-2 `audit_logs` migration (新規) — `(id, tenant_id, actor_id, table_name, op, before, after, created_at)`、insert は trigger でテナント所有テーブルに自動 attach。
  - 6f-3 `notification_preferences` migration (新規) — テナント単位の SMTP host / from / approval-needed / approval-completed / monthly-cap 通知 ON/OFF、`enabled_recipients` (jsonb)。
  - 6f-4 `monthly_scan_usage` MV refresh の Edge Function `monthly-usage-refresh` (cron 1 日 1 回) + 80% 到達検知時の `notify_monthly_cap` EF (`notification_preferences` に応じて SMTP send / no-op)。
  - 6f-5 `/app/admin/tenants` (system_admin only) — テナント CRUD + 初期管理者招待 + plan / cap 編集。
  - 6f-6 `/app/admin/users` (tenant_admin / system_admin) — 自テナント worker / tenant_admin 一覧 + 招待 + role 変更 + active 切替 (既存 `changeUserRole` + `admin_revoke_refresh_tokens` 利用)。
  - 6f-7 `/app/admin/audit-logs` (tenant_admin / system_admin) — audit_logs 検索 + フィルタ + CSV export。
  - 6f-8 `/app/admin/notifications` (tenant_admin / system_admin) — SMTP / webhook 設定 UI。Supabase Auth dashboard 設定が必要な場合は read-only で警告。
  - 6f-9 `/app/admin/usage` (tenant_admin / system_admin) — 月間 scan 上限 % bar + 上限突破時の banner。banner は AppShell layer でも常時表示 (80% 到達時のみ)。
  - 6f-10 `tests/integration/rls/tenant-subscriptions-rls.test.ts` + `audit-logs-rls.test.ts` + `notification-prefs-rls.test.ts` — system_admin / tenant_admin 境界の live RLS テスト。
  - 6f-11 二重監査 (security-auditor): system_admin 境界 / `tenant_subscriptions` クロステナント / `audit_logs` 改竄不可 (DELETE policy なし) / SMTP secret の `service_role` 経路のみ。
- **Non-scope**: テナントカスタム帳票テンプレ / GEN 連携 / PWA offline。
- **Files / areas**:
  - `supabase/migrations/2026{xxxx}_phase6f_tenant_subscriptions.sql` (新規)
  - `supabase/migrations/2026{xxxx}_phase6f_audit_logs.sql` (新規 + 全テナント所有テーブルに `before/after` trigger)
  - `supabase/migrations/2026{xxxx}_phase6f_notification_preferences.sql` (新規)
  - `supabase/functions/monthly-usage-refresh/` (新規 EF)
  - `supabase/functions/notify-monthly-cap/` (新規 EF) / `supabase/functions/notify-correction-approval/` (新規 EF)
  - `src/app/app/admin/{tenants,users,audit-logs,notifications,usage}/{page,actions,*Form,*List}.tsx` (新規)
  - `src/lib/admin/{tenants,users,audit-logs,notifications,usage}/*.ts` (新規)
  - `src/components/AppShell.tsx` (80% banner)
  - `tests/integration/rls/*` (新規 3 件)
  - `tests/e2e/phase6f-admin-ops.spec.ts`
- **DB / RPC**: ① 3 新規 migration、② 2-3 EF、③ 既存 RPC (`changeUserRole`, `admin_revoke_refresh_tokens`) 再利用。
- **QA**: ① 5 admin route authed e2e、② RLS-601〜610 live test (system_admin / tenant_admin / worker 各境界)、③ 80% banner 表示テスト、④ audit_logs UPDATE/DELETE reject 確認 (改竄不可)、⑤ axe = 0、⑥ SMTP 通知は **dev mode で fake transport** に切替えてテスト (実 SMTP は staging で別途検証)。
- **Security / RLS**: ① system_admin 境界 (Phase 1 で確立済の `app.is_system_admin()` ヘルパ再利用)、② `tenant_subscriptions` の cross-tenant SELECT reject、③ `audit_logs` の DELETE policy なし + UPDATE は service_role のみ、④ SMTP credentials は **`.env.enc` (SOPS+age)** に格納、client bundle 漏洩 grep 0、⑤ notification preferences の SMTP password 列は **client SELECT を許可しない** (column-level revoke or view 経由)。
- **Dependencies**: 6a 完了 + (推奨) 6d 完了 (MV を作る部分が重複する場合は 6d で先行)。
- **Risk**: ① audit_logs trigger を全テーブルに付けると INSERT cost ↑ → 6f architect step でテーブル絞込 (work_settings / tenant_field_settings / match_rules / qr_format_definitions / csv_format_definitions / profiles / tenant_subscriptions / notification_preferences の **設定系のみ**、records 系は除外)、② SMTP 未設定テナントへの notify は `STATUS: degraded` で degrade、③ system_admin 招待 UI を間違えて tenant_admin に開放すると重大事故 → middleware で `/app/admin/tenants` を `system_admin` only に hard-gate + 二重監査必須。
- **DoD**: ① 5 admin route live、② RLS-601〜610 live test green、③ 80% banner 動作、④ audit_logs trigger 動作確認 (settings 変更で row 増加)、⑤ SMTP fake transport で notify 動作、⑥ axe = 0、⑦ 6f spec 12+ pass、⑧ **security-auditor pass (P0=0 / P1=0)**。
- **Suggested dispatch role**: `architect (5 day)` + `backend (5 day)` + `frontend (4 day)` + `designer (2 day)` + `qa_e2e (3 day)` + `security-auditor (2 day, 二重監査必須)` + `orchestrator`。
- **Budget**: 10 日 / 110 turn (二重監査必須のため Phase 5 の 90 turn 級より重め)。

### Phase 6 sub-phase summary table

| sub-phase | 日数 | turn | 二重監査 | 主役 role | 主成果 |
|---|---|---|---|---|---|
| 6a | 5 | 60 | no | orchestrator | E2E cookie / nav 拡張 / 5e residual close |
| 6b | 7 | 80 | no | frontend + designer + qa | StepShell + 4 業務 scan-first |
| 6c | 6 | 60 | no | frontend + backend + designer | 4 帳票 HTML + (任意) PDF |
| 6d | 7 | 80 | recommended | backend + frontend + security | 3 ダッシュボード + MV migration |
| 6e | 5 | 50 | no | frontend + designer + i18n_reviewer | i18n + dark 完成 |
| 6f | 10 | 110 | **必須** | architect + backend + frontend + security | tenants / users / audit-logs / notifications / usage |
| **合計** | **40** | **440** | — | — | — |

旧 Phase 6 計画 (10 日 / 100 turn) を **40 日 / 440 turn (4 倍)** に拡張する形になるが、これは「scan / 帳票 / 報告書 / i18n / dark / admin 残機能」を全部含むためで、旧 Phase 6 + 旧 Phase 7 + 旧 Phase 10 i18n の合計 (10 + 10 + ~5 = 25 日) に owner の前倒し指示分を加えると整合する。Phase 8 (offline) と Phase 9 (PITR / observability) は Phase 6 外で温存。

---

## D. Architecture Decision Records (ADR)

| ADR ID | 決定 | 検討案 | 採用 | 理由 / now | リスク / rollback |
|---|---|---|---|---|---|
| ADR-P6-01 | scan-first ルート戦略 | A `/app/logi/*` を強化 / B `/app/scan/*` 新設 / C 既存を `/app/scan/*` に rename | **A (既存を強化、StepShell オプトイン)** | 本番 URL を温存 / Playwright e2e を温存 / 既存 4 業務の独自フロー を破壊しない | StepShell が業務固有要件をすべて吸収しきれない場合、page 個別実装に rollback (両立可) |
| ADR-P6-02 | 帳票印刷出力形式 | A HTML print only / B PDF only / C HTML + PDF 両方 | **C (HTML core + PDF optional)** | 追加 dep ゼロで MVP を回せる / PDF はファイル保管が必要なテナント向け option | PDF endpoint で `@react-pdf/renderer` が server-only 分離に失敗したら disable し HTML のみで運用継続 |
| ADR-P6-03 | preferences の persistence | A `user_metadata` jsonb 維持 / B 新規 `tenant_user_preferences` テーブル | **A (jsonb 維持)** | 既存実装が動作中 / 移行コスト > 利益 / Phase 7+ で再評価可 | 列追加が必要なら Phase 7 で migration 1 本で table 化 (現状 schema は変更不要) |
| ADR-P6-04 | notification_preferences の格納 | A `tenants` jsonb 列追加 / B 新規 `notification_preferences` テーブル | **B (新規テーブル)** | SMTP password / webhook URL を別 column-level RLS で gate 可能 / クライアントへの partial expose 防げる | 不要な複雑化と判断したら Phase 7 で row 数 = テナント数 と低い前提で jsonb に統合可能 |
| ADR-P6-05 | chart library | recharts / chart.js / @tremor/react / @observablehq/plot / 自作 SVG | **recharts** | bundle 許容範囲 / SSR 可 / Tailwind v4 親和 / SVG output で印刷時に reuse 可 | Tailwind v4 互換 NG なら自作 SVG (d3-shape) に切替。POC を 6d 着手前 30 turn で確認 |
| ADR-P6-06 | i18n library | next-intl / react-intl / 自作 | **next-intl v3** | Next 15 App Router 公式 / middleware 統合 / server+client 両対応 | next-intl v3 互換 NG なら自作 (key-value JSON + format helper) に dropdown |
| ADR-P6-07 | 帳票 print の role gate | A worker も全件 print 可 / B tenant_admin のみ全件 / worker は self のみ | **B (worker = self / tenant_admin = all)** | 情報露出最小化 / PRODUCT_SPEC §4 P-OPE の用途は self 確認 + 当日数枚 / tenant_admin は管理用途 | 必要なら work_settings に boolean flag を足して per-tenant に切替可能 |
| ADR-P6-08 | Phase 6 の scope 上限 | A 当初 Phase 6 (旧計画 10 日) を踏襲 / B operational features 全部 / C 一部前倒し | **B (operational features 全部、40 日 / 440 turn)** | owner 「進められるところを進める」明示 / Phase 7-10 の前倒し可な部分を集約 / Phase 8 offline と Phase 9 PITR は据置 (scope explosion 回避) | 各 sub-phase は独立 dispatch 可。途中で 6a/6b/6c 完了の所で `STATUS: success / Phase 6 partial complete` を許容、6d-6f を Phase 7+ に押し出すこともできる |

---

## E. Security / RLS / privacy 考慮

### E.1 テナント分離

- 既存 RLS テンプレ (Phase 1〜4 / Phase 5 で確立) を **全 6a〜6f で踏襲**。新規テーブル (tenant_subscriptions / audit_logs / notification_preferences) は同テンプレを apply。
- `monthly_scan_usage` MV は **テナント別 partition column を必須化** (`tenant_id` を MV の最左 column)、SELECT は view ラップ + RLS で gate。

### E.2 scanner input validation

- Scanner の `raw` 値は **既存 Phase 3a の処理** (parser → match → never persist `raw_value` to client) を踏襲。6b の StepShell でも同じ。
- 手入力 modal 経由の文字列は zod (existing) で control char / length 上限 (1024) を 6b で再確認。

### E.3 print / report data leakage

- print preview の URL に絞込 (`?from=...&to=...`) を入れる場合、**worker が自分以外の record を URL を弄って見られない**よう RLS で gate。`/app/print/[report]` は server-render 時に `getAppSession()` で role を見て `worker_id=auth.uid()` 絞込を強制 (worker のみ)。
- 報告書 (6d) は **tenant_admin 以上に限定**。worker は `/app/reports/*` にアクセス時 `redirect("/app/logi")`。
- `manufacturing_record_defects (tenant_id, defect_code, created_at)` 部分 index は **tenant_id を最左** に維持してテナント越境クエリを意図せず作らない。

### E.4 role-based access

| ルート | worker | tenant_admin | system_admin |
|---|---|---|---|
| `/app/logi/*` / `/app/works/*` (6b) | ✅ self | ✅ all | ✅ all |
| `/app/print/*` (6c) | ✅ self only | ✅ all | ✅ all |
| `/app/reports/*` (6d) | ❌ redirect | ✅ all | ✅ all |
| `/app/account/*` (5d + 6e) | ✅ self | ✅ self | ✅ self |
| `/app/admin/*` 既存 (Phase 5) | ❌ redirect | ✅ | ✅ |
| `/app/admin/{tenants,users,audit-logs,notifications,usage}` (6f) | ❌ redirect | ✅ (users / audit-logs / notifications / usage; tenants は不可) | ✅ all |
| `/app/admin/tenants` (6f) | ❌ | ❌ redirect | ✅ |

middleware の `ADMIN_ONLY_PREFIXES` (`src/lib/supabase/middleware.ts`) を 6a / 6f で慎重に拡張。`/app/admin/tenants` は **system_admin only** の新 gate を 6f で追加。

### E.5 auditability

- `audit_logs` (6f) は **DELETE policy なし** + **UPDATE policy は service_role only**。同パターンは `corrections_audit` (Phase 5a) で確立済。
- audit_logs trigger 対象テーブルは **settings 系のみ** (work_settings / tenant_field_settings / match_rules / qr_format_definitions / csv_format_definitions / profiles / tenant_subscriptions / notification_preferences)。**records 系 (movement / inventory / manufacturing) は除外** (Phase 5 `corrections_audit` で既に audit 済 + INSERT cost を抑える)。

### E.6 service_role / 通知

- SMTP credentials / webhook URL は `.env.enc` (SOPS+age) で管理、Edge Function `notify-*` 内のみで読み込み。
- client bundle に **絶対に流れない** こと: 6f 着手後の security-auditor pass で `service_role` / `SMTP_PASSWORD` / `WEBHOOK_SECRET` 等を `.next/static/**` で grep 0 hit を再検証。
- Edge Function `inviteUser` (6f) は既存 `admin.auth.admin.inviteUserByEmail` パターンを踏襲。SMTP 未設定の場合は `STATUS: degraded` を返し owner が Supabase dashboard で SMTP / SendGrid を設定するまで保留。

### E.7 PITR / scan 爆発 再評価

- Phase 4 で PITR を一旦見送り (Phase 9 で再評価)。**Phase 6d で MV cron を入れた時の row 数 / トランザクション量を観測** し、`docs/RUNBOOK.md §6.3` 再評価トリガに `monthly_scan_cap` 80% 超え or `audit_logs` 1M row 超え を追加候補として記録。Phase 6 の DoD には含めない (Phase 9 で判断)。

---

## F. QA / UX 計画 (各 sub-phase 期待)

### F.1 Phase C qa_e2e 期待

各 sub-phase の Phase C で:

- ① authed Playwright (E2E_LOGI_AUTH_COOKIE / E2E_WORKER_AUTH_COOKIE / E2E_SYSADMIN_AUTH_COOKIE を 6a で発行) を必ず実行。
- ② 各 sub-phase の新規 spec は **8 件以上** の authed test (6a / 6e は 5+ で可)。
- ③ Lighthouse mobile 3-run median を 6b / 6c / 6d / 6e で実行 (admin 6f は performance budget 緩和、5 run median で OK)。
- ④ visual snapshot は 6b (scan), 6c (帳票), 6d (chart), 6e (dark mode 4 mode) で必須。

### F.2 ux_reviewer 期待

- 56×56 タッチ違反 = 0 (size="lg" `h-14 min-h-14` を全 primary CTA で確認、特に 6b sticky bottom CTA / 6f admin form)。
- glove input 検証は 6b で specifically: 親指 reach simulation (画面下端 viewport の hot zone)。
- 色弱性 (color blindness) 検証は 6e dark mode + 6c 帳票 highlight (差分 red) で specifically: protanopia / deuteranopia simulation で OK / NG の区別が崩れないこと。
- 帳票 print preview は **A4 + 80mm thermal の 2 paper size × ja/en の 2 lang = 4 variant** で snapshot。
- 報告書 chart は **legend + axis label + tooltip + data-test-id** をすべて i18n / dark 対応。

### F.3 screenshots / Lighthouse / axe evidence

- 各 sub-phase の `.kobo/screenshots/phase6{a,b,c,d,e,f}/` ディレクトリに以下を必ず保存:
  - 主要 route の authed snapshot (mobile 360×640 + desktop 1280×800 の 2 サイズ)。
  - 6c print preview の A4 / 80mm の 2 サイズ。
  - 6e の 4 mode (ja-light / ja-dark / en-light / en-dark) × 主要 3 route = 12 snapshot。
  - 6d chart の line / bar / pie の 3 種 × 3 期間 (daily / weekly / monthly) = 9 snapshot。
- Lighthouse JSON は `.kobo/lighthouse/phase6{x}/*.json` に保存、performance / accessibility / best-practices / seo の 4 軸 ≥ 80 を target、accessibility ≥ 95 を hard floor。
- axe-core JSON は `.kobo/axe/phase6{x}/*.json`、`violations.length === 0` を hard gate (impact: critical / serious が 0、moderate / minor も 0 を目標)。

### F.4 touch target / glove input 検査

- 全 primary CTA / 戻る / 中止 / 手入力 / 確認 ボタンを **`getBoundingClientRect()` で width ≥ 56 height ≥ 56 を assertion** (既存 admin-master-crud.spec の `touch_target_violations` パターンを 6b/6c/6d/6e/6f で再利用)。
- 6b sticky bottom CTA は viewport 底面 8px 以上 margin、親指リーチ hot zone 内。
- 6f admin form は **`size="lg"` (h-14)** を強制、`size="md"` (h-12) は副次操作のみ。

### F.5 二重監査 (Phase 6f 必須)

- security-auditor は 6f で:
  - `tenant_subscriptions` のクロステナント SELECT / UPDATE / DELETE reject (RLS-601〜603)
  - `audit_logs` の UPDATE / DELETE reject (RLS-604〜605)
  - `notification_preferences` の SMTP password 列 client 露出 = 0 (RLS-606 + bundle grep)
  - `system_admin` 境界 (`/app/admin/tenants` を tenant_admin が触れない)
  - `service_role` / `SMTP_PASSWORD` / `WEBHOOK_SECRET` の `.next/static/**` grep 0
- 結果は `.kobo/security-audit-phase6f-{date}.md` に集約、P0 / P1 = 0 を merge 条件 (Phase 5e と同形式)。

---

## Phase 6 全体図 (mermaid)

```mermaid
flowchart LR
  subgraph Phase6a [6a Foundation (5d)]
    A1[E2E cookies]
    A2[nav 拡張]
    A3[5e P2/P3 closure]
  end
  subgraph Phase6b [6b Scan-first (7d)]
    B1[StepShell]
    B2[4 業務 wire]
  end
  subgraph Phase6c [6c 帳票 (6d)]
    C1[HTML preview ×4]
    C2[PDF endpoint opt]
    C3[code照合 highlight]
  end
  subgraph Phase6d [6d Reports (7d)]
    D1[recharts POC]
    D2[3 dashboards]
    D3[MV + idx migration]
  end
  subgraph Phase6e [6e i18n+dark (5d)]
    E1[next-intl]
    E2[AppShell wire-up]
    E3[axe 4 mode]
  end
  subgraph Phase6f [6f Admin ops (10d, 二重監査)]
    F1[tenants / users]
    F2[audit_logs migration+UI]
    F3[notifications EF+UI]
    F4[usage 80% banner]
    F5[security-auditor pass]
  end
  A1 --> B1
  A1 --> C1
  A1 --> D1
  A1 --> E1
  A1 --> F1
  D3 -.MV.-> F4
  C1 -.history launcher.-> B2
  E2 -.lang / dark.-> C1
  E2 -.lang / dark.-> D2
  E2 -.lang / dark.-> F1
```

各 sub-phase は **6a 以降は独立 dispatch 可**。6f は 6d 完了後に着手するのが望ましい (MV を 6d で先に作っておくと 6f で cron を繋ぐだけで済む)。
