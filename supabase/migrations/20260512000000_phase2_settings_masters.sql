-- =====================================================================
-- GENBA Phase 2: settings + masters + QR definitions
-- =====================================================================
-- Source of truth for the Phase 2 schema. Adds the configuration and
-- master tables that Phase 3 (LOGI business screens) will depend on.
--
-- Decisions reflected (2026-05-11 owner Phase 2 kickoff):
--   * 設定系: qr_format_definitions, qr_item_definitions, match_rules,
--     match_rule_lines, csv_import_definitions, csv_export_definitions,
--     work_settings, work_input_field_settings, standard_field_definitions,
--     tenant_field_settings, custom_field_definitions
--   * マスタ系: work_types, processes, equipment, defect_groups, defects
--   * Every tenant-owned table carries created_by / updated_by / deleted_at
--     and ENABLEs row level security with policies that read JWT claims via
--     the app.* helpers from the Phase 1 migration.
--   * QR_SPEC §7 — raw_value SELECT will be gated to tenant_admin in Phase 3
--     when qr_scan_histories ships. Phase 2 schema only defines the *templates*
--     (qr_format_definitions / qr_item_definitions); no raw_value column here.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. standard_field_definitions (system-wide field catalog, no RLS)
--    Read by all tenants; modifications restricted to system_admin.
-- ---------------------------------------------------------------------
create table if not exists public.standard_field_definitions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  data_type text not null check (data_type in ('text', 'numeric', 'date', 'boolean')),
  category text not null check (category in ('header', 'line', 'label', 'movement', 'inventory', 'manufacturing')),
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.standard_field_definitions enable row level security;

create policy standard_fields_select_all
on public.standard_field_definitions for select to authenticated
using (true);

create policy standard_fields_modify_system_admin
on public.standard_field_definitions for all to authenticated
using (app.is_system_admin())
with check (app.is_system_admin());

-- Seed common standard fields used across all 4 businesses.
insert into public.standard_field_definitions (code, label, data_type, category, sort_order)
values
  ('item_code', '品目コード', 'text', 'label', 10),
  ('quantity', '数量', 'numeric', 'label', 20),
  ('lot', 'ロット', 'text', 'label', 30),
  ('location_code', 'ロケーション', 'text', 'label', 40),
  ('order_no', '注文番号', 'text', 'header', 50),
  ('customer_code', '顧客コード', 'text', 'header', 60),
  ('shipment_no', '出荷番号', 'text', 'header', 70),
  ('ship_date', '出荷日', 'date', 'header', 80),
  ('line_no', '明細番号', 'numeric', 'line', 90),
  ('process_code', '工程コード', 'text', 'manufacturing', 100),
  ('equipment_code', '設備コード', 'text', 'manufacturing', 110),
  ('defect_code', '不適合コード', 'text', 'manufacturing', 120)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 2. tenant_field_settings (per-tenant on/off + purpose for std fields)
--    Phase 2 DoD: "利用 ON/OFF + 5 用途".
--    purpose ∈ {identify_header, identify_line, match_source, item_label, display_only}
-- ---------------------------------------------------------------------
create table if not exists public.tenant_field_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  field_code text not null references public.standard_field_definitions(code) on update cascade,
  enabled boolean not null default true,
  purpose text not null default 'display_only'
    check (purpose in ('identify_header', 'identify_line', 'match_source', 'item_label', 'display_only')),
  display_label text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id, field_code)
);

create index if not exists tenant_field_settings_tenant_idx
  on public.tenant_field_settings (tenant_id);

alter table public.tenant_field_settings enable row level security;

create policy tenant_field_settings_select_same_tenant
on public.tenant_field_settings for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

create policy tenant_field_settings_modify_tenant_admin
on public.tenant_field_settings for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- ---------------------------------------------------------------------
-- 3. custom_field_definitions (per-tenant custom_text_01..10 etc)
-- ---------------------------------------------------------------------
create table if not exists public.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  column_name text not null check (
    column_name ~ '^custom_(text_(0[1-9]|10)|number_0[1-5]|date_0[1-5])$'
  ),
  label text not null,
  data_type text not null check (data_type in ('text', 'numeric', 'date')),
  description text,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id, column_name)
);

create index if not exists custom_field_definitions_tenant_idx
  on public.custom_field_definitions (tenant_id);

