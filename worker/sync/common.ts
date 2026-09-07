import type { ItemRow } from "../db";
import type { PlaidClient } from "../plaid";
import { PlaidApiError } from "../plaid";
import type { Product, RefreshResult } from "../../shared/types";
import { productSyncStatement } from "../db";

export interface SyncContext {
  db: D1Database;
  bucket: R2Bucket;
  plaid: PlaidClient;
  item: ItemRow;
}

export type SyncFn = (ctx: SyncContext) => Promise<Record<string, number>>;

const RETRYABLE = new Set(["PRODUCT_NOT_READY", "RATE_LIMIT_EXCEEDED"]);

/** Thrown by a sync when Plaid reports data is not ready yet; triggers a retry. */
export class NotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotReadyError";
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof NotReadyError) return true;
  return err instanceof PlaidApiError && RETRYABLE.has(err.body.error_code);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a product sync, retrying transient Plaid errors, and records the
 * outcome in product_syncs. Never throws; failures are reported in the result.
 */
export async function runProductSync(
  ctx: SyncContext,
  product: Product,
  fn: SyncFn,
  maxAttempts = 4,
): Promise<RefreshResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const summary = await fn(ctx);
      await productSyncStatement(ctx.db, ctx.item.item_id, product, "ok", null).run();
      return { product, status: "ok", error: null, summary };
    } catch (err) {
      lastError = err;
      if (isRetryable(err) && attempt < maxAttempts) {
        await sleep(1500 * 2 ** (attempt - 1));
        continue;
      }
      break;
    }
  }
  const message = describeError(lastError);
  // Data that is merely not ready yet is a pending state, not a failure.
  const status = lastError instanceof NotReadyError ? "pending" : "error";
  console.error(
    JSON.stringify({ level: status === "error" ? "error" : "warn", msg: "product sync incomplete", item_id: ctx.item.item_id, product, status, error: message }),
  );
  await productSyncStatement(ctx.db, ctx.item.item_id, product, status, message).run();
  return { product, status, error: message, summary: {} };
}

export function describeError(err: unknown): string {
  if (err instanceof PlaidApiError) {
    return `${err.body.error_code}: ${err.body.display_message ?? err.body.error_message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysAgo(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}
