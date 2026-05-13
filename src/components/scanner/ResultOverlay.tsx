"use client";

/**
 * Phase 3b / Phase 4 reconcile — Result overlay (OK / WARN / NG).
 *
 * Two layouts are supported:
 *
 *   layout="bottom-sheet" (DEFAULT, canonical per scanner-overlay.md §Solution)
 *     Compact card meant to be rendered as Scanner's `bottomOverlay` slot
 *     (Layer 3). variant=none returns null so the live camera preview is
 *     unobstructed. Uses --shadow-overlay to float over the camera feed.
 *
 *   layout="panel" (legacy, kept for callers that still want a 2-column
 *     side panel — currently unused by LOGI flows but exposed for future
 *     ScannerOverlayDryRun / admin variants).
 *
 * Color-blind safe: each state combines (1) DISTINCT ICON, (2) TEXT LABEL,
 * (3) BORDER PATTERN — never relies on hue alone. Mapping:
 *
 *   OK   → animated SVG check  (✓), solid green border
 *   WARN → AlertTriangle       (△), dotted amber border-bottom + double border
 *   NG   → X icon              (✕), double red border, role="status" + aria-live="assertive"
 *
 * Buttons are ≥ 56×56 (Button size="lg" → h-14).
 */

import { useMemo, type CSSProperties } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import type { MatchOutcome } from "@/lib/qr/match";

export type ResultOverlayLayout = "bottom-sheet" | "panel";

type Props = {
  outcome: MatchOutcome | null;
  ngFlow: "block" | "warn";
  onAcceptWarning?: () => void;
  onRescan: () => void;
  /**
   * Visual layout — see file header. Defaults to the canonical "bottom-sheet"
   * (Layer 3 of scanner-overlay.md). Pass "panel" only when the caller wants
   * the legacy side-panel rendering with a static placeholder.
   */
  layout?: ResultOverlayLayout;
};

type Variant = "ok" | "warn" | "ng" | "none";

function variantOf(outcome: MatchOutcome | null): Variant {
  if (!outcome) return "none";
  if (outcome.matchResult === "ng") return "ng";
  if (outcome.withWarnings) return "warn";
  return "ok";
}

