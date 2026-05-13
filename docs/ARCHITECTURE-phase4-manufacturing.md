# GENBA Phase 4 (WORKS = 製造実績) Architecture

作成日: 2026-05-13 / Phase 4 architect-only design
TASK_ID: T-20260513-180000-genba-phase4-manufacturing-architect
依存: `docs/ARCHITECTURE.md` (Phase 0)、`docs/PRODUCT_SPEC.md` §3 UC-4 / §6 AC、`docs/IMPLEMENTATION_PLAN.md` Phase 4 (160 turn / 14 日 / 二重監査必須)、`docs/DESIGN_DIRECTION.md` (色 `--func-manufact #6c4aa6`)、`docs/SECURITY-AUDIT-2026-05-12-phase3b.md`
入力観察: `research/genba-discovery/spec/GENBA_機能整理.md` (WORKS §, 製造予定・製造実績・製造実績不適合)

> Status: **architect-only design**. 本 doc 自体は production code / migration / test / config を一切変更しない。implementation は owner 確認後の Phase 4a〜4d dispatch で別途。
>
> Source notes:
> - `memory:genba_backlog.md` Phase 4 セクションは本 dispatch 時点で kobo memory 配下に **存在せず** (Read failed)。本 doc は `research/genba-discovery/spec/GENBA_機能整理.md` の WORKS 章および既存 `docs/ARCHITECTURE.md` ER 図 (`MANUFACTURING_PLANS ─ MFG_PROCESSES ─ MFG_RECORDS`) を一次ソースとして補完設計した。
> - 既存 `qr_scan_histories.target_table` CHECK 制約 + `validate_target_tenant()` トリガ allow-list が `'manufacturing_records'`, `'manufacturing_plans'`, `'mfg_processes'` を **すでに列挙済**。Phase 4 テーブル名はこの allow-list に合わせる (§3.6 で詳述)。

---

## 1. 既存 architecture 読込結果と Phase 4 整合確認

### 1.1 読み込んだ Phase 1〜3b 成果物

| 成果物 | 確認内容 | Phase 4 への含意 |
|---|---|---|
| `docs/ARCHITECTURE.md` §2 ER 図 | `MANUFACTURING_PLANS ─ MFG_PROCESSES ─ MFG_RECORDS` の 3 段関係が既に提示済 | Phase 4 で実体化する。テーブル名は `manufacturing_plans` / `mfg_processes` / `manufacturing_records` (allow-list と一致) |
| `docs/ARCHITECTURE.md` §3 状態遷移 | 製造: `ReadInstruction→StartChoice→Started→Producing→Ended→InputResult→AddDefect*→Submitted→ProduceInflow?` | UI 状態機械の骨格はここで確定済。Phase 4 はこれを実装に落とす |
| `docs/ARCHITECTURE.md` §4 RLS テンプレ | `tenant_id=app.current_tenant_id()` + `worker_id=auth.uid()` + UPDATE は self or tenant_admin + DELETE は tenant_admin | **無改変で踏襲**。LOGI と同じ pattern を WORKS の 3 records 系テーブルにも適用 |
| `docs/PRODUCT_SPEC.md` §6 AC | AC-AUTH/RLS/QR/CSV/HIST/A11Y/PERF は Phase 4 完了時点で 1 顧客 MVP 動作 | Phase 4 = MVP gate。AC は WORKS 経由でも検証される |
| `docs/IMPLEMENTATION_PLAN.md` Phase 4 行 | 14 日 / 160 turn / 二重監査必須 / `paid_subscription_signup` (Pro+PITR) 承認は Phase 3 末・Phase 4 着手前 / production_deploy 承認必須 | §9 budget 試算と整合済 |
| `supabase/migrations/20260512000200_phase3a_logi_foundation.sql` | `qr_scan_histories.target_table` CHECK allow-list に `manufacturing_records` / `manufacturing_plans` / `mfg_processes` が **既に列挙** されている (lines 380-392) | Phase 4 で **同名のテーブルを作る** ことが事実上 hard-coded 制約。改名すると allow-list と trigger 双方の修正が必要 |
| `supabase/migrations/20260512000300_phase3a_target_tenant_trigger.sql` | `validate_target_tenant()` の defense-in-depth allow-list にも同 3 テーブル名がハードコード (lines 40-50) | 同上。Phase 4 migration で **テーブル新規作成のみで RLS-007 と同形のクロステナント参照保護が即発動**できる |
| `supabase/migrations/20260512000400_phase3a_raw_value_protection.sql` | `qr_scan_histories.raw_value` を column-grant + dual-view (`v_qr_scan_histories` / `v_qr_scan_histories_admin`) で保護 | Phase 4 の製造ラベル QR スキャンも **同じ qr_scan_histories に書き込む** ため、raw_value 保護は無改変で恩恵を受ける |
| `supabase/migrations/20260512000600_phase3b_csv_jobs.sql` | `csv_import_jobs` + `enforce_plan_line_tenant()` 親 tenant_id ドリフト防止 trigger + `pg_column_size(parsed_values) <= 8192` CHECK | Phase 4 の `mfg_processes` も親 `manufacturing_plans` への drift 防止 trigger を **同パターン**で追加する (§4.4) |
| `src/lib/logi/{actions,validators,types,history}.ts` | server actions の標準形 (anon JWT client / `app_metadata.tenant_id` / `worker_id=auth.uid()` / `{data,error}` 返却 / `raw_value` を返さない) | Phase 4 では `src/lib/works/` 配下に同形 module を追加 (§5.2) |
| `src/components/scanner/{Scanner,ResultOverlay,StepHeader,ManualInputModal,scanner-state}.tsx` | Scanner / ResultOverlay / StepHeader / ManualInputModal / scanner-state reducer は **業務不依存** で実装済 | Phase 4 UI は **そのまま再利用**。新規スキャナ component を作らない (§6 / §7) |
| `src/lib/csv/{sanitize,encode,import-client}.ts` | formula injection 防御・shift_jis・10 MB / 100 k 行 reject はすべて業務不依存 | 製造実績 CSV 出力 (履歴拡張) も無改変で恩恵。新規 CSV 取込は §3.5 で計画 |
| `tests/integration/rls/{rls-live,rls-phase3a,coverage-gap-closure}.test.ts` | 28/28 live PASS (qa-summary-T-20260513-170000) | Phase 4 では RLS-401..408 を **同じ live-gated pattern** で追記 (§8) |
| `docs/SECURITY-AUDIT-2026-05-12-phase3b.md` UNVERIFIED_ITEM #2 #3 | `csv_import_jobs` の live RLS coverage / live EF 415/413 round-trip 未取得 | Phase 4d で WORKS 系を含めて一気に live coverage 拡張 (§8 / §9) |

### 1.2 Phase 4 と既存 architecture の **conflict 検査**

| 観点 | Conflict? | 詳細 |
|---|---|---|
| ER 図 | **0** | Phase 0 ER 図と一致。MFG_PROCESSES という別名が ER 図にあり、spec の "manufacturing_plan_processes" と差があるが、`allow-list と一致する mfg_processes を採用` で決着 (§3.6 ADR) |
| RLS テンプレ | **0** | LOGI の 6 テーブル + qr_scan_histories と完全に同形。`app.current_tenant_id()` / `app.is_tenant_admin()` / `app.is_system_admin()` ヘルパーを再利用 |
| `app_metadata` JWT claim | **0** | tenant_id / role は `raw_app_meta_data` のみから読む。`raw_user_metadata` 参照 0 件を Phase 1〜3b と同じ grep で再検証する |
| `service_role` 境界 | **0** | server actions は anon JWT のみ。`service_role` は Edge Function (もし新設するなら) と migration 適用シェルからのみ。`.next/static/**` への漏洩 0 hit を Phase 4d で再検証 |
| `raw_value` 保護 | **0** | qr_scan_histories を経由するため Phase 3a 保護がそのまま効く。新規 raw 文字列保護は不要 |
| formula injection / CSV | **0** | sanitize.ts を製造実績履歴 CSV 出力からも呼ぶ |
| polymorphic FK | **0** | target_table allow-list に既に追加済。新規 trigger 改変は不要 (allow-list が既に拡張済) |
| 56×56 タッチ / WCAG | **0** | Phase 3b 確立済の AC-A11Y-01 を WORKS UI でも再現 |
| Phase 5 admin CRUD 境界 | **0** | 製造マスタ (processes / equipment / defect_groups / defects) は **Phase 4 migration で seed + read 経路のみ**、CRUD UI は Phase 5 (master CRUD UI fence)。境界線を §3.4 で明記 |

