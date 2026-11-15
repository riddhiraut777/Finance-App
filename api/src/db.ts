import { Database } from "bun:sqlite";

// Opens (or creates) the database file at api/finance.db.
// Tests set DB_PATH to ":memory:" so they never touch the real data.
export const db = new Database(process.env.DB_PATH ?? "finance.db");

// Create the table only if it doesn't exist yet, so this is safe to run many times.
// amount is stored as an integer in the smallest unit (e.g. 450.00 -> 45000)
// to avoid decimal rounding errors.
db.run(`
  CREATE TABLE IF NOT EXISTS transactions (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    type     TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    amount   INTEGER NOT NULL,
    category TEXT NOT NULL,
    date     TEXT NOT NULL,
    note     TEXT
  )
`);
