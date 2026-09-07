import type { Product, RefreshResult } from "../../shared/types";
import { PRODUCTS } from "../../shared/types";
import type { SyncContext, SyncFn } from "./common";
import { runProductSync } from "./common";
import { syncInvestments } from "./investments";
import { syncLiabilities } from "./liabilities";
import { syncStatements } from "./statements";
import { syncTransactions } from "./transactions";

const SYNCERS: Record<Product, SyncFn> = {
  transactions: syncTransactions,
  liabilities: syncLiabilities,
  investments: syncInvestments,
  statements: syncStatements,
};

export function isProduct(value: string): value is Product {
  return (PRODUCTS as readonly string[]).includes(value);
}

export async function refreshProduct(ctx: SyncContext, product: Product): Promise<RefreshResult> {
  return runProductSync(ctx, product, SYNCERS[product]);
}

/** Products are independent, so refresh them concurrently. */
export async function refreshAll(ctx: SyncContext): Promise<RefreshResult[]> {
  return Promise.all(PRODUCTS.map((p) => refreshProduct(ctx, p)));
}

export type { SyncContext } from "./common";
