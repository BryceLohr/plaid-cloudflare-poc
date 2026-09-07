import { runBatch, upsertAccountStatements, nowIso } from "../db";
import type { PlaidTransaction } from "../plaid";
import type { SyncContext } from "./common";

function upsertTransactionStatement(db: D1Database, itemId: string, t: PlaidTransaction) {
  return db
    .prepare(
      `INSERT INTO transactions (transaction_id, item_id, account_id, date, name, merchant_name,
         amount, iso_currency_code, pending, category_primary, category_detailed, raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(transaction_id) DO UPDATE SET
         account_id = excluded.account_id,
         date = excluded.date,
         name = excluded.name,
         merchant_name = excluded.merchant_name,
         amount = excluded.amount,
         iso_currency_code = excluded.iso_currency_code,
         pending = excluded.pending,
         category_primary = excluded.category_primary,
         category_detailed = excluded.category_detailed,
         raw = excluded.raw`,
    )
    .bind(
      t.transaction_id,
      itemId,
      t.account_id,
      t.date,
      t.name ?? null,
      t.merchant_name ?? null,
      t.amount,
      t.iso_currency_code ?? null,
      t.pending ? 1 : 0,
      t.personal_finance_category?.primary ?? null,
      t.personal_finance_category?.detailed ?? null,
      JSON.stringify(t),
    );
}

/**
 * Incremental /transactions/sync. Pages are applied as they arrive; the cursor
 * is persisted only after the final page so an interrupted sync replays safely.
 */
export async function syncTransactions(ctx: SyncContext): Promise<Record<string, number>> {
  const { db, plaid, item } = ctx;
  let cursor = item.transactions_cursor;
  let added = 0;
  let modified = 0;
  let removed = 0;
  let hasMore = true;
  let pages = 0;

  while (hasMore) {
    const page = await plaid.transactionsSync(item.access_token, cursor);
    pages++;
    const statements: D1PreparedStatement[] = [];
    if (page.accounts) statements.push(...upsertAccountStatements(db, item.item_id, page.accounts));
    for (const t of page.added) statements.push(upsertTransactionStatement(db, item.item_id, t));
    for (const t of page.modified) statements.push(upsertTransactionStatement(db, item.item_id, t));
    const del = db.prepare("DELETE FROM transactions WHERE transaction_id = ?");
    for (const r of page.removed) statements.push(del.bind(r.transaction_id));
    if (statements.length) await runBatch(db, statements);

    added += page.added.length;
    modified += page.modified.length;
    removed += page.removed.length;
    cursor = page.next_cursor;
    hasMore = page.has_more;
  }

  await db
    .prepare("UPDATE items SET transactions_cursor = ?, updated_at = ? WHERE item_id = ?")
    .bind(cursor, nowIso(), item.item_id)
    .run();

  return { pages, added, modified, removed };
}
