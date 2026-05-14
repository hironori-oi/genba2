-- =====================================================================
-- GENBA Phase 5a: 訂正書込 RPC × 3
--   submit_movement_correction(p_old_id uuid, p_new_data jsonb, p_reason text)
--   submit_inventory_correction(p_old_id uuid, p_new_data jsonb, p_reason text)
--   submit_manufacturing_correction(p_old_id uuid, p_new_data jsonb, p_reason text)
-- =====================================================================
-- Implements docs/ARCHITECTURE-phase5-admin-ui.md §3.5.3 + §4.2 + §6.
--
-- SECURITY:
--   * SECURITY INVOKER — caller の RLS が gate する。
--     - 旧 row SELECT: <tbl>_select_same_tenant (same-tenant)
--     - 旧 row UPDATE deleted_at: <tbl>_update_self_or_admin
--     - 新 row INSERT: <tbl>_insert_worker (tenant_id pin + worker_id pin)
--     - corrections_audit INSERT: corrections_audit_insert_via_rpc
--   * SET search_path = '' — テーブル/関数は全て fully qualified (public.x /
--     app.x / auth.x)。caller search_path 注入を遮断。
--   * revoke all from public; grant execute to authenticated.
--
-- Transactional boundary: function 全体が caller のトランザクション内で
-- 1 つの statement として実行されるため、途中で例外が出れば旧 row の
-- deleted_at 書込・新 row INSERT・audit INSERT が一括 ROLLBACK される。
--
-- Idempotent: CREATE OR REPLACE FUNCTION で再適用安全。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. submit_movement_correction
--    旧 movement_records 行を deleted_at で soft-delete し、
--    新 movement_records 行を previous_record_id 付きで INSERT。
--    対象 business_code は 'receiving' / 'picking'。
-- ---------------------------------------------------------------------
create or replace function public.submit_movement_correction(
  p_old_id uuid,
  p_new_data jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_business_code text;
  v_worker_id uuid := auth.uid();
  v_new_id uuid;
  v_audit_id uuid;
begin
  if v_worker_id is null then
    raise exception 'submit_movement_correction: caller is not authenticated'
      using errcode = '42501';
  end if;
  if p_old_id is null then
    raise exception 'submit_movement_correction: p_old_id is required'
      using errcode = '22023';
  end if;
  if p_reason is null or char_length(p_reason) = 0 or char_length(p_reason) > 256 then
    raise exception 'submit_movement_correction: p_reason must be 1..256 chars'
      using errcode = '22023';
  end if;

  -- 旧 row を RLS の SELECT policy 越しに読む。クロステナント / RLS reject
  -- 時は 0 rows → not_found を返す。
  select tenant_id, business_code
    into v_tenant_id, v_business_code
    from public.movement_records
   where id = p_old_id
     and deleted_at is null;

  if v_tenant_id is null then
    raise exception 'submit_movement_correction: old record not found or already corrected'
      using errcode = '02000';
  end if;

  -- 旧 row を soft-delete。update policy は self-or-admin。
  update public.movement_records
     set deleted_at = now(),
         updated_at = now(),
         updated_by = v_worker_id
   where id = p_old_id
     and deleted_at is null;

  if not found then
    raise exception 'submit_movement_correction: old record update rejected (RLS)'
      using errcode = '42501';
  end if;

  -- 新 row を INSERT。tenant_id / worker_id は caller-derived 値で pin。
  -- business_code は payload にあれば優先するが、無ければ旧 row のものを継承。
  insert into public.movement_records (
    tenant_id,
    business_code,
    movement_plan_line_id,
    worker_id,
    item_code,
    quantity,
    lot,
    location_code,
    match_result,
    match_detail,
    notes,
    previous_record_id,
    manufacturing_record_id,
    created_by,
    updated_by
  )
  values (
    v_tenant_id,
    coalesce(nullif(p_new_data ->> 'business_code', ''), v_business_code),
    nullif(p_new_data ->> 'movement_plan_line_id', '')::uuid,
    v_worker_id,
    coalesce(p_new_data ->> 'item_code', ''),
    coalesce((p_new_data ->> 'quantity')::numeric, 0),
    nullif(p_new_data ->> 'lot', ''),
    nullif(p_new_data ->> 'location_code', ''),
    coalesce(p_new_data ->> 'match_result', 'ok'),
    coalesce(p_new_data -> 'match_detail', '[]'::jsonb),
    nullif(p_new_data ->> 'notes', ''),
    p_old_id,
    nullif(p_new_data ->> 'manufacturing_record_id', '')::uuid,
    v_worker_id,
    v_worker_id
  )
  returning id into v_new_id;

  insert into public.corrections_audit (
    tenant_id,
    actor_id,
    business_code,
    target_table,
    old_record_id,
    new_record_id,
    reason
  )
  values (
    v_tenant_id,
    v_worker_id,
    coalesce(nullif(p_new_data ->> 'business_code', ''), v_business_code),
    'movement_records',
    p_old_id,
    v_new_id,
    p_reason
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'new_record_id', v_new_id,
    'audit_id', v_audit_id,
    'target_table', 'movement_records',
    'business_code', coalesce(nullif(p_new_data ->> 'business_code', ''), v_business_code)
  );
end;
$$;

revoke all on function public.submit_movement_correction(uuid, jsonb, text) from public;
grant execute on function public.submit_movement_correction(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. submit_inventory_correction
--    旧 inventory_records 行を soft-delete し、新 inventory_records 行を
--    previous_record_id 付きで INSERT。business_code 'inventory' 固定。
-- ---------------------------------------------------------------------
create or replace function public.submit_inventory_correction(
  p_old_id uuid,
  p_new_data jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_worker_id uuid := auth.uid();
  v_new_id uuid;
  v_audit_id uuid;
begin
  if v_worker_id is null then
    raise exception 'submit_inventory_correction: caller is not authenticated'
      using errcode = '42501';
  end if;
  if p_old_id is null then
    raise exception 'submit_inventory_correction: p_old_id is required'
      using errcode = '22023';
  end if;
  if p_reason is null or char_length(p_reason) = 0 or char_length(p_reason) > 256 then
    raise exception 'submit_inventory_correction: p_reason must be 1..256 chars'
      using errcode = '22023';
  end if;

  select tenant_id
    into v_tenant_id
    from public.inventory_records
   where id = p_old_id
     and deleted_at is null;

  if v_tenant_id is null then
    raise exception 'submit_inventory_correction: old record not found or already corrected'
      using errcode = '02000';
  end if;

  update public.inventory_records
     set deleted_at = now(),
         updated_at = now(),
         updated_by = v_worker_id
   where id = p_old_id
     and deleted_at is null;

  if not found then
    raise exception 'submit_inventory_correction: old record update rejected (RLS)'
      using errcode = '42501';
  end if;

  insert into public.inventory_records (
    tenant_id,
    inventory_plan_line_id,
    worker_id,
    item_code,
    counted_quantity,
    location_code,
    lot,
    match_result,
    match_detail,
    notes,
    previous_record_id,
    created_by,
    updated_by
  )
  values (
    v_tenant_id,
    nullif(p_new_data ->> 'inventory_plan_line_id', '')::uuid,
    v_worker_id,
    coalesce(p_new_data ->> 'item_code', ''),
    coalesce((p_new_data ->> 'counted_quantity')::numeric, 0),
    nullif(p_new_data ->> 'location_code', ''),
    nullif(p_new_data ->> 'lot', ''),
    coalesce(p_new_data ->> 'match_result', 'ok'),
    coalesce(p_new_data -> 'match_detail', '[]'::jsonb),
    nullif(p_new_data ->> 'notes', ''),
    p_old_id,
    v_worker_id,
    v_worker_id
  )
  returning id into v_new_id;

  insert into public.corrections_audit (
    tenant_id,
    actor_id,
    business_code,
    target_table,
    old_record_id,
    new_record_id,
    reason
  )
  values (
    v_tenant_id,
    v_worker_id,
    'inventory',
    'inventory_records',
    p_old_id,
    v_new_id,
    p_reason
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'new_record_id', v_new_id,
    'audit_id', v_audit_id,
    'target_table', 'inventory_records',
    'business_code', 'inventory'
  );
end;
$$;

revoke all on function public.submit_inventory_correction(uuid, jsonb, text) from public;
grant execute on function public.submit_inventory_correction(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------
-- 3. submit_manufacturing_correction
--    旧 manufacturing_records 行を soft-delete し、新 manufacturing_records
--    行を previous_record_id 付きで INSERT。business_code 'manufacturing'
--    固定。製造入庫 (movement_records.manufacturing_record_id link) の
--    取扱いは R-P4-17 closure: デフォルトでは 旧 movement_records を
--    そのまま残す (在庫を動かさない、選択肢 B)。p_new_data に
--    rollback_inflow=true が指定された場合のみ旧 movement_records を
--    soft-delete する。
-- ---------------------------------------------------------------------
create or replace function public.submit_manufacturing_correction(
  p_old_id uuid,
  p_new_data jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_mfg_process_id uuid;
  v_worker_id uuid := auth.uid();
  v_new_id uuid;
  v_audit_id uuid;
  v_rollback_inflow boolean := coalesce((p_new_data ->> 'rollback_inflow')::boolean, false);
begin
  if v_worker_id is null then
    raise exception 'submit_manufacturing_correction: caller is not authenticated'
      using errcode = '42501';
  end if;
  if p_old_id is null then
    raise exception 'submit_manufacturing_correction: p_old_id is required'
      using errcode = '22023';
  end if;
  if p_reason is null or char_length(p_reason) = 0 or char_length(p_reason) > 256 then
    raise exception 'submit_manufacturing_correction: p_reason must be 1..256 chars'
      using errcode = '22023';
  end if;

  select tenant_id, mfg_process_id
    into v_tenant_id, v_mfg_process_id
    from public.manufacturing_records
   where id = p_old_id
     and deleted_at is null;

  if v_tenant_id is null then
    raise exception 'submit_manufacturing_correction: old record not found or already corrected'
      using errcode = '02000';
  end if;

  update public.manufacturing_records
     set deleted_at = now(),
         updated_at = now(),
         updated_by = v_worker_id
   where id = p_old_id
     and deleted_at is null;

  if not found then
    raise exception 'submit_manufacturing_correction: old record update rejected (RLS)'
      using errcode = '42501';
  end if;

  insert into public.manufacturing_records (
    tenant_id,
    mfg_process_id,
    worker_id,
    work_date,
    actual_quantity,
    good_quantity,
    defect_quantity,
    lot,
    equipment_id,
    started_at,
    ended_at,
    match_result,
    match_detail,
    notes,
    previous_record_id,
    created_by,
    updated_by
  )
  values (
    v_tenant_id,
    coalesce(nullif(p_new_data ->> 'mfg_process_id', '')::uuid, v_mfg_process_id),
    v_worker_id,
    coalesce((p_new_data ->> 'work_date')::date, current_date),
    coalesce((p_new_data ->> 'actual_quantity')::numeric, 0),
    nullif(p_new_data ->> 'good_quantity', '')::numeric,
    coalesce((p_new_data ->> 'defect_quantity')::numeric, 0),
    nullif(p_new_data ->> 'lot', ''),
    nullif(p_new_data ->> 'equipment_id', '')::uuid,
    nullif(p_new_data ->> 'started_at', '')::timestamptz,
    nullif(p_new_data ->> 'ended_at', '')::timestamptz,
    coalesce(p_new_data ->> 'match_result', 'ok'),
    coalesce(p_new_data -> 'match_detail', '[]'::jsonb),
    nullif(p_new_data ->> 'notes', ''),
    p_old_id,
    v_worker_id,
    v_worker_id
  )
  returning id into v_new_id;

  -- R-P4-17 closure: 製造入庫 rollback (opt-in).
  if v_rollback_inflow then
    update public.movement_records
       set deleted_at = now(),
           updated_at = now(),
           updated_by = v_worker_id
     where manufacturing_record_id = p_old_id
       and deleted_at is null;
  end if;

  insert into public.corrections_audit (
    tenant_id,
    actor_id,
    business_code,
    target_table,
    old_record_id,
    new_record_id,
    reason
  )
  values (
    v_tenant_id,
    v_worker_id,
    'manufacturing',
    'manufacturing_records',
    p_old_id,
    v_new_id,
    p_reason
  )
  returning id into v_audit_id;

  return jsonb_build_object(
    'new_record_id', v_new_id,
    'audit_id', v_audit_id,
    'target_table', 'manufacturing_records',
    'business_code', 'manufacturing',
    'rolled_back_inflow', v_rollback_inflow
  );
end;
$$;

revoke all on function public.submit_manufacturing_correction(uuid, jsonb, text) from public;
grant execute on function public.submit_manufacturing_correction(uuid, jsonb, text) to authenticated;

-- =====================================================================
-- End of Phase 5a correction RPCs migration.
-- =====================================================================
