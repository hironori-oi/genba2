/**
 * Demo / preview fixtures for the Phase 2 admin screens.
 *
 * In production these screens read from Supabase via the user's anon JWT
 * (RLS-gated). When the Supabase env is missing (initial dev, ephemeral CI,
 * pre-credentials owner sign-off) we fall back to this fixture set so the
 * UI is still inspectable end-to-end. The fixtures DO NOT contain any
 * tenant data and never touch the network.
 *
 * NOTE: Phase 5 will replace these reads with the real Supabase select +
 * server-action mutations; the fixtures stay only as a `mode === "demo"`
 * branch so designers and the QA pipeline can render the screens without
 * provisioned credentials.
 */

import type { QrFormatDefinition } from "@/lib/qr";

export type FieldSettingPurpose =
  | "identify_header"
  | "identify_line"
  | "match_source"
  | "item_label"
  | "display_only";

export const FIELD_PURPOSES: ReadonlyArray<{ value: FieldSettingPurpose; label: string; helper: string }> = [
  {
    value: "identify_header",
    label: "ヘッダー識別",
    helper: "movement_plans 等のヘッダー行を特定するための鍵となる項目。",
  },
  {
    value: "identify_line",
    label: "明細識別",
    helper: "明細行 (plan_lines) を一意に特定するための項目。",
  },
  {
    value: "match_source",
    label: "照合ソース",
    helper: "2点照合でラベルと突き合わせる元値となる項目。",
  },
  {
    value: "item_label",
    label: "ラベル項目",
    helper: "現品ラベル QR に乗る品目情報。",
  },
  {
    value: "display_only",
    label: "表示のみ",
    helper: "保存はするが識別・照合には使わない参考情報。",
  },
];

export type FieldSetting = {
  fieldCode: string;
  label: string;
  dataType: "text" | "numeric" | "date" | "boolean";
  enabled: boolean;
  purpose: FieldSettingPurpose;
  displayLabel: string | null;
  sortOrder: number;
};

export type MatchRule = {
  id: string;
  ruleCode: string;
  ruleName: string;
  businessCode: "receiving" | "picking" | "inventory" | "manufacturing";
  enabled: boolean;
  lines: Array<{
    sortOrder: number;
    lineFieldCode: string;
    labelFieldCode: string;
    compareType: "equals" | "numeric_equals";
    missingValueAction: "ng" | "warning" | "skip";
    mismatchAction: "ng" | "warning";
  }>;
};

export const DEMO_FIELD_SETTINGS: FieldSetting[] = [
  { fieldCode: "item_code", label: "品目コード", dataType: "text", enabled: true, purpose: "match_source", displayLabel: "品目コード", sortOrder: 10 },
  { fieldCode: "quantity", label: "数量", dataType: "numeric", enabled: true, purpose: "item_label", displayLabel: "数量", sortOrder: 20 },
  { fieldCode: "lot", label: "ロット", dataType: "text", enabled: true, purpose: "item_label", displayLabel: "ロット", sortOrder: 30 },
  { fieldCode: "location_code", label: "ロケーション", dataType: "text", enabled: true, purpose: "item_label", displayLabel: "ロケーション", sortOrder: 40 },
  { fieldCode: "order_no", label: "注文番号", dataType: "text", enabled: true, purpose: "identify_header", displayLabel: "注文番号", sortOrder: 50 },
  { fieldCode: "customer_code", label: "顧客コード", dataType: "text", enabled: false, purpose: "display_only", displayLabel: "顧客コード", sortOrder: 60 },
  { fieldCode: "shipment_no", label: "出荷番号", dataType: "text", enabled: true, purpose: "identify_header", displayLabel: "出荷番号", sortOrder: 70 },
  { fieldCode: "ship_date", label: "出荷日", dataType: "date", enabled: true, purpose: "identify_header", displayLabel: "出荷日", sortOrder: 80 },
  { fieldCode: "line_no", label: "明細番号", dataType: "numeric", enabled: true, purpose: "identify_line", displayLabel: "明細番号", sortOrder: 90 },
  { fieldCode: "process_code", label: "工程コード", dataType: "text", enabled: false, purpose: "display_only", displayLabel: "工程コード", sortOrder: 100 },
  { fieldCode: "equipment_code", label: "設備コード", dataType: "text", enabled: false, purpose: "display_only", displayLabel: "設備コード", sortOrder: 110 },
  { fieldCode: "defect_code", label: "不適合コード", dataType: "text", enabled: false, purpose: "display_only", displayLabel: "不適合コード", sortOrder: 120 },
];

const DEMO_TENANT_ID = "00000000-demo-0000-0000-000000000000";

