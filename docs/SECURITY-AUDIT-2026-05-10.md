# GENBA Security Audit (Doc-Level, Phase 0 Discovery)

date: 2026-05-10
scope: Phase 0 Discovery docs (6 files: PRODUCT_SPEC, ARCHITECTURE, QR_SPEC, DESIGN_DIRECTION, MIGRATION_NOTES, IMPLEMENTATION_PLAN)
data_classification: pii-adjacent (worker login_id = email), no payment, no end-user file upload (CSV import by tenant_admin only)
auditor mode: documentation review only (no code exists, no diff, no active probe)
applied_against: post-fix state (本ドキュメント記載時点で P1 5 件のうち main fix を docs に反映済み)

---

## 監査の目的と前提

Phase 0 Discovery 完了直後、Phase 1 キックオフ承認の判断材料として、6 本の設計文書に対して `prompts/role-cards/security-auditor.md` の観点でレビューを行った。実装コードは未着手のため、本監査は **設計判断・記述レベルでのリスク特定** に限定し、exploit 試行や active probe は行っていない (approval-rules `security_active_probe` 該当なし)。

---

## FINDINGS (P1 のみ。P0 ゼロ。P2 のうち重要 2 件を併記)

### [P1] auth/jwt: `raw_app_meta_data` vs `user_metadata` 区別の必要性

- **where**: ARCHITECTURE.md §8.1
- **repro (gap の発覚)**: 当初 "Supabase Auth の `raw_app_meta_data` に保存" とのみ記載。`user_metadata` (client SDK から書換可) との区別が未明示で、実装者が取り違えると role escalation 経路になる
- **fix**: ARCHITECTURE §8.1 に **`raw_user_metadata` 使用禁止 + `raw_app_meta_data` を service_role のみで更新** を明記。Phase 1 DoD (RLS-008) に grep 0 hit を追加
- **status**: ✅ 反映済み (ARCHITECTURE.md §8.1)
- **confidence**: high

### [P1] rls/update_policy: 同テナント内 worker 間の record 改竄防御欠落

- **where**: ARCHITECTURE.md §8.2 movement_records UPDATE policy
- **repro**: INSERT は `worker_id = auth.uid()` で防御していたが、UPDATE は `tenant_id` 一致のみ。worker A が同テナントの worker B の `movement_records` を任意 UPDATE 可能。RLS-001〜005 に該当テストが無い
- **fix**: UPDATE policy に `worker_id = auth.uid() OR role='tenant_admin'` を USING/WITH CHECK 双方に追加。RLS-006 テスト追加
- **status**: ✅ 反映済み (ARCHITECTURE.md §8.2, §8.3)
- **confidence**: high

### [P1] rls/polymorphic_fk: `qr_scan_histories.target_id` のクロステナント参照

- **where**: ARCHITECTURE.md R-05、QR_SPEC.md §6, §8
- **repro**: R-05 として認識済みだが、緩和策は当初 Phase 5 後ろ倒し。Phase 3 で `qr_scan_histories` を導入する時点で worker が `target_id` に他テナント実績の uuid を埋めても RLS は検知しない (history 行自身の tenant_id しか見ない)
- **fix**: ARCHITECTURE R-05 / QR_SPEC §6 に **Phase 3 で `validate_target_tenant()` trigger 必須**、`target_table` 許可リスト CHECK 制約、RLS-007 テスト追加
- **status**: ✅ 反映済み (ARCHITECTURE R-05, §8.3, QR_SPEC §6, IMPLEMENTATION_PLAN Phase 3 DoD)
- **confidence**: high

### [P1] csv/injection: formula injection + size/MIME/行数上限未文書化

- **where**: ARCHITECTURE.md §7
- **repro**: 顧客は Excel (shift_jis) で開く前提。`item_code` 等に `=cmd|...` を含む QR が読まれて履歴 → CSV 出力 → 顧客が開いて任意コマンド実行リスク。`/api/csv/import` には MIME / size / 行数の上限が一切記載なし
- **fix**: ARCHITECTURE §7.1 に Content-Type 強制 / 10MB / 100k 行制限、§7.2 に formula injection 防御 (`=+-@\t\r` 始まりはシングルクォート prepend) を追加。Phase 3 DoD に対応 unit test を追加
- **status**: ✅ 反映済み (ARCHITECTURE.md §7.1, §7.2, IMPLEMENTATION_PLAN Phase 3 DoD)
- **confidence**: high

### [P1] audit/timing: `updated_by` 列が Phase 7 まで導入されない

- **where**: IMPLEMENTATION_PLAN.md Phase 7 (audit_logs)、ARCHITECTURE §4.2 共通列、PRODUCT_SPEC §7
- **repro**: `audit_logs` 全面導入は Phase 7 だが、Phase 1〜6 に発生する **設定変更 (RLS / QR / match_rules / work_settings / マスタ / users)** が一切無記録。R-08 (`readable=false` 誤操作) 等の事故時に追跡不可。`updated_by` 列も共通列に未記載
- **fix**: ARCHITECTURE §4.2 共通列に `created_by` / `updated_by` を Phase 1 から導入と明記。IMPLEMENTATION_PLAN Phase 1 DoD に共通列導入を追加
- **status**: ✅ 反映済み (ARCHITECTURE §4.2, IMPLEMENTATION_PLAN Phase 1 DoD)
- **confidence**: medium