export function ResultOverlay({
  outcome,
  ngFlow,
  onAcceptWarning,
  onRescan,
  layout = "bottom-sheet",
}: Props) {
  const variant = useMemo(() => variantOf(outcome), [outcome]);
  const isSheet = layout === "bottom-sheet";

  if (variant === "none") {
    // Bottom-sheet: the live camera preview itself is the affordance, so we
    // intentionally render nothing — Layer 3 stays out of the way until
    // there is a match to report. (scanner-overlay.md §Solution.)
    if (isSheet) {
      return null;
    }
    // Panel (legacy) keeps the dashed-border placeholder so the 2-column
    // grid does not collapse and the SR user gets a "ready" status.
    return (
      <div
        data-testid="result-overlay"
        data-variant="none"
        data-layout="panel"
        role="status"
        aria-live="polite"
        className="grid min-h-[200px] place-items-center border-2 border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-center"
      >
        <p className="text-sm text-[var(--muted)]">
          QR 読取後にここへ照合結果が表示されます
        </p>
      </div>
    );
  }

  // Shared sizing tokens across variants.
  // - sheet: compact, sits at bottom of camera viewport (no min-height
  //   constraint, viewport governs); subtle inner padding.
  // - panel: tall side panel; keeps min-height so 2-column doesn't collapse.
  const layoutBase = isSheet
    ? "flex flex-col items-center justify-center gap-2 p-3 text-center"
    : "flex min-h-[200px] flex-col items-center justify-center gap-2 p-4 text-center";

  if (variant === "ok") {
    return (
      <div
        data-testid="result-overlay"
        data-variant="ok"
        data-layout={layout}
        role="status"
        aria-live="polite"
        style={{ boxShadow: "var(--shadow-overlay)" }}
        className={cn(
          layoutBase,
          "border-4 border-solid border-[var(--color-ok)]",
          // --color-good is the OK-flash semantic alias; .12 alpha keeps body ink
          // (--color-ok) readable on top while signaling "matched green" at-a-glance.
          // In sheet mode we lean on a slightly more opaque surface so text
          // stays legible over the live camera feed underneath.
          isSheet
            ? "bg-[color-mix(in_oklch,var(--color-good)_18%,var(--surface))]"
            : "bg-[color-mix(in_oklch,var(--color-good)_12%,var(--surface))]",
        )}
      >
        <CheckDrawIcon />
        <p
          className={cn(
            "font-semibold text-[var(--color-ok)]",
            isSheet ? "text-2xl" : "text-3xl",
          )}
        >
          OK
        </p>
        <p className="text-sm text-[var(--ink)]">
          照合に成功しました。数量を入力してください。
        </p>
      </div>
    );
  }

  if (variant === "warn") {
    return (
      <div
        data-testid="result-overlay"
        data-variant="warn"
        data-layout={layout}
        role="status"
        aria-live="polite"
        className={cn(
          layoutBase,
          // double + dotted bottom — visual pattern in addition to hue
          "border-4 border-double border-[var(--color-warn)] bg-[oklch(96%_.04_70)]",
        )}
        style={{
          borderBottomStyle: "dotted",
          boxShadow: "var(--shadow-overlay)",
        }}
      >
        <AlertTriangle
          aria-hidden
          className={cn(isSheet ? "h-10 w-10" : "h-14 w-14", "text-[var(--color-warn)]")}
        />
        <p
          className={cn(
            "font-semibold text-[var(--color-warn)]",
            isSheet ? "text-2xl" : "text-3xl",
          )}
          style={{ textDecoration: "underline dotted" }}
        >
          警告 △
        </p>
        <p className="text-sm text-[var(--ink)]">
          照合は成功しましたが、一部の項目に警告があります。
          内容を確認したうえで登録に進んでください。
        </p>
        <div className="flex flex-wrap justify-center gap-3 pt-2">
          {onAcceptWarning ? (
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={onAcceptWarning}
              data-testid="result-overlay-accept-warning"
            >
              内容を確認して続行
            </Button>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={onRescan}
            data-testid="result-overlay-rescan"
          >
            再スキャン
          </Button>
        </div>
        <MatchDetailList outcome={outcome!} />
      </div>
    );
  }

  // NG — assertive aria-live; double border; X icon
  return (
    <div
      data-testid="result-overlay"
      data-variant="ng"
      data-layout={layout}
      data-ng-flow={ngFlow}
      role="status"
      aria-live="assertive"
      style={{ boxShadow: "var(--shadow-overlay)" }}
      className={cn(
        layoutBase,
        "border-4 border-double border-[var(--color-bad)] bg-[oklch(94%_.04_25)]",
      )}
    >
      <X
        aria-hidden
        className={cn(isSheet ? "h-10 w-10" : "h-14 w-14", "text-[var(--color-bad)]")}
      />
      <p
        className={cn(
          "font-semibold text-[var(--color-bad)]",
          isSheet ? "text-2xl" : "text-3xl",
        )}
      >
        NG ✕
      </p>
      <p className="text-sm text-[var(--ink)]">
        {ngFlow === "block"
          ? "照合に失敗しました。登録できません。ラベルを確認のうえ再スキャンしてください。"
          : "照合に失敗しました。確認してから続行してください。"}
      </p>
      <div className="flex flex-wrap justify-center gap-3 pt-2">
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={onRescan}
          data-testid="result-overlay-rescan"
        >
          再スキャン
        </Button>
      </div>
      <MatchDetailList outcome={outcome!} />
    </div>
  );
}

function MatchDetailList({ outcome }: { outcome: MatchOutcome }) {
  if (outcome.detail.length === 0) {
    return null;
  }
  return (
    <details
      className="mt-2 w-full max-w-md text-left"
      data-testid="result-overlay-detail"
    >
      <summary className="cursor-pointer text-xs font-medium text-[var(--muted)]">
        照合明細 ({outcome.detail.length})
      </summary>
      <ul className="mt-2 flex flex-col gap-1 text-xs">
        {outcome.detail.map((line) => (
          <li
            key={`${line.sortOrder}-${line.lineFieldCode}`}
            className="flex items-baseline justify-between gap-2 border-b border-[var(--border)] py-1 font-mono"
          >
            <span className="text-[var(--ink)]">
              {line.lineFieldCode} ↔ {line.labelFieldCode}
            </span>
            <span
              className={cn(
                "px-1",
                line.result === "ok" && "text-[var(--color-ok)]",
                line.result === "warning" && "text-[var(--color-warn)]",
                line.result === "ng" && "text-[var(--color-bad)]",
                line.result === "skip" && "text-[var(--muted)]",
              )}
            >
              {labelOf(line.result)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function labelOf(r: "ok" | "ng" | "warning" | "skip"): string {
  switch (r) {
    case "ok":
      return "OK ✓";
    case "ng":
      return "NG ✕";
    case "warning":
      return "WARN △";
    case "skip":
      return "skip";
  }
}

/**
 * Polish-phase delight: SVG check-stroke that draws on mount via
 * stroke-dasharray + @keyframes genba-check-draw (350ms cubic-bezier
 * (0.2,0.6,0.2,1)).  Gated by prefers-reduced-motion — the global
 * reduced-motion rule clamps animation-duration to ~0ms, and the
 * explicit .genba-check-draw rule in globals.css forces dashoffset:0
 * so the check is fully visible immediately for that audience.
 *
 * Implemented as inline SVG (not lucide Check) so we can attach the
 * stroke-dasharray + keyframe directly to the <path>.
 */
function CheckDrawIcon() {
  // Path length ≈ 48 (the M4-12 / 11-20 polyline through a 24×24 viewbox).
  // We tell CSS via --genba-check-length so the dashoffset matches stride.
  return (
    <svg
      aria-hidden
      data-testid="result-overlay-check-draw"
      viewBox="0 0 24 24"
      width="56"
      height="56"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="genba-check-draw text-[var(--color-ok)]"
      style={{ "--genba-check-length": "48" } as CSSProperties}
    >
      <path d="M4 12 L10 18 L20 6" />
    </svg>
  );
}
