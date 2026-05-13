// inventory-csv-import — Phase 3b Edge Function (Deno runtime).
//
// Mirrors movement-csv-import, but for inventory_plans / inventory_plan_lines.
// Same security envelope (10 MB cap, 100k row cap, 200-error short-circuit,
// service-role insert with JWT-pinned tenant_id, csv_import_jobs header
// row for UI polling). See the sibling function's header for the full
// design rationale — comments here only call out the differences.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 100_000;
const MAX_ERRORS = 200;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type ImportKind = "plan" | "plan_line";
type RowError = { row: number; code: string; message: string };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return jsonResponse(status, { error: { code, message } });
}

function isAcceptableContentType(ct: string): boolean {
  const lower = ct.toLowerCase();
  return (
    lower.includes("text/csv") ||
    lower.includes("application/vnd.ms-excel") ||
    lower.includes("spreadsheet") ||
    lower.includes("application/octet-stream")
  );
}

async function readUserAndTenant(authHeader: string): Promise<
  | { userId: string; tenantId: string }
  | { error: { status: number; code: string; message: string } }
> {
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return {
      error: {
        status: 401,
        code: "unauthenticated",
        message: "missing bearer token",
      },
    };
  }
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.auth.getUser();
  if (error || !data?.user) {
    return {
      error: { status: 401, code: "unauthenticated", message: "invalid token" },
    };
  }
  const meta = (data.user.app_metadata ?? {}) as Record<string, unknown>;
  const tenantId =
    typeof meta.tenant_id === "string" && meta.tenant_id.length > 0
      ? meta.tenant_id
      : null;
  if (!tenantId) {
    return {
      error: { status: 403, code: "tenant_missing", message: "tenant claim missing" },
    };
  }
  return { userId: data.user.id, tenantId };
}

function splitCsvRow(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  let cur = "";
  let inQuotes = false;
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      cells.push(cur);
      cur = "";
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  cells.push(cur);
  return cells;
}

function validateInventoryPlanRow(
  cells: string[],
): { ok: true; row: Record<string, any> } | { ok: false; code: string; message: string } {
  // Expected: plan_code, plan_name, plan_date, status, notes.
  if (cells.length < 2) {
    return { ok: false, code: "column_count", message: "plan_code/plan_name required" };
  }
  const [plan_code, plan_name, plan_date, status, notes] = cells.map((c) => c.trim());
  if (!plan_code) return { ok: false, code: "plan_code", message: "plan_code required" };
  if (!plan_name) return { ok: false, code: "plan_name", message: "plan_name required" };
  if (plan_code.length > 64) return { ok: false, code: "plan_code", message: "plan_code too long" };
  if (/[\r\n ]/.test(plan_code)) {
    return { ok: false, code: "plan_code", message: "control chars not allowed" };
  }
  return {
    ok: true,
    row: {
      plan_code,
      plan_name,
      plan_date: plan_date || null,
      status: status || "active",
      notes: notes || null,
    },
  };
}

