/**
 * Phase 4b WORKS zod validator unit tests.
 *
 * Exercises the strict input contracts shipped in src/lib/works/validators.ts:
 *
 *   * manufacturingPlanInsertSchema   — CSV-import header rows
 *   * mfgProcessInsertSchema          — CSV-import per-process rows
 *   * manufacturingRecordDefectInsertSchema — standalone defect row
 *   * submitManufacturingRecordSchema — submit_manufacturing_record RPC payload
 *
 * Cases mirror the surface that the architect doc §8.1 lists for
 * tests/unit/works-validators.test.ts (defect array cap, nonneg quantity,
 * datetime ordering, control-char rejection) plus strict-mode coverage
 * to catch client/server drift.
 */

import { describe, expect, it } from "vitest";
import {
  MANUFACTURING_DEFECT_MAX,
  manufacturingPlanInsertSchema,
  manufacturingRecordDefectInsertSchema,
  mfgProcessInsertSchema,
  produceInflowInsertSchema,
  submitManufacturingRecordSchema,
} from "@/lib/works/validators";

const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";
const T3 = "33333333-3333-3333-3333-333333333333";
const NUL = String.fromCharCode(0);

describe("manufacturingPlanInsertSchema", () => {
  it("accepts a minimal valid plan row", () => {
    const r = manufacturingPlanInsertSchema.safeParse({
      tenant_id: T1,
      order_no: "MO-001",
      item_code: "ITEM-A",
      planned_quantity: 100,
    });
    expect(r.success).toBe(true);
  });

  it("rejects missing order_no", () => {
    const r = manufacturingPlanInsertSchema.safeParse({
      tenant_id: T1,
      order_no: "",
      item_code: "ITEM-A",
      planned_quantity: 1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects order_no longer than 64 chars", () => {
    const r = manufacturingPlanInsertSchema.safeParse({
      tenant_id: T1,
      order_no: "x".repeat(65),
      item_code: "ITEM-A",
      planned_quantity: 1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative planned_quantity", () => {
    const r = manufacturingPlanInsertSchema.safeParse({
      tenant_id: T1,
      order_no: "MO-001",
      item_code: "ITEM-A",
      planned_quantity: -0.01,
    });
    expect(r.success).toBe(false);
  });

  it("accepts planned_quantity of 0 (planning placeholder)", () => {
    const r = manufacturingPlanInsertSchema.safeParse({
      tenant_id: T1,
      order_no: "MO-001",
      item_code: "ITEM-A",
      planned_quantity: 0,
    });
    expect(r.success).toBe(true);
  });

  it("rejects item_code with newline", () => {
    const r = manufacturingPlanInsertSchema.safeParse({
      tenant_id: T1,
      order_no: "MO-001",
      item_code: "ITEM\nA",
      planned_quantity: 1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown status", () => {
    const r = manufacturingPlanInsertSchema.safeParse({
      tenant_id: T1,
      order_no: "MO-001",
      item_code: "ITEM-A",
      planned_quantity: 1,
      status: "shipped",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown keys (strict mode)", () => {
    const r = manufacturingPlanInsertSchema.safeParse({
      tenant_id: T1,
      order_no: "MO-001",
      item_code: "ITEM-A",
      planned_quantity: 1,
      // not in the schema:
      created_by: T2,
    });
    expect(r.success).toBe(false);
  });
});

describe("mfgProcessInsertSchema", () => {
  it("accepts a minimal valid process row", () => {
    const r = mfgProcessInsertSchema.safeParse({
      manufacturing_plan_id: T1,
      tenant_id: T1,
      process_order: 1,
    });
    expect(r.success).toBe(true);
  });

  it("rejects process_order of 0", () => {
    const r = mfgProcessInsertSchema.safeParse({
      manufacturing_plan_id: T1,
      tenant_id: T1,
      process_order: 0,
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-uuid manufacturing_plan_id", () => {
    const r = mfgProcessInsertSchema.safeParse({
      manufacturing_plan_id: "not-a-uuid",
      tenant_id: T1,
      process_order: 1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown status", () => {
    const r = mfgProcessInsertSchema.safeParse({
      manufacturing_plan_id: T1,
      tenant_id: T1,
      process_order: 1,
      status: "in-flight",
    });
    expect(r.success).toBe(false);
  });

  it("accepts every allowed status enum value", () => {
    for (const s of ["pending", "in_progress", "done", "canceled"]) {
      const r = mfgProcessInsertSchema.safeParse({
        manufacturing_plan_id: T1,
        tenant_id: T1,
        process_order: 1,
        status: s,
      });
      expect(r.success, `expected status=${s} to be accepted`).toBe(true);
    }
  });
});

describe("manufacturingRecordDefectInsertSchema", () => {
  it("accepts a valid defect row", () => {
    const r = manufacturingRecordDefectInsertSchema.safeParse({
      defect_id: T1,
      defect_quantity: 3,
    });
    expect(r.success).toBe(true);
  });

  it("accepts defect_quantity of 0", () => {
    const r = manufacturingRecordDefectInsertSchema.safeParse({
      defect_id: T1,
      defect_quantity: 0,
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative defect_quantity", () => {
    const r = manufacturingRecordDefectInsertSchema.safeParse({
      defect_id: T1,
      defect_quantity: -1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects non-uuid defect_id", () => {
    const r = manufacturingRecordDefectInsertSchema.safeParse({
      defect_id: "abc",
      defect_quantity: 1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown keys (strict mode)", () => {
    const r = manufacturingRecordDefectInsertSchema.safeParse({
      defect_id: T1,
      defect_quantity: 1,
      // not in the schema:
      tenant_id: T1,
    });
    expect(r.success).toBe(false);
  });
});

describe("produceInflowInsertSchema", () => {
  it("accepts a valid produce_inflow", () => {
    const r = produceInflowInsertSchema.safeParse({
      item_code: "ITEM-A",
      quantity: 10,
      location_code: "DOCK-1",
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative quantity", () => {
    const r = produceInflowInsertSchema.safeParse({
      item_code: "ITEM-A",
      quantity: -1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects item_code with NUL", () => {
    const r = produceInflowInsertSchema.safeParse({
      item_code: `ITEM${NUL}A`,
      quantity: 1,
    });
    expect(r.success).toBe(false);
  });
});

describe("submitManufacturingRecordSchema", () => {
  const base = {
    mfg_process_id: T1,
    actual_quantity: 10,
  } as const;

  it("accepts a minimal valid submit payload", () => {
    const r = submitManufacturingRecordSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it("rejects negative actual_quantity", () => {
    const r = submitManufacturingRecordSchema.safeParse({
      ...base,
      actual_quantity: -0.5,
    });
    expect(r.success).toBe(false);
  });

  it("accepts actual_quantity of 0 (process started but no good output)", () => {
    const r = submitManufacturingRecordSchema.safeParse({
      ...base,
      actual_quantity: 0,
    });
    expect(r.success).toBe(true);
  });

  it("rejects non-uuid mfg_process_id", () => {
    const r = submitManufacturingRecordSchema.safeParse({
      mfg_process_id: "not-a-uuid",
      actual_quantity: 1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown match_result", () => {
    const r = submitManufacturingRecordSchema.safeParse({
      ...base,
      match_result: "weird",
    });
    expect(r.success).toBe(false);
  });

  it("accepts the four valid match_result values", () => {
    for (const m of ["ok", "ng", "warning", "skipped"]) {
      const r = submitManufacturingRecordSchema.safeParse({
        ...base,
        match_result: m,
      });
      expect(r.success, `expected match_result=${m} to be accepted`).toBe(true);
    }
  });

  it("rejects ended_at earlier than started_at", () => {
    const r = submitManufacturingRecordSchema.safeParse({
      ...base,
      started_at: "2026-05-13T09:00:00.000Z",
      ended_at: "2026-05-13T08:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });

  it("accepts ended_at equal to started_at (instantaneous step)", () => {
    const ts = "2026-05-13T09:00:00.000Z";
    const r = submitManufacturingRecordSchema.safeParse({
      ...base,
      started_at: ts,
      ended_at: ts,
    });
    expect(r.success).toBe(true);
  });

  it("accepts ended_at after started_at", () => {
    const r = submitManufacturingRecordSchema.safeParse({
      ...base,
      started_at: "2026-05-13T09:00:00.000Z",
      ended_at: "2026-05-13T09:45:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("rejects defect array exceeding MANUFACTURING_DEFECT_MAX", () => {
    const r = submitManufacturingRecordSchema.safeParse({
      ...base,
      defects: Array.from({ length: MANUFACTURING_DEFECT_MAX + 1 }, () => ({
        defect_id: T2,
        defect_quantity: 1,
      })),
    });
    expect(r.success).toBe(false);
  });

  it("accepts defect array at exactly MANUFACTURING_DEFECT_MAX", () => {
    const r = submitManufacturingRecordSchema.safeParse({
      ...base,
      defects: Array.from({ length: MANUFACTURING_DEFECT_MAX }, () => ({
        defect_id: T2,
        defect_quantity: 1,
      })),
    });
    expect(r.success).toBe(true);
  });

  it("rejects defect array with a malformed entry", () => {
    const r = submitManufacturingRecordSchema.safeParse({
      ...base,
      defects: [{ defect_id: "not-a-uuid", defect_quantity: 1 }],
    });
    expect(r.success).toBe(false);
  });

  it("defaults match_detail to []", () => {
    const r = submitManufacturingRecordSchema.parse(base);
    expect(r.match_detail).toEqual([]);
  });

  it("defaults defects to []", () => {
    const r = submitManufacturingRecordSchema.parse(base);
    expect(r.defects).toEqual([]);
  });

  it("rejects produce_inflow with item_code containing newline", () => {
    const r = submitManufacturingRecordSchema.safeParse({
      ...base,
      produce_inflow: {
        item_code: "ITEM\nA",
        quantity: 1,
      },
    });
    expect(r.success).toBe(false);
  });

  it("accepts produce_inflow with valid item_code", () => {
    const r = submitManufacturingRecordSchema.safeParse({
      ...base,
      produce_inflow: {
        item_code: "ITEM-A",
        quantity: 12,
        location_code: "DOCK-1",
        lot: "LOT-001",
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown keys (strict mode)", () => {
    const r = submitManufacturingRecordSchema.safeParse({
      ...base,
      // not in the schema:
      tenant_id: T3,
    });
    expect(r.success).toBe(false);
  });

  it("rejects worker_id in payload (RPC pins worker_id from auth.uid())", () => {
    const r = submitManufacturingRecordSchema.safeParse({
      ...base,
      // not in the schema; RPC ignores any caller-supplied worker_id.
      worker_id: T3,
    });
    expect(r.success).toBe(false);
  });

  it("rejects lot field with control char", () => {
    const r = submitManufacturingRecordSchema.safeParse({
      ...base,
      lot: `LOT${NUL}1`,
    });
    expect(r.success).toBe(false);
  });

  it("rejects notes longer than 512 chars", () => {
    const r = submitManufacturingRecordSchema.safeParse({
      ...base,
      notes: "n".repeat(513),
    });
    expect(r.success).toBe(false);
  });
});
