"use client";

/**
 * Phase 3b — Scanner.
 *
 * Tries native `window.BarcodeDetector` (qr_code). When unavailable we fall
 * back to a manual-input modal (D-03). All interactive controls are ≥ 56×56
 * px per AC-A11Y-01.
 *
 * SECURITY: we never log or persist `raw` here. The host decides what to do
 * with the payload. `getUserMedia` is invoked with `facingMode: "environment"`
 * so a worker holding the device gets the back camera.
 *
 * iOS Safari notes: <video> must have `playsInline` + `muted` for inline
 * preview, otherwise the browser tries to enter fullscreen player mode.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Camera, Keyboard, RotateCcw, X } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { ManualInputModal } from "./ManualInputModal";

type Props = {
  onResult: (raw: string) => void;
  onCancel?: () => void;
  /** When true skip camera and open ManualInputModal directly (kiosks / fallback). */
  manualOnly?: boolean;
  /** Hint shown in the manual input modal. */
  manualPlaceholder?: string;
  /** Optional label for the "中止" button (default: "中止"). */
  cancelLabel?: string;
  /**
   * Layer 3 slot (scanner-overlay.md §Solution). Rendered absolute over the
   * bottom of the camera viewport at `z-30` so the result sheet floats on the
   * same stack as the camera + viewfinder, instead of being a sibling 2-column
   * panel.
   */
  bottomOverlay?: ReactNode;
};

type CameraStatus =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "running" }
  | { kind: "denied" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string }
  | { kind: "timeout" };

const SCAN_TIMEOUT_MS = 30_000;
const DETECT_INTERVAL_MS = 250;

type DetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
};

type BarcodeDetectorCtor = new (init: { formats: string[] }) => DetectorLike;

function getBarcodeDetector(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { BarcodeDetector?: BarcodeDetectorCtor };
  return typeof w.BarcodeDetector === "function" ? w.BarcodeDetector : null;
}

