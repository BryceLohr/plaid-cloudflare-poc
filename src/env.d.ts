// Secrets are provisioned at runtime (via `wrangler secret put` or the
// dashboard) and are therefore not part of the generated wrangler config
// types. Declaration-merge them into the global `Env` interface so the Worker
// can read them type-safely. They are optional because the POC runs (health,
// landing page) without Plaid credentials configured.
interface Env {
  PLAID_CLIENT_ID?: string;
  PLAID_SECRET?: string;
}
