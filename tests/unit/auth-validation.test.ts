import { describe, it, expect } from "vitest";
import {
  PASSWORD_MIN_LENGTH,
  loginSchema,
  passwordResetRequestSchema,
  passwordUpdateSchema,
} from "@/lib/validation/auth";

describe("AC-AUTH-01 password validation", () => {
  it("declares 10-character minimum (decision 2026-05-11)", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
  });

  it("rejects passwords shorter than 10 characters", () => {
    const result = loginSchema.safeParse({
      email: "worker@example.com",
      password: "Short9!!",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === "password");
      expect(issue?.message).toContain("10");
    }
  });

  it("accepts passwords with exactly 10 characters", () => {
    const result = loginSchema.safeParse({
      email: "worker@example.com",
      password: "Abcdefg123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed emails", () => {
    const result = loginSchema.safeParse({
      email: "not-an-email",
      password: "Abcdefg1234",
    });
    expect(result.success).toBe(false);
  });

  it("rejects passwords longer than 128 characters (DoS guard)", () => {
    const result = loginSchema.safeParse({
      email: "worker@example.com",
      password: "a".repeat(129),
    });
    expect(result.success).toBe(false);
  });
});

describe("password reset request", () => {
  it("requires a valid email", () => {
    expect(
      passwordResetRequestSchema.safeParse({ email: "nope" }).success,
    ).toBe(false);
    expect(
      passwordResetRequestSchema.safeParse({ email: "worker@example.com" })
        .success,
    ).toBe(true);
  });
});

describe("password update", () => {
  it("rejects mismatched confirmation", () => {
    const r = passwordUpdateSchema.safeParse({
      password: "Abcdefg1234",
      confirm: "Abcdefg9999",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === "confirm")).toBe(true);
    }
  });

  it("accepts matching passwords at >= 10 chars", () => {
    const r = passwordUpdateSchema.safeParse({
      password: "Abcdefg1234",
      confirm: "Abcdefg1234",
    });
    expect(r.success).toBe(true);
  });
});
