import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { ManufacturingFlow } from "./ManufacturingFlow";
import type { ProcessOption } from "@/components/works/ProcessSelector";

export const metadata: Metadata = { title: "製造実績" };

type ProcessRow = {
  id: string;
  process_order: number | string;
  status: string;
  manufacturing_plan_id: string;
  manufacturing_plans:
    | {
        order_no: string | null;
        item_code: string | null;
      }
    | null;
};

type DefectRow = {
  id: string;
  defect_code: string | null;
  defect_name: string | null;
};

/**
 * Phase 4c — /app/works/manufacturing entry.
 *
 * Server component. Pins tenant via the existing app session helper, then
 * tries to surface up to 50 pending mfg_processes + 200 defect masters as
 * a UX nicety. RLS scopes both reads automatically; if env/credentials are
 * missing we fall through to free-form UUID input.
 *
 * service_role is never used here — every read flows through the anon-JWT
 * server client (createClient) so bundle leakage scope (R-P4-10) stays
 * unchanged.
 */
type SearchParams = { mode?: string | string[] };

export default async function ManufacturingPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const session = await getAppSession();
  if (session.kind === "unauthenticated") {
    redirect("/login?next=/app/works/manufacturing");
  }

  const sp = (await searchParams) ?? {};
  const modeParam = Array.isArray(sp.mode) ? sp.mode[0] : sp.mode;
  const startMode: "scan" | "form" = modeParam === "scan" ? "scan" : "form";

  let processOptions: ProcessOption[] = [];
  let defectOptions: { id: string; label: string }[] = [];

  if (supabaseConfigured()) {
    try {
      const supabase = await createClient();
      const { data: procRows } = await supabase
        .from("mfg_processes")
        .select(
          "id, process_order, status, manufacturing_plan_id, manufacturing_plans(order_no, item_code)",
        )
        .is("deleted_at", null)
        .in("status", ["pending", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(50);
      processOptions = ((procRows ?? []) as unknown as ProcessRow[]).map((r) => {
        const ord = r.manufacturing_plans?.order_no ?? "-";
        const item = r.manufacturing_plans?.item_code ?? "-";
        return {
          id: r.id,
          label: `${ord} / 工程 ${r.process_order} (${r.status})`,
          helper: `品目 ${item}`,
        };
      });

      const { data: defectRows } = await supabase
        .from("defects")
        .select("id, defect_code, defect_name")
        .is("deleted_at", null)
        .order("defect_code", { ascending: true })
        .limit(200);
      defectOptions = ((defectRows ?? []) as DefectRow[]).map((d) => ({
        id: d.id,
        label: `${d.defect_code ?? "?"} — ${d.defect_name ?? "(名称なし)"}`,
      }));
    } catch {
      // RLS / network / migration drift — fall back to free-form mode silently
      // so the UI never blocks. The form itself surfaces validation errors.
    }
  }

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="manufacturing-root"
      data-start-mode={startMode}
    >
      <ManufacturingFlow
        processOptions={processOptions}
        defectOptions={defectOptions}
      />
    </div>
  );
}
