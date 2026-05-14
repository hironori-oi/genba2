-- =====================================================================
-- GENBA — demo tenant seed (for mobile / manual walkthrough testing)
-- =====================================================================
-- 目的: Phase 5/6 の admin tab / scan-first / correction / reports を
-- "空のテーブル" ではなく実データで動作確認できるようにする最小 seed。
--
-- 対象テナント: 11d4774b-cba2-4d7a-9c98-0eeab4334161
--   (Phase 5e-2 で発行された synthetic test tenant、worker.user.json 参照)
--
-- 適用方法:
--   1. Supabase Dashboard → SQL Editor を開く
--   2. このファイル全体をコピペ → Run
--   3. 末尾の VERIFY block で各 master が想定行数になっているか確認
--
-- 安全性:
--   - 全 INSERT は ON CONFLICT DO NOTHING (idempotent、繰り返し実行 OK)
--   - tenant_id を hard-code して synthetic tenant 限定 (他テナントに影響なし)
--   - service_role 想定 (RLS bypass)、authenticated でも tenant_admin なら OK
--
-- 削除:
--   - tenant 自体を Auth → Users で削除すると ON DELETE CASCADE で全部消える
--   - 個別行削除は `delete from <table> where tenant_id = '11d4774b-...'`
-- =====================================================================

-- テナント存在チェック (削除済なら以降の INSERT が FK 違反で失敗するので早期に気付ける)
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.tenants
   where id = '11d4774b-cba2-4d7a-9c98-0eeab4334161';
  if v_count = 0 then
    raise exception 'Target tenant 11d4774b-... does not exist. Synthetic user may have been cleaned up by afterAll. Create a new tenant + tenant_admin user via Auth Dashboard first.';
  end if;
  raise notice 'Target tenant exists, proceeding with seed.';
end $$;

-- =====================================================================
-- 1. work_types — 4 業務 (receiving / picking / inventory / manufacturing)
-- =====================================================================
insert into public.work_types (tenant_id, code, name, business_code, sort_order)
values
  ('11d4774b-cba2-4d7a-9c98-0eeab4334161', 'WT-RCV', '受入', 'receiving', 10),
  ('11d4774b-cba2-4d7a-9c98-0eeab4334161', 'WT-PCK', 'ピッキング', 'picking', 20),
  ('11d4774b-cba2-4d7a-9c98-0eeab4334161', 'WT-INV', '棚卸', 'inventory', 30),
  ('11d4774b-cba2-4d7a-9c98-0eeab4334161', 'WT-MFG', '製造', 'manufacturing', 40)
on conflict (tenant_id, code) do nothing;

-- =====================================================================
-- 2. processes — 工程マスタ
-- =====================================================================
insert into public.processes (tenant_id, code, name, sort_order)
values
  ('11d4774b-cba2-4d7a-9c98-0eeab4334161', 'PROC-001', '前工程', 10),
  ('11d4774b-cba2-4d7a-9c98-0eeab4334161', 'PROC-002', '主工程', 20),
  ('11d4774b-cba2-4d7a-9c98-0eeab4334161', 'PROC-003', '検査', 30),
  ('11d4774b-cba2-4d7a-9c98-0eeab4334161', 'PROC-004', '包装', 40)
on conflict (tenant_id, code) do nothing;

-- =====================================================================
-- 3. equipment — 設備マスタ (process_id は LEFT JOIN で動的解決)
-- =====================================================================
with proc as (
  select id, code from public.processes
   where tenant_id = '11d4774b-cba2-4d7a-9c98-0eeab4334161'
)
insert into public.equipment (tenant_id, code, name, process_id, sort_order)
select
  '11d4774b-cba2-4d7a-9c98-0eeab4334161',
  v.code,
  v.name,
  proc.id,
  v.sort_order
from (values
  ('EQ-001', '加工機 A', 'PROC-002', 10),
  ('EQ-002', '加工機 B', 'PROC-002', 20),
  ('EQ-003', '検査機 1', 'PROC-003', 30),
  ('EQ-004', '梱包機 X', 'PROC-004', 40)
) v(code, name, proc_code, sort_order)
left join proc on proc.code = v.proc_code
on conflict (tenant_id, code) do nothing;

-- =====================================================================
-- 4. defect_groups — 不適合グループ
-- =====================================================================
insert into public.defect_groups (tenant_id, code, name, sort_order)
values
  ('11d4774b-cba2-4d7a-9c98-0eeab4334161', 'DG-APP', '外観不良', 10),
  ('11d4774b-cba2-4d7a-9c98-0eeab4334161', 'DG-INT', '内部不良', 20)
on conflict (tenant_id, code) do nothing;

-- =====================================================================
-- 5. defects — 不適合 (defect_group_id は LEFT JOIN で解決)
-- =====================================================================
with dg as (
  select id, code from public.defect_groups
   where tenant_id = '11d4774b-cba2-4d7a-9c98-0eeab4334161'
)
insert into public.defects (tenant_id, code, name, defect_group_id, severity, sort_order)
select
  '11d4774b-cba2-4d7a-9c98-0eeab4334161',
  v.code,
  v.name,
  dg.id,
  v.severity,
  v.sort_order
from (values
  ('DEF-SCR', 'キズ', 'DG-APP', 'minor', 10),
  ('DEF-DRT', '汚れ', 'DG-APP', 'minor', 20),
  ('DEF-CRK', '割れ', 'DG-INT', 'major', 30),
  ('DEF-CRT', '寸法外', 'DG-INT', 'critical', 40)
) v(code, name, dg_code, severity, sort_order)
left join dg on dg.code = v.dg_code
on conflict (tenant_id, code) do nothing;

