// Thin fetch-based Plaid client. The official `plaid` SDK is axios/Node based,
// so a small typed wrapper over the JSON API is more idiomatic for Workers.

const PLAID_HOSTS: Record<string, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

export interface PlaidErrorBody {
  error_type: string;
  error_code: string;
  error_message: string;
  display_message: string | null;
  request_id?: string;
}

export class PlaidApiError extends Error {
  readonly status: number;
  readonly body: PlaidErrorBody;

  constructor(status: number, body: PlaidErrorBody) {
    super(`${body.error_type}/${body.error_code}: ${body.error_message}`);
    this.name = "PlaidApiError";
    this.status = status;
    this.body = body;
  }
}

export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  balances: {
    available: number | null;
    current: number | null;
    limit: number | null;
    iso_currency_code: string | null;
    unofficial_currency_code: string | null;
  };
  [key: string]: unknown;
}

export interface PlaidItem {
  item_id: string;
  institution_id: string | null;
  institution_name?: string | null;
  products: string[];
  billed_products: string[];
  [key: string]: unknown;
}

export interface PlaidTransaction {
  transaction_id: string;
  account_id: string;
  date: string;
  name: string;
  merchant_name: string | null;
  amount: number;
  iso_currency_code: string | null;
  pending: boolean;
  personal_finance_category: { primary: string; detailed: string } | null;
  [key: string]: unknown;
}

export interface TransactionsSyncResponse {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string; account_id?: string }[];
  next_cursor: string;
  has_more: boolean;
  accounts?: PlaidAccount[];
  transactions_update_status?:
    | "TRANSACTIONS_UPDATE_STATUS_UNKNOWN"
    | "NOT_READY"
    | "INITIAL_UPDATE_COMPLETE"
    | "HISTORICAL_UPDATE_COMPLETE";
  request_id: string;
}

export interface LiabilityRecord {
  account_id: string;
  [key: string]: unknown;
}

export interface LiabilitiesGetResponse {
  accounts: PlaidAccount[];
  item: PlaidItem;
  liabilities: {
    credit: LiabilityRecord[] | null;
    mortgage: LiabilityRecord[] | null;
    student: LiabilityRecord[] | null;
  };
  request_id: string;
}

export interface PlaidSecurity {
  security_id: string;
  name: string | null;
  ticker_symbol: string | null;
  type: string | null;
  close_price: number | null;
  iso_currency_code: string | null;
  [key: string]: unknown;
}

export interface PlaidHolding {
  account_id: string;
  security_id: string;
  quantity: number;
  institution_price: number;
  institution_value: number;
  cost_basis: number | null;
  iso_currency_code: string | null;
  [key: string]: unknown;
}

export interface InvestmentsHoldingsGetResponse {
  accounts: PlaidAccount[];
  holdings: PlaidHolding[];
  securities: PlaidSecurity[];
  item: PlaidItem;
  request_id: string;
}

export interface PlaidInvestmentTransaction {
  investment_transaction_id: string;
  account_id: string;
  security_id: string | null;
  date: string;
  name: string;
  type: string;
  subtype: string;
  quantity: number;
  amount: number;
  price: number;
  fees: number | null;
  iso_currency_code: string | null;
  [key: string]: unknown;
}

export interface InvestmentsTransactionsGetResponse {
  accounts: PlaidAccount[];
  investment_transactions: PlaidInvestmentTransaction[];
  securities: PlaidSecurity[];
  item: PlaidItem;
  total_investment_transactions: number;
  request_id: string;
}

export interface StatementsListResponse {
  accounts: {
    account_id: string;
    account_name: string;
    account_official_name: string | null;
    account_mask: string | null;
    account_type: string;
    account_subtype: string | null;
    statements: { statement_id: string; month: number; year: number; date_posted?: string }[];
  }[];
  institution_id: string;
  institution_name: string;
  item_id: string;
  request_id: string;
}

export interface LinkTokenCreateRequest {
  client_name: string;
  language: string;
  country_codes: string[];
  user: { client_user_id: string };
  products: string[];
  optional_products?: string[];
  required_if_supported_products?: string[];
  statements?: { start_date: string; end_date: string };
  transactions?: { days_requested?: number };
  webhook?: string;
  redirect_uri?: string;
}

