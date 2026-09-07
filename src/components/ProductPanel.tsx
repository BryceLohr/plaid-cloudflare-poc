import type { ReactNode } from "react";
import type { ProductSync } from "../../shared/types";
import { relativeTime } from "../format";

interface Props {
  title: string;
  description: string;
  sync?: ProductSync;
  busy: boolean;
  loading: boolean;
  onRefresh?: () => void;
  children: ReactNode;
}

/** Shared chrome for each product tab: heading, sync status, refresh button. */
export function ProductPanel({ title, description, sync, busy, loading, onRefresh, children }: Props) {
  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h2>{title}</h2>
          <p className="muted small">{description}</p>
        </div>
        {onRefresh && (
          <div className="panel-sync">
            <span className={`badge badge-${sync?.status ?? "pending"}`}>{sync?.status ?? "pending"}</span>
            <span className="muted small">last synced {relativeTime(sync?.last_synced_at)}</span>
            <button className="btn btn-small" onClick={onRefresh} disabled={busy}>
              {busy ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        )}
      </header>
      {sync?.status === "error" && sync.error && <div className="alert alert-error">Last sync failed: {sync.error}</div>}
      {loading ? <p className="muted">Loading…</p> : children}
    </section>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="muted center">
        {children}
      </td>
    </tr>
  );
}