### [P2] qr/raw_value_exposure: `qr_scan_histories.raw_value` の worker SELECT を制限する設計が無い

- **where**: QR_SPEC.md §8
- **repro**: 「運用ルールでドキュメント化」とあるのみで技術制御無し。worker は自テナントの `qr_scan_histories` を SELECT 可
- **fix**: QR_SPEC §8 に「`raw_value` 列は tenant_admin のみ SELECT 可とする column-level RLS or view 経由」を Phase 3 DoD に追加
- **status**: ✅ 反映済み (QR_SPEC §8, IMPLEMENTATION_PLAN Phase 3 DoD)
- **confidence**: medium

### [P2] auth/lockout: rate limit / password policy / role 変更時のセッション失効が未記載

- **where**: PRODUCT_SPEC.md AC-AUTH-01
- **repro**: 「Supabase Auth の標準挙動を信頼、追加検証は不要」とあるが、実際の rate limit 値・パスワード長要件・role 降格時の token revoke 戦略が未確認
- **fix (推奨)**: AC-AUTH-01 に「Phase 1 で Supabase Auth の rate limit 値を確認・記録」「パスワード最低 10 文字」「role/tenant 変更時は service_role で対象 user の refresh token を revoke」を追加
- **status**: ⚠️ **未反映**。owner レビュー時に決定し、Phase 1 着手前に追記する
- **confidence**: medium

---

## RLS POLICY TEST SQL (Phase 1 / 3 で実機検証)

| ID | 対象 | テスト概要 | 期待 |
| --- | --- | --- | --- |
| RLS-001 | movement_records | T2 ユーザーで `SELECT * WHERE tenant_id = T1` | 0 rows |
| RLS-002 | work_settings | worker ロールで `INSERT` | RLS reject |
| RLS-003 | movement_records | worker が `worker_id = <other>` で INSERT | RLS reject |
| RLS-004 | movement_records | T2 が `UPDATE SET tenant_id=T1 WHERE id=<own>` | 0 rows (WITH CHECK) |
| RLS-005 | (codebase) | service_role キーが client コードに | 0 hits |
| RLS-006 | movement_records | 同テナント worker A → worker B record `UPDATE` | 0 rows (worker_id 制約) |
| RLS-007 | qr_scan_histories | worker が `target_id` に他テナント実績 uuid で INSERT | 0 rows (validate_target_tenant() trigger) |
| RLS-008 | (codebase) | `raw_user_metadata` への `tenant_id`/`role` 書込 grep | 0 hits |

---

## UNVERIFIED_ITEMS (Read だけでは確認できない / Phase 1+ 実機検証)

- Supabase Auth の実 rate limit 値 (project 作成後に dashboard で要確認)
- Edge Function (sign-up trigger) の service_role 利用が client bundle に漏れていないか (Phase 1 build 後に grep)
- shift_jis 出力の `iconv-lite` 依存に既知 CVE が無いか (Phase 3 で `npm audit` 実行時に確認)
- RLS テスト SQL (RLS-001〜008) が実際に Supabase で期待動作するか (Phase 1 / Phase 3 で実機確認)
- JWT の `tenant_id` claim 改竄試行 (alg=none, signature 改ざん) が Supabase Auth で reject されること (Phase 1 で実機確認)
- `validate_target_tenant()` trigger の SQL injection リスク (動的 EXECUTE 時の `target_table` 値検証) — Phase 3 実装時に security-auditor で再確認

---

## VERDICT

**conditional**

- P0: 0 件
- P1: 5 件 → **doc 改訂で 5 件すべて解消済み** (本ドキュメント §FINDINGS の status=✅)
- P2: 2 件 → 1 件解消済み、1 件 (auth/lockout) は owner レビュー後に Phase 1 着手前追記
- approval-rules compliance: Supabase 新規 (Phase 1 oauth_credential_creation) / production_deploy (Phase 4) / Sentry+Pro (Phase 9 paid_subscription_signup) は IMPLEMENTATION_PLAN に正しく記載 → OK

→ **Phase 1 キックオフを承認可能** だが、auth/lockout (P2) を Phase 1 着手前に PRODUCT_SPEC に追記すること、および本書 §RLS POLICY TEST SQL の RLS-001〜008 を Phase 1 / Phase 3 acceptance gate に組み込むことを条件とする。

---

## NOTIFY_OWNER

**false**

- P0 ゼロのため `approval-rules: security_audit_p0_found` には該当しない
- 通常通知 (notify_only) として、Phase 1 キックオフ承認時に owner が本ドキュメントを併せて確認することを推奨

---

## 改訂履歴

| 日付 | 改訂 | 担当 |
| --- | --- | --- |
| 2026-05-10 | 初版 (Phase 0 Discovery doc audit、P1 fix 反映済み) | orchestrator (security-auditor role 文書レビュー) |
