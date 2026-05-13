# GENBA

現場作業記録 SaaS。QR を中心に、入庫 / ピッキング / 棚卸 / 製造実績の 4 業務を記録する multi-tenant Web アプリ。

## ステータス

**Phase 0: Discovery (進行中 / 2026-05-10)**

実装コードは未着手。本リポジトリは現時点では `docs/` のみを保持する。実装は owner が `docs/PRODUCT_SPEC.md` と `docs/IMPLEMENTATION_PLAN.md` を承認した後に Phase 1 でキックオフする。

## 構成

- `docs/PRODUCT_SPEC.md` — プロダクト仕様、ペルソナ、MVP / P0/P1/P2、受け入れ基準
- `docs/ARCHITECTURE.md` — システム構成、ドメインモデル、4 業務状態遷移図、RLS / RBAC
- `docs/DESIGN_DIRECTION.md` — design tokens、現場 mobile-first UX、QR スキャン体験
- `docs/QR_SPEC.md` — QR フォーマット定義 / 2 点照合ロジック / バージョン管理
- `docs/MIGRATION_NOTES.md` — pick-checker (旧試作) からの差分、引き継ぎ判断
- `docs/IMPLEMENTATION_PLAN.md` — Phase 1〜10 のスコープ、DoD、見積、リスク

## 技術スタック (予定 / Phase 1 以降で確定)

`config/tech-stack.yaml` に従う。Next.js 15 + TypeScript + Tailwind + shadcn-ui / Supabase (PostgreSQL + Auth + Storage + Edge Functions) / Vercel / SOPS+age による secrets。

## 参考資料

- 仕様: `workspace/research/genba-discovery/spec/genba_overall_ui_mock.html`、`GENBA_機能整理.md`
- 旧試作 (read only、コピー禁止): `workspace/research/genba-discovery/reference/pick-checker/`