-- =====================================================================
-- 6. qr_format_definitions — Phase 6b scan-first テスト用 2 format
-- =====================================================================
-- format A: header type、4 フィールド (test-qr-mobile.html の QR-1 が match)
insert into public.qr_format_definitions
  (tenant_id, qr_type, format_code, format_name, version, delimiter, encoding, readable, issuable, description)
values
  ('11d4774b-cba2-4d7a-9c98-0eeab4334161', 'header', 'DEMO-HEADER', 'デモ用標準ヘッダ', 1, 'pipe', 'utf8', true, true, 'demo: item|lot|qty|date')
on conflict (tenant_id, qr_type, version) do nothing;

-- format B: line type、2 フィールド (test-qr-mobile.html の QR-5 短ID match 想定)
insert into public.qr_format_definitions
  (tenant_id, qr_type, format_code, format_name, version, delimiter, encoding, readable, issuable, description)
values
  ('11d4774b-cba2-4d7a-9c98-0eeab4334161', 'line', 'DEMO-LINE', 'デモ用ラインQR', 1, 'pipe', 'utf8', true, true, 'demo: plan_id pattern')
on conflict (tenant_id, qr_type, version) do nothing;

-- =====================================================================
-- 7. qr_item_definitions — header 4 position + line 1 position
-- =====================================================================
-- header A (DEMO-HEADER v1): item_code | lot_no | qty | mfg_date
with hdr as (
  select id from public.qr_format_definitions
   where tenant_id = '11d4774b-cba2-4d7a-9c98-0eeab4334161'
     and qr_type = 'header' and version = 1
)
insert into public.qr_item_definitions
  (qr_format_definition_id, position, qr_item_name, target_column, required, data_type, description)
select hdr.id, v.position, v.item_name, v.target_column, v.required, v.data_type, v.descr
from hdr, (values
  (1, 'item_code', 'item_code', true,  'text',    'P1=品番'),
  (2, 'lot_no',    'lot_no',    true,  'text',    'P2=ロット'),
  (3, 'qty',       'qty',       true,  'numeric', 'P3=数量'),
  (4, 'mfg_date',  'mfg_date',  false, 'date',    'P4=製造日 (任意)')
) v(position, item_name, target_column, required, data_type, descr)
on conflict (qr_format_definition_id, position) do nothing;

-- line B (DEMO-LINE v1): plan_id
with ln as (
  select id from public.qr_format_definitions
   where tenant_id = '11d4774b-cba2-4d7a-9c98-0eeab4334161'
     and qr_type = 'line' and version = 1
)
insert into public.qr_item_definitions
  (qr_format_definition_id, position, qr_item_name, target_column, required, data_type, description)
select ln.id, 1, 'plan_id', 'plan_id', true, 'text', 'movement plan の参照 ID'
from ln
on conflict (qr_format_definition_id, position) do nothing;

-- =====================================================================
-- 8. work_settings — 4 業務に minimum config (NULL FK 容認)
-- =====================================================================
-- schema 確認は admin/work-settings 画面で。ここでは基本 mode のみ。
-- check constraint (Phase 2 migration 由来):
--   work_mode: 'ticket' / 'free'
--   match_mode: 'double' / 'none'
--   ng_flow: 'block' / 'warn' / 'approve'
insert into public.work_settings (tenant_id, business_code, work_mode, match_mode, ng_flow, correction_approval)
values
  ('11d4774b-cba2-4d7a-9c98-0eeab4334161', 'receiving',    'ticket', 'double', 'warn', false),
  ('11d4774b-cba2-4d7a-9c98-0eeab4334161', 'picking',      'ticket', 'double', 'warn', false),
  ('11d4774b-cba2-4d7a-9c98-0eeab4334161', 'inventory',    'free',   'none',   'warn', false),
  ('11d4774b-cba2-4d7a-9c98-0eeab4334161', 'manufacturing','ticket', 'double', 'approve', true)
on conflict (tenant_id, business_code) do nothing;

-- =====================================================================
-- VERIFY: 想定行数 (work_types 4 / processes 4 / equipment 4 / defect_groups 2 / defects 4 / qr_formats 2 / qr_items 5 / work_settings 4)
-- =====================================================================
select 'work_types'             as table_name, count(*) as rows from public.work_types             where tenant_id = '11d4774b-cba2-4d7a-9c98-0eeab4334161'
union all select 'processes',        count(*) from public.processes        where tenant_id = '11d4774b-cba2-4d7a-9c98-0eeab4334161'
union all select 'equipment',        count(*) from public.equipment        where tenant_id = '11d4774b-cba2-4d7a-9c98-0eeab4334161'
union all select 'defect_groups',    count(*) from public.defect_groups    where tenant_id = '11d4774b-cba2-4d7a-9c98-0eeab4334161'
union all select 'defects',          count(*) from public.defects          where tenant_id = '11d4774b-cba2-4d7a-9c98-0eeab4334161'
union all select 'qr_format_definitions', count(*) from public.qr_format_definitions where tenant_id = '11d4774b-cba2-4d7a-9c98-0eeab4334161'
union all select 'qr_item_definitions', count(*) from public.qr_item_definitions qid
  join public.qr_format_definitions qfd on qfd.id = qid.qr_format_definition_id
  where qfd.tenant_id = '11d4774b-cba2-4d7a-9c98-0eeab4334161'
union all select 'work_settings',    count(*) from public.work_settings    where tenant_id = '11d4774b-cba2-4d7a-9c98-0eeab4334161'
order by 1;
