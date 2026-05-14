import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { isErr } from "@/lib/admin/shared/result";
import { selectAuditEntries, toCsv } from "@/lib/admin/audit-logs/select";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const guard = await ensureTenantAdmin();
  if (isErr(guard)) {
    return new Response(guard.message, { status: 403 });
  }
  const { supabase, tenantId } = guard.data;
  const url = new URL(req.url);

  const filter = {
    table: url.searchParams.get("table"),
    op: url.searchParams.get("op"),
    limit: 500,
  };

  const { rows, error } = await selectAuditEntries(supabase, tenantId, filter);
  if (error) {
    return new Response(`load_error: ${error}`, { status: 500 });
  }

  const csv = toCsv(rows);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=\"audit-logs-${new Date().toISOString().slice(0, 10)}.csv\"`,
      "Cache-Control": "no-store",
    },
  });
}
