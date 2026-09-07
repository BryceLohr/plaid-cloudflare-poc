# plaid-cloudflare-poc

Throw-away proof of concept for building a Plaid-powered app on Cloudflare. A single Worker serves a React SPA and a small JSON API that links bank accounts with Plaid Link, pulls Plaid **Transactions**, **Liabilities**, **Investments** and **Statements** from the Sandbox, persists them, and lets you refresh each product on demand.

Deployed instance: https://plaid-cloudflare-poc.bryce-lohr.workers.dev

There is no authentication or multi-user support; everything belongs to one implicit user. Do not use this as-is in production.

## Architecture

```
Browser (React + Vite, react-plaid-link)
   │  static assets + /api/*
   ▼
Cloudflare Worker (Hono)  ──►  Plaid API (sandbox)
   │            │
   ▼            ▼
   D1 (SQLite)  R2 (statement PDFs)
```

- **Worker + Static Assets** – one deployable; the SPA is served as static assets, `/api/*` runs in the Worker (`assets.run_worker_first`).
- **Hono** for routing in `worker/index.ts`.
- **Plaid client** – `worker/plaid.ts` is a thin, typed `fetch` wrapper over the Plaid JSON API (the official SDK is axios/Node based, a fetch client is more natural in Workers).
- **D1** holds items, accounts, transactions, liabilities, securities, holdings, investment transactions, statement metadata and per-product sync status (`migrations/0001_init.sql`).
- **R2** holds statement PDFs at `items/{item_id}/statements/{statement_id}.pdf`.
- **Secrets** – `PLAID_CLIENT_ID` and `PLAID_SECRET` are Worker secrets (`.dev.vars` locally). `PLAID_ENV` is a plain var (`sandbox`).

## How each product is synced

| Product | Plaid endpoints | Persistence strategy |
| --- | --- | --- |
| Transactions | `/transactions/sync` | Cursor stored per Item; `added`/`modified` upserted, `removed` deleted; cursor persisted after the last page. A `NOT_READY` status right after linking is retried with backoff and otherwise reported as *pending*. |
| Liabilities | `/liabilities/get` | Snapshot: the Item's rows are replaced. Rows keep the full Plaid object as JSON plus the type (`credit`, `mortgage`, `student`). |
| Investments | `/investments/holdings/get`, `/investments/transactions/get` | Holdings replaced per Item, securities upserted globally, investment transactions upserted over a trailing 24 months with `count`/`offset` pagination. |
| Statements | `/statements/list`, `/statements/download` | Metadata upserted; up to 20 of the newest PDFs downloaded into R2 per refresh, the rest fetched into R2 on first open. |

Every product call also upserts the `accounts` array it returns, so balances stay current. Sync outcomes are recorded in `product_syncs` and surfaced in the UI as badges.

## API

All routes are under `/api`:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/link/token` | Create a Link token (`products: [transactions]`, `optional_products: [liabilities, investments, statements]`). |
| `POST` | `/link/exchange` | Exchange `public_token`, store the Item, run an initial sync of all products. |
| `GET` | `/items` | Linked Items with accounts and per-product sync status. |
| `DELETE` | `/items/:itemId` | `/item/remove` at Plaid, delete R2 objects, cascade-delete D1 rows. |
| `POST` | `/items/:itemId/refresh/:product` | Refresh `transactions`, `liabilities`, `investments`, `statements` or `all`. |
| `GET` | `/items/:itemId/transactions` | Persisted transactions (most recent first). |
| `GET` | `/items/:itemId/liabilities` | Persisted liabilities. |
| `GET` | `/items/:itemId/investments` | Holdings (joined with securities) and investment transactions. |
| `GET` | `/items/:itemId/statements` | Statement metadata. |
| `GET` | `/statements/:statementId/pdf` | Stream the PDF from R2 (downloading it from Plaid first if needed). |

## Local development

Prerequisites: Node 22+, a Plaid account with Sandbox credentials, and a Cloudflare account (only needed for deployment).

```bash
npm install
cp .dev.vars.example .dev.vars        # fill in PLAID_CLIENT_ID and PLAID_SECRET
npm run db:migrate:local              # create the local D1 schema
npm run dev                           # http://localhost:5173
```

`npm run dev` runs Vite with the Cloudflare Vite plugin, so the Worker executes in `workerd` with local D1 and R2 emulation while talking to the real Plaid Sandbox.

In the app click **Connect a bank account**, pick **First Platypus Bank** and sign in with `user_good` / `pass_good`. That Sandbox institution supports all four products so one Link session populates every tab. To exercise incremental transaction updates, link with `user_transactions_dynamic` and use `/sandbox/transactions/create`, then hit **Refresh** on the Transactions tab.

Other scripts:

```bash
npm run check        # type-check the SPA and the Worker
npm run build        # production build to dist/
npm run cf-typegen   # regenerate worker-configuration.d.ts after editing wrangler.jsonc
```

## Deployment

The Worker, D1 database and R2 bucket referenced in `wrangler.jsonc` already exist in the target account. To deploy from scratch in another account:

```bash
npx wrangler d1 create plaid-cloudflare-poc                  # put the returned database_id in wrangler.jsonc
npx wrangler r2 bucket create plaid-cloudflare-poc-statements
npm run db:migrate:remote
npx wrangler secret put PLAID_CLIENT_ID
npx wrangler secret put PLAID_SECRET
npm run deploy                                               # vite build && wrangler deploy
```

## Out of scope

User authentication and per-user data partitioning, Plaid webhooks (`SYNC_UPDATES_AVAILABLE`, `STATEMENTS_REFRESH_COMPLETE`), scheduled refreshes, encryption of access tokens at rest, and an automated test suite. Verification for this PoC was done by type-checking plus manual end-to-end runs against the Plaid Sandbox, locally and on the deployed Worker.
