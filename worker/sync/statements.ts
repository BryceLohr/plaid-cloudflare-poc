import { nowIso, runBatch } from "../db";
import type { SyncContext } from "./common";

export function statementR2Key(itemId: string, statementId: string): string {
  return `items/${itemId}/statements/${statementId}.pdf`;
}

/**
 * Lists available statements, upserts their metadata, then downloads any PDF
 * not yet stored in R2. Statements are immutable so already-downloaded files
 * are never re-fetched.
 */
export async function syncStatements(ctx: SyncContext): Promise<Record<string, number>> {
  const { db, bucket, plaid, item } = ctx;
  const res = await plaid.statementsList(item.access_token);

  const upsert = db.prepare(
    `INSERT INTO statements (statement_id, item_id, account_id, year, month)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(statement_id) DO UPDATE SET
       account_id = excluded.account_id,
       year = excluded.year,
       month = excluded.month`,
  );
  const statements: D1PreparedStatement[] = [];
  let listed = 0;
  for (const account of res.accounts) {
    for (const s of account.statements) {
      statements.push(upsert.bind(s.statement_id, item.item_id, account.account_id, s.year, s.month));
      listed++;
    }
  }
  if (statements.length) await runBatch(db, statements);

  const pending = await db
    .prepare("SELECT statement_id FROM statements WHERE item_id = ? AND r2_key IS NULL")
    .bind(item.item_id)
    .all<{ statement_id: string }>();

  let downloaded = 0;
  for (const row of pending.results) {
    const key = statementR2Key(item.item_id, row.statement_id);
    const pdf = await plaid.statementsDownload(item.access_token, row.statement_id);
    await bucket.put(key, pdf.body, {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: {
        item_id: item.item_id,
        statement_id: row.statement_id,
        plaid_content_hash: pdf.headers.get("Plaid-Content-Hash") ?? "",
      },
    });
    await db
      .prepare("UPDATE statements SET r2_key = ?, downloaded_at = ? WHERE statement_id = ?")
      .bind(key, nowIso(), row.statement_id)
      .run();
    downloaded++;
  }

  return { listed, downloaded };
}