**結論**: **既知 conflict = 0**。Phase 4 は Phase 3a/3b が用意した RLS / raw_value / polymorphic FK trigger / CSV pipeline / Scanner component を **そのまま土台に乗る**。新規 architecture 観点は 4 件のみ:

1. **新規テーブル 4〜6 個** (master 含む) を §3 で定義
2. **manufacturing_record_id** カラムを既存 `movement_records` に追加 (製造入庫リンク)
3. **`mfg_processes` 親 tenant ドリフト防止 trigger** を `enforce_plan_line_tenant` と同パターンで追加 (§4.4)
4. **WORKS UI** (`/app/works/manufacturing/`) を Scanner reuse で実装

---

## 2. Phase 4 対象業務確認

### 2.1 スコープ確定 (research/genba-discovery/spec § WORKS + PRODUCT_SPEC §3 UC-4)

| 区分 | スコープ in | スコープ out (Phase 5 以降 or 永久) |
|---|---|---|
| 業務 | 製造実績 1 業務 | (WORKS は MVP では製造実績のみ。spec §全体構成 で明示) |
| データ | 製造予定 (取込) / 製造予定工程 (工順) / 製造実績 (開始/終了/数量/設備/ロット) / 製造実績不適合 (N) | ライン稼働率、シフト、設備別歩留、MES 連携 (Phase 10 GEN 連携の枠) |
| ロール | worker (現場入力) / tenant_admin (マスタ管理 + 履歴閲覧 + raw_value) / system_admin (横断) | factory-scoped / line-scoped 多階層は Phase 4 では **採用しない** (§4.3 で根拠) |
| 操作 | 製造指示 QR 読取 → 工程選択 → 開始 → 終了 → 製造数 + ロット + 設備 → 不適合 N → 登録 / 製造入庫を同時記録 (任意) | リアルタイムライン状況 dashboard (Phase 7 履歴強化で部分対応) / シフト計画 |
| 端末 | iOS Safari 17+ / Android Chrome 120+ PWA、手袋運用、56×56 タッチ | ネイティブアプリ (Phase 0 で out)、PLC 直結 |
| QR | 製造指示書ヘッダ QR (`manufacturing_plans` 参照) / 製造指示書明細 = 工程 QR (`mfg_processes` 参照) / 現品ラベル QR (品目特定) | 専用バーコード規格 (Code128 等)、Phase 4 は qr_code のみ |
| CSV | **取込**: 製造予定 (オーダー単位の CSV) / **出力**: 製造実績履歴 (4 業務統合履歴の一部として) | 月次 ロット トレース帳票 (Phase 7) |

### 2.2 ユースケース UC-4 詳細フロー (PRODUCT_SPEC §3 + ARCHITECTURE §3 状態遷移)

```
SelectWork (work_settings: business='manufacturing')
  → SelectWorker (QR or list)
  → ReadInstructionHeader (帳票ヘッダQR → manufacturing_plans を特定)
  → SelectProcess (工程 listing or 帳票明細 QR → mfg_processes を特定)
  → StartChoice (新規開始 / 進行中再開)
  → Started (started_at を記録、UI に経過秒)
  → Producing (作業中、必要なら一時保存)
  → Ended (ended_at を記録、work_minutes 自動算出)
  → InputResult (actual_quantity + lot + equipment_id + notes)
  → AddDefect* (不適合 0〜N: defect_id + defect_quantity)
  → Submitted (manufacturing_records INSERT + manufacturing_record_defects N 件 bulk INSERT)
  → ProduceInflow? (任意で movement_records receiving を同 transaction で 1 件 INSERT、
                    movement_records.manufacturing_record_id にリンク)
  → SelectWork (次の作業へ)
```

ロール別: **worker** が現場で全フロー / **tenant_admin** は同フロー + 履歴閲覧 + raw_value 閲覧 (Phase 3a 保護そのまま) + 訂正 (Phase 5)。

### 2.3 dispatch の `BACKGROUND` で言及された未採用項目の判断

| 項目 (dispatch 言及) | 判断 | 根拠 |
|---|---|---|
| シフト/ライン | **不採用** | spec の WORKS §基本方針 にライン・シフト概念なし。MVP YAGNI。必要なら Phase 4 完了後に `equipment_id` の意味を拡張するか、Phase 7 で追加検討 |
| 工場 (factory) スコープ | **不採用** | 同上。`tenant_id` のみで運用。マルチサイト企業は当面 tenant を複数発行する運用で吸収 |
| QR 連携 | **採用** (Phase 3a/3b の scanner / parser / qr_scan_histories をそのまま流用) | spec §QR コード設計 + UC-4 |
| 作業開始/終了 | **採用** | spec § WORKS §基本方針 で `started_at / ended_at / work_minutes` を明示 |
| 設備/ロット/不具合 | **採用** | spec § WORKS / 製造実績 / 製造実績不適合 |
| 品質チェック (quality_records) | **後回し (Phase 7+)** | spec に独立テーブルとしての品質チェックは記載なし。MVP では不適合 (`manufacturing_record_defects`) で代替 (§3.3 で根拠) |
| 製造計画 (manufacturing_plans) | **採用 (CSV 取込で)** | spec § WORKS §製造予定。CSV 取込導線は inventory CSV (Phase 3b) と同パターン |

---

## 3. テーブル設計案

### 3.1 命名と allow-list 整合

既存 Phase 3a allow-list に合わせ、以下の名前で確定:

```
public.processes               (master, tenant-scoped)
public.equipment               (master, tenant-scoped)
public.defect_groups           (master, tenant-scoped)
public.defects                 (master, tenant-scoped)
public.manufacturing_plans     (production schedule header)
public.mfg_processes           (production schedule by process — 工程)
public.manufacturing_records   (actual record per process)
public.manufacturing_record_defects (defect rows per record)
```

**ADR-P4-01**: `mfg_processes` という短縮名を採用 (spec §製造予定工程 は `manufacturing_plan_processes` だが、Phase 3a の `qr_scan_histories.target_table` CHECK 制約と `validate_target_tenant()` トリガ allow-list が既に `mfg_processes` を hard-code 済)。allow-list を改名する場合は migration を 1 本余計に書く必要があり、また既存 `tests/integration/rls/rls-phase3a.test.ts` の RLS-208 (`target_table='users' INSERT rejected by CHECK`) と同様の 整合性テストを再走させる必要がある。allow-list 側を変更しないほうが migration ordering と test surface が小さい。

### 3.2 master tables (Phase 4 で新規、CRUD UI は Phase 5)

すべて `tenants` と同じ tenant-scoped pattern、共通列 `id / tenant_id / code / name / sort_order / active / note / 監査5列`。RLS は **同一テナント SELECT、tenant_admin INSERT/UPDATE/DELETE**。

```sql
-- DDL 案 (Phase 4a で実装):

create table if not exists public.processes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  process_code text not null,
  process_name text not null,
  sort_order integer not null default 100,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id, process_code)
);
-- + 同形で public.equipment / public.defect_groups / public.defects
--   (defects は defect_group_id uuid references public.defect_groups(id) を持つ)
```

RLS policy は 4 マスタ共通 (Phase 3a `work_types` / `business` 等 Phase 2 マスタと同形):

