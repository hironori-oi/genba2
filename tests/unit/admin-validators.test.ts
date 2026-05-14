import { describe, expect, it } from "vitest";
import {
  codeSchema,
  correctionReasonSchema,
  csvExportDefinitionInputSchema,
  csvImportDefinitionInputSchema,
  customFieldDefinitionInputSchema,
  masterRowInputSchema,
  matchRuleSchema,
  nameSchema,
  preferencesInputSchema,
  profileInputSchema,
  qrFormatDefinitionSchema,
  qrItemDefinitionSchema,
  sortOrderSchema,
  submitInventoryCorrectionInputSchema,
  submitManufacturingCorrectionInputSchema,
  submitMovementCorrectionInputSchema,
  tenantFieldSettingRowSchema,
  versionSchema,
  workInputFieldSettingInputSchema,
  workSettingsInputSchema,
  zodIssuesToFieldErrors,
} from "@/lib/admin/shared/validation";

/**
 * Unit coverage for Phase 5b admin validators (architect §3.3,
 * SCOPE_5B_STRICT bullet 5). ~20 cases across QR format, match rule,
 * master row, custom field, tenant field settings, and shared atoms.
 */

describe("shared atoms", () => {
  it("codeSchema accepts A-Z 0-9 - _", () => {
    expect(codeSchema.safeParse("WT-001").success).toBe(true);
    expect(codeSchema.safeParse("alpha_beta").success).toBe(true);
  });

  it("codeSchema rejects spaces and CJK", () => {
    expect(codeSchema.safeParse("WT 001").success).toBe(false);
    expect(codeSchema.safeParse("工程").success).toBe(false);
  });

  it("codeSchema rejects empty + over 64 chars", () => {
    expect(codeSchema.safeParse("").success).toBe(false);
    expect(codeSchema.safeParse("A".repeat(65)).success).toBe(false);
    expect(codeSchema.safeParse("A".repeat(64)).success).toBe(true);
  });

  it("nameSchema rejects control characters", () => {
    expect(nameSchema.safeParse("製造\x00工程").success).toBe(false);
    expect(nameSchema.safeParse("製造工程").success).toBe(true);
  });

  it("sortOrderSchema rejects negative / non-integer / too-large", () => {
    expect(sortOrderSchema.safeParse(-1).success).toBe(false);
    expect(sortOrderSchema.safeParse(1.5).success).toBe(false);
    expect(sortOrderSchema.safeParse(10_001).success).toBe(false);
    expect(sortOrderSchema.safeParse(0).success).toBe(true);
    expect(sortOrderSchema.safeParse(10_000).success).toBe(true);
  });

  it("versionSchema requires integer ≥ 1", () => {
    expect(versionSchema.safeParse(0).success).toBe(false);
    expect(versionSchema.safeParse(1).success).toBe(true);
    expect(versionSchema.safeParse(2.5).success).toBe(false);
  });
});

describe("qrItemDefinitionSchema", () => {
  it("accepts a valid item", () => {
    const r = qrItemDefinitionSchema.safeParse({
      position: 1,
      qrItemName: "品目コード",
      targetColumn: "item_code",
      required: true,
      dataType: "text",
      dateFormat: null,
      missingValueAction: "error",
    });
    expect(r.success).toBe(true);
  });

  it("rejects position < 1 and > 50", () => {
    const base = {
      qrItemName: "x",
      targetColumn: "y",
      required: false,
      dataType: "text",
      missingValueAction: "allow_blank",
    } as const;
    expect(qrItemDefinitionSchema.safeParse({ position: 0, ...base }).success).toBe(false);
    expect(qrItemDefinitionSchema.safeParse({ position: 51, ...base }).success).toBe(false);
    expect(qrItemDefinitionSchema.safeParse({ position: 1, ...base }).success).toBe(true);
  });
});