export const DEMO_QR_FORMATS: QrFormatDefinition[] = [
  {
    id: "f-label-v1",
    tenantId: DEMO_TENANT_ID,
    qrType: "label",
    version: 1,
    formatCode: "LBL",
    formatName: "現品ラベル V1",
    delimiter: "pipe",
    delimiterChar: null,
    encoding: "utf8",
    readable: true,
    issuable: false,
    validFrom: "2026-01-01",
    items: [
      { position: 1, qrItemName: "品目コード", targetColumn: "item_code", required: true, dataType: "text", missingValueAction: "error" },
      { position: 2, qrItemName: "数量", targetColumn: "quantity", required: true, dataType: "numeric", missingValueAction: "error" },
      { position: 3, qrItemName: "ロケーション", targetColumn: "location_code", required: false, dataType: "text", missingValueAction: "allow_blank" },
      { position: 4, qrItemName: "注文番号", targetColumn: "order_no", required: false, dataType: "text", missingValueAction: "allow_blank" },
    ],
  },
  {
    id: "f-label-v2",
    tenantId: DEMO_TENANT_ID,
    qrType: "label",
    version: 2,
    formatCode: "LBL",
    formatName: "現品ラベル V2 (ロット追加)",
    delimiter: "pipe",
    delimiterChar: null,
    encoding: "utf8",
    readable: true,
    issuable: true,
    validFrom: "2026-05-01",
    items: [
      { position: 1, qrItemName: "品目コード", targetColumn: "item_code", required: true, dataType: "text", missingValueAction: "error" },
      { position: 2, qrItemName: "数量", targetColumn: "quantity", required: true, dataType: "numeric", missingValueAction: "error" },
      { position: 3, qrItemName: "ロケーション", targetColumn: "location_code", required: false, dataType: "text", missingValueAction: "allow_blank" },
      { position: 4, qrItemName: "注文番号", targetColumn: "order_no", required: false, dataType: "text", missingValueAction: "allow_blank" },
      { position: 5, qrItemName: "ロット", targetColumn: "lot", required: false, dataType: "text", missingValueAction: "allow_blank" },
    ],
  },
  {
    id: "f-location-v1",
    tenantId: DEMO_TENANT_ID,
    qrType: "location",
    version: 1,
    formatCode: "LOC",
    formatName: "ロケーション V1",
    delimiter: "pipe",
    delimiterChar: null,
    encoding: "utf8",
    readable: true,
    issuable: false,
    validFrom: "2026-01-01",
    items: [
      { position: 1, qrItemName: "ロケーション", targetColumn: "location_code", required: true, dataType: "text", missingValueAction: "error" },
    ],
    // 例: A-03-15 (エリア-列-段)。pattern が空のテナントでは自由入力にフォールバック。
    pattern: "^[A-Z]-\\d{2}-\\d{2}$",
  },
  {
    id: "f-header-v1",
    tenantId: DEMO_TENANT_ID,
    qrType: "header",
    version: 1,
    formatCode: "HDR",
    formatName: "ヘッダー V1",
    delimiter: "pipe",
    delimiterChar: null,
    encoding: "utf8",
    readable: true,
    issuable: true,
    validFrom: "2026-01-01",
    items: [
      { position: 1, qrItemName: "出荷番号", targetColumn: "shipment_no", required: true, dataType: "text", missingValueAction: "error" },
      { position: 2, qrItemName: "出荷日", targetColumn: "ship_date", required: false, dataType: "date", dateFormat: "YYYY-MM-DD", missingValueAction: "allow_blank" },
      { position: 3, qrItemName: "顧客コード", targetColumn: "customer_code", required: false, dataType: "text", missingValueAction: "allow_blank" },
    ],
  },
];

export const DEMO_MATCH_RULES: MatchRule[] = [
  {
    id: "r-picking-default",
    ruleCode: "PICKING-DEFAULT",
    ruleName: "ピッキング既定 (品目+ロット)",
    businessCode: "picking",
    enabled: true,
    lines: [
      {
        sortOrder: 1,
        lineFieldCode: "item_code",
        labelFieldCode: "item_code",
        compareType: "equals",
        missingValueAction: "ng",
        mismatchAction: "ng",
      },
      {
        sortOrder: 2,
        lineFieldCode: "lot",
        labelFieldCode: "lot",
        compareType: "equals",
        missingValueAction: "warning",
        mismatchAction: "warning",
      },
    ],
  },
  {
    id: "r-receiving-strict",
    ruleCode: "RECEIVING-STRICT",
    ruleName: "入庫: 品目+数量厳格",
    businessCode: "receiving",
    enabled: true,
    lines: [
      {
        sortOrder: 1,
        lineFieldCode: "item_code",
        labelFieldCode: "item_code",
        compareType: "equals",
        missingValueAction: "ng",
        mismatchAction: "ng",
      },
      {
        sortOrder: 2,
        lineFieldCode: "quantity",
        labelFieldCode: "quantity",
        compareType: "numeric_equals",
        missingValueAction: "ng",
        mismatchAction: "ng",
      },
    ],
  },
];
