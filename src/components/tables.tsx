import type {
  Account,
  Holding,
  InvestmentTransaction,
  Liability,
  Statement,
  Transaction,
} from "../../shared/types";
import { api } from "../api";
import { MONTHS, money, num, pct, text, titleCase } from "../format";
import { EmptyRow } from "./ProductPanel";

type AccountLookup = Map<string, Account>;

function accountLabel(accounts: AccountLookup, accountId: string): string {
  const a = accounts.get(accountId);
  if (!a) return accountId.slice(0, 8) + "…";
  return `${a.name ?? a.official_name ?? "Account"}${a.mask ? ` ••${a.mask}` : ""}`;
}

export function AccountsTable({ accounts }: { accounts: Account[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Official name</th>
          <th>Type</th>
          <th>Subtype</th>
          <th>Mask</th>
          <th className="right">Available</th>
          <th className="right">Current</th>
        </tr>
      </thead>
      <tbody>
        {accounts.length === 0 && <EmptyRow colSpan={7}>No accounts.</EmptyRow>}
        {accounts.map((a) => (
          <tr key={a.account_id}>
            <td>{text(a.name)}</td>
            <td className="muted">{text(a.official_name)}</td>
            <td>{titleCase(a.type)}</td>
            <td>{titleCase(a.subtype)}</td>
            <td>{a.mask ? `••${a.mask}` : "—"}</td>
            <td className="right">{money(a.available_balance, a.iso_currency_code)}</td>
            <td className="right">{money(a.current_balance, a.iso_currency_code)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CountNote({ shown, total }: { shown: number; total: number }) {
  return (
    <p className="muted small count-note">
      {shown < total ? `Showing the ${shown} most recent of ${total} persisted rows.` : `${total} persisted rows.`}
    </p>
  );
}

export function TransactionsTable({
  transactions,
  total,
  accounts,
}: {
  transactions: Transaction[];
  total: number;
  accounts: AccountLookup;
}) {
  return (
    <>
      <CountNote shown={transactions.length} total={total} />
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Name</th>
            <th>Merchant</th>
            <th>Account</th>
            <th>Category</th>
            <th className="right">Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {transactions.length === 0 && <EmptyRow colSpan={7}>No transactions persisted yet.</EmptyRow>}
          {transactions.map((t) => (
            <tr key={t.transaction_id}>
              <td className="nowrap">{t.date}</td>
              <td>{text(t.name)}</td>
              <td className="muted">{text(t.merchant_name)}</td>
              <td className="muted">{accountLabel(accounts, t.account_id)}</td>
              <td className="muted">{titleCase(t.category_primary)}</td>
              <td className={`right nowrap ${t.amount < 0 ? "credit" : ""}`}>{money(t.amount, t.iso_currency_code)}</td>
              <td>{t.pending ? <span className="badge badge-pending">pending</span> : "posted"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

const CREDIT_FIELDS: [string, string, (v: unknown) => string][] = [
  ["Statement balance", "last_statement_balance", (v) => money(v as number)],
  ["Minimum payment", "minimum_payment_amount", (v) => money(v as number)],
  ["Next due", "next_payment_due_date", text],
  ["Last payment", "last_payment_amount", (v) => money(v as number)],
  ["Last payment date", "last_payment_date", text],
  ["Overdue", "is_overdue", text],
];
const MORTGAGE_FIELDS: [string, string, (v: unknown) => string][] = [
  ["Loan type", "loan_type_description", text],
  ["Term", "loan_term", text],
  ["Rate", "interest_rate", (v) => {
    const r = v as { percentage?: number; type?: string } | null;
    return r ? `${pct(r.percentage ?? null)} ${r.type ?? ""}`.trim() : "—";
  }],
  ["Next payment", "next_monthly_payment", (v) => money(v as number)],
  ["Next due", "next_payment_due_date", text],
  ["Original principal", "origination_principal_amount", (v) => money(v as number)],
  ["Maturity", "maturity_date", text],
];
const STUDENT_FIELDS: [string, string, (v: unknown) => string][] = [
  ["Loan name", "loan_name", text],
  ["Rate", "interest_rate_percentage", (v) => pct(v as number)],
  ["Status", "loan_status", (v) => titleCase((v as { type?: string } | null)?.type)],
  ["Minimum payment", "minimum_payment_amount", (v) => money(v as number)],
  ["Next due", "next_payment_due_date", text],
  ["Outstanding interest", "outstanding_interest_amount", (v) => money(v as number)],
  ["Repayment plan", "repayment_plan", (v) => text((v as { description?: string } | null)?.description)],
];

function LiabilityGroup({
  title,
  rows,
  fields,
  accounts,
}: {
  title: string;
  rows: Liability[];
  fields: [string, string, (v: unknown) => string][];
  accounts: AccountLookup;
}) {
  return (
    <div className="subsection">
      <h3>
        {title} <span className="muted small">({rows.length})</span>
      </h3>
      <table>
        <thead>
          <tr>
            <th>Account</th>
            {fields.map(([label]) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow colSpan={fields.length + 1}>None.</EmptyRow>}
          {rows.map((l) => (
            <tr key={l.account_id}>
              <td>{accountLabel(accounts, l.account_id)}</td>
              {fields.map(([label, key, fmt]) => (
                <td key={label}>{fmt(l.raw[key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LiabilitiesView({ liabilities, accounts }: { liabilities: Liability[]; accounts: AccountLookup }) {
  const byType = (type: Liability["liability_type"]) => liabilities.filter((l) => l.liability_type === type);
  return (
    <>
      <LiabilityGroup title="Credit cards" rows={byType("credit")} fields={CREDIT_FIELDS} accounts={accounts} />
      <LiabilityGroup title="Mortgages" rows={byType("mortgage")} fields={MORTGAGE_FIELDS} accounts={accounts} />
      <LiabilityGroup title="Student loans" rows={byType("student")} fields={STUDENT_FIELDS} accounts={accounts} />
    </>
  );
}

export function HoldingsTable({ holdings, accounts }: { holdings: Holding[]; accounts: AccountLookup }) {
  return (
    <div className="subsection">
      <h3>
        Holdings <span className="muted small">({holdings.length})</span>
      </h3>
      <table>
        <thead>
          <tr>
            <th>Account</th>
            <th>Ticker</th>
            <th>Security</th>
            <th>Type</th>
            <th className="right">Quantity</th>
            <th className="right">Price</th>
            <th className="right">Value</th>
            <th className="right">Cost basis</th>
          </tr>
        </thead>
        <tbody>
          {holdings.length === 0 && <EmptyRow colSpan={8}>No holdings persisted yet.</EmptyRow>}
          {holdings.map((h) => (
            <tr key={`${h.account_id}:${h.security_id}`}>
              <td className="muted">{accountLabel(accounts, h.account_id)}</td>
              <td className="mono">{text(h.security?.ticker_symbol)}</td>
              <td>{text(h.security?.name)}</td>
              <td className="muted">{titleCase(h.security?.type)}</td>
              <td className="right">{num(h.quantity)}</td>
              <td className="right">{money(h.institution_price, h.iso_currency_code)}</td>
              <td className="right">{money(h.institution_value, h.iso_currency_code)}</td>
              <td className="right">{money(h.cost_basis, h.iso_currency_code)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InvestmentTransactionsTable({
  transactions,
  total,
  accounts,
}: {
  transactions: InvestmentTransaction[];
  total: number;
  accounts: AccountLookup;
}) {
  return (
    <div className="subsection">
      <h3>
        Investment transactions <span className="muted small">({total})</span>
      </h3>
      <CountNote shown={transactions.length} total={total} />
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Name</th>
            <th>Account</th>
            <th>Security</th>
            <th>Type</th>
            <th className="right">Quantity</th>
            <th className="right">Price</th>
            <th className="right">Fees</th>
            <th className="right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {transactions.length === 0 && <EmptyRow colSpan={9}>No investment transactions persisted yet.</EmptyRow>}
          {transactions.map((t) => (
            <tr key={t.investment_transaction_id}>
              <td className="nowrap">{t.date}</td>
              <td>{text(t.name)}</td>
              <td className="muted">{accountLabel(accounts, t.account_id)}</td>
              <td className="mono">{t.security?.ticker_symbol ?? t.security?.name ?? "—"}</td>
              <td className="muted">
                {titleCase(t.type)}
                {t.subtype && t.subtype !== t.type ? ` / ${titleCase(t.subtype)}` : ""}
              </td>
              <td className="right">{num(t.quantity)}</td>
              <td className="right">{money(t.price, t.iso_currency_code)}</td>
              <td className="right">{money(t.fees, t.iso_currency_code)}</td>
              <td className={`right nowrap ${(t.amount ?? 0) < 0 ? "credit" : ""}`}>{money(t.amount, t.iso_currency_code)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StatementsTable({ statements, accounts }: { statements: Statement[]; accounts: AccountLookup }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Period</th>
          <th>Account</th>
          <th>Statement ID</th>
          <th>Stored in R2</th>
          <th>PDF</th>
        </tr>
      </thead>
      <tbody>
        {statements.length === 0 && <EmptyRow colSpan={5}>No statements persisted yet.</EmptyRow>}
        {statements.map((s) => (
          <tr key={s.statement_id}>
            <td className="nowrap">
              {MONTHS[s.month - 1] ?? s.month} {s.year}
            </td>
            <td>{accountLabel(accounts, s.account_id)}</td>
            <td className="mono muted">{s.statement_id}</td>
            <td>
              {s.r2_key ? (
                <span className="badge badge-ok">stored</span>
              ) : (
                <span className="badge badge-pending">on demand</span>
              )}
            </td>
            <td>
              <a href={api.statementPdfUrl(s.statement_id)} target="_blank" rel="noreferrer">
                Open PDF
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