export class PlaidClient {
  private readonly baseUrl: string;

  constructor(
    private readonly clientId: string,
    private readonly secret: string,
    env: string,
  ) {
    const host = PLAID_HOSTS[env];
    if (!host) throw new Error(`Unknown PLAID_ENV "${env}"`);
    this.baseUrl = host;
  }

  private async post<T>(path: string, body: object): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: this.clientId, secret: this.secret, ...body }),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as PlaidErrorBody | null;
      throw new PlaidApiError(
        res.status,
        errBody ?? {
          error_type: "API_ERROR",
          error_code: "UNKNOWN",
          error_message: `Plaid ${path} failed with HTTP ${res.status}`,
          display_message: null,
        },
      );
    }
    return (await res.json()) as T;
  }

  linkTokenCreate(req: LinkTokenCreateRequest) {
    return this.post<{ link_token: string; expiration: string }>("/link/token/create", req);
  }

  itemPublicTokenExchange(publicToken: string) {
    return this.post<{ access_token: string; item_id: string }>("/item/public_token/exchange", {
      public_token: publicToken,
    });
  }

  itemGet(accessToken: string) {
    return this.post<{ item: PlaidItem }>("/item/get", { access_token: accessToken });
  }

  itemRemove(accessToken: string) {
    return this.post<{ request_id: string }>("/item/remove", { access_token: accessToken });
  }

  institutionsGetById(institutionId: string, countryCodes: string[]) {
    return this.post<{ institution: { institution_id: string; name: string } }>(
      "/institutions/get_by_id",
      { institution_id: institutionId, country_codes: countryCodes },
    );
  }

  accountsGet(accessToken: string) {
    return this.post<{ accounts: PlaidAccount[]; item: PlaidItem }>("/accounts/get", {
      access_token: accessToken,
    });
  }

  transactionsSync(accessToken: string, cursor: string | null) {
    return this.post<TransactionsSyncResponse>("/transactions/sync", {
      access_token: accessToken,
      cursor: cursor ?? undefined,
      count: 500,
    });
  }

  liabilitiesGet(accessToken: string) {
    return this.post<LiabilitiesGetResponse>("/liabilities/get", { access_token: accessToken });
  }

  investmentsHoldingsGet(accessToken: string) {
    return this.post<InvestmentsHoldingsGetResponse>("/investments/holdings/get", {
      access_token: accessToken,
    });
  }

  investmentsTransactionsGet(
    accessToken: string,
    startDate: string,
    endDate: string,
    offset: number,
    count = 500,
  ) {
    return this.post<InvestmentsTransactionsGetResponse>("/investments/transactions/get", {
      access_token: accessToken,
      start_date: startDate,
      end_date: endDate,
      options: { count, offset },
    });
  }

  statementsList(accessToken: string) {
    return this.post<StatementsListResponse>("/statements/list", { access_token: accessToken });
  }

  /** Returns the raw PDF response so callers can stream it into R2. */
  async statementsDownload(accessToken: string, statementId: string): Promise<Response> {
    const res = await fetch(`${this.baseUrl}/statements/download`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.clientId,
        secret: this.secret,
        access_token: accessToken,
        statement_id: statementId,
      }),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as PlaidErrorBody | null;
      throw new PlaidApiError(
        res.status,
        errBody ?? {
          error_type: "API_ERROR",
          error_code: "UNKNOWN",
          error_message: `Plaid /statements/download failed with HTTP ${res.status}`,
          display_message: null,
        },
      );
    }
    return res;
  }
}

export function plaidClientFromEnv(env: Env): PlaidClient {
  if (!env.PLAID_CLIENT_ID || !env.PLAID_SECRET) {
    throw new Error("PLAID_CLIENT_ID and PLAID_SECRET must be configured");
  }
  return new PlaidClient(env.PLAID_CLIENT_ID, env.PLAID_SECRET, env.PLAID_ENV);
}
