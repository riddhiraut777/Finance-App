import { Database } from "bun:sqlite";

// Opens (or creates) the database file at api/finance.db.
// Tests set DB_PATH to ":memory:" so they never touch the real data.
export const db = new Database(process.env.DB_PATH ?? "finance.db");

// Make SQLite enforce the links between tables (e.g. a transaction's user must exist).
db.run("PRAGMA foreign_keys = ON");

// One row per account. Passwords are never stored, only a hash of them.
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  )
`);

// One row per logged-in browser. The browser holds a random token in a cookie;
// we store only a hash of it, so a leaked database can't be used to log in.
db.run(`
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  )
`);

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
    note     TEXT,
    user_id  INTEGER REFERENCES users(id)
  )
`);

// Databases created before login existed have no user_id column yet. Add it.
// Their old rows get user_id = NULL, so they belong to nobody and are never shown.
const columns = db.query("PRAGMA table_info(transactions)").all() as { name: string }[];
if (!columns.some((c) => c.name === "user_id")) {
  db.run("ALTER TABLE transactions ADD COLUMN user_id INTEGER REFERENCES users(id)");
}

db.run("CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id)");
