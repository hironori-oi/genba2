// manufacturing-plan-csv-import — Phase 4b Edge Function (Deno runtime).
//
// Accepts an authenticated CSV upload and inserts rows into either
// manufacturing_plans (kind=plan) or mfg_processes (kind=process).
// Mirrors the security envelope of movement-csv-import / inventory-csv-
// import from Phase 3b:
//
//   * Authorization: Bearer <JWT> — validated against the Supabase Auth
//     /user endpoint; tenant_id is extracted from `app_metadata` and is
//     NEVER taken from a caller-supplied form field.
//   * Content-Type: must be text/csv / application/vnd.ms-excel / a
//     spreadsheet MIME / application/octet-stream. Anything else → 415.
//   * Size: hard cap 10 MB. Content-Length > cap → 413 immediately.
//     Streaming reads are byte-counted; we still fail-fast if a chunked
//     upload sneaks past the header check.
//   * Row count: hard cap 100_000 rows after header → 413.
//   * Per-row zod-style validation: errors are collected up to 200
//     entries then we short-circuit the rest of the parse so a malicious
//     file cannot DoS the function with millions of error objects.
//   * Formula injection: every text cell that starts with `=`, `+`, `-`,
//     `@`, `\t`, or `\r` is sanitised by prepending `'` (see
//     src/lib/csv/sanitize.ts for the export path; the same rule applies
//     here on import so a malicious CSV cannot land a literal `=HYPERLINK`
//     in manufacturing_plans.order_no etc. and be re-exported untouched).
//   * Inserts use the service-role client (env var, never client-exposed)
//     so RLS does not block the bulk insert — tenant_id is pinned from
//     the caller's verified JWT, not from the file. The csv_import_jobs
//     header row is INSERTed first so the UI has a polling target even
//     if the bulk insert later fails.
//   * `errors` jsonb never includes raw cell values — only `{row, code,
//     message}` — to keep raw_value-like leakage out of the polling
//     response.
//
// We deliberately log very little: no `console.log(rawText)` ever, no
// JWT or Authorization header ever, no service-role key (it lives only
// in Deno.env). Error responses follow `{ error: { code, message } }`.

// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  splitCsvRow,
  validateManufacturingPlanRow,
  validateMfgProcessRow,
} from "./parser.ts";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — ARCHITECTURE §4 / PRODUCT_SPEC §6
const MAX_ROWS = 100_000;
const MAX_ERRORS = 200;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type ImportKind = "plan" | "process";
type RowError = { row: number; code: string; message: string };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
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

// ---------------------------------------------------------------------
// JWT verification + tenant pin.
// ---------------------------------------------------------------------
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
  // Verify the JWT against Supabase Auth. We do not decode/trust the
  // token locally — round-trip ensures Auth's revocation list is honored.
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
  // app_metadata is the only authorisation surface — raw_user_metadata is
  // user-writable and must never gate tenant resolution.
  const meta = (data.user.app_metadata ?? {}) as Record<string, unknown>;
  const tenantId =
    typeof meta.tenant_id === "string" && meta.tenant_id.length > 0
      ? meta.tenant_id
      : null;
  if (!tenantId) {
    return {
      error: {
        status: 403,
        code: "tenant_missing",
        message: "tenant claim missing",
      },
    };
  }
  return { userId: data.user.id, tenantId };
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
    return errorResponse(
      415,
      "unsupported_content_type",
      "CSV upload required",
    );
  }

  const contentLength = Number(req.headers.get("Content-Length") ?? "0");
  if (contentLength > MAX_BYTES) {
    return errorResponse(413, "file_too_large", "exceeds 10MB cap");
  }

  // ?kind=plan|process
  const url = new URL(req.url);
  const kind = (url.searchParams.get("kind") ?? "plan") as ImportKind;
  if (kind !== "plan" && kind !== "process") {
    return errorResponse(400, "invalid_kind", "?kind must be plan or process");
  }

  const ctx = await readUserAndTenant(
    req.headers.get("Authorization") ?? "",
  );
  if ("error" in ctx) {
    return errorResponse(ctx.error.status, ctx.error.code, ctx.error.message);
  }

  // Stream the body up to MAX_BYTES so a missing Content-Length cannot
  // bypass the size cap.
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
  while (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }
  if (rawLines.length === 0) {
    return errorResponse(400, "empty_csv", "empty CSV");
  }
  if (rawLines.length > MAX_ROWS + 1) {
    // +1 because we treat row 0 as the header.
    return errorResponse(
      413,
      "row_limit_exceeded",
      `exceeds ${MAX_ROWS} rows`,
    );
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
        ? validateManufacturingPlanRow(cells)
        : validateMfgProcessRow(cells);
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
      kind: "manufacturing_plan",
      source_storage_path: sourcePath,
      total_rows: dataLines.length,
      success_rows: 0,
      error_rows: errors.length,
      errors,
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
    const table = kind === "plan" ? "manufacturing_plans" : "mfg_processes";
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
            {
              row: 0,
              code: insErr.code ?? "insert_failed",
              message: insErr.message,
            },
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
