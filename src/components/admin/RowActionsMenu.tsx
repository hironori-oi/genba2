"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

/**
 * RowActionsMenu — Phase 5e-3 polish.
 *
 * Compact per-row "操作" disclosure that bundles edit / delete / clone /
 * other row-scoped admin affordances under a single 56×56 trigger. Used
 * by DataTable.renderActions to replace flat lists of N×M secondary
 * buttons (e.g. the Phase 5b QR-format "V<n> を新バージョンへ複製" list,
 * which scaled poorly past ~3 rows).
 *
 * Implementation notes:
 *   * Native <details>/<summary> drives the open/close state so keyboard
 *     focus, Enter/Space activation, Escape and screen-reader semantics
 *     come for free.
 *   * Outside-click and Escape are handled imperatively so the popover
 *     never lingers when the user dismisses it; the click-outside guard
 *     is gated on `open` to avoid wasted listeners.
 *   * Each item is a real <button> (or <a>), 56×56 minimum (size="lg"),
 *     so the menu remains usable for glove-wearing operators.
 */

export type RowAction = {
  label: ReactNode;
  onSelect: () => void;
  variant?: "default" | "danger";
  testId?: string;
  disabled?: boolean;
  /** Optional helper line under the label (e.g. "V3 を作成"). */
  hint?: ReactNode;
};

export function RowActionsMenu({
  label,
  actions,
  buttonTestId,
}: {
  label: string;
  actions: ReadonlyArray<RowAction>;
  buttonTestId?: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      const node = detailsRef.current;
      if (!node) return;
      if (event.target instanceof Node && !node.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <details
      ref={detailsRef}
      open={open}
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
      className="relative inline-block text-start"
    >
      <summary
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-label={label}
        data-testid={buttonTestId}
        className={cn(
          "list-none inline-flex h-14 min-h-14 w-14 min-w-14 cursor-pointer items-center justify-center",
          "rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] text-sm font-medium text-[var(--ink)]",
          "transition-[background-color,border-color] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]",
          "hover:border-[var(--color-brand)]",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]",
          // Hide browser default disclosure marker
          "[&::-webkit-details-marker]:hidden marker:hidden",
        )}
      >
        <span aria-hidden>操作 ▾</span>
      </summary>
      <div
        id={menuId}
        role="menu"
        aria-label={label}
        className={cn(
          "absolute right-0 z-20 mt-1 flex min-w-[14rem] flex-col gap-1 rounded-[8px] border border-[var(--border)]",
          "bg-[var(--surface)] p-2 shadow-lg",
        )}
      >
        {actions.map((action, idx) => (
          <Button
            key={idx}
            type="button"
            variant={action.variant === "danger" ? "danger" : "secondary"}
            size="lg"
            role="menuitem"
            disabled={action.disabled}
            data-testid={action.testId}
            className="w-full justify-start"
            onClick={() => {
              if (action.disabled) return;
              setOpen(false);
              action.onSelect();
            }}
          >
            <span className="flex flex-col items-start">
              <span>{action.label}</span>
              {action.hint ? (
                <span className="text-xs font-normal text-[var(--muted)]">
                  {action.hint}
                </span>
              ) : null}
            </span>
          </Button>
        ))}
      </div>
    </details>
  );
}
