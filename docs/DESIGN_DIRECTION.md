# GENBA Design Direction

作成日: 2026-05-10 / Phase 0 Discovery
依存: `docs/DESIGN-PRINCIPLES.md`、`docs/PRODUCT_SPEC.md`、`docs/ARCHITECTURE.md`
入力観察: `research/genba-discovery/spec/genba_overall_ui_mock.html` (**そのまま実装に持ち込まない**。色味・密度・配色ロジックなど設計者の意図のみ抽出)

## 1. ブランド (3 形容詞)

**実直 (honest) / 即応 (immediate) / 業務 (industrial)**。装飾を増やさず「いま何を読めば良いか / 何が NG か」を 1 行で見せる、結果は 0.3s 以内、工場・倉庫の道具として馴染む配色 (dark green + utility orange/blue/violet)。glassmorphism や紫グラデは持ち込まない。

## 2. mock 観察と採否 (DESIGN-PRINCIPLES Avoid/Embrace 照合)

| 観察 | 採否 |
| --- | --- |
| sidebar dark green `#172421` + main light off-white `#f4f6f4` の dual surface | **採用** (token 化) |
| 4 業務色 (入庫=深緑 / ピッキング=橙 / 棚卸=青 / 製造=紫) | **採用** (面でなくアクセントのみ) |
| topbar の状態 chip (オンライン / 作業者 / 未同期) | **採用** (装飾削減) |
| トップ高密度 dashboard | **再構成** (mobile-first にカード縦積み + 作業中をトップへ) |
| 作業者「未選択」が neutral pill | **強化** (warn 色、必須選択) |
| 角丸 8px が全面均一 | **修正** (sharp + pill の二極化) |
| QR S/M/L 切替 | **採用** + Phase 2 で「自動」 default |
| サイドカナ 1 文字バッジ (T/入/ピ/棚/製) | **採用** (絵文字より識別性) |

## 3. Design Tokens (Phase 1 で `tailwind.config.ts` 化)

OKLCH 表記、light を default。**Phase 1 は OS-following dark mode のみ実装** (`prefers-color-scheme: dark` メディアクエリ駆動、手動トグル UI は提供しない)。手動切替トグル / ユーザー個人設定での上書きは後フェーズ (Phase 5 個人設定タブ) で導入。Phase 0 owner レビュー 2026-05-11 で確定 (B 案採用)。

| Token | OKLCH / HEX | 用途 |
| --- | --- | --- |
| `--bg` | `oklch(97.5% .005 150)` / #f4f6f4 | 全体背景 |
| `--surface` / `--surface-2` | `oklch(99% 0 0)` / `oklch(96% .008 160)` | カード / サブ面 |
| `--ink` / `--muted` / `--border` | #18221f / #5b6864 / #dfe5e2 | 本文 / 補助 / 境界 |
| `--brand` / `--func-receive` | `oklch(48% .10 175)` / #087466 | ブランド・入庫 |
| `--func-pick` | #d26035 | ピッキング |
| `--func-inventory` / `--info` | #2f5da8 | 棚卸 |
| `--func-manufact` | #6c4aa6 | 製造 |
| `--ok` / `--warn` / `--bad` | #1e8a5b / #c98215 / #c63a2c | OK/警告/NG |

dark mode tokens (Phase 1 = `@media (prefers-color-scheme: dark)` のみ駆動): L 軸反転 (`--bg: oklch(15% .01 160)` 等)、機能色は L=60% に持ち上げ。Phase 5 で `.dark` クラス + 手動トグル / 個人設定オーバーライドを導入予定。

**Typography**: Inter Variable + Noto Sans JP (本文)、Geist Mono (品目コード / QR raw)。Body 16px / form input 18px (iOS zoom 抑制 + 手袋視認)、tabular-nums で数量・ID 列。

**Spacing/Radius**: scale 4/8/12/16/24/32/48/64。`--radius-sharp 0` (カード) と `--radius-pill 999` (chip) の **二極化** (8〜16px 角丸禁止)、`--radius-md 6` はフォームのみ。

