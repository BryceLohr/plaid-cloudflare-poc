-- Plaid Items (one per linked institution login). access_token is stored in
-- plain text because this is a throw-away PoC; encrypt at rest in real apps.
CREATE TABLE items (
  item_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  institution_id TEXT,
  institution_name TEXT,
  transactions_cursor TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Per-product sync bookkeeping (status: ok | error | pending).
CREATE TABLE product_syncs (
  item_id TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
  product TEXT NOT NULL,
  status TEXT NOT NULL,
  last_synced_at TEXT,
  error TEXT,
  PRIMARY KEY (item_id, product)
);

CREATE TABLE accounts (
  account_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
  name TEXT,
  official_name TEXT,
  mask TEXT,
  type TEXT,
  subtype TEXT,
  current_balance REAL,
  available_balance REAL,
  iso_currency_code TEXT,
  raw TEXT NOT NULL
);
CREATE INDEX idx_accounts_item ON accounts(item_id);

CREATE TABLE transactions (
  transaction_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  date TEXT NOT NULL,
  name TEXT,
  merchant_name TEXT,
  amount REAL NOT NULL,
  iso_currency_code TEXT,
  pending INTEGER NOT NULL DEFAULT 0,
  category_primary TEXT,
  category_detailed TEXT,
  raw TEXT NOT NULL
);
CREATE INDEX idx_transactions_item_date ON transactions(item_id, date DESC);

CREATE TABLE liabilities (
  account_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
  liability_type TEXT NOT NULL CHECK (liability_type IN ('credit', 'mortgage', 'student')),
  raw TEXT NOT NULL
);
CREATE INDEX idx_liabilities_item ON liabilities(item_id);

-- Securities are global (not item-scoped) in Plaid's model.
CREATE TABLE securities (
  security_id TEXT PRIMARY KEY,
  name TEXT,
  ticker_symbol TEXT,
  type TEXT,
  close_price REAL,
  iso_currency_code TEXT,
  raw TEXT NOT NULL
);

CREATE TABLE holdings (
  account_id TEXT NOT NULL,
  security_id TEXT NOT NULL,
  item_id TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
  quantity REAL,
  institution_price REAL,
  institution_value REAL,
  cost_basis REAL,
  iso_currency_code TEXT,
  raw TEXT NOT NULL,
  PRIMARY KEY (account_id, security_id)
);
CREATE INDEX idx_holdings_item ON holdings(item_id);

CREATE TABLE investment_transactions (
  investment_transaction_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  security_id TEXT,
  date TEXT NOT NULL,
  name TEXT,
  type TEXT,
  subtype TEXT,
  quantity REAL,
  amount REAL,
  price REAL,
  fees REAL,
  iso_currency_code TEXT,
  raw TEXT NOT NULL
);
CREATE INDEX idx_investment_transactions_item_date ON investment_transactions(item_id, date DESC);

CREATE TABLE statements (
  statement_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  r2_key TEXT,
  downloaded_at TEXT
);
CREATE INDEX idx_statements_item ON statements(item_id);