```sql
alter table public.processes enable row level security;

create policy processes_select_same_tenant
on public.processes for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

create policy processes_modify_tenant_admin
on public.processes for all to authenticated
using ((tenant_id = app.current_tenant_id() and app.is_tenant_admin()) or app.is_system_admin())
with check ((tenant_id = app.current_tenant_id() and app.is_tenant_admin()) or app.is_system_admin());
```

### 3.3 業務テーブル: `manufacturing_plans` / `mfg_processes` / `manufacturing_records` / `manufacturing_record_defects`

```sql
-- manufacturing_plans: 製造指示・オーダー単位のヘッダ
create table if not exists public.manufacturing_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_no text not null,            -- 製造指示番号
  item_code text not null,           -- 製造対象品目
  planned_quantity numeric not null check (planned_quantity >= 0),
  lot text,
  start_date date,
  end_date date,
  status text not null default 'active' check (status in ('draft','active','closed')),
  notes text,
  imported_file_name text,           -- CSV 取込メタ
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id, order_no)
);
-- RLS: select same_tenant / modify tenant_admin (LOGI plans と同形)
```

```sql
-- mfg_processes: 工順・工程ごとの予定 (manufacturing_plans 1:N)
--   tenant_id は denormalised (Phase 3a movement_plan_lines と同方針)
--   親 tenant ドリフトは Phase 4 で enforce_mfg_process_tenant() trigger (§4.4)
create table if not exists public.mfg_processes (
  id uuid primary key default gen_random_uuid(),
  manufacturing_plan_id uuid not null references public.manufacturing_plans(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  process_order integer not null,
  process_id uuid references public.processes(id) on delete restrict,
  equipment_id uuid references public.equipment(id) on delete restrict,
  assigned_worker_id uuid references auth.users(id),
  status text not null default 'pending' check (status in ('pending','in_progress','done','canceled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (manufacturing_plan_id, process_order)
);
-- RLS: select same_tenant / modify tenant_admin
```

```sql
-- manufacturing_records: 実績 (mfg_processes 1:N)
--   ARCHITECTURE §4 RLS template そのまま: worker insert self / update self|admin /
--   delete admin
create table if not exists public.manufacturing_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  mfg_process_id uuid not null references public.mfg_processes(id) on delete restrict,
  worker_id uuid not null references auth.users(id),
  work_date date not null,
  actual_quantity numeric not null check (actual_quantity >= 0),
  lot text,
  equipment_id uuid references public.equipment(id) on delete restrict,
  started_at timestamptz,
  ended_at timestamptz,
  work_minutes numeric generated always as (
    case
      when started_at is not null and ended_at is not null
        then extract(epoch from (ended_at - started_at)) / 60.0
      else null
    end
  ) stored,
  match_result text not null default 'ok' check (match_result in ('ok','ng','warning','skipped')),
  match_detail jsonb not null default '[]'::jsonb,
  recorded_at timestamptz not null default now(),
  previous_record_id uuid references public.manufacturing_records(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  check (started_at is null or ended_at is null or ended_at >= started_at)
);
-- RLS:
--   manufacturing_records_select_same_tenant   (same tenant or system_admin)
--   manufacturing_records_insert_worker        (tenant + worker_id=auth.uid())
--   manufacturing_records_update_self_or_admin (self or tenant_admin)
--   manufacturing_records_delete_tenant_admin
-- index:
--   (tenant_id, recorded_at desc)
--   (mfg_process_id)
--   (worker_id)
--   (previous_record_id)
```

```sql
-- manufacturing_record_defects: 不適合 N (manufacturing_records 1:N)
--   tenant_id を denormalise + parent tenant ドリフト trigger を追加
create table if not exists public.manufacturing_record_defects (
  id uuid primary key default gen_random_uuid(),
  manufacturing_record_id uuid not null references public.manufacturing_records(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  defect_id uuid not null references public.defects(id) on delete restrict,
  defect_quantity numeric not null check (defect_quantity >= 0),
  notes text,
  recorded_at timestamptz not null default now(),
  previous_record_id uuid references public.manufacturing_record_defects(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz
);
-- RLS:
--   *_select_same_tenant         (same tenant or system_admin)
--   *_insert_worker              (tenant + must descend from manufacturing_records the user can insert;
--                                 enforce via WITH CHECK + tenant trigger)
--   *_update_self_or_admin       (creator self or tenant_admin)
--   *_delete_tenant_admin
```

### 3.4 採用判断の根拠

| dispatch 言及 | 採否 | 根拠 |
|---|---|---|
| `manufacturing_plans` | **採用** | spec § WORKS §製造予定 / UC-4 で帳票ヘッダから工程を辿る基幹データ。CSV 取込導線 (inventory_plan と同パターン) のターゲットでもある |
| `quality_records` (品質チェック) | **採用しない** | spec § WORKS にも `docs/ARCHITECTURE.md` にも独立テーブル定義なし。不適合 (`manufacturing_record_defects`) で代替し、定性的な検査結果は Phase 7 で `custom_text_01..10` ベースの工程結果記録として拡張する余地を残す。MVP YAGNI |
| `manufacturing_plan_processes` (spec の長い名前) | **採用しない (改名)** | §3.6 ADR で説明 |
| `manufacturing_record_defects` (新規) | **採用 (改名)** | spec の "製造実績不適合"。`record_defects` の表記で他テーブルとの命名整合 (`movement_records` / `inventory_records`) を取る |
| 既存 `movement_records` 共通化 | **部分的に共通化** | 製造入庫は **`movement_records` の receiving 行として 1 件 INSERT し、`manufacturing_record_id` FK で manufacturing_records と紐付ける** (spec §移動実績の運用別の扱い と一致)。本 FK は **Phase 4a migration で `movement_records` に追加** する。`movement_records` 自体は分割しない (重複回避) |
| `field_definitions` 共通カスタム列 | **採用 (Phase 1 から既存)** | `custom_text_01..10` / `custom_number_01..05` / `custom_date_01..05` を Phase 4 の 3 テーブル (`manufacturing_plans` / `mfg_processes` / `manufacturing_records`) にも一律付与 (Phase 1 移植可) |

### 3.5 既存テーブルとの共通化・FK・denormalization

**新規 FK**:

```sql
-- movement_records.manufacturing_record_id (Phase 4a で追加)
alter table public.movement_records
  add column manufacturing_record_id uuid
    references public.manufacturing_records(id) on delete set null;
create index movement_records_manufacturing_record_idx
  on public.movement_records (manufacturing_record_id);
-- UNIQUE は付けない: 製造実績 1 件から 製造入庫 1 件が標準だが、
--   訂正 (previous_record_id) を絡めると 1:N に膨らみうる。spec §移動実績の運用別の扱い
--   注釈 (「製造入庫」) も unique を強制していない。
--   ただし IMPLEMENTATION_PLAN §Phase 4 リスク に「製造入庫二重記録 (manufacturing_record_id UNIQUE)」
--   と明記されているため、Phase 4c で **partial unique index** (deleted_at is null) を検討:
--   create unique index movement_records_manufacturing_unique_alive
--     on public.movement_records (manufacturing_record_id)
--     where manufacturing_record_id is not null and deleted_at is null;
--   採否は §10 R-P4-04 / Phase 4c で再確認
```

**Denormalization (Phase 3a と同方針)**: `mfg_processes.tenant_id` と `manufacturing_record_defects.tenant_id` を親から複製。RLS が JOIN なしで効くようにし、Phase 4a で `enforce_mfg_process_tenant()` および `enforce_manufacturing_record_defect_tenant()` の **2 本** の親-tenant ドリフト防止 trigger を追加 (Phase 3b `enforce_plan_line_tenant` と同パターン)。

**qr_scan_histories の流用**: 製造の QR スキャン (帳票ヘッダ / 工程明細 / 現品ラベル) はすべて既存 `qr_scan_histories` に `target_table` ∈ {`manufacturing_plans`, `mfg_processes`, `manufacturing_records`} で INSERT。Phase 3a の RLS-007 trigger と raw_value 保護がそのまま効く → Phase 4 migration で `qr_scan_histories` を **改変しない**。

