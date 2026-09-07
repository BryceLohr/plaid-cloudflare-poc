import { runBatch, upsertAccountStatements } from "../db";
import type { PlaidInvestmentTransaction, PlaidSecurity } from "../plaid";
import type { SyncContext } from "./common";
import { daysAgo, isoDate } from "./common";

const INVESTMENT_TX_LOOKBACK_DAYS = 730;
const PAGE_SIZE = 500;

function upsertSecurityStatements(db: D1Database, securities: PlaidSecurity[]) {
  const stmt = db.prepare(
    `INSERT INTO securities (security_id, name, ticker_symbol, type, close_price, iso_currency_code, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(security_id) DO UPDATE SET
       name = excluded.name,
       ticker_symbol = excluded.ticker_symbol,
       type = excluded.type,
       close_price = excluded.close_price,
       iso_currency_code = excluded.iso_currency_code,
       raw = excluded.raw`,
  );
  return securities.map((s) =>
    stmt.bind(
      s.security_id,
      s.name ?? null,
      s.ticker_symbol ?? null,
      s.type ?? null,
      s.close_price ?? null,
      s.iso_currency_code ?? null,
      JSON.stringify(s),
    ),
  );
}

function upsertInvestmentTransactionStatement(
  db: D1Database,
  itemId: string,
  t: PlaidInvestmentTransaction,
) {
  return db
    .prepare(
      `INSERT INTO investment_transactions (investment_transaction_id, item_id, account_id, security_id,
         date, name, type, subtype, quantity, amount, price, fees, iso_currency_code, raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(investment_transaction_id) DO UPDATE SET
         account_id = excluded.account_id,
         security_id = excluded.security_id,
         date = excluded.date,
         name = excluded.name,
         type = excluded.type,
         subtype = excluded.subtype,
         quantity = excluded.quantity,
         amount = excluded.amount,
         price = excluded.price,
         fees = excluded.fees,
         iso_currency_code = excluded.iso_currency_code,
         raw = excluded.raw`,
    )
    .bind(
      t.investment_transaction_id,
      itemId,
      t.account_id,
      t.security_id ?? null,
      t.date,
      t.name ?? null,
      t.type ?? null,
      t.subtype ?? null,
      t.quantity ?? null,
      t.amount ?? null,
      t.price ?? null,
      t.fees ?? null,
      t.iso_currency_code ?? null,
      JSON.stringify(t),
    );
}

/**
 * Holdings are a snapshot, so the item's holdings are replaced wholesale.
 * Investment transactions are upserted over a trailing window.
 */
export async function syncInvestments(ctx: SyncContext): Promise<Record<string, number>> {
  const { db, plaid, item } = ctx;

  const holdingsRes = await plaid.investmentsHoldingsGet(item.access_token);
  const holdingStatements: D1PreparedStatement[] = [
    ...upsertAccountStatements(db, item.item_id, holdingsRes.accounts),
    ...upsertSecurityStatements(db, holdingsRes.securities),
    db.prepare("DELETE FROM holdings WHERE item_id = ?").bind(item.item_id),
  ];
  const insertHolding = db.prepare(
    `INSERT INTO holdings (account_id, security_id, item_id, quantity, institution_price,
       institution_value, cost_basis, iso_currency_code, raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, security_id) DO UPDATE SET
       item_id = excluded.item_id,
       quantity = excluded.quantity,
       institution_price = excluded.institution_price,
       institution_value = excluded.institution_value,
       cost_basis = excluded.cost_basis,
       iso_currency_code = excluded.iso_currency_code,
       raw = excluded.raw`,
  );
  for (const h of holdingsRes.holdings) {
    holdingStatements.push(
      insertHolding.bind(
        h.account_id,
        h.security_id,
        item.item_id,
        h.quantity ?? null,
        h.institution_price ?? null,
        h.institution_value ?? null,
        h.cost_basis ?? null,
        h.iso_currency_code ?? null,
        JSON.stringify(h),
      ),
    );
  }
  await runBatch(db, holdingStatements);

  const startDate = isoDate(daysAgo(INVESTMENT_TX_LOOKBACK_DAYS));
  const endDate = isoDate(new Date());
  let offset = 0;
  let total = Infinity;
  let txCount = 0;
  while (offset < total) {
    const page = await plaid.investmentsTransactionsGet(
      item.access_token,
      startDate,
      endDate,
      offset,
      PAGE_SIZE,
    );
    total = page.total_investment_transactions;
    const statements: D1PreparedStatement[] = [
      ...upsertSecurityStatements(db, page.securities),
      ...page.investment_transactions.map((t) =>
        upsertInvestmentTransactionStatement(db, item.item_id, t),
      ),
    ];
    if (statements.length) await runBatch(db, statements);
    txCount += page.investment_transactions.length;
    if (page.investment_transactions.length === 0) break;
    offset += page.investment_transactions.length;
  }

  return {
    holdings: holdingsRes.holdings.length,
    securities: holdingsRes.securities.length,
    investment_transactions: txCount,
  };
}
