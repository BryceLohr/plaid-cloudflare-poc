import { Hono } from "hono";
import type {
  Account,
  ApiError,
  Holding,
  InvestmentTransaction,
  InvestmentsResponse,
  ItemSummary,
  Liability,
  ProductSync,
  RefreshResult,
  Security,
  Statement,
  Transaction,
} from "../shared/types";
import { PRODUCTS } from "../shared/types";
import { getItem, nowIso, parseRaw, productSyncStatement, upsertAccountStatements, runBatch } from "./db";
import type { ItemRow } from "./db";
import { PlaidApiError, plaidClientFromEnv } from "./plaid";
import { isProduct, refreshAll, refreshProduct } from "./sync";
import type { SyncContext } from "./sync";
import { daysAgo, isoDate } from "./sync/common";
import { downloadStatementToR2 } from "./sync/statements";

class NotFoundError extends Error {}

const app = new Hono<{ Bindings: Env }>().basePath("/api");

const CLIENT_NAME = "Plaid on Cloudflare PoC";
const COUNTRY_CODES = ["US"];
// Single implicit user: this PoC has no authentication.
const CLIENT_USER_ID = "poc-user";
const STATEMENTS_LOOKBACK_DAYS = 180;

app.onError((err, c) => {
  if (err instanceof NotFoundError) return c.json({ error: err.message } satisfies ApiError, 404);
  if (err instanceof PlaidApiError) {
    console.error(
      JSON.stringify({ level: "error", msg: "plaid api error", code: err.body.error_code, type: err.body.error_type }),
    );
    const body: ApiError = {
      error: err.body.display_message ?? err.body.error_message,
      plaid_error_code: err.body.error_code,
      plaid_error_type: err.body.error_type,
    };
    return c.json(body, err.status >= 400 && err.status < 600 ? (err.status as 400) : 502);
  }
  console.error(JSON.stringify({ level: "error", msg: "unhandled error", error: err.message }));
  return c.json({ error: err.message } satisfies ApiError, 500);
});

app.notFound((c) => c.json({ error: "Not found" } satisfies ApiError, 404));

function syncContext(c: { env: Env }, item: ItemRow): SyncContext {
  return { db: c.env.DB, bucket: c.env.STATEMENTS, plaid: plaidClientFromEnv(c.env), item };
}

async function requireItem(db: D1Database, itemId: string): Promise<ItemRow> {
  const item = await getItem(db, itemId);
  if (!item) throw new NotFoundError(`Item ${itemId} not found`);
  return item;
}

app.get("/health", (c) => c.json({ ok: true, plaid_env: c.env.PLAID_ENV }));

// ---------- Link ----------

app.post("/link/token", async (c) => {
  const plaid = plaidClientFromEnv(c.env);
  const res = await plaid.linkTokenCreate({
    client_name: CLIENT_NAME,
    language: "en",
    country_codes: COUNTRY_CODES,
    user: { client_user_id: CLIENT_USER_ID },
    // Transactions is required; the others are initialized only where the
    // institution supports them so Link never fails on a missing product.
    products: ["transactions"],
    optional_products: ["liabilities", "investments", "statements"],
    statements: {
      start_date: isoDate(daysAgo(STATEMENTS_LOOKBACK_DAYS)),
      end_date: isoDate(new Date()),
    },
  });
  return c.json({ link_token: res.link_token, expiration: res.expiration });
});

