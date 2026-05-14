import { describe, expect, it } from "vitest";
import {
  err,
  isErr,
  isOk,
  ok,
  type AdminActionResult,
} from "@/lib/admin/shared/result";

describe("AdminActionResult envelope (architect §3.3)", () => {
  it("ok() with no payload returns status='ok' and undefined data", () => {
    const r = ok();
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.data).toBeUndefined();
    }
  });

  it("ok(data) preserves the payload", () => {
    const r = ok({ id: "abc", count: 3 });
    expect(r.status).toBe("ok");
    if (r.status === "ok") {
      expect(r.data).toEqual({ id: "abc", count: 3 });
    }
  });

  it("err() builds an error envelope without fieldErrors when omitted", () => {
    const r = err("forbidden", "tenant_admin が必要です。");
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.code).toBe("forbidden");
      expect(r.message).toBe("tenant_admin が必要です。");
      expect("fieldErrors" in r).toBe(false);
    }
  });

  it("err() carries fieldErrors when supplied (zod parse pattern)", () => {
    const r = err("validation", "入力エラー", {
      code: "必須です",
      version: "1 以上の整数",
    });
    expect(r.status).toBe("error");
    if (r.status === "error") {
      expect(r.code).toBe("validation");
      expect(r.fieldErrors).toEqual({
        code: "必須です",
        version: "1 以上の整数",
      });
    }
  });

  it("isOk / isErr type guards narrow correctly", () => {
    const value: AdminActionResult<{ name: string }> = ok({ name: "QR-A" });
    if (isOk(value)) {
      // Compile-only check: inside this branch `data` is non-error.
      expect(value.data.name).toBe("QR-A");
    } else {
      throw new Error("expected ok");
    }

    const bad: AdminActionResult<{ name: string }> = err(
      "not_found",
      "対象が見つかりません",
    );
    expect(isOk(bad)).toBe(false);
    expect(isErr(bad)).toBe(true);
  });

  it("union discriminator lets callers exhaustively handle every error code", () => {
    const codes = [
      "validation",
      "forbidden",
      "not_found",
      "conflict",
      "rls",
      "unconfigured",
      "unexpected",
    ] as const;
    for (const code of codes) {
      const r = err(code, `msg:${code}`);
      // Switch on the discriminator demonstrates narrowing — the type system
      // requires every branch to be reachable, which would fail to compile
      // if AdminErrorCode lost a member.
      const label =
        r.status === "ok"
          ? "ok"
          : (() => {
              switch (r.code) {
                case "validation":
                  return "v";
                case "forbidden":
                  return "f";
                case "not_found":
                  return "n";
                case "conflict":
                  return "c";
                case "rls":
                  return "r";
                case "unconfigured":
                  return "u";
                case "unexpected":
                  return "x";
                default: {
                  const exhaust: never = r.code;
                  return exhaust;
                }
              }
            })();
      expect(label).toMatch(/^[vfncrux]$/);
    }
  });
});
