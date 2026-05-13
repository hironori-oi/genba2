/**
 * Phase 4b WORKS (manufacturing) public surface.
 *
 * Types + validators are safe to import from anywhere. The server-only
 * helpers in ./actions and ./history must NOT be re-exported from this
 * barrel — they carry an `import "server-only"` guard and importing them
 * from the barrel would force every client consumer into a "server-only"
 * boundary error. Server callers should
 * `import { ... } from "@/lib/works/actions"` or
 * `import { ... } from "@/lib/works/history"` directly.
 */

export * from "./types";
export * from "./validators";