**Touch target**: 主要操作 **56×56 px 最小** (WCAG 2.2 AA + 手袋運用)、二次 44×44、form input 高さ 48。

## 4. Layout

**案 A (PC / 大型タブレット)**: sidebar 240px dark green + main light、topbar に状態 chip 3、4 業務カード 2×2 (タブレット縦) / 横 4 (PC)、作業中 + 最近を aside に下積み。

**案 B (型を破る、スマホ + 7" 縦持ち + 手袋)**: sidebar 初期非表示、topbar 左の業務ボタンで bottom sheet 切替。主画面は **常に「いま選んでいる業務」**、トップ概念をなくす。作業中セッションは画面下 floating bar から復帰。

**選定**: 案 A をベースに、breakpoint でスマホ時は案 B 要素に切替。Phase 1 は案 A、Phase 2 でスマホ最適化。

## 5. 主要画面の状態 (4 状態必達: 通常 / 空 / loading / error)

**トップ**: 通常=4 業務カード + 作業中 + 最近 5 件 / 空 (作業中)=「作業中のセッションはありません」 / 空 (最近)=「直近の登録はまだありません」 / loading=skeleton (sharp、shimmer 禁止、grain texture) / error=再試行ボタン + `error.message` muted 1 行。

**QR スキャン**: ready=大プレビュー + フレーム / reading=フレーム枠 brand 色脈動 (reduced-motion で停止) / **matched OK**=`--ok` 全画面フラッシュ 0.2s + アイコン / **matched NG**=`--bad` フラッシュ 0.4s + 警告音 + 項目別 NG 詳細 / no camera=手入力導線 / permission denied=設定手順 / timeout 30s=手入力提案。

**履歴**: 通常=フィルタ + 表 + ページング + CSV ボタン active / 空 (絞込)=条件変更案内 / 空 (データなし)=CSV ボタン disabled / loading=skeleton row × 5 / error=再試行。

## 6. 機能アクセント運用

4 業務色は **面でなくアクセント**: ✗ カード全塗 / ✓ 左端 4px 縦バー、見出し色、アイコンバッジ、hover 枠、chip 文字色。色だけで区別せず **必ずカナ 1 文字バッジ + テキスト併記** (色覚多様性配慮)。

## 7. アイコン / Motion / アクセシビリティ

- **アイコン**: lucide-react outline 1.5px、業務バッジは「入/ピ/棚/製」カナ (36×36)、空状態は線描モノクロ (Phase 5 で 4 業務分作成)。loading は skeleton + grain noise (shimmer 禁止)。
- **Motion**: `prefers-reduced-motion: reduce` で全停止。easing は `cubic-bezier(0.4,0,0.2,1)`。hover=border のみ、focus=outline 2px + offset 2px、press=scale 0.97 / 80ms。入場アニメ禁止。QR フラッシュ < 250ms、reduced-motion 時はアイコン点灯のみ。
- **WCAG 2.2 AA**: 本文 16:1+、機能色テキスト 4.5:1+ (不足時 L を下げる)、focus ring 必達、keyboard 完結 + QR 手入力 fallback、`<label>` + `aria-describedby`、heading skip 禁止、QR 結果は `role="status" aria-live="polite"` (NG は `assertive`)、主要タップ 56×56。

## 8. 引き継ぎ

- Avoid List 遵守: 中央寄せ hero / 紫グラデ多用 / 8〜16px 角丸 / 絵文字 / 回転スピナー / 中身ない hero copy → すべて回避。
- Phase 1 で designer 起動時に `workspace/design-library/{tokens, voices, patterns/dual-surface-work-app, patterns/function-color-accent, inspirations}/genba*.md` を追記する (Phase 0 では追記しない)。
- OG 画像 (Phase 5 marketer 連携): 1200×630 dark green ベース、左 60% にロゴ + tagline、右 40% に 4 業務バッジ縦積み、grain noise 5%、tagline は display 56px。
