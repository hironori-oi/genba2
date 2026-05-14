import { z } from "zod";

export const notificationPreferencesSchema = z.object({
  smtpHost: z.string().trim().max(255).optional().nullable(),
  smtpPort: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isInteger(n) || n <= 0 || n >= 65536) return NaN;
      return n;
    })
    .refine((v) => v === null || (Number.isInteger(v) && v > 0 && v < 65536), {
      message: "ポートは 1〜65535 の整数を入力してください。",
    }),
  smtpUsername: z.string().trim().max(255).optional().nullable(),
  // Empty smtpPassword means: do not overwrite the existing one.
  smtpPassword: z.string().max(512).optional().nullable(),
  smtpFromEmail: z
    .string()
    .trim()
    .max(255)
    .optional()
    .nullable()
    .refine((v) => !v || /.+@.+\..+/.test(v), {
      message: "メールアドレスの形式が不正です。",
    }),
  smtpFromName: z.string().trim().max(255).optional().nullable(),
  notifyCorrectionApproval: z.boolean(),
  notifyCorrectionCompleted: z.boolean(),
  notifyMonthlyCap: z.boolean(),
  webhookUrl: z
    .string()
    .trim()
    .max(512)
    .optional()
    .nullable()
    .refine((v) => !v || /^https?:\/\//.test(v), {
      message: "URL は http(s):// で始まる必要があります。",
    }),
  // Empty webhookSecret means: do not overwrite the existing one.
  webhookSecret: z.string().max(512).optional().nullable(),
});

// Input type uses the pre-transform shape (smtpPort accepts string from
// form inputs); the action-side `.safeParse()` normalizes it to number|null.
export type NotificationPreferencesInput = z.input<
  typeof notificationPreferencesSchema
>;
