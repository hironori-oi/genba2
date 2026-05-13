/**
 * Shared zod helpers for tenant-owned record validation.
 *
 * Phase 4b extracts these from src/lib/logi/validators.ts so both LOGI
 * (Phase 3a/3b) and WORKS (Phase 4) inserts share a single source of truth
 * for control-char policy, item_code shape, match_result enum, and the
 * tenant/worker identifier shapes.
 *
 * No server-only imports — safe to use from client form code (e.g. via
 * @hookform/resolvers/zod) too. Architecture doc:
 * docs/ARCHITECTURE-phase4-manufacturing.md §6.2.
 */

import { z } from "zod";

/**
 * Disallow CR / LF / NUL anywhere in scannable text fields. These break
 * CSV exports and indicate either copy-paste bugs or injection attempts.
 * Same policy applies across LOGI and WORKS records.
 */
const NUL = String.fromCharCode(0);
export const CONTROL_CHARS = new RegExp(`[\\r\\n${NUL}]`);
export const noControlChars = (v: string): boolean => !CONTROL_CHARS.test(v);

/** UUID schema reused by tenant_id / worker_id / FK columns. */
export const uuidSchema = z.string().uuid();

/** Tenant identifier — UUID, with the alias used in payload contracts. */
export const tenantIdSchema = uuidSchema;

/** Worker identifier — UUID, with the alias used in payload contracts. */
export const workerIdSchema = uuidSchema;

/**
 * item_code: required, 1-64 chars, no control chars. Used by every record
 * table that references a physical SKU.
 */
export const itemCodeSchema = z
  .string()
  .min(1, "item_code は必須です")
  .max(64, "item_code は64文字以内です")
  .refine(noControlChars, "item_code に改行や NUL を含めることはできません");

/**
 * Optional short-form text (default 64 chars, no control chars). Used for
 * lot, location_code, code-like identifiers.
 */
export const optionalShortText = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label} は${max}文字以内です`)
    .refine(noControlChars, `${label} に改行や NUL を含めることはできません`)
    .optional()
    .nullable()
    .transform((v) => (v === undefined || v === "" ? null : v));

/**
 * Optional long-form text (notes etc). Newlines allowed; only the bound
 * is enforced.
 */
export const optionalLongText = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label} は${max}文字以内です`)
    .optional()
    .nullable()
    .transform((v) => (v === undefined || v === "" ? null : v));

/**
 * Required short text (1..max), no control chars. Used for plan_code,
 * order_no etc.
 */
export const requiredShortText = (max: number, label: string) =>
  z
    .string()
    .min(1, `${label} は必須です`)
    .max(max, `${label} は${max}文字以内です`)
    .refine(noControlChars, `${label} に改行や NUL を含めることはできません`);

/** match_result enum — present on every record-style table. */
export const matchResultSchema = z.enum(["ok", "ng", "warning", "skipped"]);

/** match_result enum extended with "none" for QR scan history rows. */
export const qrScanMatchResultSchema = z.enum([
  "ok",
  "ng",
  "warning",
  "skipped",
  "none",
]);

/** Plan status enum shared across movement / inventory / manufacturing plans. */
export const planStatusSchema = z.enum(["draft", "active", "closed"]);

/** Cross-domain business code enum (covers LOGI + WORKS). */
export const businessCodeSchema = z.enum([
  "receiving",
  "picking",
  "inventory",
  "manufacturing",
]);

/**
 * match_detail jsonb payload — bounded array of opaque entries. 64 is a
 * defence-in-depth cap; one entry per match_rule_line is realistic.
 */
export const matchDetailSchema = z
  .array(z.unknown())
  .max(64, "match_detail は最大64件です")
  .default([]);
