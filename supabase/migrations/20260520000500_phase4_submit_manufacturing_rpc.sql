-- =====================================================================
-- GENBA Phase 4a: submit_manufacturing_record() RPC.
-- =====================================================================
-- Implements docs/ARCHITECTURE-phase4-manufacturing.md §5.2 transactional
-- boundary, modified per Phase 4a dispatch directive to use
-- SECURITY DEFINER + tenant_id automatic pinning instead of SECURITY
-- INVOKER. The dispatch decision was made to keep the Phase 3a/3b
-- SECURITY DEFINER + search_path='' pattern uniform and to lock the
-- tenant_id source to the JWT app_metadata claim (never client-supplied).
--
-- Behaviour:
--   1. Reads tenant_id from auth.jwt() app_metadata via
--      app.current_tenant_id(). The caller cannot override it.
--   2. Reads worker_id from auth.uid(). The caller cannot override it.
--   3. Verifies the parent mfg_processes row belongs to the same tenant.
--   4. INSERTs one manufacturing_records row with the pinned tenant_id /
--      worker_id.
--   5. INSERTs N manufacturing_record_defects rows (if any) with the same
--      pinned tenant_id; the per-row enforce_manufacturing_record_defect_-
--      tenant trigger further validates parent-tenant integrity.
--   6. Optionally INSERTs one movement_records row (business_code =
--      'receiving') linked back via manufacturing_record_id. The partial
--      UNIQUE index (Phase 4a migration #4) blocks a second alive 製造入庫
--      row for the same manufacturing_records row.
--   7. Returns jsonb with manufacturing_record_id, defect_ids[], and
--      movement_record_id (nullable).
--
-- All work runs in a single transaction (the calling RPC). On any
-- exception the implicit ROLLBACK reverts the manufacturing_records
-- insert, the defect inserts, and the movement_records insert together,
-- so partial writes (R-P4-05) cannot persist.
--
-- Security:
--   * SECURITY DEFINER + `set search_path = ''` — every table is fully
--     qualified to `public.<name>` so the function never depends on the
--     caller's search_path (pick-checker 013_search_path lesson).
--   * The function owner runs with elevated privilege (SECURITY DEFINER)
--     but the function body itself enforces tenant_id and worker_id pins
--     from JWT-derived sources, so the RLS policy bypass that SECURITY
--     DEFINER grants cannot be used to write rows for another tenant or
--     another worker.
--   * EXECUTE is granted only to authenticated. anon / public have no
--     grant.
--   * No RAISE NOTICE / RAISE INFO of caller-supplied values (forensic
--     leakage defense).
--
-- Input contract (jsonb keys, see also src/lib/works/types.ts in Phase 4b):
--   {
--     "mfg_process_id":     "<uuid>",
--     "work_date":          "YYYY-MM-DD",
--     "actual_quantity":    <numeric>,
--     "good_quantity":      <numeric|null>,
--     "defect_quantity":    <numeric>,
--     "lot":                "<text|null>",
--     "equipment_id":       "<uuid|null>",
--     "started_at":         "<timestamptz|null>",
--     "ended_at":           "<timestamptz|null>",
--     "match_result":       "ok|ng|warning|skipped",
--     "match_detail":       <jsonb array>,
--     "notes":              "<text|null>",
--     "previous_record_id": "<uuid|null>",
--     "defects": [
--       { "defect_id": "<uuid>", "defect_quantity": <numeric>, "notes": "<text|null>" }
--     ],
--     "produce_inflow": null | {
--       "item_code":     "<text>",
--       "quantity":      <numeric>,
--       "location_code": "<text|null>",
--       "lot":           "<text|null>",
--       "notes":         "<text|null>"
--     }
--   }
-- =====================================================================

create or replace function public.submit_manufacturing_record(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_worker_id uuid := auth.uid();
  v_mfg_process_id uuid;
  v_parent_tenant_id uuid;
  v_record_id uuid;
  v_defect_ids uuid[] := array[]::uuid[];
  v_defect_id uuid;
  v_defect_row jsonb;
  v_produce_inflow jsonb;
  v_movement_record_id uuid;
begin
  if v_tenant_id is null then
    raise exception 'submit_manufacturing_record: no tenant_id in app_metadata'
      using errcode = '42501';
  end if;
  if v_worker_id is null then
    raise exception 'submit_manufacturing_record: caller is not authenticated'
      using errcode = '42501';
  end if;

  v_mfg_process_id := (p_payload ->> 'mfg_process_id')::uuid;
  if v_mfg_process_id is null then
    raise exception 'submit_manufacturing_record: mfg_process_id is required'
      using errcode = '22023';
  end if;

  -- Confirm the parent mfg_processes row belongs to the caller's tenant.
  -- A SECURITY DEFINER function bypasses RLS, so we must verify tenancy
  -- ourselves before INSERTing the child manufacturing_records row.
  select tenant_id
    into v_parent_tenant_id
    from public.mfg_processes
   where id = v_mfg_process_id;

  if v_parent_tenant_id is null then
    raise exception 'submit_manufacturing_record: mfg_process not found'
      using errcode = '22023';
  end if;
  if v_parent_tenant_id <> v_tenant_id then
    raise exception 'submit_manufacturing_record: mfg_process belongs to a different tenant'
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
    previous_record_id,
    notes,
    created_by,
    updated_by
  )
  values (
    v_tenant_id,
    v_mfg_process_id,
    v_worker_id,
    coalesce((p_payload ->> 'work_date')::date, current_date),
    coalesce((p_payload ->> 'actual_quantity')::numeric, 0),
    nullif(p_payload ->> 'good_quantity', '')::numeric,
    coalesce((p_payload ->> 'defect_quantity')::numeric, 0),
    nullif(p_payload ->> 'lot', ''),
    nullif(p_payload ->> 'equipment_id', '')::uuid,
    nullif(p_payload ->> 'started_at', '')::timestamptz,
    nullif(p_payload ->> 'ended_at', '')::timestamptz,
    coalesce(p_payload ->> 'match_result', 'ok'),
    coalesce(p_payload -> 'match_detail', '[]'::jsonb),
    nullif(p_payload ->> 'previous_record_id', '')::uuid,
    nullif(p_payload ->> 'notes', ''),
    v_worker_id,
    v_worker_id
  )
  returning id into v_record_id;

  -- Defects (0..N). The enforce_manufacturing_record_defect_tenant
  -- trigger further validates parent tenant on each row.
  if jsonb_typeof(p_payload -> 'defects') = 'array' then
    for v_defect_row in
      select value from jsonb_array_elements(p_payload -> 'defects')
    loop
      insert into public.manufacturing_record_defects (
        manufacturing_record_id,
        tenant_id,
        defect_id,
        defect_quantity,
        notes,
        created_by,
        updated_by
      )
      values (
        v_record_id,
        v_tenant_id,
        (v_defect_row ->> 'defect_id')::uuid,
        coalesce((v_defect_row ->> 'defect_quantity')::numeric, 0),
        nullif(v_defect_row ->> 'notes', ''),
        v_worker_id,
        v_worker_id
      )
      returning id into v_defect_id;
      v_defect_ids := v_defect_ids || v_defect_id;
    end loop;
  end if;

  -- Optional produce-inflow (製造入庫). When present we INSERT a single
  -- movement_records row with business_code='receiving' and the FK back
  -- to manufacturing_records. The partial unique index
  -- movement_records_manufacturing_unique_alive guards against a second
  -- alive row for the same manufacturing_records id.
  v_produce_inflow := p_payload -> 'produce_inflow';
  if v_produce_inflow is not null and jsonb_typeof(v_produce_inflow) = 'object' then
    insert into public.movement_records (
      tenant_id,
      business_code,
      worker_id,
      item_code,
      quantity,
      lot,
      location_code,
      match_result,
      notes,
      manufacturing_record_id,
      created_by,
      updated_by
    )
    values (
      v_tenant_id,
      'receiving',
      v_worker_id,
      coalesce(v_produce_inflow ->> 'item_code', ''),
      coalesce((v_produce_inflow ->> 'quantity')::numeric, 0),
      nullif(v_produce_inflow ->> 'lot', ''),
      nullif(v_produce_inflow ->> 'location_code', ''),
      'ok',
      nullif(v_produce_inflow ->> 'notes', ''),
      v_record_id,
      v_worker_id,
      v_worker_id
    )
    returning id into v_movement_record_id;
  end if;

  return jsonb_build_object(
    'manufacturing_record_id', v_record_id,
    'defect_ids', to_jsonb(v_defect_ids),
    'movement_record_id', v_movement_record_id
  );
end;
$$;

revoke all on function public.submit_manufacturing_record(jsonb) from public;
grant execute on function public.submit_manufacturing_record(jsonb) to authenticated;

-- =====================================================================
-- End of Phase 4a submit_manufacturing_record RPC migration.
-- =====================================================================