### 3.6 ADR-P4-01: `mfg_processes` vs `manufacturing_plan_processes`

**決定**: 短縮名 `mfg_processes` を採用。

**選択肢**:
- (A) spec 原文の `manufacturing_plan_processes` を採用し、Phase 3a の allow-list / trigger / `QR_SCAN_TARGET_TABLES` (src/lib/logi/types.ts) を **3 箇所 同期改名**
- (B) Phase 3a allow-list 既存値 `mfg_processes` をそのまま採用 (本 doc の採用案)

**根拠**:
- (B) は migration 増分 0、type 増分 0、test 増分 0。Phase 3a/3b で 28/28 live PASS の状態に対する surface 変更が最小
- spec § QR コード設計 で「QR 種別と target_table の対応は QR 項目定義で吸収可能」と運用 flexibility が確保済
- 長期的に `manufacturing_plan_processes` の方が可読性が高いが、Phase 5 master CRUD UI / Phase 7 履歴強化のいずれでも改名コストは小さいまま (Phase 4 を急いで通すほうが MVP gate に対するリスクが低い)

**Phase 5 以降の改名余地**: 必要なら Phase 7 (履歴強化) に bundle して migration 1 本で改名可能 (allow-list 更新 + 既存データ ALTER TABLE RENAME)。

---

## 4. RLS 設計案

### 4.1 全 6 新規テーブルに対する RLS テンプレ

LOGI Phase 3a と **完全同形** を採用 (§1 で確認した conflict 0)。

| テーブル | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `processes` / `equipment` / `defect_groups` / `defects` | same-tenant + system_admin | tenant_admin | tenant_admin (WITH CHECK) | tenant_admin |
| `manufacturing_plans` | same-tenant + system_admin | tenant_admin | tenant_admin (WITH CHECK) | tenant_admin |
| `mfg_processes` | same-tenant + system_admin | tenant_admin | tenant_admin (WITH CHECK) | tenant_admin |
| `manufacturing_records` | same-tenant + system_admin | worker `worker_id=auth.uid()` AND `tenant_id=current_tenant_id()` | self or tenant_admin (WITH CHECK pin tenant_id) | tenant_admin |
| `manufacturing_record_defects` | same-tenant + system_admin | worker can INSERT if `tenant_id=current_tenant_id()` AND parent record's worker_id=auth.uid() OR is_tenant_admin | self (creator) or tenant_admin (WITH CHECK) | tenant_admin |

### 4.2 `app_metadata` pattern 厳格踏襲

- `app.current_tenant_id()` / `app.is_tenant_admin()` / `app.is_system_admin()` の 3 ヘルパーを **全 policy で再利用** (新規 SECURITY DEFINER 関数を作らない)
- `auth.jwt() -> 'app_metadata'` のみ参照 (Phase 1 で確立済)。`raw_user_metadata` への参照を grep して 0 hit を再検証 (Phase 4d security audit DoD)
- 新規 SECURITY DEFINER 関数 `enforce_mfg_process_tenant()` / `enforce_manufacturing_record_defect_tenant()` は `set search_path = ''` 厳守 (Phase 3b `enforce_plan_line_tenant` 同パターン)
- `service_role` は **migration 適用シェル** からのみ。server actions は anon JWT 経由のみ → `src/lib/works/actions.ts` に `service_role` / `createAdminClient` 等の grep を Phase 4d で 0 hit 検証

### 4.3 多階層 access model の判断: **採用しない**

dispatch §SCOPE で「tenant 別 + 工場/ライン別が必要なら多階層 access model」と問われたが:

- spec § WORKS にも `docs/ARCHITECTURE.md` にも factory / line 概念なし
- マルチサイト企業は tenant を複数発行する運用で吸収可能
- 多階層 RLS は再帰 policy の risk surface (pick-checker 教訓: ARCHITECTURE §4 R-01)
- MVP YAGNI

将来必要なら `equipment_id` に "factory_id" 相当の意味を持たせる、または `profiles.assigned_businesses` の jsonb に `assigned_lines` を追加するなどで非破壊拡張可能。

### 4.4 新規 trigger 設計

```sql
-- Phase 3b の enforce_plan_line_tenant() と同パターン。
-- TG_TABLE_NAME を見て親テーブル名と FK 列名を分岐し、
-- 親の tenant_id と NEW.tenant_id が一致しなければ 42501。

create or replace function public.enforce_mfg_process_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_tenant_id uuid;
begin
  if new.manufacturing_plan_id is null then
    return new;
  end if;
  execute format(
    'select tenant_id from public.%I where id = $1',
    'manufacturing_plans'
  ) using new.manufacturing_plan_id into parent_tenant_id;
  if parent_tenant_id is null then
    raise exception 'mfg_processes parent manufacturing_plans % not found', new.manufacturing_plan_id
      using errcode = '42501';
  end if;
  if parent_tenant_id <> new.tenant_id then
    raise exception 'mfg_processes tenant_id mismatch with parent manufacturing_plans.tenant_id'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger mfg_processes_enforce_tenant
before insert or update of manufacturing_plan_id, tenant_id
on public.mfg_processes
for each row
execute function public.enforce_mfg_process_tenant();
```

同パターンで `enforce_manufacturing_record_defect_tenant()` (parent = `manufacturing_records`) を追加。

**注**: `manufacturing_records.mfg_process_id` は親が常に `mfg_processes` 単一 → 既存 `enforce_plan_line_tenant` を一般化するか、専用 trigger を 2 本立てるかは判断が必要。本 doc では **専用 trigger を 2 本立てる方針** を採用 (allow-list ハードコードの方が search_path / format injection が安全。汎化したい場合は Phase 7 で 1 本にリファクタ)。

### 4.5 `service_role` client leakage 禁止 (Phase 1〜3b と同等)

- `src/lib/works/` 配下に `createAdminClient` / `service_role` grep 0 hit を Phase 4d security audit で確認
- `.next/static/**/*.js` に `service_role` / `SUPABASE_SERVICE_ROLE_KEY` / `raw_user_metadata` grep 0 hit を Phase 4d で確認
- Edge Function を新設する場合 (例: 製造予定 CSV 取込 EF — §5.4) は `supabase/functions/manufacturing-csv-import/index.ts` 内 `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` のみで使用、Bearer 検証 + `app_metadata.tenant_id` 採取は Phase 3b movement-csv-import / inventory-csv-import と同形 (§5.4)

---

## 5. UI / server actions / Edge Function 設計案

### 5.1 ルーティング

```
src/app/app/works/
  page.tsx                                  WORKS 業務トップ (現状の /app/logi/page.tsx と対称)
  manufacturing/
    page.tsx                                製造実績フロー entry
    ManufacturingFlow.tsx                   状態機械 (ReadInstruction→...→Submitted)
  history/
    page.tsx                                WORKS 履歴 (Phase 4 で works 単独タブ / Phase 5 で LOGI と統合)

src/app/app/logi/page.tsx                   既存。"製造" disabled card → /app/works/manufacturing へ enable に切替
```

**注**: 既存 `src/app/app/logi/page.tsx` の disabled "製造" カード (line 47-61) は Phase 4c の最終仕上げで **enable + href を `/app/works/manufacturing` に向ける** が、`src/app/app/logi/` の構造自体は触らない (WORKS は独立ディレクトリ)。

### 5.2 server actions / validators / types

```
src/lib/works/
  actions.ts                                 insertManufacturingRecord(input)
                                             insertManufacturingRecordDefects(parent, defects[])
                                             insertManufacturingPlanFromImport(...) [admin only]
  validators.ts                              zod strict schemas; control-char guard / 64-char item_code /
                                             defect array max 32 / work_minutes >= 0
  types.ts                                   ManufacturingPlan / MfgProcess / ManufacturingRecord /
                                             ManufacturingRecordDefect / WorksBusinessCode
  history.ts                                 fetchManufacturingHistory({tenant, period, worker, limit})
                                             fetchManufacturingRecordById(id, role) — worker view (no raw_value);
                                             admin view via existing v_qr_scan_histories_admin for scan trail
  index.ts                                   re-export
```

