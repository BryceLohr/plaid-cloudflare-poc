import { useEffect, useMemo, useState } from "react";
import type {
  Account,
  InvestmentsResponse,
  ItemSummary,
  Liability,
  Product,
  Statement,
  TransactionsResponse,
} from "../../shared/types";
import { api } from "../api";
import { ProductPanel } from "./ProductPanel";
import {
  AccountsTable,
  HoldingsTable,
  InvestmentTransactionsTable,
  LiabilitiesView,
  StatementsTable,
  TransactionsTable,
} from "./tables";

type Tab = "accounts" | Product;

const TABS: { id: Tab; label: string }[] = [
  { id: "accounts", label: "Accounts" },
  { id: "transactions", label: "Transactions" },
  { id: "liabilities", label: "Liabilities" },
  { id: "investments", label: "Investments" },
  { id: "statements", label: "Statements" },
];

interface Props {
  item: ItemSummary;
  busyProduct: Product | "all" | null;
  /** Increments whenever the item's data may have changed (after a refresh). */
  dataVersion: number;
  onRefresh: (product: Product) => void;
  onError: (message: string) => void;
}

export function ItemDetail({ item, busyProduct, dataVersion, onRefresh, onError }: Props) {
  const [tab, setTab] = useState<Tab>("accounts");
  const [loading, setLoading] = useState(false);
  const [transactions, setTransactions] = useState<TransactionsResponse>({ transactions: [], total: 0 });
  const [liabilities, setLiabilities] = useState<Liability[]>([]);
  const [investments, setInvestments] = useState<InvestmentsResponse>({
    holdings: [],
    investment_transactions: [],
    investment_transactions_total: 0,
  });
  const [statements, setStatements] = useState<Statement[]>([]);

  const accountsById = useMemo(() => new Map<string, Account>(item.accounts.map((a) => [a.account_id, a])), [item.accounts]);

  useEffect(() => {
    if (tab === "accounts") return;
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      switch (tab) {
        case "transactions":
          setTransactions(await api.transactions(item.item_id));
          break;
        case "liabilities":
          setLiabilities((await api.liabilities(item.item_id)).liabilities);
          break;
        case "investments":
          setInvestments(await api.investments(item.item_id));
          break;
        case "statements":
          setStatements((await api.statements(item.item_id)).statements);
          break;
      }
    };
    load()
      .catch((err) => {
        if (!cancelled) onError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, item.item_id, dataVersion, onError]);

  const syncFor = (p: Product) => item.syncs.find((s) => s.product === p);
  const isBusy = (p: Product) => busyProduct === p || busyProduct === "all";

  return (
    <div className="detail">
      <div className="detail-head">
        <h1>{item.institution_name ?? item.institution_id ?? "Institution"}</h1>
        <div className="muted small mono">item {item.item_id}</div>
      </div>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "accounts" && (
        <ProductPanel
          title="Accounts"
          description="Accounts on this Item. Balances are refreshed as a side effect of every product sync."
          busy={false}
          loading={false}
        >
          <AccountsTable accounts={item.accounts} />
        </ProductPanel>
      )}

      {tab === "transactions" && (
        <ProductPanel
          title="Transactions"
          description="Incrementally synced with /transactions/sync using a persisted cursor; added, modified and removed transactions are applied to D1."
          sync={syncFor("transactions")}
          busy={isBusy("transactions")}
          loading={loading}
          onRefresh={() => onRefresh("transactions")}
        >
          <TransactionsTable transactions={transactions.transactions} total={transactions.total} accounts={accountsById} />
        </ProductPanel>
      )}

      {tab === "liabilities" && (
        <ProductPanel
          title="Liabilities"
          description="Snapshot from /liabilities/get, grouped by credit card, mortgage and student loan."
          sync={syncFor("liabilities")}
          busy={isBusy("liabilities")}
          loading={loading}
          onRefresh={() => onRefresh("liabilities")}
        >
          <LiabilitiesView liabilities={liabilities} accounts={accountsById} />
        </ProductPanel>
      )}

      {tab === "investments" && (
        <ProductPanel
          title="Investments"
          description="Holdings from /investments/holdings/get and the trailing 24 months of /investments/transactions/get, joined with securities."
          sync={syncFor("investments")}
          busy={isBusy("investments")}
          loading={loading}
          onRefresh={() => onRefresh("investments")}
        >
          <HoldingsTable holdings={investments.holdings} accounts={accountsById} />
          <InvestmentTransactionsTable
            transactions={investments.investment_transactions}
            total={investments.investment_transactions_total}
            accounts={accountsById}
          />
        </ProductPanel>
      )}

      {tab === "statements" && (
        <ProductPanel
          title="Statements"
          description="Metadata from /statements/list. PDFs are fetched with /statements/download and cached in R2: a batch of the newest on each refresh, the rest on first open."
          sync={syncFor("statements")}
          busy={isBusy("statements")}
          loading={loading}
          onRefresh={() => onRefresh("statements")}
        >
          <StatementsTable statements={statements} accounts={accountsById} />
        </ProductPanel>
      )}
    </div>
  );
}