function validateInventoryPlanLineRow(
  cells: string[],
): { ok: true; row: Record<string, any> } | { ok: false; code: string; message: string } {
  // Expected: inventory_plan_id, line_no, item_code, location_code,
  // expected_quantity, notes.
  if (cells.length < 4) {
    return { ok: false, code: "column_count", message: "inventory_plan_id/line_no/item_code/qty required" };
  }
  const [inventory_plan_id, line_no_s, item_code, location_code, expected_quantity_s, notes] =
    cells.map((c) => c.trim());
  if (!/^[0-9a-fA-F-]{36}$/.test(inventory_plan_id)) {
    return { ok: false, code: "inventory_plan_id", message: "inventory_plan_id must be uuid" };
  }
  const line_no = Number(line_no_s);
  if (!Number.isInteger(line_no) || line_no < 1) {
    return { ok: false, code: "line_no", message: "line_no must be positive integer" };
  }
  if (!item_code || item_code.length > 64) {
    return { ok: false, code: "item_code", message: "item_code 1-64 chars required" };
  }
  if (/[\r\n ]/.test(item_code)) {
    return { ok: false, code: "item_code", message: "control chars not allowed" };
  }
  const expected_quantity = Number(expected_quantity_s);
  if (!Number.isFinite(expected_quantity) || expected_quantity < 0) {
    return { ok: false, code: "expected_quantity", message: "expected_quantity must be nonneg number" };
  }
  return {
    ok: true,
    row: {
      inventory_plan_id,
      line_no,
      item_code,
      location_code: location_code || null,
      expected_quantity,
      notes: notes || null,
    },
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return errorResponse(405, "method_not_allowed", "POST required");
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return errorResponse(500, "config_missing", "function not configured");
  }

  const contentType = req.headers.get("Content-Type") ?? "";
  if (!isAcceptableContentType(contentType)) {
    return errorResponse(415, "unsupported_content_type", "CSV upload required");
  }

  const contentLength = Number(req.headers.get("Content-Length") ?? "0");
  if (contentLength > MAX_BYTES) {
    return errorResponse(413, "file_too_large", "exceeds 10MB cap");
  }

  const url = new URL(req.url);
  const kind = (url.searchParams.get("kind") ?? "plan_line") as ImportKind;
  if (kind !== "plan" && kind !== "plan_line") {
    return errorResponse(400, "invalid_kind", "?kind must be plan or plan_line");
  }

  const ctx = await readUserAndTenant(req.headers.get("Authorization") ?? "");
  if ("error" in ctx) {
    return errorResponse(ctx.error.status, ctx.error.code, ctx.error.message);
  }

  const reader = req.body?.getReader();
  if (!reader) return errorResponse(400, "empty_body", "no body");
  let received = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      received += value.byteLength;
      if (received > MAX_BYTES) {
        return errorResponse(413, "file_too_large", "exceeds 10MB cap");
      }
      chunks.push(value);
    }
  }
  const total = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    total.set(c, offset);
    offset += c.byteLength;
  }
  const text = new TextDecoder("utf-8").decode(total);

  const rawLines = text.split(/\r\n|\n/);
  while (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") rawLines.pop();
  if (rawLines.length === 0) {
    return errorResponse(400, "empty_csv", "empty CSV");
  }
  if (rawLines.length > MAX_ROWS + 1) {
    return errorResponse(413, "row_limit_exceeded", `exceeds ${MAX_ROWS} rows`);
  }

  const dataLines = rawLines.slice(1);
  const valid: Array<Record<string, any>> = [];
  const errors: RowError[] = [];
  for (let i = 0; i < dataLines.length; i++) {
    if (errors.length >= MAX_ERRORS) break;
    const line = dataLines[i];
    if (line.trim() === "") continue;
    const cells = splitCsvRow(line);
    const result =
      kind === "plan"
        ? validateInventoryPlanRow(cells)
        : validateInventoryPlanLineRow(cells);
    if (!result.ok) {
      errors.push({ row: i + 2, code: result.code, message: result.message });
      continue;
    }
    valid.push(result.row);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const sourcePath = url.searchParams.get("path") ?? "";
  const { data: job, error: jobErr } = await admin
    .from("csv_import_jobs")
    .insert({
      tenant_id: ctx.tenantId,
      kind: "inventory",
      source_storage_path: sourcePath,
      total_rows: dataLines.length,
      success_rows: 0,
      error_rows: errors.length,
      errors: errors,
      status: "running",
      requested_by: ctx.userId,
    })
    .select("id")
    .single();
  if (jobErr || !job) {
    return errorResponse(500, "job_create_failed", jobErr?.message ?? "");
  }

  let inserted = 0;
  if (valid.length > 0) {
    const table = kind === "plan" ? "inventory_plans" : "inventory_plan_lines";
    const rowsToInsert = valid.map((r) => ({ ...r, tenant_id: ctx.tenantId }));
    const { data: insData, error: insErr } = await admin
      .from(table)
      .insert(rowsToInsert)
      .select("id");
    if (insErr) {
      await admin
        .from("csv_import_jobs")
        .update({
          status: "failed",
          error_rows: errors.length + valid.length,
          finished_at: new Date().toISOString(),
          errors: [
            ...errors,
            { row: 0, code: insErr.code ?? "insert_failed", message: insErr.message },
          ],
        })
        .eq("id", job.id);
      return errorResponse(500, "bulk_insert_failed", insErr.message);
    }
    inserted = insData?.length ?? 0;
  }

  await admin
    .from("csv_import_jobs")
    .update({
      status: errors.length > 0 && inserted === 0 ? "failed" : "succeeded",
      success_rows: inserted,
      error_rows: errors.length,
      finished_at: new Date().toISOString(),
      errors,
    })
    .eq("id", job.id);

  return jsonResponse(200, {
    job_id: job.id,
    total: dataLines.length,
    succeeded: inserted,
    errors,
  });
});