alter table public.custom_field_definitions enable row level security;

create policy custom_field_definitions_select_same_tenant
on public.custom_field_definitions for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

create policy custom_field_definitions_modify_tenant_admin
on public.custom_field_definitions for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- ---------------------------------------------------------------------
-- 4. qr_format_definitions (per-tenant, per-type, versioned)
--    UNIQUE: (tenant_id, qr_type, version)
-- ---------------------------------------------------------------------
create table if not exists public.qr_format_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  qr_type text not null check (qr_type in ('header', 'line', 'label')),
  format_code text not null,
  format_name text not null,
  version integer not null check (version >= 1),
  delimiter text not null default 'pipe' check (delimiter in ('comma', 'tab', 'pipe', 'other')),
  delimiter_char text,
  encoding text not null default 'utf8' check (encoding in ('utf8', 'shift_jis')),
  readable boolean not null default true,
  issuable boolean not null default true,
  valid_from date not null default current_date,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id, qr_type, version)
);

create index if not exists qr_format_definitions_tenant_type_idx
  on public.qr_format_definitions (tenant_id, qr_type);

alter table public.qr_format_definitions enable row level security;

create policy qr_format_select_same_tenant
on public.qr_format_definitions for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

create policy qr_format_modify_tenant_admin
on public.qr_format_definitions for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- ---------------------------------------------------------------------
-- 5. qr_item_definitions (position-indexed parsing rules)
--    Position changes require a *new format version* (QR_SPEC §3, §5).
-- ---------------------------------------------------------------------
create table if not exists public.qr_item_definitions (
  id uuid primary key default gen_random_uuid(),
  qr_format_definition_id uuid not null references public.qr_format_definitions(id) on delete cascade,
  position integer not null check (position >= 1),
  qr_item_name text not null,
  target_column text not null,
  required boolean not null default false,
  data_type text not null check (data_type in ('text', 'numeric', 'date')),
  date_format text,
  missing_value_action text not null default 'allow_blank'
    check (missing_value_action in ('error', 'allow_blank')),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (qr_format_definition_id, position)
);

create index if not exists qr_item_definitions_format_idx
  on public.qr_item_definitions (qr_format_definition_id);

alter table public.qr_item_definitions enable row level security;

-- qr_item_definitions inherits tenancy from its parent format via lookup.
-- We embed the tenant predicate by joining to qr_format_definitions.
create policy qr_item_select_same_tenant
on public.qr_item_definitions for select to authenticated
using (
  exists (
    select 1 from public.qr_format_definitions f
    where f.id = qr_item_definitions.qr_format_definition_id
      and (f.tenant_id = app.current_tenant_id() or app.is_system_admin())
  )
);

create policy qr_item_modify_tenant_admin
on public.qr_item_definitions for all to authenticated
using (
  exists (
    select 1 from public.qr_format_definitions f
    where f.id = qr_item_definitions.qr_format_definition_id
      and (
        (f.tenant_id = app.current_tenant_id() and app.is_tenant_admin())
        or app.is_system_admin()
      )
  )
)
with check (
  exists (
    select 1 from public.qr_format_definitions f
    where f.id = qr_item_definitions.qr_format_definition_id
      and (
        (f.tenant_id = app.current_tenant_id() and app.is_tenant_admin())
        or app.is_system_admin()
      )
  )
);

-- ---------------------------------------------------------------------
-- 6. match_rules + match_rule_lines (2-point matching config)
-- ---------------------------------------------------------------------
create table if not exists public.match_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  business_code text not null check (business_code in ('receiving', 'picking', 'inventory', 'manufacturing')),
  rule_code text not null,
  rule_name text not null,
  description text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id, business_code, rule_code)
);

create index if not exists match_rules_tenant_idx
  on public.match_rules (tenant_id);

alter table public.match_rules enable row level security;

create policy match_rules_select_same_tenant
on public.match_rules for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

create policy match_rules_modify_tenant_admin
on public.match_rules for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