すべて Phase 3a/3b `src/lib/logi/` を **テンプレ複写 + 改名**。新規パターンは導入しない。

**ActionResult 型**: `{ data: T | null, error: { code, message } | null }` (Phase 3b と同形、throw しない)。

**insertManufacturingRecord トランザクション境界**: 製造実績 + 不適合 N + (任意で) 製造入庫 movement_records 1 件 = 同一論理操作。**Phase 4b では Supabase RPC (PL/pgSQL 関数 `submit_manufacturing_record`) を 1 つ作って 1 トランザクションで包む** (RLS は引き続き効く、SECURITY INVOKER で書く)。これにより部分書き込み (record 成功 / defect 失敗) を防ぐ。判断根拠は §10 R-P4-05。

### 5.3 UI 実装方針

| Component | 出所 | 改変 |
|---|---|---|
| `<Scanner />` | 既存 `src/components/scanner/Scanner.tsx` | **無改変で再利用**。`onResult` callback の処理側 (ManufacturingFlow.tsx) で受ける |
| `<ResultOverlay />` | 既存 | 無改変。OK / NG / warn の 4-channel パターンそのまま |
| `<StepHeader />` | 既存 | step 数を 3〜6 に増やすため `steps={[...]}` を製造フローに合わせ列挙 |
| `<ManualInputModal />` | 既存 | 無改変 (D-03 手入力 fallback) |
| `<NgFlowToggle />` (DEV プレビュー) | 既存 | Phase 4c では DEV プレビューのまま、Phase 5 で `work_settings` 経由のテナント設定切替に置き換え |
| **新規** `<ManufacturingFlow />` | 新規 | `useReducer` (scanner-state.ts と同方針 pure reducer) で状態機械を表現。`decideCanSubmit` に相当する `decideCanSubmitManufacturing` を実装 |
| **新規** `<DefectListInput />` | 新規 | 不適合 N の add / remove / quantity 入力。56×56 タッチ。仮想スクロールは不要 (実運用 < 20 件想定) |
| **新規** `<ProcessSelector />` | 新規 | mfg_processes 一覧表示 + 帳票明細 QR との照合 |
| **新規** `<ProduceInflowToggle />` | 新規 | 製造入庫を同時記録するかの ON/OFF (デフォルト OFF、UC-4 任意要素) |

**a11y / focus / error states**:
- 4-state 必達 (通常 / 空 / loading / error) を ManufacturingFlow の各 step で実装
- 主要操作 56×56 px (Phase 3b 確立)
- ResultOverlay は 4-channel (icon + text + pattern + color) のまま
- DefectListInput の add ボタンは `aria-controls` で list を指す
- `role="status" aria-live="polite"` を InputResult success 表示に、`assertive` を NG 表示に
- `prefers-reduced-motion` 全停止 (Scanner と同方針)

### 5.4 Edge Function (CSV 取込)

Phase 4 では **製造予定 CSV 取込 EF** を 1 本追加:

```
supabase/functions/manufacturing-plan-csv-import/index.ts
  - Phase 3b movement-csv-import / inventory-csv-import と同 envelope:
    * Content-Type 415 (`text/csv` / `application/vnd.ms-excel` / spreadsheet / octet-stream)
    * 10 MB Content-Length + streaming byte counter 413
    * MAX_ROWS = 100_000, header inclusive
    * MAX_ERRORS = 200 short-circuit
    * Bearer JWT round-trip via anon.auth.getUser() (raw JWT parse 禁止)
    * tenant_id は JWT claims の app_metadata から固定 (CSV payload には含めない)
    * service_role insert で manufacturing_plans + mfg_processes を bulk INSERT
    * errors jsonb に raw cell 値を含めない (`{row, code, message}` のみ)
    * file path traversal: source_storage_path はメタデータのみで file read しない
  - 行構造例: order_no, item_code, planned_quantity, lot, start_date, end_date,
              process_order, process_code, equipment_code
              → manufacturing_plans (1) + mfg_processes (N) を ON CONFLICT 戦略で INSERT
```

**判断**: 製造実績 CSV 取込 EF は **作らない**。製造実績は現場入力起源 (UC-4) であり、CSV 取込は予定取込のみで足りる。

---

## 6. 既存 LOGI (倉庫) との関係整理

### 6.1 共通化と重複回避

| 領域 | LOGI (Phase 3a/3b) | WORKS (Phase 4) | 共通化判断 |
|---|---|---|---|
| Scanner / ResultOverlay / StepHeader / ManualInputModal | `src/components/scanner/` | 同 path 再利用 | **共通化済** (改変なし) |
| QR parser | `src/lib/qr/{parser,delimiter,match,types}.ts` | 同 module 再利用 | **共通化済** |
| zod 共通バリデータ (item_code / control char / matchResult / qrType) | `src/lib/logi/validators.ts` | 同 module から **import + 再利用** | **部分共通化**: Phase 4b で `validators.ts` 内のヘルパー (`itemCodeSchema` / `optionalShortText` / `noControlChars` / `matchDetailSchema`) を `src/lib/validation/shared.ts` に切り出し、`src/lib/logi/validators.ts` と `src/lib/works/validators.ts` の両方が import する形にする (Phase 4b で実施) |
| Server action 標準形 (`{data,error}` / `resolveTenantAndUser`) | `src/lib/logi/actions.ts` | 同形を `src/lib/works/actions.ts` に複写 | **テンプレ複写**。`resolveTenantAndUser` ヘルパーも `src/lib/auth/session.ts` 系に切り出して共有 |
| CSV sanitize / encode / import-client | `src/lib/csv/` | 同 module 再利用 | **共通化済** |
| CSV upload component | `src/components/csv/CsvUploadButton.tsx` | 同 component 再利用 | **共通化済** (受け側 endpoint だけ差し替え) |
| 履歴 UI (`/app/logi/history`) | Phase 3b 既存 | Phase 4c で **business_code filter** を活用して `manufacturing` も同 UI で表示 | **共通化推奨**: 4-業務統合履歴は IMPLEMENTATION_PLAN.md Phase 4 DoD に明記。`src/app/app/logi/history/` を `src/app/app/history/` にリネームするか、`/app/logi/history` を統合 history のままにするかは Phase 4c で UX 判断 |
| RLS 共通ヘルパー (`app.current_tenant_id()` 等) | Phase 1 から既存 | 同関数を policy 内で利用 | **共通化済** |
| `validate_target_tenant()` トリガ | Phase 3a 既存 | allow-list に既に manufacturing 系を含む | **共通化済** |
| `field_definitions` カスタム列 | `custom_text_01..10` 等を全テナント所有テーブルに付与 | 同形を Phase 4 新規 3 テーブルにも追加 | **方針共通化** (DDL は新規) |

### 6.2 引き出し対象の component / module

Phase 4b で以下を切り出す:

1. `src/lib/validation/shared.ts` ← `itemCodeSchema` / `optionalShortText` / `optionalLongText` / `noControlChars` / `matchResultSchema` 等を logi/validators から moved
2. `src/lib/auth/server-tenant.ts` ← `resolveTenantAndUser()` を server actions 用に共有化 (現在 logi/actions.ts に inline)
3. 既存 `src/lib/qr/`, `src/lib/csv/`, `src/components/scanner/`, `src/components/csv/CsvUploadButton.tsx` は **無改変で再利用**

### 6.3 命名 / route の境界

