import { useCallback, useEffect, useState } from "react";
import type { ItemSummary, Product } from "../shared/types";
import { api } from "./api";
import { ItemDetail } from "./components/ItemDetail";
import { ItemList } from "./components/ItemList";
import { LinkButton } from "./components/LinkButton";

export default function App() {
  const [items, setItems] = useState<ItemSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ itemId: string; product: Product | "all" } | null>(null);
  const [dataVersion, setDataVersion] = useState(0);

  const showError = useCallback((message: string) => setError(message), []);

  const loadItems = useCallback(async () => {
    const { items } = await api.listItems();
    setItems(items);
    setSelectedId((current) => {
      if (current && items.some((i) => i.item_id === current)) return current;
      return items[items.length - 1]?.item_id ?? null;
    });
    setDataVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    loadItems().catch((err) => showError(err instanceof Error ? err.message : String(err)));
  }, [loadItems, showError]);

  const refresh = async (itemId: string, product: Product | "all") => {
    setBusy({ itemId, product });
    setError(null);
    try {
      const { item, results } = await api.refresh(itemId, product);
      setItems((prev) => prev?.map((i) => (i.item_id === item.item_id ? item : i)) ?? null);
      setDataVersion((v) => v + 1);
      const failed = results.filter((r) => r.status === "error");
      if (failed.length) setError(failed.map((r) => `${r.product}: ${r.error}`).join("; "));
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (itemId: string) => {
    if (!confirm("Remove this institution and delete all of its persisted data?")) return;
    setBusy({ itemId, product: "all" });
    try {
      await api.removeItem(itemId);
      await loadItems();
    } catch (err) {
      showError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const selected = items?.find((i) => i.item_id === selectedId) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="brand">Plaid on Cloudflare</div>
          <div className="muted small">Workers · D1 · R2 · Plaid Sandbox proof of concept</div>
        </div>
        <LinkButton onLinked={loadItems} onError={showError} />
      </header>

      {error && (
        <div className="alert alert-error banner">
          <span>{error}</span>
          <button className="btn btn-small" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <main className="layout">
        <aside className="sidebar">
          <h2 className="sidebar-title">Linked institutions</h2>
          {items === null ? (
            <p className="muted">Loading…</p>
          ) : (
            <ItemList
              items={items}
              selectedId={selectedId}
              busyItemId={busy?.itemId ?? null}
              onSelect={setSelectedId}
              onRefreshAll={(id) => void refresh(id, "all")}
              onRemove={(id) => void remove(id)}
            />
          )}
        </aside>
        <section className="content">
          {selected ? (
            <ItemDetail
              item={selected}
              busyProduct={busy?.itemId === selected.item_id ? busy.product : null}
              dataVersion={dataVersion}
              onRefresh={(p) => void refresh(selected.item_id, p)}
              onError={showError}
            />
          ) : (
            items !== null && (
              <div className="empty tall">
                <p>Select a linked institution to inspect its data, or connect a new one.</p>
              </div>
            )
          )}
        </section>
      </main>
    </div>
  );
}