describe("qrFormatDefinitionSchema", () => {
  const validFormat = {
    id: "new-abc",
    qrType: "label" as const,
    formatCode: "LBL",
    formatName: "現品ラベル V1",
    version: 1,
    delimiter: "pipe" as const,
    delimiterChar: null,
    encoding: "utf8" as const,
    readable: true,
    issuable: true,
    validFrom: "2026-01-01",
    description: null,
    items: [
      {
        position: 1,
        qrItemName: "品目コード",
        targetColumn: "item_code",
        required: true,
        dataType: "text" as const,
        dateFormat: null,
        missingValueAction: "error" as const,
      },
    ],
  };

  it("accepts a minimum valid format", () => {
    expect(qrFormatDefinitionSchema.safeParse(validFormat).success).toBe(true);
  });

  it("rejects validFrom that isn't YYYY-MM-DD", () => {
    const r = qrFormatDefinitionSchema.safeParse({ ...validFormat, validFrom: "2026/01/01" });
    expect(r.success).toBe(false);
  });

  it("rejects items with duplicate position", () => {
    const items = [
      validFormat.items[0],
      { ...validFormat.items[0], position: 1, qrItemName: "重複" },
    ];
    const r = qrFormatDefinitionSchema.safeParse({ ...validFormat, items });
    expect(r.success).toBe(false);
  });

  it("rejects zero items", () => {
    const r = qrFormatDefinitionSchema.safeParse({ ...validFormat, items: [] });
    expect(r.success).toBe(false);
  });

  it("rejects > 50 items", () => {
    const items = Array.from({ length: 51 }, (_, i) => ({
      ...validFormat.items[0],
      position: i + 1,
    }));
    const r = qrFormatDefinitionSchema.safeParse({ ...validFormat, items });
    expect(r.success).toBe(false);
  });
});