- `/app/logi/*` = LOGI のみ (`receiving` / `picking` / `inventory`)
- `/app/works/*` = WORKS のみ (`manufacturing`)
- `/app/history/*` = 4 業務統合 (Phase 4c で `/app/logi/history` から **rename + move** を検討、または `/app/logi/history` をそのまま統合 history とする — Phase 4c で確定)
- `/app/admin/*` = 設定 / マスタ (Phase 2 既存 + Phase 5 で master CRUD UI 拡張)

---

## 7. 想定 migration 一覧 + 適用順序

### 7.1 ファイル一覧

| # | ファイル名 (案) | 目的 | 依存 |
|---|---|---|---|
| 1 | `20260520000100_phase4_works_masters.sql` | `processes` / `equipment` / `defect_groups` / `defects` + RLS + seed の空テンプレ | Phase 1 (app.* helpers + tenants) |
| 2 | `20260520000200_phase4_manufacturing_plans.sql` | `manufacturing_plans` + `mfg_processes` + RLS + 親 tenant ドリフト trigger `enforce_mfg_process_tenant` | 1 + Phase 3a allow-list (既存) |
| 3 | `20260520000300_phase4_manufacturing_records.sql` | `manufacturing_records` + `manufacturing_record_defects` + RLS + 親 tenant ドリフト trigger `enforce_manufacturing_record_defect_tenant` + index | 2 |
| 4 | `20260520000400_phase4_movement_records_link.sql` | `movement_records.manufacturing_record_id` カラム追加 + index + partial unique (alive) | 3 + Phase 3a movement_records |
| 5 | `20260520000500_phase4_submit_manufacturing_rpc.sql` | `public.submit_manufacturing_record()` PL/pgSQL: record + defects N + 任意で movement_records 1 件を 1 トランザクションで INSERT | 4 |
| 6 | `20260520000600_phase4_rls_tests.sql` | docs/dev 用テスト SQL (RLS-401..408) を `tests/integration/rls/rls-phase4.test.ts` から呼び出す形での README コメント (本体は code 側) | 5 |

### 7.2 適用順序と rollback notes

順序は file 名昇順で固定 (Phase 1〜3b と同方針)。各 migration は **冪等** (`create table if not exists` / `drop policy if exists` / `drop trigger if exists` / `drop constraint if exists`)。

**Rollback 戦略**:
- Phase 4a 4 マスタは 1〜2 行 seed のみ追加なら `delete + drop table` で可逆。production seed を入れない限り rollback 容易
- `manufacturing_records` / `manufacturing_record_defects` は production 投入後の rollback は **不可** (現場入力データ消失)。Supabase PITR (Phase 3 末で有効化済) でカバー
- `movement_records.manufacturing_record_id` 列追加は `alter table ... drop column manufacturing_record_id` で可逆 (production 投入後、紐付け済の行が出るまでは)
- `submit_manufacturing_record()` 関数は `drop function if exists` で可逆

**Forward-only 移行ポリシー**: Phase 1〜3b と同方針 (migration を編集せず、後続 migration で修正)。

### 7.3 Live migration 適用 strategy

Phase 3a/3b で確立した方式をそのまま踏襲:

```
node .kobo/apply-one-T-<TASK_ID>.mjs <filename>
  → POST https://api.supabase.com/v1/projects/{ref}/database/query
     Authorization: Bearer $SUPABASE_ACCESS_TOKEN
     body: { query: <SQL ファイル全文> }
  → 201 Created を順番に確認
  → secret 値 (token / anon / service_role / url) は echo / log しない
```

適用ホスト: kobo home shell から `.env.local` を source した状態の WSL bash。
Sandboxed bash の `VAR=value cmd` 制約は Phase 3a/3b で実証された wrapper (`.kobo/run-live-rls-*.mjs`) で回避済。

Phase 4d で **live RLS regression を 28→36+ tests (RLS-401..408 を含めた)** に拡張、`RUN_LIVE_RLS_TESTS=1 npm run test -- tests/integration/rls/` で実行。

### 7.4 Phase 4 着手前の owner ゲート

- `paid_subscription_signup` 承認 (Supabase Pro + PITR) → Phase 3 末で取得済の前提 (IMPLEMENTATION_PLAN.md L88)。**Phase 4a 着手直前に再確認**
- `production_deploy` 承認 → Phase 4d 完了後の MVP 本番投入で必要
- Auth dashboard rate-limit 値の SECURITY-AUDIT 反映 → Phase 4d で再確認

---

## 8. 想定 test 一覧

### 8.1 単体 / 統合 / E2E / live RLS の分類

| 種別 | テストファイル (案) | カバー対象 | gate |
|---|---|---|---|
| Unit | `tests/unit/works-validators.test.ts` | zod スキーマ (defect 配列 max=32 / 数量 nonneg / 日時整合 / 制御文字拒否) | 常時 |
| Unit | `tests/unit/manufacturing-state.test.ts` | ManufacturingFlow reducer / `decideCanSubmitManufacturing` | 常時 |
| Unit | `tests/unit/csv-manufacturing-export.test.ts` | 4-業務統合履歴 CSV 出力時の formula injection (`=+-@\t\r` prepend) — Phase 3b sanitize.ts の re-exercise | 常時 |
| Unit (re-run) | `tests/unit/csv-formula-injection.test.ts` | 既存 24 ケース。Phase 4 で manufacturing 由来の CSV row が含まれても regression しない | 常時 |
| Integration RLS (live-gated) | `tests/integration/rls/manufacturing-rls.test.ts` | RLS-401..408 (下記 §8.2) | `RUN_LIVE_RLS_TESTS=1` |
| Integration EF (live-gated) | `tests/integration/csv/manufacturing-plan-csv-import.live.test.ts` | Phase 3b movement / inventory と同 envelope (415 / 413 / 100k / formula 起点行) | `RUN_LIVE_EF_TESTS=1` (新規 gate) |
| E2E | `tests/e2e/works-manufacturing.spec.ts` | unauth redirect / authed フル UC-4 フロー / 製造入庫同時記録 / 不適合 N=0 と N>0 の 2 ケース / axe a11y | Playwright `--list` パース + 認証 cookie でフルラン (Phase 3b と同方針) |
| E2E regression | 既存 `tests/e2e/logi-{receiving,picking,inventory}.spec.ts` | Phase 4 で破壊していないことを確認 | 同上 |
| Security audit (read-only) | `docs/SECURITY-AUDIT-<date>-phase4.md` | P0/P1/P2 静的監査 + bundle leakage grep + UNVERIFIED_ITEMS 更新 | Phase 4d 二重監査 |

### 8.2 RLS-401..408 (Phase 4 RLS coverage)

| ID | テーブル / 操作 | 期待 |
|---|---|---|
| RLS-401 | `manufacturing_plans` cross-tenant SELECT | 0 rows |
| RLS-402 | `mfg_processes` worker INSERT (tenant_admin only) | 42501 |
| RLS-403 | `mfg_processes` 親 tenant ドリフト INSERT (parent T1, denormalised T2) | 42501 by `enforce_mfg_process_tenant` |
| RLS-404 | `manufacturing_records` worker INSERT で `worker_id=他ユーザ` | RLS WITH CHECK で reject |
| RLS-405 | `manufacturing_records` 同テナント worker A が B の行を UPDATE | reject (self-only) |
| RLS-406 | `manufacturing_record_defects` 親 tenant ドリフト INSERT | 42501 by enforce trigger |
| RLS-407 | `manufacturing_record_defects` cross-tenant SELECT | 0 rows |
| RLS-408 | `qr_scan_histories` `target_table='manufacturing_records'` で `target_id` が他テナント | 42501 by `validate_target_tenant()` (Phase 3a 既存 trigger の WORKS 経路 live exec) |

### 8.3 A11y regression / a11y 拡張

- 既存 axe ルール (Phase 3b で適用済) を `tests/e2e/works-manufacturing.spec.ts` でも実行
- DefectListInput の動的 row 追加で `aria-controls` / `aria-live` を Playwright で assertion
- 56×56 タッチ violation 0 件を Phase 3b と同方針で audit

### 8.4 Security audit カバレッジ

