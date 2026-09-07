import type {
  ApiError,
  InvestmentsResponse,
  ItemSummary,
  Liability,
  Product,
  RefreshResult,
  Statement,
  TransactionsResponse,
} from "../shared/types";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.error);
    this.name = "ApiRequestError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError;
    throw new ApiRequestError(res.status, body);
  }
  return (await res.json()) as T;
}

export const api = {
  createLinkToken: () => request<{ link_token: string }>("/link/token", { method: "POST" }),
  exchangePublicToken: (publicToken: string) =>
    request<{ item: ItemSummary; results: RefreshResult[] }>("/link/exchange", {
      method: "POST",
      body: JSON.stringify({ public_token: publicToken }),
    }),
  listItems: () => request<{ items: ItemSummary[] }>("/items"),
  removeItem: (itemId: string) => request<{ ok: true }>(`/items/${itemId}`, { method: "DELETE" }),
  refresh: (itemId: string, product: Product | "all") =>
    request<{ item: ItemSummary; results: RefreshResult[] }>(`/items/${itemId}/refresh/${product}`, {
      method: "POST",
    }),
  transactions: (itemId: string) => request<TransactionsResponse>(`/items/${itemId}/transactions`),
  liabilities: (itemId: string) => request<{ liabilities: Liability[] }>(`/items/${itemId}/liabilities`),
  investments: (itemId: string) => request<InvestmentsResponse>(`/items/${itemId}/investments`),
  statements: (itemId: string) => request<{ statements: Statement[] }>(`/items/${itemId}/statements`),
  statementPdfUrl: (statementId: string) => `/api/statements/${statementId}/pdf`,
};
