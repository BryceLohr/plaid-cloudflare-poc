import type { PlaidAccount } from "./plaid";
import type { Product, SyncStatus } from "../shared/types";

export interface ItemRow {
  item_id: string;
  access_token: string;
  institution_id: string | null;
  institution_name: string | null;
  transactions_cursor: string | null;
  created_at: string;
  updated_at: string;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function getItem(db: D1Database, itemId: string): Promise<ItemRow | null> {
  return db.prepare("SELECT * FROM items WHERE item_id = ?").bind(itemId).first<ItemRow>();
}

export function upsertAccountStatements(
  db: D1Database,
  itemId: string,
  accounts: PlaidAccount[],
): D1PreparedStatement[] {
  const stmt = db.prepare(
    `INSERT INTO accounts (account_id, item_id, name, official_name, mask, type, subtype,
       current_balance, available_balance, iso_currency_code, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id) DO UPDATE SET
       name = excluded.name,
       official_name = excluded.official_name,
       mask = excluded.mask,
       type = excluded.type,
       subtype = excluded.subtype,
       current_balance = excluded.current_balance,
       available_balance = excluded.available_balance,
       iso_currency_code = excluded.iso_currency_code,
       raw = excluded.raw`,
  );
  return accounts.map((a) =>
    stmt.bind(
      a.account_id,
      itemId,
      a.name ?? null,
      a.official_name ?? null,
      a.mask ?? null,
      a.type ?? null,
      a.subtype ?? null,
      a.balances?.current ?? null,
      a.balances?.available ?? null,
      a.balances?.iso_currency_code ?? null,
      JSON.stringify(a),
    ),
  );
}

export function productSyncStatement(
  db: D1Database,
  itemId: string,
  product: Product,
  status: SyncStatus,
  error: string | null,
): D1PreparedStatement {
  const syncedAt = status === "ok" ? nowIso() : null;
  return db
    .prepare(
      `INSERT INTO product_syncs (item_id, product, status, last_synced_at, error)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(item_id, product) DO UPDATE SET
         status = excluded.status,
         last_synced_at = COALESCE(excluded.last_synced_at, product_syncs.last_synced_at),
         error = excluded.error`,
    )
    .bind(itemId, product, status, syncedAt, error);
}

/** D1 limits a single batch to 1,000 statements on the free tier; chunk to be safe. */
export async function runBatch(db: D1Database, statements: D1PreparedStatement[], chunk = 500) {
  for (let i = 0; i < statements.length; i += chunk) {
    await db.batch(statements.slice(i, i + chunk));
  }
}

export function parseRaw<T = Record<string, unknown>>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