create table if not exists public.match_rule_lines (
  id uuid primary key default gen_random_uuid(),
  match_rule_id uuid not null references public.match_rules(id) on delete cascade,
  sort_order integer not null default 0,
  line_field_code text not null,
  label_field_code text not null,
  compare_type text not null default 'equals'
    check (compare_type in ('equals', 'numeric_equals')),
  missing_value_action text not null default 'ng'
    check (missing_value_action in ('ng', 'warning', 'skip')),
  mismatch_action text not null default 'ng'
    check (mismatch_action in ('ng', 'warning')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz
);

create index if not exists match_rule_lines_rule_idx
  on public.match_rule_lines (match_rule_id);

alter table public.match_rule_lines enable row level security;

create policy match_rule_lines_select_same_tenant
on public.match_rule_lines for select to authenticated
using (
  exists (
    select 1 from public.match_rules r
    where r.id = match_rule_lines.match_rule_id
      and (r.tenant_id = app.current_tenant_id() or app.is_system_admin())
  )
);

create policy match_rule_lines_modify_tenant_admin
on public.match_rule_lines for all to authenticated
using (
  exists (
    select 1 from public.match_rules r
    where r.id = match_rule_lines.match_rule_id
      and (
        (r.tenant_id = app.current_tenant_id() and app.is_tenant_admin())
        or app.is_system_admin()
      )
  )
)
with check (
  exists (
    select 1 from public.match_rules r
    where r.id = match_rule_lines.match_rule_id
      and (
        (r.tenant_id = app.current_tenant_id() and app.is_tenant_admin())
        or app.is_system_admin()
      )
  )
);

-- ---------------------------------------------------------------------
-- 7. csv_import_definitions / csv_export_definitions (per-business)
-- ---------------------------------------------------------------------
create table if not exists public.csv_import_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  business_code text not null check (business_code in ('receiving', 'picking', 'inventory', 'manufacturing')),
  target_table text not null,
  definition_code text not null,
  definition_name text not null,
  encoding text not null default 'utf8' check (encoding in ('utf8', 'shift_jis')),
  delimiter text not null default 'comma' check (delimiter in ('comma', 'tab', 'pipe')),
  start_row integer not null default 1 check (start_row >= 1),
  duplicate_action text not null default 'error'
    check (duplicate_action in ('skip', 'update', 'error')),
  column_mapping jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id, definition_code)
);

alter table public.csv_import_definitions enable row level security;

create policy csv_import_select_same_tenant
on public.csv_import_definitions for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

create policy csv_import_modify_tenant_admin
on public.csv_import_definitions for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

create table if not exists public.csv_export_definitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  business_code text not null check (business_code in ('receiving', 'picking', 'inventory', 'manufacturing')),
  source_table text not null,
  definition_code text not null,
  definition_name text not null,
  encoding text not null default 'utf8' check (encoding in ('utf8', 'shift_jis')),
  delimiter text not null default 'comma' check (delimiter in ('comma', 'tab', 'pipe')),
  include_header boolean not null default true,
  column_selection jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id, definition_code)
);

alter table public.csv_export_definitions enable row level security;

create policy csv_export_select_same_tenant
on public.csv_export_definitions for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

create policy csv_export_modify_tenant_admin
on public.csv_export_definitions for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- ---------------------------------------------------------------------
-- 8. work_settings (per-business work flow config)
--    work_mode/match_mode/ng_flow + correction_approval (PRODUCT_SPEC D-06)
-- ---------------------------------------------------------------------
create table if not exists public.work_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  business_code text not null check (business_code in ('receiving', 'picking', 'inventory', 'manufacturing')),
  work_mode text not null default 'ticket' check (work_mode in ('ticket', 'free')),
  match_mode text not null default 'double' check (match_mode in ('double', 'none')),
  ng_flow text not null default 'warn' check (ng_flow in ('block', 'warn', 'approve')),
  correction_approval boolean not null default false,
  header_format_id uuid references public.qr_format_definitions(id),
  line_format_id uuid references public.qr_format_definitions(id),
  label_format_id uuid references public.qr_format_definitions(id),
  match_rule_id uuid references public.match_rules(id),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id, business_code)
);

create index if not exists work_settings_tenant_idx on public.work_settings (tenant_id);

alter table public.work_settings enable row level security;

create policy work_settings_select_same_tenant
on public.work_settings for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

