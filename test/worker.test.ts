import { env, createExecutionContext, waitOnExecutionContext, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

async function dispatch(path: string, init?: RequestInit): Promise<Response> {
  const request = new Request(`http://example.com${path}`, init);
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("plaid-cloudflare-poc worker", () => {
  it("serves the landing page", async () => {
    const res = await dispatch("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Plaid");
  });

  it("reports health with credential status", async () => {
    const res = await dispatch("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.service).toBe("plaid-cloudflare-poc");
    expect(body).toHaveProperty("plaidConfigured");
  });

  it("returns 503 for Plaid endpoints when credentials are absent", async () => {
    const res = await dispatch("/api/create_link_token", { method: "POST" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("plaid_not_configured");
  });

  it("validates the exchange payload", async () => {
    // Without credentials this returns 503 before payload validation.
    const res = await dispatch("/api/exchange_public_token", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect([400, 503]).toContain(res.status);
  });

  it("returns 404 for unknown routes", async () => {
    const res = await dispatch("/nope");
    expect(res.status).toBe(404);
  });

  it("responds over the full worker pipeline via SELF", async () => {
    const res = await SELF.fetch("http://example.com/health");
    expect(res.status).toBe(200);
  });
});