export function Scanner({
  onResult,
  onCancel,
  manualOnly = false,
  manualPlaceholder = "QR 文字列を貼り付け / 手入力",
  cancelLabel = "中止",
  bottomOverlay,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [status, setStatus] = useState<CameraStatus>({ kind: "idle" });
  const [manualOpen, setManualOpen] = useState<boolean>(manualOnly);

  const detectorCtor = useMemo(() => getBarcodeDetector(), []);

  const stopCamera = useCallback(() => {
    if (detectIntervalRef.current) {
      clearInterval(detectIntervalRef.current);
      detectIntervalRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (manualOnly) {
      setManualOpen(true);
      return;
    }
    if (!detectorCtor) {
      setStatus({ kind: "unsupported" });
      setManualOpen(true);
      return;
    }
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setStatus({ kind: "unsupported" });
      setManualOpen(true);
      return;
    }
    setStatus({ kind: "starting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const v = videoRef.current;
      if (!v) {
        stream.getTracks().forEach((t) => t.stop());
        setStatus({ kind: "error", message: "video element not ready" });
        return;
      }
      v.srcObject = stream;
      v.playsInline = true;
      v.muted = true;
      try {
        await v.play();
      } catch {
        /* autoplay may reject — preview frame still mounts */
      }
      setStatus({ kind: "running" });

      const detector = new detectorCtor({ formats: ["qr_code"] });
      detectIntervalRef.current = setInterval(async () => {
        const video = videoRef.current;
        if (!video || video.readyState < 2) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length > 0 && codes[0].rawValue) {
            const raw = codes[0].rawValue;
            stopCamera();
            onResult(raw);
          }
        } catch {
          // detector occasionally throws between frames; keep polling.
        }
      }, DETECT_INTERVAL_MS);

      timeoutRef.current = setTimeout(() => {
        stopCamera();
        setStatus({ kind: "timeout" });
        setManualOpen(true);
      }, SCAN_TIMEOUT_MS);
    } catch (err: unknown) {
      const name = (err as { name?: string }).name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setStatus({ kind: "denied" });
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setStatus({ kind: "unsupported" });
      } else {
        setStatus({
          kind: "error",
          message:
            err instanceof Error ? err.message : "カメラ起動に失敗しました",
        });
      }
      setManualOpen(true);
    }
  }, [detectorCtor, manualOnly, onResult, stopCamera]);

  useEffect(() => {
    void startCamera();
    return () => {
      stopCamera();
    };
    // We want to start once on mount; restarts are explicit via the 再試行 button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRetry = useCallback(() => {
    stopCamera();
    setStatus({ kind: "idle" });
    void startCamera();
  }, [startCamera, stopCamera]);

  const handleManual = useCallback(() => {
    setManualOpen(true);
  }, []);

  const handleManualSubmit = useCallback(
    (raw: string) => {
      setManualOpen(false);
      stopCamera();
      onResult(raw);
    },
    [onResult, stopCamera],
  );

  const statusLabel = useMemo(() => {
    switch (status.kind) {
      case "idle":
        return "準備中…";
      case "starting":
        return "カメラを起動しています…";
      case "running":
        return "QR コードをフレーム内に収めてください";
      case "denied":
        return "カメラの使用が許可されていません。手入力に切替えてください。";
      case "unsupported":
        return "この端末/ブラウザはカメラ読取に対応していません。手入力に切替えてください。";
      case "timeout":
        return "30 秒以内に読取できませんでした。手入力に切替えるか再試行してください。";
      case "error":
        return `カメラエラー: ${status.message}`;
    }
  }, [status]);

  const isError =
    status.kind === "denied" ||
    status.kind === "unsupported" ||
    status.kind === "timeout" ||
    status.kind === "error";

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="scanner-root"
    >
      <div
        data-testid="scanner-frame"
        className={cn(
          "relative w-full overflow-hidden border-2 border-[var(--border)]",
          "aspect-[4/3] bg-[var(--surface-2)]",
        )}
      >
        {/* video element */}
        <video
          ref={videoRef}
          data-testid="scanner-video"
          className="h-full w-full object-cover"
          playsInline
          muted
          aria-label="QR コードカメラプレビュー"
        />

        {/* overlay frame guide — 4 corner-L brackets per scanner-overlay.md §Anatomy.
            currentColor is set per state: scanning → step-active (+ pulse breathing),
            idle → scan-frame, error → scan-frame-strong (static hint). */}
        <div
          aria-hidden
          data-testid="scanner-viewfinder"
          className="pointer-events-none absolute inset-0 grid place-items-center"
        >
          <div
            className={cn(
              "relative h-2/3 w-2/3",
              status.kind === "running" &&
                "text-[var(--color-step-active)] genba-scan-pulse",
              status.kind === "starting" && "text-[var(--color-scan-frame-strong)]",
              status.kind !== "running" &&
                status.kind !== "starting" &&
                "text-[var(--color-scan-frame)]",
            )}
          >
            <span className="genba-viewfinder-corner" data-corner="tl" />
            <span className="genba-viewfinder-corner" data-corner="tr" />
            <span className="genba-viewfinder-corner" data-corner="bl" />
            <span className="genba-viewfinder-corner" data-corner="br" />
          </div>
        </div>

        {/* status overlay for non-running states */}
        {status.kind !== "running" ? (
          <div className="absolute inset-0 grid place-items-center bg-black/40 p-4 text-center text-white">
            <p className="font-mono text-sm">{statusLabel}</p>
          </div>
        ) : null}

        {/* Layer 3 — Result bottom-sheet slot (scanner-overlay.md §Solution).
            Pointer-events scoped to the slot itself so the rest of the
            viewport stays click-through for the camera surface. */}
        {bottomOverlay ? (
          <div
            data-testid="scanner-bottom-overlay"
            className="pointer-events-none absolute inset-x-0 bottom-0 z-30"
          >
            <div className="pointer-events-auto">{bottomOverlay}</div>
          </div>
        ) : null}
      </div>

      <p
        role="status"
        aria-live="polite"
        data-testid="scanner-status"
        className="text-sm text-[var(--muted)]"
      >
        {statusLabel}
      </p>

      {isError ? (
        <Alert
          tone={status.kind === "denied" ? "warn" : "error"}
          title={
            status.kind === "denied"
              ? "カメラが許可されていません"
              : status.kind === "timeout"
                ? "読取タイムアウト"
                : status.kind === "unsupported"
                  ? "カメラ非対応"
                  : "カメラエラー"
          }
        >
          手入力に切替えるか、ブラウザ設定でカメラを許可後に再試行してください。
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={handleManual}
          data-testid="scanner-manual"
          aria-label="手入力モードに切替える"
        >
          <Keyboard aria-hidden className="h-5 w-5" />
          手入力
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={handleRetry}
          data-testid="scanner-retry"
          aria-label="カメラ起動を再試行"
        >
          <RotateCcw aria-hidden className="h-5 w-5" />
          再試行
        </Button>
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={() => {
              stopCamera();
              onCancel();
            }}
            data-testid="scanner-cancel"
            aria-label={cancelLabel}
          >
            <X aria-hidden className="h-5 w-5" />
            {cancelLabel}
          </Button>
        ) : null}
        {/* Camera-active hint */}
        {status.kind === "running" ? (
          <span className="inline-flex items-center gap-2 text-xs font-mono text-[var(--muted)]">
            <Camera aria-hidden className="h-4 w-4" />
            読取中
          </span>
        ) : null}
      </div>

      <ManualInputModal
        open={manualOpen}
        placeholder={manualPlaceholder}
        onClose={() => setManualOpen(false)}
        onSubmit={handleManualSubmit}
      />
    </div>
  );
}
