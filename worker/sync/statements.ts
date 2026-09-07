import { nowIso, runBatch } from "../db";
import type { ItemRow } from "../db";
import type { PlaidClient } from "../plaid";
import type { SyncContext } from "./common";

// Sandbox returns a statement per account per month, so a refresh can list
// ~100 PDFs. Download a bounded number eagerly; the PDF endpoint fetches the
// rest lazily on first access.
const MAX_DOWNLOADS_PER_REFRESH = 20;
const DOWNLOAD_CONCURRENCY = 5;

export function statementR2Key(itemId: string, statementId: string): string {
  return `items/${itemId}/statements/${statementId}.pdf`;
}

/** Downloads one statement PDF from Plaid into R2 and records the key. Returns the key. */
export async function downloadStatementToR2(
  db: D1Database,
  bucket: R2Bucket,
  plaid: PlaidClient,
  item: ItemRow,
  statementId: string,
): Promise<string> {
  const key = statementR2Key(item.item_id, statementId);
  const pdf = await plaid.statementsDownload(item.access_token, statementId);
  // R2 needs a known length; statement PDFs are small enough to buffer.
  const bytes = await pdf.arrayBuffer();
  await bucket.put(key, bytes, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: {
      item_id: item.item_id,
      statement_id: statementId,
      plaid_content_hash: pdf.headers.get("Plaid-Content-Hash") ?? "",
    },
  });
  await db
    .prepare("UPDATE statements SET r2_key = ?, downloaded_at = ? WHERE statement_id = ?")
    .bind(key, nowIso(), statementId)
    .run();
  return key;
}

/**
 * Lists available statements, upserts their metadata, then downloads a batch
 * of PDFs not yet stored in R2. Statements are immutable so already-downloaded
 * files are never re-fetched.
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
    .prepare(
      `SELECT statement_id FROM statements WHERE item_id = ? AND r2_key IS NULL
       ORDER BY year DESC, month DESC LIMIT ?`,
    )
    .bind(item.item_id, MAX_DOWNLOADS_PER_REFRESH)
    .all<{ statement_id: string }>();

  let downloaded = 0;
  const queue = [...pending.results];
  const workers = Array.from({ length: DOWNLOAD_CONCURRENCY }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      await downloadStatementToR2(db, bucket, plaid, item, next.statement_id);
      downloaded++;
    }
  });
  await Promise.all(workers);

  const remaining = await db
    .prepare("SELECT COUNT(*) AS n FROM statements WHERE item_id = ? AND r2_key IS NULL")
    .bind(item.item_id)
    .first<{ n: number }>();

  return { listed, downloaded, awaiting_download: remaining?.n ?? 0 };
}
