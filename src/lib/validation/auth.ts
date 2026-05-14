import { z } from "zod";

/**
 * AC-AUTH-01 (PRODUCT_SPEC §6, 2026-05-11 owner decision):
 * - password minimum length: 10 characters
 * - role/tenant changes invalidate the user's refresh tokens via an
 *   elevated admin RPC (server-only path).
 *
 * UI and server actions MUST both use these schemas — keep the length here
 * single-sourced.
 */
export const PASSWORD_MIN_LENGTH = 10;

export const emailSchema = z
  .string({ required_error: "メールアドレスを入力してください" })
  .trim()
  .min(1, "メールアドレスを入力してください")
  .max(254, "メールアドレスが長すぎます")
  .email("メールアドレスの形式が正しくありません");

export const passwordSchema = z
  .string({ required_error: "パスワードを入力してください" })
  .min(PASSWORD_MIN_LENGTH, `パスワードは ${PASSWORD_MIN_LENGTH} 文字以上で入力してください`)
  .max(128, "パスワードが長すぎます");

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type LoginInput = z.infer<typeof loginSchema>;

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
});
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;

export const passwordUpdateSchema = z
  .object({
    password: passwordSchema,
    confirm: passwordSchema,
  })
  .refine((data) => data.password === data.confirm, {
    message: "パスワードが一致しません",
    path: ["confirm"],
  });
export type PasswordUpdateInput = z.infer<typeof passwordUpdateSchema>;
