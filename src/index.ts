/**
 * Plaid + Cloudflare Workers proof of concept.
 *
 * The Worker talks to Plaid's REST API directly with `fetch` (rather than the
 * Node SDK) so it runs natively on the Workers runtime. Credentials are read
 * from secrets at runtime and are never committed to config or source.
 */

const PLAID_HOSTS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

interface PlaidCredentials {
  clientId: string;
  secret: string;
  baseUrl: string;
  env: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function resolveCredentials(env: Env): PlaidCredentials | null {
  const plaidEnv = env.PLAID_ENV ?? "sandbox";
  const baseUrl = PLAID_HOSTS[plaidEnv] ?? PLAID_HOSTS.sandbox;
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
    return null;
  }
  return {
    clientId: env.PLAID_CLIENT_ID,
    secret: env.PLAID_SECRET,
    baseUrl,
    env: plaidEnv,
  };
}

async function callPlaid(
  creds: PlaidCredentials,
  path: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const upstream = await fetch(`${creds.baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: creds.clientId,
      secret: creds.secret,
      ...payload,
    }),
  });

  const data = await upstream.json();
  return json(data, upstream.status);
}

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Plaid × Cloudflare Workers POC</title>
    <style>
      :root { color-scheme: light dark; }
      body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 42rem; margin: 3rem auto; padding: 0 1.25rem; line-height: 1.6; }
      code { background: rgba(127,127,127,.15); padding: .15rem .35rem; border-radius: .35rem; }
      .card { border: 1px solid rgba(127,127,127,.3); border-radius: .75rem; padding: 1rem 1.25rem; margin: 1rem 0; }
      h1 { font-size: 1.6rem; }
    </style>
  </head>
  <body>
    <h1>Plaid × Cloudflare Workers</h1>
    <p>This is a proof-of-concept Worker that proxies Plaid's REST API.</p>
    <div class="card">
      <strong>Endpoints</strong>
      <ul>
        <li><code>GET /health</code> — service and credential status</li>
        <li><code>POST /api/create_link_token</code> — create a Plaid Link token</li>
        <li><code>POST /api/exchange_public_token</code> — exchange a public token</li>
      </ul>
    </div>
    <p>Set <code>PLAID_CLIENT_ID</code> and <code>PLAID_SECRET</code> to enable live Plaid calls.</p>
  </body>
</html>`;

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "GET" && pathname === "/") {
      return new Response(INDEX_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (request.method === "GET" && pathname === "/health") {
      const creds = resolveCredentials(env);
      return json({
        status: "ok",
        service: "plaid-cloudflare-poc",
        plaidEnv: env.PLAID_ENV ?? "sandbox",
        plaidConfigured: creds !== null,
        time: new Date().toISOString(),
      });
    }

    if (request.method === "POST" && pathname === "/api/create_link_token") {
      const creds = resolveCredentials(env);
      if (!creds) {
        return json(
          {
            error: "plaid_not_configured",
            message:
              "Set PLAID_CLIENT_ID and PLAID_SECRET secrets to use Plaid endpoints.",
          },
          503,
        );
      }
      return callPlaid(creds, "/link/token/create", {
        user: { client_user_id: crypto.randomUUID() },
        client_name: "Plaid Cloudflare POC",
        products: ["auth", "transactions"],
        country_codes: ["US"],
        language: "en",
      });
    }

    if (request.method === "POST" && pathname === "/api/exchange_public_token") {
      const creds = resolveCredentials(env);
      if (!creds) {
        return json(
          {
            error: "plaid_not_configured",
            message:
              "Set PLAID_CLIENT_ID and PLAID_SECRET secrets to use Plaid endpoints.",
          },
          503,
        );
      }
      let payload: { public_token?: string };
      try {
        payload = (await request.json()) as { public_token?: string };
      } catch {
        return json({ error: "invalid_json" }, 400);
      }
      if (!payload.public_token) {
        return json({ error: "missing_public_token" }, 400);
      }
      return callPlaid(creds, "/item/public_token/exchange", {
        public_token: payload.public_token,
      });
    }

    return json({ error: "not_found", path: pathname }, 404);
  },
} satisfies ExportedHandler<Env>;
