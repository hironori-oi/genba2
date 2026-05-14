# GENBA

[![CI](https://github.com/hironori-oi/genba2/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hironori-oi/genba2/actions/workflows/ci.yml)

現場作業記録 SaaS。QR を中心に **入庫 / ピッキング / 棚卸 / 製造実績** の 4 業務を記録する multi-tenant Web アプリ。

- **Production**: <https://genba2-ai.vercel.app/>
- **Phase 4d-deploy 時点 (2026-05-14) で MVP 本番稼働中**。詳細は `docs/PRODUCT_SPEC.md` §0 / `docs/RUNBOOK.md` §0。

## 技術スタック

`config/tech-stack.yaml` に従う:

- Next.js 15 (App Router) + TypeScript + Tailwind v4 + shadcn-ui pattern
- React Hook Form + Zod
- Supabase (PostgreSQL + Auth + Storage + Edge Functions / RLS multi-tenant)
- Vercel (production branch = `main`、push 自動 build & deploy)
- Vitest (unit + integration) + Playwright (e2e)
- Secrets: SOPS+age (`.env.enc` → `.env.local`)

## 開発セットアップ

```bash
# 1. シークレット復号 (オーナーが age 鍵を保有している前提)
./scripts/secrets-decrypt.sh        # .env.enc → .env.local

# 2. 依存関係インストール
npm ci

# 3. dev サーバ起動 (localhost:3000)
npm run dev
```

ローカル E2E / Lighthouse / RLS live test の手順、本番デプロイ / DB rollback / Backup 戦略は **`docs/RUNBOOK.md`** に集約。日々の運用判断はそちらを参照のこと。

## 主要 npm スクリプト

| script | 用途 |
| --- | --- |
| `npm run dev` | Next.js dev server (localhost:3000) |
| `npm run build` | Vercel と同等の production build |
| `npm run start` | build 後の production server |
| `npm run lint` | ESLint (next lint) |
| `npm run typecheck` | TypeScript no-emit 型検査 |
| `npm run test` | Vitest (unit + integration、live RLS は env で skip) |
| `npm run test:watch` | Vitest watch |
| `npm run e2e` | Playwright E2E |
| `npm run e2e:install` | Playwright ブラウザ (Chromium + deps) install |

`RUN_LIVE_RLS_TESTS=1` + Supabase env が揃った時のみ live RLS test が有効化される。CI / デフォルトでは skip。

## CI / Branch Protection

`main` への push、`feature/**` の push、`main` への pull request で GitHub Actions が走る (`.github/workflows/ci.yml`):

- `lint` — `npm run lint`
- `typecheck` — `npm run typecheck` (`tsc --noEmit`)
- `unit-test` — `npm run test` (Vitest、live RLS skip)
- `build` — `npm run build` (Vercel と同等の Next.js production build)

`main` ブランチは branch protection で **PR 必須 + 上記 4 job 必須通過** を要求する (solo dev のため required reviews=0)。

## ドキュメント構成

- `docs/PRODUCT_SPEC.md` — プロダクト仕様、ペルソナ、MVP / P0/P1/P2、受け入れ基準
- `docs/ARCHITECTURE.md` — システム構成、ドメインモデル、4 業務状態遷移、RLS / RBAC
- `docs/ARCHITECTURE-phase4-manufacturing.md` — Phase 4 製造ドメイン補遺
- `docs/DESIGN_DIRECTION.md` — design tokens、現場 mobile-first UX、QR スキャン体験
- `docs/QR_SPEC.md` — QR フォーマット定義 / 2 点照合ロジック / バージョン管理
- `docs/MIGRATION_NOTES.md` — pick-checker (旧試作) からの差分、引き継ぎ判断
- `docs/IMPLEMENTATION_PLAN.md` — Phase 1〜10 のスコープ、DoD、見積、リスク
- `docs/RUNBOOK.md` — **本番情報 / Deploy / DB rollback / Backup / dev script 運用**
- `docs/SECURITY-AUDIT-*.md` — Phase 毎の security 監査記録

## 参考資料

- 仕様: `workspace/research/genba-discovery/spec/genba_overall_ui_mock.html`、`GENBA_機能整理.md`
- 旧試作 (read only、コピー禁止): `workspace/research/genba-discovery/reference/pick-checker/`
