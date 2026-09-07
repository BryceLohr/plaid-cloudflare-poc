import { runBatch, upsertAccountStatements } from "../db";
import type { LiabilityRecord } from "../plaid";
import type { LiabilityType } from "../../shared/types";
import type { SyncContext } from "./common";

/** Full replace of the item's liabilities; the payload is a point-in-time snapshot. */
export async function syncLiabilities(ctx: SyncContext): Promise<Record<string, number>> {
  const { db, plaid, item } = ctx;
  const res = await plaid.liabilitiesGet(item.access_token);

  const statements: D1PreparedStatement[] = [
    ...upsertAccountStatements(db, item.item_id, res.accounts),
    db.prepare("DELETE FROM liabilities WHERE item_id = ?").bind(item.item_id),
  ];
  const insert = db.prepare(
    "INSERT INTO liabilities (account_id, item_id, liability_type, raw) VALUES (?, ?, ?, ?)",
  );

  const counts: Record<string, number> = { credit: 0, mortgage: 0, student: 0 };
  const groups: [LiabilityType, LiabilityRecord[] | null][] = [
    ["credit", res.liabilities.credit],
    ["mortgage", res.liabilities.mortgage],
    ["student", res.liabilities.student],
  ];
  for (const [type, records] of groups) {
    for (const rec of records ?? []) {
      statements.push(insert.bind(rec.account_id, item.item_id, type, JSON.stringify(rec)));
      counts[type]++;
    }
  }

  await runBatch(db, statements);
  return counts;
}