app.post("/link/exchange", async (c) => {
  const body = await c.req.json<{ public_token?: string }>().catch(() => ({}) as { public_token?: string });
  if (!body.public_token) return c.json({ error: "public_token is required" } satisfies ApiError, 400);

  const plaid = plaidClientFromEnv(c.env);
  const exchange = await plaid.itemPublicTokenExchange(body.public_token);
  const { item: plaidItem } = await plaid.itemGet(exchange.access_token);

  let institutionName: string | null = null;
  if (plaidItem.institution_id) {
    institutionName = await plaid
      .institutionsGetById(plaidItem.institution_id, COUNTRY_CODES)
      .then((r) => r.institution.name)
      .catch(() => null);
  }

  const ts = nowIso();
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO items (item_id, access_token, institution_id, institution_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET
         access_token = excluded.access_token,
         institution_id = excluded.institution_id,
         institution_name = excluded.institution_name,
         updated_at = excluded.updated_at`,
    ).bind(exchange.item_id, exchange.access_token, plaidItem.institution_id, institutionName, ts, ts),
    ...PRODUCTS.map((p) => productSyncStatement(c.env.DB, exchange.item_id, p, "pending", null)),
  ];
  const accounts = await plaid.accountsGet(exchange.access_token);
  statements.push(...upsertAccountStatements(c.env.DB, exchange.item_id, accounts.accounts));
  await runBatch(c.env.DB, statements);

  const item = await requireItem(c.env.DB, exchange.item_id);
  const results = await refreshAll(syncContext(c, item));
  const summary = await loadItemSummary(c.env.DB, item.item_id);
  return c.json({ item: summary, results }, 201);
});

// ---------- Items ----------

async function loadItemSummary(db: D1Database, itemId: string): Promise<ItemSummary | null> {
  const [items] = await loadItemSummaries(db, itemId);
  return items ?? null;
}

async function loadItemSummaries(db: D1Database, onlyItemId?: string): Promise<ItemSummary[]> {
  const where = onlyItemId ? "WHERE item_id = ?" : "";
  const bind = onlyItemId ? [onlyItemId] : [];
  const [itemsRes, accountsRes, syncsRes] = await db.batch([
    db
      .prepare(`SELECT item_id, institution_id, institution_name, created_at, updated_at FROM items ${where} ORDER BY created_at`)
      .bind(...bind),
    db
      .prepare(
        `SELECT account_id, item_id, name, official_name, mask, type, subtype, current_balance,
                available_balance, iso_currency_code FROM accounts ${where} ORDER BY type, name`,
      )
      .bind(...bind),
    db.prepare(`SELECT item_id, product, status, last_synced_at, error FROM product_syncs ${where}`).bind(...bind),
  ]);

  const accountsByItem = new Map<string, Account[]>();
  for (const a of accountsRes.results as Account[]) {
    const list = accountsByItem.get(a.item_id) ?? [];
    list.push(a);
    accountsByItem.set(a.item_id, list);
  }
  const syncsByItem = new Map<string, ProductSync[]>();
  for (const s of syncsRes.results as (ProductSync & { item_id: string })[]) {
    const list = syncsByItem.get(s.item_id) ?? [];
    list.push({ product: s.product, status: s.status, last_synced_at: s.last_synced_at, error: s.error });
    syncsByItem.set(s.item_id, list);
  }

  return (itemsRes.results as Omit<ItemSummary, "accounts" | "syncs">[]).map((row) => ({
    ...row,
    accounts: accountsByItem.get(row.item_id) ?? [],
    syncs: PRODUCTS.map(
      (p) =>
        syncsByItem.get(row.item_id)?.find((s) => s.product === p) ?? {
          product: p,
          status: "pending",
          last_synced_at: null,
          error: null,
        },
    ),
  }));
}

app.get("/items", async (c) => c.json({ items: await loadItemSummaries(c.env.DB) }));

app.get("/items/:itemId", async (c) => {
  const summary = await loadItemSummary(c.env.DB, c.req.param("itemId"));
  if (!summary) return c.json({ error: "Item not found" } satisfies ApiError, 404);
  return c.json({ item: summary });
});

app.delete("/items/:itemId", async (c) => {
  const item = await getItem(c.env.DB, c.req.param("itemId"));
  if (!item) return c.json({ error: "Item not found" } satisfies ApiError, 404);

  // Revoke at Plaid first; a failure there should not leave orphaned local data.
  await plaidClientFromEnv(c.env)
    .itemRemove(item.access_token)
    .catch((err) =>
      console.error(JSON.stringify({ level: "warn", msg: "item/remove failed", item_id: item.item_id, error: String(err) })),
    );

  const keys = await c.env.DB.prepare("SELECT r2_key FROM statements WHERE item_id = ? AND r2_key IS NOT NULL")
    .bind(item.item_id)
    .all<{ r2_key: string }>();
  if (keys.results.length) await c.env.STATEMENTS.delete(keys.results.map((k) => k.r2_key));

  // Child rows cascade from items (PRAGMA foreign_keys is on by default in D1).
  await c.env.DB.prepare("DELETE FROM items WHERE item_id = ?").bind(item.item_id).run();
  return c.json({ ok: true });
});

// ---------- Refresh ----------

app.post("/items/:itemId/refresh/:product", async (c) => {
  const product = c.req.param("product");
  if (product !== "all" && !isProduct(product)) {
    return c.json({ error: `Unknown product "${product}"` } satisfies ApiError, 400);
  }
  const item = await getItem(c.env.DB, c.req.param("itemId"));
  if (!item) return c.json({ error: "Item not found" } satisfies ApiError, 404);

  const ctx = syncContext(c, item);
  const results: RefreshResult[] =
    product === "all" ? await refreshAll(ctx) : [await refreshProduct(ctx, product)];
  const summary = await loadItemSummary(c.env.DB, item.item_id);
  return c.json({ item: summary, results });
});

// ---------- Product data ----------

app.get("/items/:itemId/transactions", async (c) => {
  const itemId = c.req.param("itemId");
  const limit = Math.min(Number(c.req.query("limit") ?? 500), 2000);
  const [rows, count] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT transaction_id, item_id, account_id, date, name, merchant_name, amount, iso_currency_code,
              pending, category_primary, category_detailed
       FROM transactions WHERE item_id = ? ORDER BY date DESC, transaction_id LIMIT ?`,
    ).bind(itemId, limit),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM transactions WHERE item_id = ?").bind(itemId),
  ]);
  const transactions: Transaction[] = (rows.results as (Omit<Transaction, "pending"> & { pending: number })[]).map(
    (r) => ({ ...r, pending: r.pending === 1 }),
  );
  return c.json({ transactions, total: (count.results[0] as { n: number }).n });
});

