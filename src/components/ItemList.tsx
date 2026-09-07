import type { ItemSummary, Product } from "../../shared/types";
import { PRODUCTS } from "../../shared/types";
import { relativeTime } from "../format";

interface Props {
  items: ItemSummary[];
  selectedId: string | null;
  busyItemId: string | null;
  onSelect: (itemId: string) => void;
  onRefreshAll: (itemId: string) => void;
  onRemove: (itemId: string) => void;
}

const PRODUCT_LABEL: Record<Product, string> = {
  transactions: "Txns",
  liabilities: "Liab",
  investments: "Inv",
  statements: "Stmt",
};

export function ItemList({ items, selectedId, busyItemId, onSelect, onRefreshAll, onRemove }: Props) {
  if (items.length === 0) {
    return (
      <div className="empty">
        <p>No institutions linked yet.</p>
        <p className="muted">
          Click <strong>Connect a bank account</strong>, pick any Sandbox institution (for example First Platypus
          Bank) and sign in with <code>user_good</code> / <code>pass_good</code>.
        </p>
      </div>
    );
  }

  return (
    <ul className="item-list">
      {items.map((item) => {
        const busy = busyItemId === item.item_id;
        return (
          <li
            key={item.item_id}
            className={`item-card ${item.item_id === selectedId ? "selected" : ""}`}
            onClick={() => onSelect(item.item_id)}
          >
            <div className="item-card-head">
              <div>
                <div className="item-name">{item.institution_name ?? item.institution_id ?? "Unknown institution"}</div>
                <div className="muted small">
                  {item.accounts.length} account{item.accounts.length === 1 ? "" : "s"} · linked{" "}
                  {relativeTime(item.created_at)}
                </div>
              </div>
            </div>
            <div className="badges">
              {PRODUCTS.map((p) => {
                const sync = item.syncs.find((s) => s.product === p);
                const status = sync?.status ?? "pending";
                return (
                  <span
                    key={p}
                    className={`badge badge-${status}`}
                    title={`${p}: ${status}${sync?.last_synced_at ? `, synced ${relativeTime(sync.last_synced_at)}` : ""}${sync?.error ? `\n${sync.error}` : ""}`}
                  >
                    {PRODUCT_LABEL[p]}
                  </span>
                );
              })}
            </div>
            <div className="item-actions" onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-small" disabled={busy} onClick={() => onRefreshAll(item.item_id)}>
                {busy ? "Refreshing…" : "Refresh all"}
              </button>
              <button className="btn btn-small btn-danger" disabled={busy} onClick={() => onRemove(item.item_id)}>
                Remove
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
