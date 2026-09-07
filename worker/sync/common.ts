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
  maxAttempts = 3,
): Promise<RefreshResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const summary = await fn(ctx);
      await productSyncStatement(ctx.db, ctx.item.item_id, product, "ok", null).run();
      return { product, status: "ok", error: null, summary };
    } catch (err) {
      lastError = err;
      if (err instanceof PlaidApiError && RETRYABLE.has(err.body.error_code) && attempt < maxAttempts) {
        await sleep(1000 * 2 ** (attempt - 1));
        continue;
      }
      break;
    }
  }
  const message = describeError(lastError);
  console.error(
    JSON.stringify({ level: "error", msg: "product sync failed", item_id: ctx.item.item_id, product, error: message }),
  );
  await productSyncStatement(ctx.db, ctx.item.item_id, product, "error", message).run();
  return { product, status: "error", error: message, summary: {} };
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