Phase 4d 二重監査の対象:

1. `service_role` / `SUPABASE_SERVICE_ROLE_KEY` / `raw_value` / `raw_user_metadata` の `.next/static/**/*.js` grep 0 件
2. `console.log/info/debug` の `src/components/works/**` / `src/lib/works/**` / `supabase/functions/manufacturing-plan-csv-import/**` 0 件
3. `submit_manufacturing_record` RPC が SECURITY INVOKER で書かれており RLS bypass しないことを静的確認
4. `enforce_mfg_process_tenant` / `enforce_manufacturing_record_defect_tenant` の `search_path=''` 確認、`format('%I')` injection-safe 確認
5. Phase 3a/3b の Phase 3b P2 carryovers (storage-roundtrip drift / soft-delete trigger / iconv-lite direct dep — 後者は orchestrator 修正済) の WORKS 経由 regression なしを確認
6. 製造予定 CSV 取込 EF (新規) の Phase 3b envelope (415/413/100k/200-error short-circuit/Bearer round-trip/JWT tenant pin) を静的確認 + live test 1 round

---

## 9. Phase 4 全体 budget 試算と dispatch 分割

`docs/IMPLEMENTATION_PLAN.md` Phase 4 行: **14 日 / 160 turn / 二重監査必須**。本 doc では Phase 4 を **4 dispatch** に分割。

### 9.1 dispatch 一覧

| dispatch | scope | DoD | 推定 turn | 推定壁時計 | 必須 role |
|---|---|---|---|---:|---|
| **4a foundation** | masters (4) + manufacturing_plans / mfg_processes / manufacturing_records / manufacturing_record_defects DDL + RLS + 親 tenant ドリフト trigger 2 本 + `movement_records.manufacturing_record_id` 追加 + `submit_manufacturing_record()` RPC | 6 migration 作成 + live 適用 (HTTP 201) + RLS-401..408 静的 SQL を README に書く (live exec は 4d) | **40** | 1.5 〜 2.5 h | architect (本 doc) → backend (migration writer + live apply) |
| **4b backend actions** | `src/lib/works/{actions,validators,types,history}.ts` + `src/lib/validation/shared.ts` 切り出し + `src/lib/auth/server-tenant.ts` 切り出し + `tests/unit/works-validators.test.ts` + `tests/unit/manufacturing-state.test.ts` + 製造予定 CSV 取込 EF (`supabase/functions/manufacturing-plan-csv-import/index.ts`) | unit test pass / lint / typecheck / `src/lib/works/**` で `service_role` grep 0 / EF static envelope review pass | **40** | 1.5 〜 2.5 h | backend (主) + reviewer (差分監査) |
| **4c UI + E2E** | `src/app/app/works/manufacturing/{page,ManufacturingFlow}.tsx` + `<DefectListInput />` / `<ProcessSelector />` / `<ProduceInflowToggle />` + `/app/logi/page.tsx` 製造カード enable + 4-業務統合履歴 拡張 (`business_code='manufacturing'` filter) + `tests/e2e/works-manufacturing.spec.ts` (3〜4 ケース) + design-library 追記 (purple `--func-manufact` の wiring 状況) | E2E 構造解析 pass / axe 違反 0 / Scanner regression なし / 56×56 audit pass / Phase 3b LOGI E2E regression なし | **50** | 2 〜 3 h | frontend + designer (並列、Phase F-3 dogfood) + reviewer |
| **4d polish + 二重監査 + production deploy** | RLS-401..408 live exec / EF live envelope test / MVP 1 顧客 seed / Supabase PITR 有効化確認 / production_deploy 承認後 deploy / `docs/SECURITY-AUDIT-<date>-phase4.md` 二重監査 / `docs/RUNBOOK.md` 作成 / `docs/SECURITY-AUDIT-2026-05-12-phase3b.md` の Phase 4 carryover (csv_import_jobs live RLS 等) を一気に closure | live RLS 36/36 pass / security-auditor pass (P0=0, P1=0) / RUNBOOK.md 存在 / PITR 有効 / production_deploy ログ取得 / PRODUCT_SPEC §6 AC 全 pass | **30** | 1.5 〜 2 h | security-auditor (二重監査) + backend (live apply) + ops (RUNBOOK) |
| **合計** | — | — | **160** | **6.5 〜 10 h 実時間** (並列で短縮可) | architect + backend + frontend + designer + reviewer + security-auditor + ops |

### 9.2 並列化想定 (Phase F-3 dogfood 継続)

- 4b と 4c の **frontend / backend / designer** を Phase 3b と同様に **真並列** 投入 (3 agent 同時実行) で実時間 ~50% 短縮可
- 4d は **二重監査 (independent security-auditor)** + **backend (live apply)** + **ops (RUNBOOK 起草)** を並列。security-auditor の Read-only static review は他 2 と disjoint

### 9.3 risk / contingency

- Phase 3 で 21 日かかった (Phase 3a/3b 分割) ので、Phase 4 も 4a/4b/4c/4d 4 分割で 14 日に収める前提
- live exec (RLS / EF) で env 制約に当たれば Phase 3b と同じ `.kobo/run-live-rls-*.mjs` wrapper で escalate
- production_deploy 承認が Phase 4d 直前に来ない場合は 4d を 4d-1 (二重監査) と 4d-2 (deploy) に再分割

---

## 10. 既知 risk と回避策