app.get("/items/:itemId/liabilities", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT account_id, item_id, liability_type, raw FROM liabilities WHERE item_id = ? ORDER BY liability_type, account_id",
  )
    .bind(c.req.param("itemId"))
    .all<{ account_id: string; item_id: string; liability_type: Liability["liability_type"]; raw: string }>();
  const liabilities: Liability[] = rows.results.map((r) => ({
    account_id: r.account_id,
    item_id: r.item_id,
    liability_type: r.liability_type,
    raw: parseRaw(r.raw) ?? {},
  }));
  return c.json({ liabilities });
});

const SECURITY_COLUMNS =
  "s.security_id AS s_security_id, s.name AS s_name, s.ticker_symbol AS s_ticker_symbol, s.type AS s_type, s.close_price AS s_close_price, s.iso_currency_code AS s_iso_currency_code";

interface SecurityJoin {
  s_security_id: string | null;
  s_name: string | null;
  s_ticker_symbol: string | null;
  s_type: string | null;
  s_close_price: number | null;
  s_iso_currency_code: string | null;
}

function splitSecurity<T extends SecurityJoin>(row: T): [Omit<T, keyof SecurityJoin>, Security | null] {
  const { s_security_id, s_name, s_ticker_symbol, s_type, s_close_price, s_iso_currency_code, ...rest } = row;
  const security: Security | null = s_security_id
    ? {
        security_id: s_security_id,
        name: s_name,
        ticker_symbol: s_ticker_symbol,
        type: s_type,
        close_price: s_close_price,
        iso_currency_code: s_iso_currency_code,
      }
    : null;
  return [rest, security];
}

app.get("/items/:itemId/investments", async (c) => {
  const itemId = c.req.param("itemId");
  const [holdingsRes, txRes, txCount] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT h.account_id, h.security_id, h.item_id, h.quantity, h.institution_price, h.institution_value,
              h.cost_basis, h.iso_currency_code, ${SECURITY_COLUMNS}
       FROM holdings h LEFT JOIN securities s ON s.security_id = h.security_id
       WHERE h.item_id = ? ORDER BY h.account_id, h.institution_value DESC`,
    ).bind(itemId),
    c.env.DB.prepare(
      `SELECT t.investment_transaction_id, t.item_id, t.account_id, t.security_id, t.date, t.name, t.type,
              t.subtype, t.quantity, t.amount, t.price, t.fees, t.iso_currency_code, ${SECURITY_COLUMNS}
       FROM investment_transactions t LEFT JOIN securities s ON s.security_id = t.security_id
       WHERE t.item_id = ? ORDER BY t.date DESC, t.investment_transaction_id LIMIT 1000`,
    ).bind(itemId),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM investment_transactions WHERE item_id = ?").bind(itemId),
  ]);

  const holdings: Holding[] = (holdingsRes.results as (Omit<Holding, "security"> & SecurityJoin)[]).map((row) => {
    const [rest, security] = splitSecurity(row);
    return { ...rest, security };
  });
  const investment_transactions: InvestmentTransaction[] = (
    txRes.results as (Omit<InvestmentTransaction, "security"> & SecurityJoin)[]
  ).map((row) => {
    const [rest, security] = splitSecurity(row);
    return { ...rest, security };
  });
  return c.json({
    holdings,
    investment_transactions,
    investment_transactions_total: (txCount.results[0] as { n: number }).n,
  } satisfies InvestmentsResponse);
});

app.get("/items/:itemId/statements", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT statement_id, item_id, account_id, year, month, r2_key, downloaded_at
     FROM statements WHERE item_id = ? ORDER BY year DESC, month DESC, account_id`,
  )
    .bind(c.req.param("itemId"))
    .all<Statement>();
  return c.json({ statements: rows.results });
});

app.get("/statements/:statementId/pdf", async (c) => {
  const statementId = c.req.param("statementId");
  const row = await c.env.DB.prepare(
    "SELECT item_id, r2_key, year, month, account_id FROM statements WHERE statement_id = ?",
  )
    .bind(statementId)
    .first<{ item_id: string; r2_key: string | null; year: number; month: number; account_id: string }>();
  if (!row) return c.json({ error: "Statement not found" } satisfies ApiError, 404);

  // Serve from R2, fetching from Plaid on first access if the refresh has not
  // downloaded this statement yet.
  let object = row.r2_key ? await c.env.STATEMENTS.get(row.r2_key) : null;
  if (!object) {
    const item = await requireItem(c.env.DB, row.item_id);
    const key = await downloadStatementToR2(c.env.DB, c.env.STATEMENTS, plaidClientFromEnv(c.env), item, statementId);
    object = await c.env.STATEMENTS.get(key);
  }
  if (!object) return c.json({ error: "Statement PDF missing from storage" } satisfies ApiError, 404);

  const filename = `statement-${row.year}-${String(row.month).padStart(2, "0")}-${row.account_id.slice(0, 8)}.pdf`;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", "application/pdf");
  headers.set("ETag", object.httpEtag);
  headers.set("Content-Disposition", `inline; filename="${filename}"`);
  return new Response(object.body, { headers });
});

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
