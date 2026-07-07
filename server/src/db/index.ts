import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema.js";
import { existsSync, mkdirSync, readdirSync } from "fs";
import { dirname, join, resolve } from "path";

// Resolve which sqlite file to use so users don't need to hardcode a
// specific filename. Preference order:
//
//   1. `DATABASE_URL` env, but only if the file has real data
//      (purchase_orders rows > 0). Prevents an accidentally-pointed-at
//      empty file from silently hiding the real working database.
//   2. Scan `./data/` for `*.sqlite` files and pick the one with the
//      most purchase_orders rows.
//   3. Fall back to `./data/db.sqlite` (created fresh).
//
// This way the app works with whichever sqlite is present in the project.
const DEFAULT_DIR = "./data";
const DEFAULT_FILE = "db.sqlite";

// Count rows in a canonical table as our "has data" heuristic. Opens the
// file read-only so a candidate we ultimately don't choose isn't mutated.
// Returns -1 if the file can't be opened or the table doesn't exist.
function countPurchaseOrders(filePath: string): number {
  if (!existsSync(filePath)) return -1;
  let handle: Database.Database | null = null;
  try {
    handle = new Database(filePath, { readonly: true, fileMustExist: true });
    const row = handle
      .prepare("SELECT count(*) AS c FROM purchase_orders")
      .get() as { c: number } | undefined;
    return row?.c ?? 0;
  } catch {
    return -1;
  } finally {
    try {
      handle?.close();
    } catch { /* ignore */ }
  }
}

function pickBestSqlite(dir: string): { path: string; rows: number } | null {
  if (!existsSync(dir)) return null;
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".sqlite"));
  } catch {
    return null;
  }
  const scored = files
    .map((f) => ({ path: join(dir, f), rows: countPurchaseOrders(join(dir, f)) }))
    .filter((c) => c.rows > 0);
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.rows - a.rows);
  return scored[0];
}

function resolveDbPath(): string {
  const configured = process.env.DATABASE_URL?.trim();
  if (configured) {
    const configuredRows = countPurchaseOrders(configured);
    if (configuredRows > 0) return configured;
    const best = pickBestSqlite(dirname(configured) || DEFAULT_DIR);
    if (best) {
      console.warn(
        `[db] DATABASE_URL=${configured} has ${Math.max(configuredRows, 0)} rows; using "${best.path}" (${best.rows} rows) instead.`,
      );
      return best.path;
    }
    // Nothing else exists — honor the configured path and create it fresh.
    return configured;
  }

  const best = pickBestSqlite(DEFAULT_DIR);
  if (best) return best.path;
  return join(DEFAULT_DIR, DEFAULT_FILE);
}

const DB_PATH = resolveDbPath();
mkdirSync(dirname(DB_PATH), { recursive: true });
console.log(`[db] using sqlite file: ${resolve(DB_PATH)}`);

const sqlite = new Database(DB_PATH);
export const db = drizzle(sqlite, { schema });
