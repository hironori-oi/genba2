# 本格運用開始チェックリスト — genba

Phase 1-6 開発完了 (2026-05-15) → 本格運用開始までの全タスク整理。

## 現状 (2026-05-15 時点)

| 区分 | 状態 |
|---|---|
| 機能実装 | Phase 1-6 全完了 (admin UI + worker UX + scan-first + print + reports + i18n+dark + admin ops) |
| Vercel deploy | `genba2-ai.vercel.app` 動作中 (subdomain) |
| Supabase | production DB に 17 migrations live applied |
| GitHub | `hironori-oi/genba2` main brunch up-to-date |
| Test | vitest 307 / Playwright 129 / axe 0 / 二重監査 PASS |
| テナント | synthetic test tenant のみ |
| ユーザー | synthetic test users のみ |
| 独自ドメイン | 未設定 |
| 商用ライセンス | 未整備 |

---

## 🚦 MUST — launch blocker (これ無しでは本格運用不可)

### A. 法務・コンプライアンス
- [ ] **利用規約** 策定 + サインアップ flow に同意 UI
- [ ] **プライバシーポリシー** 策定 + データ取扱い明記
- [ ] **個人情報保護法対応** — 取扱事業者として届出要否確認、安全管理措置
- [ ] **データ retention 方針** — corrections_audit / admin_audit_log / records の保管期間決定
- [ ] **削除権 / Export 権** — GDPR 相当 (海外顧客あるなら必須)
- [ ] **契約書テンプレート** — B2B SaaS 契約
- [ ] **SLA 定義** — uptime / response time / 障害時補償

### B. 本番運用基盤
- [ ] **独自ドメイン** — `genba2-ai.vercel.app` → 顧客向け正式 domain
- [ ] **DNS + SSL 証明書** — Vercel 経由で自動だが domain 登録必要
- [ ] **Email 送信設定** — SMTP (notifications + 招待 mail)。AWS SES / SendGrid / 国内サービス選定
- [ ] **本番 SUPABASE 環境変数 verify** — Vercel に NEXT_PUBLIC_SUPABASE_URL 等が正しく設定済か
- [ ] **Edge Function deploy** — `monthly-usage-refresh` + `notify-monthly-cap` (Phase 6f carry-over、READMEs 完備)
- [ ] **本番テナント作成手順** — tenant_admin user 招待 → tenant_subscriptions row 作成 procedure
- [ ] **初回 master データ投入** — 顧客固有の品番 / 工程 / 設備 / QR format / match_rules / work_settings

### C. セキュリティ
- [ ] **secret rotation policy** — SUPABASE_SERVICE_ROLE_KEY 漏洩時 rotation 手順
- [ ] **Vercel team access** — owner 以外の deploy 権限管理
- [ ] **GitHub branch protection** — main 直 push 禁止、PR review 必須化
- [ ] **CSP / セキュリティヘッダ** — Next.js middleware で X-Frame-Options / CSP / HSTS
- [ ] **Rate limiting** — API endpoint / login 試行制限
- [ ] **session 期限** — Supabase JWT lifetime + refresh policy 決定
- [ ] **依存脆弱性監視** — `npm audit` + Dependabot 有効化

### D. データ移行 (既存システムあるなら)
- [ ] **旧システム → kobo データ移行設計**
- [ ] **CSV import 大量バッチ動作確認** — 5c の admin/csv-formats で 10k-100k 行 import
- [ ] **移行リハーサル** — staging で本番相当データで確認

---

## 🎯 SHOULD — pre-launch 強く推奨

### E. パフォーマンス・スケール
- [ ] **production Lighthouse 80↑** — Phase 6 carry-over、`/app/logi` で perf 達成
- [ ] **load testing** — 10 worker 同時 scan / 100 admin 同時 dashboard アクセス時の挙動
- [ ] **DB index 最適化** — slow query log 監視、必要なら追加 index
- [ ] **bundle size 削減** — first-load JS が 200KB 超なら動的 import で削減
- [ ] **image / asset CDN** — Vercel 既定で OK だが大量帳票 PDF 出力時の挙動