describe("matchRuleSchema", () => {
  const baseLine = {
    sortOrder: 1,
    lineFieldCode: "item_code",
    labelFieldCode: "item_code",
    compareType: "equals" as const,
    missingValueAction: "ng" as const,
    mismatchAction: "ng" as const,
  };

  it("accepts a valid rule", () => {
    const r = matchRuleSchema.safeParse({
      id: "new-1",
      ruleCode: "PICK-DEFAULT",
      ruleName: "ピッキング既定",
      businessCode: "picking",
      enabled: true,
      lines: [baseLine, { ...baseLine, sortOrder: 2 }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects duplicate sort_order in lines", () => {
    const r = matchRuleSchema.safeParse({
      id: "new-2",
      ruleCode: "PICK-DUP",
      ruleName: "Dup",
      businessCode: "picking",
      enabled: true,
      lines: [baseLine, { ...baseLine }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid businessCode", () => {
    const r = matchRuleSchema.safeParse({
      id: "new-3",
      ruleCode: "PICK-BAD",
      ruleName: "Bad",
      businessCode: "shipment",
      enabled: true,
      lines: [baseLine],
    });
    expect(r.success).toBe(false);
  });

  it("rejects ruleCode with invalid characters", () => {
    const r = matchRuleSchema.safeParse({
      id: "new-4",
      ruleCode: "ピッキング規則",
      ruleName: "Bad",
      businessCode: "picking",
      enabled: true,
      lines: [baseLine],
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty rule name", () => {
    const r = matchRuleSchema.safeParse({
      id: "new-5",
      ruleCode: "OK",
      ruleName: "",
      businessCode: "picking",
      enabled: true,
      lines: [baseLine],
    });
    expect(r.success).toBe(false);
  });
});

describe("masterRowInputSchema", () => {
  it("accepts a valid base row (work_types)", () => {
    const r = masterRowInputSchema.safeParse({
      code: "WT-A",
      name: "通常作業",
      sortOrder: 10,
      enabled: true,
      businessCode: "manufacturing",
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty code", () => {
    const r = masterRowInputSchema.safeParse({
      code: "",
      name: "x",
      sortOrder: 0,
      enabled: true,
    });
    expect(r.success).toBe(false);
  });

  it("accepts severity=critical for defects", () => {
    const r = masterRowInputSchema.safeParse({
      code: "DF-CRIT",
      name: "致命的不適合",
      sortOrder: 100,
      enabled: true,
      defectGroupId: "00000000-0000-0000-0000-000000000001",
      severity: "critical",
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid severity", () => {
    const r = masterRowInputSchema.safeParse({
      code: "DF",
      name: "x",
      sortOrder: 0,
      enabled: true,
      severity: "lethal",
    });
    expect(r.success).toBe(false);
  });
});

describe("customFieldDefinitionInputSchema", () => {
  it("accepts custom_text_01", () => {
    const r = customFieldDefinitionInputSchema.safeParse({
      columnName: "custom_text_01",
      label: "出荷区分",
      dataType: "text",
      description: null,
      enabled: true,
      sortOrder: 10,
    });
    expect(r.success).toBe(true);
  });

  it("rejects an invalid column name", () => {
    const r = customFieldDefinitionInputSchema.safeParse({
      columnName: "custom_text_11",
      label: "x",
      dataType: "text",
      description: null,
      enabled: true,
      sortOrder: 0,
    });
    expect(r.success).toBe(false);
  });

  it("accepts custom_date_05 with date type", () => {
    const r = customFieldDefinitionInputSchema.safeParse({
      columnName: "custom_date_05",
      label: "完了日",
      dataType: "date",
      description: null,
      enabled: true,
      sortOrder: 30,
    });
    expect(r.success).toBe(true);
  });
});

describe("tenantFieldSettingRowSchema", () => {
  it("accepts a valid row", () => {
    const r = tenantFieldSettingRowSchema.safeParse({
      fieldCode: "item_code",
      enabled: true,
      purpose: "match_source",
      displayLabel: "品目",
      sortOrder: 10,
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown purpose", () => {
    const r = tenantFieldSettingRowSchema.safeParse({
      fieldCode: "item_code",
      enabled: true,
      purpose: "unknown",
      displayLabel: null,
      sortOrder: 10,
    });
    expect(r.success).toBe(false);
  });
});

describe("csvImportDefinitionInputSchema (Phase 5c)", () => {
  const validImport = {
    id: "new-csv-import",
    businessCode: "receiving" as const,
    targetTable: "movement_records",
    definitionCode: "RECV-DEFAULT",
    definitionName: "入庫 既定",
    encoding: "utf8" as const,
    delimiter: "comma" as const,
    startRow: 2,
    duplicateAction: "error" as const,
    enabled: true,
    columnMapping: [
      {
        csvColumnIndex: 1,
        targetColumn: "item_code",
        required: true,
        defaultValue: null,
      },
      {
        csvColumnIndex: 2,
        targetColumn: "quantity",
        required: false,
        defaultValue: "0",
      },
    ],
  };

  it("accepts a minimum valid import definition", () => {
    expect(csvImportDefinitionInputSchema.safeParse(validImport).success).toBe(true);
  });

  it("rejects duplicate csv_column_index", () => {
    const r = csvImportDefinitionInputSchema.safeParse({
      ...validImport,
      columnMapping: [
        validImport.columnMapping[0],
        { ...validImport.columnMapping[0], targetColumn: "x" },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects more than 50 mapping rows", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({
      csvColumnIndex: i + 1,
      targetColumn: `c${i}`,
      required: false,
      defaultValue: null,
    }));
    const r = csvImportDefinitionInputSchema.safeParse({
      ...validImport,
      columnMapping: many,
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid duplicate_action", () => {
    const r = csvImportDefinitionInputSchema.safeParse({
      ...validImport,
      duplicateAction: "merge",
    });
    expect(r.success).toBe(false);
  });

  it("rejects startRow < 1", () => {
    const r = csvImportDefinitionInputSchema.safeParse({
      ...validImport,
      startRow: 0,
    });
    expect(r.success).toBe(false);
  });

  it("rejects target_column with uppercase letters", () => {
    const r = csvImportDefinitionInputSchema.safeParse({
      ...validImport,
      columnMapping: [
        {
          csvColumnIndex: 1,
          targetColumn: "ItemCode",
          required: true,
          defaultValue: null,
        },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe("csvExportDefinitionInputSchema (Phase 5c)", () => {
  const validExport = {
    id: "new-csv-export",
    businessCode: "manufacturing" as const,
    sourceTable: "manufacturing_records",
    definitionCode: "MFG-EXP",
    definitionName: "製造 出力",
    encoding: "shift_jis" as const,
    delimiter: "tab" as const,
    includeHeader: true,
    enabled: true,
    columnSelection: [
      { sourceColumn: "item_code", headerLabel: "品目コード", sortOrder: 10 },
      { sourceColumn: "quantity", headerLabel: "数量", sortOrder: 20 },
    ],
  };

  it("accepts a minimum valid export definition", () => {
    expect(csvExportDefinitionInputSchema.safeParse(validExport).success).toBe(true);
  });

  it("rejects duplicate source_column", () => {
    const r = csvExportDefinitionInputSchema.safeParse({
      ...validExport,
      columnSelection: [
        validExport.columnSelection[0],
        { ...validExport.columnSelection[0], headerLabel: "重複" },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid delimiter", () => {
    const r = csvExportDefinitionInputSchema.safeParse({
      ...validExport,
      delimiter: "semicolon",
    });
    expect(r.success).toBe(false);
  });

  it("rejects header_label with control char", () => {
    const r = csvExportDefinitionInputSchema.safeParse({
      ...validExport,
      columnSelection: [
        { sourceColumn: "item_code", headerLabel: "品目\x00", sortOrder: 10 },
      ],
    });
    expect(r.success).toBe(false);
  });
});

describe("workSettingsInputSchema (Phase 5c)", () => {
  const validSettings = {
    id: "new-ws-1",
    businessCode: "receiving" as const,
    workMode: "ticket" as const,
    matchMode: "double" as const,
    ngFlow: "block" as const,
    correctionApproval: false,
    headerFormatId: "11111111-1111-1111-1111-111111111111",
    lineFormatId: null,
    labelFormatId: null,
    matchRuleId: null,
    enabled: true,
  };

  it("accepts a valid work_settings row", () => {
    expect(workSettingsInputSchema.safeParse(validSettings).success).toBe(true);
  });

  it("accepts blank ('') for optional UUID fields and coerces to null", () => {
    const r = workSettingsInputSchema.safeParse({
      ...validSettings,
      headerFormatId: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.headerFormatId).toBeNull();
    }
  });

  it("rejects invalid ng_flow", () => {
    const r = workSettingsInputSchema.safeParse({
      ...validSettings,
      ngFlow: "ignore",
    });
    expect(r.success).toBe(false);
  });

  it("rejects malformed UUID for headerFormatId", () => {
    const r = workSettingsInputSchema.safeParse({
      ...validSettings,
      headerFormatId: "not-a-uuid",
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid match_mode", () => {
    const r = workSettingsInputSchema.safeParse({
      ...validSettings,
      matchMode: "triple",
    });
    expect(r.success).toBe(false);
  });
});

describe("workInputFieldSettingInputSchema (Phase 5c)", () => {
  it("accepts a valid input-field row", () => {
    const r = workInputFieldSettingInputSchema.safeParse({
      id: "new-wif-1",
      businessCode: "picking",
      fieldCode: "item_code",
      enabled: true,
      required: true,
      sortOrder: 10,
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty field_code", () => {
    const r = workInputFieldSettingInputSchema.safeParse({
      id: "new-wif-2",
      businessCode: "picking",
      fieldCode: "",
      enabled: true,
      required: false,
      sortOrder: 10,
    });
    expect(r.success).toBe(false);
  });
});

describe("correctionReasonSchema (Phase 5d)", () => {
  it("accepts 1..256 chars without control characters", () => {
    expect(correctionReasonSchema.safeParse("数量入力ミス").success).toBe(true);
    expect(correctionReasonSchema.safeParse("a".repeat(256)).success).toBe(true);
  });

  it("rejects empty and over-length reasons", () => {
    expect(correctionReasonSchema.safeParse("").success).toBe(false);
    expect(correctionReasonSchema.safeParse("a".repeat(257)).success).toBe(false);
  });

  it("rejects control characters", () => {
    expect(correctionReasonSchema.safeParse("理由\x00").success).toBe(false);
  });
});

describe("submitMovementCorrectionInputSchema (Phase 5d)", () => {
  const valid = {
    previousRecordId: "11111111-1111-1111-1111-111111111111",
    reason: "ロケ修正",
    payload: {
      business_code: "receiving" as const,
      item_code: "ITEM-001",
      quantity: 10,
      lot: null,
      location_code: "A-01",
      notes: null,
    },
  };

  it("accepts a valid movement correction input", () => {
    const r = submitMovementCorrectionInputSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("rejects non-UUID previousRecordId", () => {
    const r = submitMovementCorrectionInputSchema.safeParse({
      ...valid,
      previousRecordId: "not-a-uuid",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown business_code", () => {
    const r = submitMovementCorrectionInputSchema.safeParse({
      ...valid,
      payload: { ...valid.payload, business_code: "inventory" as never },
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative quantity", () => {
    const r = submitMovementCorrectionInputSchema.safeParse({
      ...valid,
      payload: { ...valid.payload, quantity: -1 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty reason", () => {
    const r = submitMovementCorrectionInputSchema.safeParse({
      ...valid,
      reason: "",
    });
    expect(r.success).toBe(false);
  });
});

describe("submitInventoryCorrectionInputSchema (Phase 5d)", () => {
  const valid = {
    previousRecordId: "22222222-2222-2222-2222-222222222222",
    reason: "数量訂正",
    payload: {
      item_code: "ITEM-002",
      counted_quantity: 5,
      lot: "L-2026",
      location_code: null,
      notes: null,
    },
  };

  it("accepts a valid inventory correction input", () => {
    expect(submitInventoryCorrectionInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty item_code", () => {
    const r = submitInventoryCorrectionInputSchema.safeParse({
      ...valid,
      payload: { ...valid.payload, item_code: "" },
    });
    expect(r.success).toBe(false);
  });

  it("coerces empty lot to null", () => {
    const r = submitInventoryCorrectionInputSchema.safeParse({
      ...valid,
      payload: { ...valid.payload, lot: "" },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.payload.lot).toBeNull();
    }
  });
});

describe("submitManufacturingCorrectionInputSchema (Phase 5d)", () => {
  const valid = {
    previousRecordId: "33333333-3333-3333-3333-333333333333",
    reason: "実数量訂正",
    payload: {
      work_date: "2026-05-14",
      actual_quantity: 100,
      good_quantity: 95,
      defect_quantity: 5,
      lot: null,
      started_at: null,
      ended_at: null,
      notes: null,
      rollback_inflow: false,
    },
  };

  it("accepts a valid manufacturing correction input", () => {
    expect(submitManufacturingCorrectionInputSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects good_quantity > actual_quantity", () => {
    const r = submitManufacturingCorrectionInputSchema.safeParse({
      ...valid,
      payload: { ...valid.payload, good_quantity: 200 },
    });
    expect(r.success).toBe(false);
  });

  it("rejects malformed work_date", () => {
    const r = submitManufacturingCorrectionInputSchema.safeParse({
      ...valid,
      payload: { ...valid.payload, work_date: "2026/05/14" },
    });
    expect(r.success).toBe(false);
  });

  it("requires rollback_inflow boolean", () => {
    const r = submitManufacturingCorrectionInputSchema.safeParse({
      ...valid,
      payload: {
        ...valid.payload,
        rollback_inflow: "true" as unknown as boolean,
      },
    });
    expect(r.success).toBe(false);
  });
});

describe("preferencesInputSchema (Phase 5d)", () => {
  it("accepts ja/auto/important defaults", () => {
    expect(
      preferencesInputSchema.safeParse({
        language: "ja",
        theme: "auto",
        notification: "important",
      }).success,
    ).toBe(true);
  });

  it("rejects unknown language", () => {
    expect(
      preferencesInputSchema.safeParse({
        language: "fr",
        theme: "auto",
        notification: "all",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown theme", () => {
    expect(
      preferencesInputSchema.safeParse({
        language: "ja",
        theme: "midnight",
        notification: "none",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown notification level", () => {
    expect(
      preferencesInputSchema.safeParse({
        language: "en",
        theme: "light",
        notification: "loud",
      }).success,
    ).toBe(false);
  });
});

describe("profileInputSchema (Phase 5d)", () => {
  it("accepts a 1..64 display name + optional phone", () => {
    const r = profileInputSchema.safeParse({
      displayName: "現場 太郎",
      phone: "+81-90-1234-5678",
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty display name", () => {
    const r = profileInputSchema.safeParse({
      displayName: "",
      phone: null,
    });
    expect(r.success).toBe(false);
  });

  it("rejects phone with alphabetical characters", () => {
    const r = profileInputSchema.safeParse({
      displayName: "山田",
      phone: "tel:123",
    });
    expect(r.success).toBe(false);
  });

  it("coerces empty phone to null", () => {
    const r = profileInputSchema.safeParse({
      displayName: "山田",
      phone: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.phone).toBeNull();
    }
  });
});

describe("zodIssuesToFieldErrors", () => {
  it("maps zod issues to a {key:message} map", () => {
    const r = matchRuleSchema.safeParse({
      id: "new-z",
      ruleCode: "",
      ruleName: "",
      businessCode: "picking",
      enabled: true,
      lines: [],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const m = zodIssuesToFieldErrors(r.error);
      expect(m.ruleCode).toBeDefined();
      expect(m.ruleName).toBeDefined();
    }
  });
});
