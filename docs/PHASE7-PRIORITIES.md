# Phase 7 candidates & priorities — analysis (2026-05-15)

Phase 5 admin UI + Phase 6 operational features 完了後の **Phase 7 候補** を、コスト懸念と owner directive (`hermes_workers_use_claude_p.md`) を踏まえて整理。本 doc は **planning only**、dispatch 起案前の owner 判断材料。

## 1. Phase 6 carry-over (must)

| # | 項目 | 推定コスト | 実装場所 | 価値 |
|---|---|---|---|---|
| C1 | EF deploy: monthly-usage-refresh + notify-monthly-cap | $3-5 | `supabase/functions/` 既存 README に手順記載済 | 80% banner / cron 自動更新で本番運用安定 |
| C2 | production-mode Lighthouse re-measure on /app/logi | $1-2 | `next start` + headless Lighthouse、artifact 集約のみ | dev-mode 69 → prod expected ≥0.99 確認 |
| C3 | 5e-1 final-report.md backfill | $0 (local) | 既存 qa-summary / rls-results / security-audit から手書き集約 | dispatch 履歴の完全性 |

## 2. 新規 Phase 7 候補

### A. Mobile / PWA 化 (Tier B、~$8-12 推定)
worker 現場利用を加速:
- PWA manifest + service worker (offline-first)
- iOS / Android home screen install
- Push notification API (notification_preferences と連携)
- 推定: 1 dispatch、80t/60m、$8 前後

### B. SaaS multi-tenant 強化 (Tier C、~$15-20)
請求 / プラン / 限界値管理:
- Stripe (or 国内決済) 連携、tenant_subscriptions と紐付け
- plan 別 quota enforcement (scan 月次上限 etc)
- 招待 link UX (6f で invite UI を入れた基盤を活用)
- 推定: 1-2 dispatch、150t/100m、$15-20

### C. Scan UX 高度化 (Tier B、~$10-15)
現場 worker の生産性:
- Bluetooth scanner 対応 (外部 HW)
- Continuous mode (連続 scan、tap で確定)
- 音声 feedback (a11y + 騒音現場対応)
- 推定: 1 dispatch、100t/70m、$10 前後

### D. AI assist 機能 (Tier C、~$20+)
価値高いが scope 広い:
- 作業手順 AI 提案 (manufacturing_plans から手順生成)
- 不適合自動検知 (画像 → defect detection)
- correction approve の AI assistance
- 推定: 複数 dispatch、巨大、$30+ ?
- → **Phase 8 以降に deferred 推奨**

### E. observability + monitoring (Tier B、~$8-12)
production 運用の可観測性:
- Sentry / Datadog 連携 (server-only error → tenant context tag)
- Custom audit logs view (corrections_audit + admin_audit_log の dashboard)
- SLI/SLO 設計 (uptime / error rate / scan latency p95)
- 推定: 1 dispatch、80t/60m、$8 前後

### F. データ移行 / Import 強化 (Tier B、~$8-12)
既存システムからの移行 worker:
- Phase 5c の CSV import 強化 (validation preview、bulk update、rollback)
- 旧システム → kobo の master 移行 wizard
- 推定: 1 dispatch、100t/70m、$10 前後

## 3. 推奨実装順 (cost / value 重視)

### Wave 1 — quick wins (合計 $5-7)
1. **C3 5e-1 final-report.md backfill** ($0、local) — まず housekeeping
2. **C2 production Lighthouse re-measure** ($1-2、小 dispatch)
3. **C1 EF deploy** ($3-5、小 dispatch) — 6f banner が真に機能する

→ Phase 6 を真に完了させてから Phase 7 新機能へ

### Wave 2 — operator value (合計 $10-15)
4. **A Mobile / PWA 化** ($8-12) — 現場 worker が一番使う、即効果

### Wave 3 — 後回し可
5. **E observability** ($8-12) — production 運用始まってから
6. **F データ移行 wizard** ($8-12) — 顧客採用フェーズで
7. **B SaaS multi-tenant 強化** ($15-20) — マネタイズ start 時
8. **D AI assist** ($30+) — 大 Phase 化、別途 architect 必須

## 4. cost-aware operating tips

### memory `hermes_workers_use_claude_p.md` 踏まえての見直し:
- **architect dispatch は Sonnet 推奨**: planning タスクは Opus 4.7 不要、Sonnet で $3 → $1 に圧縮可
- **二重監査は dispatch 内で 1 回**: independent verdict は Phase 6f で実証済、毎 dispatch でなくてよい
- **max_turns 回避**: 5e-3 / 6b / 6e / 6g で hit、80turn で artifact 優先 instruction を payload に必ず
- **Lighthouse skip 判断**: production 確定済 routes は再計測不要、変更が大きい場合のみ
- **同時並列 dispatch 制限**: chrono-desk と genba を同時に走らせると Hermes worker `claude -p` Opus×8 が weeknight + weekend で credit 食う

### budget guideline
- 1 dispatch あたり $3-15 想定
- Phase 7 全体予算: **$50 以内** を目標 (Phase 6 累計 ~$80 だった)
- 1 dispatch で max_turns hit したら **fallback 軽量 dispatch** より **架空 implement scope 縮小** を payload で先取り

## 5. Phase 7 architect dispatch を起案するなら

scope を Wave 1 (carry-over 3 件) + Wave 2 (Mobile/PWA) に絞り、architect dispatch も Sonnet で:
```
task_id: T-20260516-XXXXXX-genba-phase7-architect
budget: max_turns=60, max_minutes=40
auth_tier: B (planning only)
scope: Phase 6 carry-over (C1/C2/C3) + Mobile/PWA design (Wave 2)
推奨 model: Sonnet (architect 系は Opus 不要)
出力: docs/ARCHITECTURE-phase7-mobile-pwa-carryover.md (~400-600 行)
```

owner GO 後に短い dispatch を 1 本だけ。Phase 6 architect の半分以下のサイズで OK。

---

**Next action**: owner が test walkthrough を終えて Phase 7 起案判断してから dispatch。それまでは local 作業 (C3 backfill + seed data) で待機。
