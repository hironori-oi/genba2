import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { ensureTenantAdmin } from "@/lib/admin/ensure-tenant-admin";
import { isErr } from "@/lib/admin/shared/result";
import { type MasterKind } from "@/lib/admin/shared/validation";
import { MastersEditor, type MastersEditorData } from "./MastersEditor";

/**
 * Phase 5b 製造系 master CRUD page (architect §3.2.6).
 *
 * Single route with five tabs: work_types / processes / equipment /
 * defect_groups / defects. Each tab renders a MasterCrudTable instance.
 *
 * Server-side fetch caps every master at 500 rows (architect §9 R-P5-17 —
 * client-side filter assumes a bounded set). When Supabase is unconfigured
 * the page shows a demo banner; rows render empty so primitives are still
 * visible for QA structure scans.
 */

const KINDS: ReadonlyArray<{ kind: MasterKind; label: string }> = [
  { kind: "work_types", label: "作業区分" },
  { kind: "processes", label: "工程" },
  { kind: "equipment", label: "設備" },
  { kind: "defect_groups", label: "不適合グループ" },
  { kind: "defects", label: "不適合" },
];

function parseKind(raw: unknown): MasterKind {
  if (typeof raw === "string" && KINDS.some((k) => k.kind === raw)) {
    return raw as MasterKind;
  }
  return "work_types";
}

export default async function MastersPage({
  searchParams,
}: {
  searchParams?: Promise<{ kind?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const activeKind = parseKind(sp.kind);

  const gate = await ensureTenantAdmin();

  let rows: MastersEditorData["rows"] = [];
  let processOptions: MastersEditorData["processOptions"] = [];
  let defectGroupOptions: MastersEditorData["defectGroupOptions"] = [];
  let liveMode = false;
  let loadError: string | null = null;

  if (!isErr(gate)) {
    liveMode = true;
    const { supabase, tenantId } = gate.data;
    const baseColumns =
      activeKind === "work_types"
        ? "id, code, name, sort_order, enabled, business_code"
        : activeKind === "equipment"
          ? "id, code, name, sort_order, enabled, process_id"
          : activeKind === "defects"
            ? "id, code, name, sort_order, enabled, defect_group_id, severity"
            : "id, code, name, sort_order, enabled";

    const { data, error } = await supabase
      .from(activeKind)
      .select(baseColumns)
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .limit(500);
    if (error) {
      loadError = "マスタの読み込みに失敗しました。";
    } else {
      rows = (data ?? []) as unknown as MastersEditorData["rows"];
    }

    if (activeKind === "equipment") {
      const { data: procs } = await supabase
        .from("processes")
        .select("id, code, name")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
        .limit(500);
      processOptions = (procs ?? []) as unknown as MastersEditorData["processOptions"];
    } else if (activeKind === "defects") {
      const { data: groups } = await supabase
        .from("defect_groups")
        .select("id, code, name")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
        .limit(500);
      defectGroupOptions = (groups ?? []) as unknown as MastersEditorData["defectGroupOptions"];
    }
  } else if (gate.code === "unconfigured") {
    // demo / preview mode — show structure but no rows.
  } else if (gate.code === "forbidden") {
    return (
      <Alert tone="error" title="権限不足">
        この画面には tenant_admin 権限が必要です。
      </Alert>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h2
          id="masters-heading"
          className="text-lg font-semibold text-[var(--ink)]"
        >
          製造系マスタ
        </h2>
        <p className="text-sm text-[var(--muted)]">
          作業区分 / 工程 / 設備 / 不適合グループ / 不適合 の 5 マスタを管理します。各マスタは tenant_admin 権限で追加・編集・削除 (論理削除) できます。
        </p>
      </header>

      {!liveMode ? (
        <Alert tone="info" title="プレビューモード">
          Supabase 接続情報が未設定のため、登録は保存されません。
        </Alert>
      ) : null}

      {loadError ? (
        <Alert tone="error" title="読み込みエラー">
          {loadError}
        </Alert>
      ) : null}

      <nav
        aria-label="マスタ種別"
        className="flex flex-wrap gap-2 border-b border-[var(--border)] pb-2"
      >
        {KINDS.map((k) => (
          <Link
            key={k.kind}
            href={`/app/admin/masters?kind=${k.kind}`}
            aria-current={activeKind === k.kind ? "page" : undefined}
            data-testid={`masters-tab-${k.kind}`}
            className={
              "inline-flex h-12 items-center border px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] " +
              (activeKind === k.kind
                ? "border-[var(--color-brand)] bg-[var(--color-brand)] text-[var(--color-brand-foreground)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--color-brand)]")
            }
          >
            {k.label}
          </Link>
        ))}
      </nav>

      <MastersEditor
        kind={activeKind}
        rows={rows}
        processOptions={processOptions}
        defectGroupOptions={defectGroupOptions}
      />
    </section>
  );
}
