import { describe, expect, it } from "vitest";
import {
  inventoryRecordInsertSchema,
  movementPlanInsertSchema,
  movementPlanLineInsertSchema,
  movementRecordInsertSchema,
  qrScanHistoryInsertSchema,
} from "@/lib/logi/validators";
import { QR_MAX_LENGTH } from "@/lib/qr/types";

const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";
const NUL = "\u0000";

describe("movementRecordInsertSchema", () => {
  it("accepts a valid receiving row", () => {
    const r = movementRecordInsertSchema.safeParse({
      business_code: "receiving",
      item_code: "ITEM-A",
      quantity: 12,
      match_result: "ok",
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative quantity", () => {
    const r = movementRecordInsertSchema.safeParse({
      business_code: "picking",
      item_code: "ITEM-A",
      quantity: -1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects item_code longer than 64 chars", () => {
    const r = movementRecordInsertSchema.safeParse({
      business_code: "receiving",
      item_code: "x".repeat(65),
      quantity: 1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown match_result", () => {
    const r = movementRecordInsertSchema.safeParse({
      business_code: "receiving",
      item_code: "ITEM-A",
      quantity: 1,
      match_result: "bogus",
    });
    expect(r.success).toBe(false);
  });

  it("rejects match_detail exceeding 64 entries", () => {
    const r = movementRecordInsertSchema.safeParse({
      business_code: "receiving",
      item_code: "ITEM-A",
      quantity: 1,
      match_detail: Array.from({ length: 65 }, () => ({})),
    });
    expect(r.success).toBe(false);
  });

  it("accepts match_detail of exactly 64 entries", () => {
    const r = movementRecordInsertSchema.safeParse({
      business_code: "receiving",
      item_code: "ITEM-A",
      quantity: 1,
      match_detail: Array.from({ length: 64 }, () => ({})),
    });
    expect(r.success).toBe(true);
  });

  it("rejects business_code 'inventory' (movement table is LOGI receiving/picking only)", () => {
    const r = movementRecordInsertSchema.safeParse({
      business_code: "inventory",
      item_code: "ITEM-A",
      quantity: 1,
    });
    expect(r.success).toBe(false);
  });

  it("accepts a free-read row (movement_plan_line_id null) for UC-2", () => {
    const r = movementRecordInsertSchema.safeParse({
      business_code: "picking",
      movement_plan_line_id: null,
      item_code: "ITEM-A",
      quantity: 1,
    });
    expect(r.success).toBe(true);
  });

  it("rejects item_code containing newline", () => {
    const r = movementRecordInsertSchema.safeParse({
      business_code: "receiving",
      item_code: "ITEM\nA",
      quantity: 1,
    });
    expect(r.success).toBe(false);
  });
});

describe("inventoryRecordInsertSchema", () => {
  it("accepts a valid counted row", () => {
    const r = inventoryRecordInsertSchema.safeParse({
      item_code: "ITEM-X",
      counted_quantity: 0,
    });
    expect(r.success).toBe(true);
  });

  it("rejects negative counted_quantity", () => {
    const r = inventoryRecordInsertSchema.safeParse({
      item_code: "ITEM-X",
      counted_quantity: -0.5,
    });
    expect(r.success).toBe(false);
  });

  it("accepts counted_quantity of 0", () => {
    const r = inventoryRecordInsertSchema.safeParse({
      item_code: "ITEM-X",
      counted_quantity: 0,
    });
    expect(r.success).toBe(true);
  });
});

describe("qrScanHistoryInsertSchema", () => {
  it("accepts a minimal valid history row", () => {
    const r = qrScanHistoryInsertSchema.safeParse({
      qr_type: "label",
      raw_value: "V1|ITEM-A|12",
      parsed_values: { item_code: "ITEM-A", quantity: 12 },
    });
    expect(r.success).toBe(true);
  });

  it("rejects raw_value at MAX+1", () => {
    const r = qrScanHistoryInsertSchema.safeParse({
      qr_type: "label",
      raw_value: "x".repeat(QR_MAX_LENGTH + 1),
    });
    expect(r.success).toBe(false);
  });

  it("accepts raw_value at exactly MAX", () => {
    const r = qrScanHistoryInsertSchema.safeParse({
      qr_type: "label",
      raw_value: "x".repeat(QR_MAX_LENGTH),
    });
    expect(r.success).toBe(true);
  });

  it("rejects raw_value with newline", () => {
    const r = qrScanHistoryInsertSchema.safeParse({
      qr_type: "label",
      raw_value: "abc\nxyz",
    });
    expect(r.success).toBe(false);
  });

  it("rejects raw_value with carriage return", () => {
    const r = qrScanHistoryInsertSchema.safeParse({
      qr_type: "label",
      raw_value: "abc\rxyz",
    });
    expect(r.success).toBe(false);
  });

  it("rejects raw_value with NUL", () => {
    const r = qrScanHistoryInsertSchema.safeParse({
      qr_type: "label",
      raw_value: `abc${NUL}xyz`,
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty raw_value", () => {
    const r = qrScanHistoryInsertSchema.safeParse({
      qr_type: "label",
      raw_value: "",
    });
    expect(r.success).toBe(false);
  });

  it("rejects target_table outside the allow-list", () => {
    const r = qrScanHistoryInsertSchema.safeParse({
      qr_type: "header",
      raw_value: "V1|FOO",
      target_table: "users",
      target_id: T1,
    });
    expect(r.success).toBe(false);
  });

  it("accepts every allowed target_table value", () => {
    const allowed = [
      "movement_records",
      "movement_plans",
      "movement_plan_lines",
      "inventory_records",
      "inventory_plans",
      "inventory_plan_lines",
      "manufacturing_records",
      "manufacturing_plans",
      "mfg_processes",
    ] as const;
    for (const t of allowed) {
      const r = qrScanHistoryInsertSchema.safeParse({
        qr_type: "label",
        raw_value: "V1|ABC",
        target_table: t,
        target_id: T1,
      });
      expect(r.success, `expected ${t} to be accepted`).toBe(true);
    }
  });

  it("rejects target_id that is not a uuid", () => {
    const r = qrScanHistoryInsertSchema.safeParse({
      qr_type: "label",
      raw_value: "V1|ABC",
      target_table: "movement_records",
      target_id: "not-a-uuid",
    });
    expect(r.success).toBe(false);
  });

  it("accepts a valid uuid target_id", () => {
    const r = qrScanHistoryInsertSchema.safeParse({
      qr_type: "label",
      raw_value: "V1|ABC",
      target_table: "movement_records",
      target_id: T2,
    });
    expect(r.success).toBe(true);
  });

  it("rejects business_code outside the enum", () => {
    const r = qrScanHistoryInsertSchema.safeParse({
      qr_type: "label",
      raw_value: "V1|ABC",
      business_code: "shipping",
    });
    expect(r.success).toBe(false);
  });

  it("accepts the four valid business_code values", () => {
    for (const b of ["receiving", "picking", "inventory", "manufacturing"]) {
      const r = qrScanHistoryInsertSchema.safeParse({
        qr_type: "label",
        raw_value: "V1|ABC",
        business_code: b,
      });
      expect(r.success, `expected ${b} to be accepted`).toBe(true);
    }
  });

  it("rejects target_table without target_id (and vice versa)", () => {
    const a = qrScanHistoryInsertSchema.safeParse({
      qr_type: "label",
      raw_value: "V1|ABC",
      target_table: "movement_records",
    });
    expect(a.success).toBe(false);
    const b = qrScanHistoryInsertSchema.safeParse({
      qr_type: "label",
      raw_value: "V1|ABC",
      target_id: T1,
    });
    expect(b.success).toBe(false);
  });

  it("rejects unknown qr_type", () => {
    const r = qrScanHistoryInsertSchema.safeParse({
      qr_type: "bogus",
      raw_value: "V1|ABC",
    });
    expect(r.success).toBe(false);
  });

  it("accepts parsed_values with exactly 64 keys", () => {
    const parsed_values = Object.fromEntries(
      Array.from({ length: 64 }, (_, i) => [`k${i}`, i]),
    );
    const r = qrScanHistoryInsertSchema.safeParse({
      qr_type: "label",
      raw_value: "V1|ABC",
      parsed_values,
    });
    expect(r.success).toBe(true);
  });

  it("rejects parsed_values with 65 keys", () => {
    const parsed_values = Object.fromEntries(
      Array.from({ length: 65 }, (_, i) => [`k${i}`, i]),
    );
    const r = qrScanHistoryInsertSchema.safeParse({
      qr_type: "label",
      raw_value: "V1|ABC",
      parsed_values,
    });
    expect(r.success).toBe(false);
  });

  it("accepts omitted parsed_values (defaults to empty object)", () => {
    const r = qrScanHistoryInsertSchema.safeParse({
      qr_type: "label",
      raw_value: "V1|ABC",
    });
    expect(r.success).toBe(true);
  });
});

describe("movementPlanInsertSchema / movementPlanLineInsertSchema", () => {
  it("accepts a valid plan row", () => {
    const r = movementPlanInsertSchema.safeParse({
      tenant_id: T1,
      business_code: "receiving",
      plan_code: "RCV-001",
      plan_name: "入庫計画 001",
    });
    expect(r.success).toBe(true);
  });

  it("rejects plan_code containing newline", () => {
    const r = movementPlanInsertSchema.safeParse({
      tenant_id: T1,
      business_code: "picking",
      plan_code: "PLAN\n01",
      plan_name: "x",
    });
    expect(r.success).toBe(false);
  });

  it("rejects line_no = 0", () => {
    const r = movementPlanLineInsertSchema.safeParse({
      movement_plan_id: T1,
      tenant_id: T2,
      line_no: 0,
      item_code: "ITEM-A",
      planned_quantity: 1,
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative planned_quantity", () => {
    const r = movementPlanLineInsertSchema.safeParse({
      movement_plan_id: T1,
      tenant_id: T2,
      line_no: 1,
      item_code: "ITEM-A",
      planned_quantity: -0.0001,
    });
    expect(r.success).toBe(false);
  });
});

describe("strict-mode (Phase 3a P1 follow-up)", () => {
  // Each schema is .strict() so unknown keys surface as a validation error
  // instead of being silently stripped — this catches client/server contract
  // drift and prevents extra payload from flowing into Phase 3b inserts.
  it("movementRecordInsertSchema rejects unknown keys", () => {
    const r = movementRecordInsertSchema.safeParse({
      business_code: "receiving",
      item_code: "ITEM-A",
      quantity: 1,
      // not in the schema:
      worker_id: T1,
    });
    expect(r.success).toBe(false);
  });

  it("qrScanHistoryInsertSchema rejects unknown keys", () => {
    const r = qrScanHistoryInsertSchema.safeParse({
      qr_type: "label",
      raw_value: "V1|ABC",
      // not in the schema:
      scanned_by: T1,
    });
    expect(r.success).toBe(false);
  });

  it("movementPlanInsertSchema rejects unknown keys", () => {
    const r = movementPlanInsertSchema.safeParse({
      tenant_id: T1,
      business_code: "receiving",
      plan_code: "RCV-001",
      plan_name: "入庫計画 001",
      // not in the schema:
      created_by: T1,
    });
    expect(r.success).toBe(false);
  });
});
