import { describe, it, expect } from "vitest";
import { safeInternalPath } from "@/lib/auth/safe-redirect";

describe("safeInternalPath (open-redirect guard)", () => {
  it.each([
    ["/app", "/app"],
    ["/app/work/picking", "/app/work/picking"],
    ["/login?notice=signed-out", "/login?notice=signed-out"],
  ])("accepts internal path %s", (input, expected) => {
    expect(safeInternalPath(input)).toBe(expected);
  });

  it.each([
    ["//evil.example.com", "/app"],
    ["//evil.example.com/path", "/app"],
    ["/\\evil", "/app"],
    ["https://evil.example.com", "/app"],
    ["mailto:attacker@example.com", "/app"],
    ["javascript:alert(1)", "/app"],
    ["", "/app"],
    [undefined, "/app"],
    [null, "/app"],
    [42, "/app"],
    ["/path\ninjection", "/app"],
  ])("rejects unsafe input %s", (input, expected) => {
    expect(safeInternalPath(input)).toBe(expected);
  });

  it("respects custom fallback", () => {
    expect(safeInternalPath("https://x", "/safe")).toBe("/safe");
  });

  it("rejects pathologically long inputs", () => {
    expect(safeInternalPath("/" + "a".repeat(2048))).toBe("/app");
  });
});
