// Types shared between the Worker API and the React SPA.

export const PRODUCTS = ["transactions", "liabilities", "investments", "statements"] as const;
export type Product = (typeof PRODUCTS)[number];

export type SyncStatus = "ok" | "error" | "pending";

export interface ProductSync {
  product: Product;
  status: SyncStatus;
  last_synced_at: string | null;
  error: string | null;
}

export interface Account {
  account_id: string;
  item_id: string;
  name: string | null;
  official_name: string | null;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  iso_currency_code: string | null;
}

export interface ItemSummary {
  item_id: string;
  institution_id: string | null;
  institution_name: string | null;
  created_at: string;
  updated_at: string;
  accounts: Account[];
  syncs: ProductSync[];
}

export interface Transaction {
  transaction_id: string;
  item_id: string;
  account_id: string;
  date: string;
  name: string | null;
  merchant_name: string | null;
  amount: number;
  iso_currency_code: string | null;
  pending: boolean;
  category_primary: string | null;
  category_detailed: string | null;
}

export type LiabilityType = "credit" | "mortgage" | "student";

export interface Liability {
  account_id: string;
  item_id: string;
  liability_type: LiabilityType;
  // Full Plaid liability object for this account (shape differs by type).
  raw: Record<string, unknown>;
}

export interface Security {
  security_id: string;
  name: string | null;
  ticker_symbol: string | null;
  type: string | null;
  close_price: number | null;
  iso_currency_code: string | null;
}

export interface Holding {
  account_id: string;
  security_id: string;
  item_id: string;
  quantity: number | null;
  institution_price: number | null;
  institution_value: number | null;
  cost_basis: number | null;
  iso_currency_code: string | null;
  security: Security | null;
}

export interface InvestmentTransaction {
  investment_transaction_id: string;
  item_id: string;
  account_id: string;
  security_id: string | null;
  date: string;
  name: string | null;
  type: string | null;
  subtype: string | null;
  quantity: number | null;
  amount: number | null;
  price: number | null;
  fees: number | null;
  iso_currency_code: string | null;
  security: Security | null;
}

export interface Statement {
  statement_id: string;
  item_id: string;
  account_id: string;
  year: number;
  month: number;
  r2_key: string | null;
  downloaded_at: string | null;
}

export interface InvestmentsResponse {
  holdings: Holding[];
  investment_transactions: InvestmentTransaction[];
}

export interface RefreshResult {
  product: Product;
  status: SyncStatus;
  error: string | null;
  summary: Record<string, number>;
}

export interface ApiError {
  error: string;
  plaid_error_code?: string;
  plaid_error_type?: string;
}
