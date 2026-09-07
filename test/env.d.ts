/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module "cloudflare:test" {
  // Makes the Worker's `Env` (config vars + secrets) available on the
  // `env` helper imported from `cloudflare:test`.
  interface ProvidedEnv extends Env {}
}