### F. 監視・運用
- [ ] **Error tracking** — Sentry / Datadog APM 連携 (server-only error → tenant context tag)
- [ ] **Uptime monitoring** — UptimeRobot / Better Uptime
- [ ] **Status page** — statuspage.io 等で顧客向け
- [ ] **Logging** — Vercel logs + Supabase logs の retention 確認
- [ ] **Alert flow** — error 発生時 Slack / Email 通知
- [ ] **Backup verification** — Supabase daily backup 復元テスト 1 回
- [ ] **Incident response plan** — 障害発生時の手順書 (RUNBOOK 拡張)
- [ ] **On-call rotation** — 平日のみ or 24/7、escalation policy

### G. UX 仕上げ
- [ ] **Empty state 改善** — マスタが空のときの guidance 文言
- [ ] **Loading state** — Suspense + skeleton screen 統一
- [ ] **Error message 日本語自然化** — Phase 6f reviewer P2-3 の "rls" mislabel 等
- [ ] **エラーリトライ UI** — network 切断時の再試行
- [ ] **Onboarding tour** — 初回 login 時の guided walkthrough
- [ ] **In-app help / FAQ** — tooltip、`?` icon
- [ ] **mobile PWA 化** — manifest + service worker + offline-first
- [ ] **Push notification** — notification_preferences と連動

### H. ドキュメント
- [ ] **エンドユーザーマニュアル** — admin 向け + worker 向け、図解付き
- [ ] **管理者セットアップガイド** — tenant 立ち上げ手順
- [ ] **トラブルシューティング FAQ** — よくある質問
- [ ] **API ドキュメント** — もし API 公開するなら (OpenAPI)
- [ ] **RUNBOOK 拡充** — incident response / rollback / migration apply 詳細化
- [ ] **CHANGELOG.md** — Phase 1-6 のリリース note

### I. テスト強化
- [ ] **E2E full authed coverage** — 129 pass → worker side も含めて 200 pass 目標
- [ ] **real device testing** — iOS Safari (iPhone) / Android Chrome / Samsung Internet
- [ ] **browser matrix** — Edge / Firefox / Safari mac の動作確認
- [ ] **localization test** — en / ja 切替後の崩れチェック
- [ ] **load test** — k6 / JMeter で 100 concurrent users
- [ ] **chaos test** — DB 断 / Vercel 障害時の挙動

### J. ビジネス基盤
- [ ] **pricing model** — Free / Standard / Enterprise の plan 設計
- [ ] **billing integration** — Stripe / Pay.JP / 国内決済選定
- [ ] **invoice generation** — 月次請求書、PDF 出力
- [ ] **support flow** — メール / chat / 電話どれで受けるか
- [ ] **onboarding doc** — 新規顧客向け Setup ガイド (動画あれば良い)
- [ ] **marketing site** — `/` の LP、機能紹介、価格表
- [ ] **SEO** — meta tag、sitemap、structured data
- [ ] **Analytics** — PostHog / Plausible / GA4 で利用統計

---

## 📈 LATER — post-launch incremental

### K. 機能拡張 (Phase 7+ 候補)
- AI assist (作業手順提案、不適合自動検知)
- Bluetooth scanner 対応 (外部 HW、連続 scan、音声 feedback)
- 多言語拡張 (中国語 / ベトナム語 / タガログ語 など現場用)
- 高度な dashboard (KPI alert、predictive analytics)
- mobile native app (現状 PWA → React Native / Flutter)

### L. 運用効率化
- [ ] **CI/CD 強化** — preview deploy on PR、auto rollback on Lighthouse fail
- [ ] **DB migration automation** — Supabase migration の auto-apply (production 慎重に)
- [ ] **bug bash 定例化** — 月 1 全機能 walk-through
- [ ] **顧客 feedback loop** — in-app feedback button → Linear / Issue へ
- [ ] **A/B test framework** — UX 改善検証

### M. データ・分析
- [ ] **データウェアハウス連携** — BigQuery / Snowflake へ export
- [ ] **顧客 KPI ダッシュボード** — 自社向け、tenant 利用統計
- [ ] **不適合トレンド分析** — defect 履歴の ML 解析

