/**
 * AdminActionResult — discriminated-union envelope shared by every Phase 5
 * admin server action (architect doc §3.3 in
 * docs/ARCHITECTURE-phase5-admin-ui.md). The discriminator field is `status`
 * (architect §3.3 type literal); the `fieldErrors?` extension is added so
 * zod parse failures can surface per-field messages without expanding the
 * union (Phase 5b dispatch brief).
 *
 * No transport-layer or framework imports — this module must stay isomorphic
 * (callable from both server actions and client components that need to
 * narrow a returned envelope).
 */

export type AdminErrorCode =
  | "validation"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rls"
  | "unconfigured"
  | "unexpected";

export type AdminActionError = {
  status: "error";
  code: AdminErrorCode;
  message: string;
  fieldErrors?: Record<string, string>;
};

export type AdminActionOk<T> = {
  status: "ok";
  data: T;
};

export type AdminActionResult<T = void> = AdminActionOk<T> | AdminActionError;

export function ok(): AdminActionResult<void>;
export function ok<T>(data: T): AdminActionResult<T>;
export function ok<T>(data?: T): AdminActionResult<T | undefined> {
  return { status: "ok", data: data as T };
}

export function err<T = never>(
  code: AdminErrorCode,
  message: string,
  fieldErrors?: Record<string, string>,
): AdminActionResult<T> {
  if (fieldErrors === undefined) {
    return { status: "error", code, message };
  }
  return { status: "error", code, message, fieldErrors };
}

export function isOk<T>(r: AdminActionResult<T>): r is AdminActionOk<T> {
  return r.status === "ok";
}

export function isErr<T>(r: AdminActionResult<T>): r is AdminActionError {
  return r.status === "error";
}
