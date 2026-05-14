import { NextResponse } from "next/server";
import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { encodeCsv } from "@/lib/csv/encode";
import { serializeCsvRow } from "@/lib/csv/sanitize";
import {
  CSV_TEMPLATE_COLUMNS,
  isCsvTemplateMaster,
} from "@/lib/csv/templates";

/**
 * Phase 5e-3 CSV template download (architect §3.6, R-P5-10/R-P5-12).
 *
 * Returns a header-only CSV for the requested master + encoding so an
 * operator can fill in rows and re-upload via the existing import job.
 *
 * Auth: tenant_admin / system_admin only — `ensureTenantAdmin` reads the
 * anon-JWT cookie session. No service_role; the response body is
 * deterministic and tenant-agnostic, so we do not need to read tenant
 * data, but we still gate on the role for parity with the rest of the
 * admin surface (architect §3.6 / R-P5-12).
 *
 * Formula injection defence: header cells are passed through
 * `serializeCsvRow`, which routes each cell through `sanitizeCsvCell`
 * (R-P5-10). Internal column names start with [a-z_] so the apostrophe
 * prepend is a defensive no-op today; if a future master adds a column
 * that starts with `=` / `+` / `-` / `@` the sanitizer still wins.
 */

const VALID_ENCODINGS = new Set(["utf8", "shift_jis"]);

export async function GET(
  _req: Request,
  context: { params: Promise<{ master: string; encoding: string }> },
) {
  const { master, encoding } = await context.params;

  if (!isCsvTemplateMaster(master)) {
    return NextResponse.json(
      { error: "unknown master", master },
      { status: 404 },
    );
  }
  if (!VALID_ENCODINGS.has(encoding)) {
    return NextResponse.json(
      { error: "unknown encoding", encoding },
      { status: 404 },
    );
  }

  const guard = await ensureTenantAdmin();
  if (guard.status === "error") {
    return NextResponse.json(
      { error: guard.code, message: guard.message },
      { status: guard.code === "forbidden" ? 403 : 401 },
    );
  }

  const columns = CSV_TEMPLATE_COLUMNS[master];
  const headerLine = serializeCsvRow(columns);
  // Trailing CRLF so Excel and other parsers detect a complete row.
  const body = `${headerLine}\r\n`;
  const buffer = encodeCsv(body, encoding as "utf8" | "shift_jis");

  const charset = encoding === "shift_jis" ? "Shift_JIS" : "utf-8";
  const filename = `${master}_template_${encoding}.csv`;

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": `text/csv; charset=${charset}`,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