create policy work_settings_modify_tenant_admin
on public.work_settings for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- ---------------------------------------------------------------------
-- 9. work_input_field_settings (per-business field on/off)
-- ---------------------------------------------------------------------
create table if not exists public.work_input_field_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  business_code text not null check (business_code in ('receiving', 'picking', 'inventory', 'manufacturing')),
  field_code text not null,
  enabled boolean not null default true,
  required boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id, business_code, field_code)
);

create index if not exists work_input_field_settings_tenant_idx
  on public.work_input_field_settings (tenant_id);

alter table public.work_input_field_settings enable row level security;

create policy work_input_field_select_same_tenant
on public.work_input_field_settings for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

create policy work_input_field_modify_tenant_admin
on public.work_input_field_settings for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- ---------------------------------------------------------------------
-- 10. Masters: work_types / processes / equipment / defect_groups / defects
-- ---------------------------------------------------------------------
create table if not exists public.work_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  business_code text check (business_code in ('receiving', 'picking', 'inventory', 'manufacturing')),
  sort_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id, code)
);

alter table public.work_types enable row level security;

create policy work_types_select_same_tenant
on public.work_types for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

create policy work_types_modify_tenant_admin
on public.work_types for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

create table if not exists public.processes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  sort_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id, code)
);

alter table public.processes enable row level security;

create policy processes_select_same_tenant
on public.processes for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

create policy processes_modify_tenant_admin
on public.processes for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  process_id uuid references public.processes(id) on delete set null,
  sort_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id, code)
);

alter table public.equipment enable row level security;

create policy equipment_select_same_tenant
on public.equipment for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

create policy equipment_modify_tenant_admin
on public.equipment for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

create table if not exists public.defect_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  sort_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id, code)
);

alter table public.defect_groups enable row level security;

create policy defect_groups_select_same_tenant
on public.defect_groups for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

create policy defect_groups_modify_tenant_admin
on public.defect_groups for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

create table if not exists public.defects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  defect_group_id uuid references public.defect_groups(id) on delete set null,
  code text not null,
  name text not null,
  severity text not null default 'minor' check (severity in ('minor', 'major', 'critical')),
  sort_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz,
  unique (tenant_id, code)
);

alter table public.defects enable row level security;

create policy defects_select_same_tenant
on public.defects for select to authenticated
using (tenant_id = app.current_tenant_id() or app.is_system_admin());

create policy defects_modify_tenant_admin
on public.defects for all to authenticated
using (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
)
with check (
  (tenant_id = app.current_tenant_id() and app.is_tenant_admin())
  or app.is_system_admin()
);

-- ---------------------------------------------------------------------
-- 11. updated_at triggers for every Phase 2 table
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'standard_field_definitions',
      'tenant_field_settings',
      'custom_field_definitions',
      'qr_format_definitions',
      'qr_item_definitions',
      'match_rules',
      'match_rule_lines',
      'csv_import_definitions',
      'csv_export_definitions',
      'work_settings',
      'work_input_field_settings',
      'work_types',
      'processes',
      'equipment',
      'defect_groups',
      'defects'
    ])
  loop
    execute format(
      'drop trigger if exists %I_touch on public.%I;',
      t, t
    );
    execute format(
      'create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_columns();',
      t, t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 12. Seed tenant_field_settings rows when a tenant is created.
--     Extends the Phase 1 seed_default_businesses trigger so every new
--     tenant gets a baseline row per standard field (enabled=true,
--     purpose='display_only'). tenant_admins can then adjust via UI.
-- ---------------------------------------------------------------------
create or replace function public.seed_tenant_field_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tenant_field_settings
    (tenant_id, field_code, enabled, purpose, display_label, sort_order, created_by, updated_by)
  select
    new.id,
    s.code,
    true,
    case
      when s.code in ('order_no','shipment_no','customer_code','ship_date') then 'identify_header'
      when s.code in ('line_no') then 'identify_line'
      when s.code in ('item_code') then 'match_source'
      when s.code in ('lot','quantity','location_code') then 'item_label'
      else 'display_only'
    end,
    s.label,
    s.sort_order,
    new.created_by,
    new.created_by
  from public.standard_field_definitions s
  where s.deleted_at is null
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists tenants_seed_field_settings on public.tenants;
create trigger tenants_seed_field_settings
after insert on public.tenants
for each row execute function public.seed_tenant_field_settings();

-- =====================================================================
-- End of Phase 2 migration.
-- =====================================================================
