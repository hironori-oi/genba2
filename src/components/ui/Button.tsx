import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "ghost" | "secondary" | "danger";
type Size = "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-[var(--color-brand)] text-[var(--color-brand-foreground)] hover:bg-[oklch(42%_.1_175)] disabled:opacity-60 disabled:cursor-not-allowed",
  secondary:
    "bg-[var(--surface-2)] text-[var(--ink)] border border-[var(--border)] hover:border-[var(--color-brand)] disabled:opacity-60",
  ghost:
    "bg-transparent text-[var(--ink)] hover:bg-[var(--surface-2)] disabled:opacity-60",
  danger:
    "bg-[var(--color-bad)] text-white hover:opacity-90 disabled:opacity-60",
};

const SIZE_CLASSES: Record<Size, string> = {
  md: "h-12 px-4 text-base min-w-12",
  lg: "h-14 px-6 text-base min-w-14 min-h-14",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "lg", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium",
        // genba-tap-snap consumes --motion-snap (120ms snappy press feedback,
        // a tactile cue for glove-wearing P-OPE workers who lose haptic feel).
        // Transition still covers bg/border for hover smoothing.
        "genba-tap-snap transition-[background-color,border-color] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)]",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  );
});