| ID | risk | 影響 | 回避策 |
|---|---|---|---|
| **R-P4-01** | `mfg_processes.tenant_id` denormalisation drift (親 manufacturing_plans.tenant_id とずれる) | 隣接テナントへの行漏れ | `enforce_mfg_process_tenant()` BEFORE INSERT/UPDATE OF (manufacturing_plan_id, tenant_id) trigger (§4.4)、live RLS-403 で実証 |
| **R-P4-02** | `manufacturing_record_defects.tenant_id` 同上 | 同上 | `enforce_manufacturing_record_defect_tenant()` 同パターン trigger、live RLS-406 で実証 |
| **R-P4-03** | `qr_scan_histories.target_id` に他テナントの manufacturing_records id | クロステナント参照、forensic value 喪失 | Phase 3a `validate_target_tenant()` allow-list に既に含まれている → migration 改変不要、RLS-408 live で検証 |
| **R-P4-04** | 製造入庫の二重記録 (`manufacturing_record_id` が同じ movement_records が複数) | 在庫数 inflate | partial unique index (`where manufacturing_record_id is not null and deleted_at is null`) を Phase 4a/4c で導入 (§3.5)。訂正履歴 (previous_record_id) との両立に注意 |
| **R-P4-05** | 製造実績 INSERT と不適合 N INSERT の部分書き込み (record 成功 / defect 失敗で不整合) | データ不整合、訂正コスト増 | `submit_manufacturing_record()` PL/pgSQL RPC で 1 transaction (§5.2)。SECURITY INVOKER で RLS bypass なし |
| **R-P4-06** | offline / 一時断線時の重複 submit (Phase 8 で本格対応するが、Phase 4 でも risk) | 同じ作業を 2 回登録 | client-side idempotency token (例: `client_submission_id` UUID を入力時に発行し、`manufacturing_records` に UNIQUE index) を Phase 4b で検討。詳細設計は Phase 4b で再判断 |
| **R-P4-07** | QR spoofing / malformed scan (悪意ある QR ペイロード) | parser 例外、誤データ | 既存 `src/lib/qr/parser.ts` の length / control-char / version guard で受ける。Phase 4 で新規 attack surface は qr_scan_histories `business_code='manufacturing'` だけ → SECURITY-AUDIT phase4 で 1 セクション割く |
| **R-P4-08** | raw_value (製造ラベル QR) の worker 露出 | サプライヤ機密漏洩 | Phase 3a column-grant + dual view で既に column-level 保護。WORKS 系 history UI も `v_qr_scan_histories` (worker) / `v_qr_scan_histories_admin` (admin) を分けて呼ぶ |
| **R-P4-09** | CSV 取込 EF (`manufacturing-plan-csv-import`) の formula injection / size DoS / path traversal | EF crash, 攻撃者経路 | Phase 3b movement / inventory EF と同 envelope (sanitize.ts / 10 MB cap / 100k 行 / 200-error short-circuit / Bearer round-trip)。新規 attack 経路は出さない |
| **R-P4-10** | service_role の bundle 漏洩 (新規 server actions / EF を増やすため) | tenant 境界の全壊 | Phase 3b と同 grep を Phase 4d security audit で全部実行 (§4.5)。`src/lib/works/**` / `src/components/works/**` を追加スコープに |
| **R-P4-11** | 多階層 access (factory / line) の YAGNI 違反による設計過剰 | 工数浪費、RLS 再帰 risk | §4.3 で明示的に **採用しない**。将来必要なら拡張余地を残す |
| **R-P4-12** | a11y regression (DefectListInput の動的 row 追加が axe 違反) | WCAG 2.2 AA 不達 | Phase 4c E2E axe + manual focus order audit。`aria-live` / `aria-controls` を初期実装から含める |
| **R-P4-13** | 業務 4 つ統合履歴 UI の情報過多 (`business_code` filter UX が悪い) | 履歴閲覧の learnability 低下 | Phase 4c で `business_code` chip filter (4 業務色アクセント) を採用。Phase 3b UX polish 4 軸スコアを 4/5 維持 |
| **R-P4-14** | Phase 4 完了時の PITR / production_deploy 承認の遅延 | MVP リリース 遅延 | Phase 4a 着手前に owner 再確認 (§7.4)。承認遅延時は 4d を 4d-1 / 4d-2 に再分割 (§9.3) |
| **R-P4-15** | `manufacturing_record_defects` の N が極端に大きい現場 (50+ 件) で UI が劣化 | a11y / perf | DefectListInput は仮想スクロール **採用しない** (Phase 3b の inventory step verticality と同様、N=20 までを想定)。Phase 5 で必要なら revisit |
| **R-P4-16** | `submit_manufacturing_record()` RPC で SECURITY INVOKER が誤って SECURITY DEFINER に書かれる | RLS bypass、tenant 境界全壊 | Phase 4d security-auditor が RPC 定義 SQL を静的レビューで confirm。`security invoker` を明示記述、PR review で grep |
| **R-P4-17** | 製造実績 訂正フロー (`previous_record_id`) と製造入庫の整合 (訂正で在庫が二重に動く) | 在庫数の不整合 | Phase 4 訂正フローは READ のみ (Phase 5 で write)。Phase 4c で「訂正前 ID」表示は実装、訂正書き込み UI は Phase 5 |
| **R-P4-18** | Phase 4 で `business_code='manufacturing'` の `qr_scan_histories` が急増し index 効かない | 履歴ページ slow | 既存 `qr_scan_histories_tenant_business_created_idx` が `(tenant_id, business_code, created_at desc)` を覆っているため OK。Phase 9 で partition 検討 |
| **R-P4-19** | Phase 4 完了後の MVP 1 顧客 seed が本番データと混在 | 本番運用前のテストデータ汚染 | seed は `tenants.slug='demo-mfg'` 等の固定 slug で隔離。Phase 4d RUNBOOK に seed 削除手順を明記 |
| **R-P4-20** | spec の `manufacturing_plan_processes` 命名と本 doc の `mfg_processes` 命名差で開発者が混乱 | 実装ミス、PR review 摩擦 | §3.6 ADR-P4-01 を本 doc + Phase 4a migration 冒頭コメント + `src/lib/works/types.ts` の docstring で 3 箇所に明記 |

---

## 付録 A: Phase 4 と Phase 5 / Phase 6 / Phase 8 の境界 (再確認)

| 機能 | Phase 4 で扱うか | 扱わない場合の所属 |
|---|---|---|
| 製造実績マスタ (processes / equipment / defects / defect_groups) の CRUD UI | **READ + 初期 seed のみ** (Phase 4 で migration + 空テンプレ) | Phase 5 master CRUD UI |
| 訂正 UI (WRITE) | **しない** | Phase 5 訂正 UI |
| 個人設定 | **しない** | Phase 5 |
| テナント管理画面 | **しない** | Phase 6 |
| 月間スキャン上限 | **しない** | Phase 6 |
| 監査ログ画面 / コード照合 | **しない** | Phase 7 |
| オフライン (PWA + IDB) | **しない** | Phase 8 |
| 多言語 / GEN 連携 | **しない** | Phase 10 |

---

## 付録 B: 採用しないが議論された選択肢

| 案 | 不採用根拠 |
|---|---|
| `manufacturing_plan_processes` (spec 原文) を採用 | allow-list 改名コスト + Phase 3a/3b live 28/28 PASS への regression risk (§3.6 ADR-P4-01) |
| 独立 `quality_records` テーブル | spec § WORKS に未定義、`manufacturing_record_defects` で代替可能 (§2.3 / §3.4) |
| factory / line スコープの多階層 RLS | spec に概念なし、再帰 policy risk (§4.3) |
| 製造実績 CSV 取込 EF | 製造実績は現場入力起源、CSV 取込は予定のみで足りる (§5.4) |
| `mfg_processes` 親 tenant ドリフト trigger を `enforce_plan_line_tenant()` に統合 | TG_TABLE_NAME 分岐先が増えると allow-list / search_path 安全性のレビュー surface が大きくなる。専用 trigger 2 本のほうが Phase 4d security audit がしやすい (§4.4) |
| 製造実績テーブルを Phase 3a に soft-merge (`business_code='manufacturing'` を movement_records に追加) | spec § WORKS § 基本方針で「製造実績は別テーブル」と明示、started_at/ended_at 等 LOGI にない列が多い (§3.4) |

---

## 付録 C: 既存 architecture doc への follow-up 提案 (本 dispatch では `docs/ARCHITECTURE.md` を編集しない)

Phase 4a 着手前または着手と同じ dispatch で、以下を Phase 4 architect 続編として **owner 承認の上** docs/ARCHITECTURE.md に追記する候補:

1. §2 ER 図に `manufacturing_record_defects` を明示追加 (現状 MFG_RECORDS までしか書かれていない)
2. §4 RLS テンプレに **製造実績の self-only UPDATE + worker_id pin** を一行追加 (Phase 3a と同形で既に踏襲しているため事実上の重複明文化)
3. §5 リスクに R-P4-04 (製造入庫二重記録 UNIQUE) を 1 行で参照
4. §3 状態遷移は既存記載で十分 — 追加なし

これらは本 dispatch スコープ外 (`docs/ARCHITECTURE.md` 編集禁止) のため、本 doc では提案のみ。

---

## 終わりに

Phase 4 は Phase 3a/3b が用意した RLS テンプレ / SECURITY DEFINER pattern / raw_value 保護 / polymorphic FK trigger / Scanner / CSV pipeline を **そのまま土台に乗る** ため、設計面の新規 risk surface は §10 に列挙した 20 項目 (主に WORKS 固有の denormalisation drift / 製造入庫二重記録 / RPC SECURITY INVOKER) に集約される。Phase 3a allow-list が `manufacturing_records` / `manufacturing_plans` / `mfg_processes` を **既に hard-code 済** という事実は Phase 4 命名を実質的に確定させ、migration 増分とテスト regression surface を最小化する。

Phase 4 全体を 4 dispatch (4a foundation / 4b backend actions / 4c UI+E2E / 4d polish + 二重監査 + production deploy) に分割した 160 turn 予算は、`docs/IMPLEMENTATION_PLAN.md` の Phase 4 行と整合し、Phase F-3 dogfood の真並列投入 (frontend × backend × designer 3 並列) で 4b/4c の実時間を約 50% 短縮できる前提に立つ。

architect 完了、owner 確認後に Phase 4a (migration foundation) dispatch を director が起案予定。