---

## 🔮 LONG-TERM — scale & enterprise

### N. 大規模展開
- [ ] **マルチリージョン** — Vercel + Supabase の region 分散
- [ ] **読み取り専用 replica** — reports 集計用 DB 分離
- [ ] **mass tenant management** — 100+ tenants の運用効率化 UI
- [ ] **white-label / OEM** — 顧客ブランディング対応
- [ ] **enterprise SSO** — SAML / OIDC 対応
- [ ] **on-premise option** — Supabase self-hosted への対応 (Docker compose)

### O. 認証
- [ ] **SOC 2 / ISO 27001** — エンタープライズ顧客向け
- [ ] **PCI DSS** — 決済情報扱うなら

---

## 推奨アクションプラン

### 直近 1 週間 (Wave 1 — launch blocker)
1. **テスト walkthrough 完走** + 発見した bug の優先度判定 (今)
2. **法務 (利用規約 / プライバシーポリシー)** 案文起こし、弁護士確認手配
3. **独自ドメイン取得** + DNS 設定 + Vercel domain bind
4. **SMTP プロバイダ選定** (推奨: 国内なら **SendGrid Japan** or **Amazon SES Tokyo**)
5. **Phase 7 architect dispatch** (Sonnet で planning、$1-2)
   - EF deploy + production Lighthouse + 法務 UI (利用規約同意 modal)

### 直近 2-4 週間 (Wave 2 — pre-launch)
6. **EF deploy 実行** (Phase 7-a dispatch、$3-5)
7. **production Lighthouse 80↑ 達成** (Phase 7-b dispatch、$2-3)
8. **Sentry 連携 + alert** (Phase 7-c dispatch、$5-8)
9. **PWA 化** (Phase 7-d dispatch、$8-12)
10. **エンドユーザーマニュアル v1** 作成 (owner 主導、AI 補助可)

### 月-2 ヶ月 (Wave 3 — soft launch)
11. **pilot tenant 1 社** invite、フィードバック蓄積
12. **billing integration** (Stripe + 月次請求)
13. **monitoring + status page**
14. **load test + 必要 index 追加**
15. **正式 launch**

### Phase 7 dispatch 予算目安
- carry-over 3 件 (C1/C2/C3): **合計 $5-10**
- Wave 2 新規 4 件: **合計 $20-30**
- Wave 3 SaaS 強化: **$15-20**
- **Phase 7 全体: $40-60 想定** (Phase 6 ~$80 より圧縮可、Sonnet 活用で)

---

## 次のミーティング議題候補

owner 確認したい意思決定:

1. **pilot 顧客はあるか？** — 既存顧客なら移行計画、なし or 自社利用なら別シナリオ
2. **独自ドメイン候補は？** — `genba.improver.jp` ? `genba2.com` ?
3. **法務リソース** — 顧問弁護士 or 雛形ベース DIY ?
4. **monetize 設計** — Free / Paid plan、価格帯
5. **support 体制** — 自社 1 名 / 外注 / community ?
6. **mobile native vs PWA** — 顧客現場の OS 多様性次第
7. **on-premise option 想定** — エンタープライズ大口あるなら早めに設計

---

## 関連 docs

- `docs/PHASE7-PRIORITIES.md` — Phase 7 sub-phase 候補 + cost-aware tips
- `docs/RUNBOOK.md` — operations 手順 (incident response / deploy / rollback)
- `docs/ARCHITECTURE.md` — システム全体設計 (Phase 1-3 base)
- `docs/PRODUCT_SPEC.md` — 機能仕様
- `docs/SECURITY-AUDIT-*.md` — phase 別 security audit 履歴
- `.kobo/security-audit-phase6-final.md` — Phase 6 最終 security audit (P0=0 P1=0)
- `.kobo/reviewer-audit-phase6-final.md` — Phase 6 最終 reviewer audit

---

**本 doc の維持**: launch 後も "post-launch incremental" / "long-term scale" セクションを更新し続けて、運用ロードマップとして活用。
