import { Hono } from "hono";
import { type AppEnv, auth, requireAuth } from "./auth";
import { db } from "./db";

const app = new Hono<AppEnv>();

app.get("/api/hello", (c) => {
  return c.json({ message: "Hello from the finance tracker API" });
});

// signup, login, logout and "who am I"
app.route("/api", auth);

// Everything under /api/transactions needs a logged-in user.
app.use("/api/transactions", requireAuth);
app.use("/api/transactions/*", requireAuth);

// Columns sent to the browser (user_id is internal, so it is left out).
const COLUMNS = "id, type, amount, category, date, note";

// LIST the logged-in user's transactions, newest first
app.get("/api/transactions", (c) => {
  const rows = db
    .query(`SELECT ${COLUMNS} FROM transactions WHERE user_id = ? ORDER BY date DESC, id DESC`)
    .all(c.get("user").id);
  return c.json(rows);
});

const INVALID_INPUT_MESSAGE =
  "Invalid input. Need: type ('income'|'expense'), amount (positive integer), category (text), date (YYYY-MM-DD).";

// Checks the JSON sent by the client. Returns clean values, or null if invalid.
// Used by both ADD and EDIT so the rules are always the same.
// amount is in the smallest unit (e.g. 450.00 -> 45000)
function parseTransaction(body: any) {
  if (
    !body ||
    (body.type !== "income" && body.type !== "expense") ||
    !Number.isInteger(body.amount) ||
    body.amount <= 0 ||
    typeof body.category !== "string" ||
    body.category.trim() === "" ||
    typeof body.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(body.date)
  ) {
    return null;
  }
  return {
    type: body.type as "income" | "expense",
    amount: body.amount as number,
    category: body.category.trim() as string,
    date: body.date as string,
    note: typeof body.note === "string" && body.note !== "" ? body.note : null,
  };
}

// ADD a transaction
// Expects JSON: { type, amount, category, date, note? }
app.post("/api/transactions", async (c) => {
  const t = parseTransaction(await c.req.json().catch(() => null));
  if (!t) return c.json({ error: INVALID_INPUT_MESSAGE }, 400);

  const result = db.run(
    "INSERT INTO transactions (type, amount, category, date, note, user_id) VALUES (?, ?, ?, ?, ?, ?)",
    [t.type, t.amount, t.category, t.date, t.note, c.get("user").id],
  );

  const created = db
    .query(`SELECT ${COLUMNS} FROM transactions WHERE id = ?`)
    .get(result.lastInsertRowid);
  return c.json(created, 201);
});

// EDIT a transaction by id (replaces all its fields)
// Expects the same JSON as ADD
app.put("/api/transactions/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const t = parseTransaction(await c.req.json().catch(() => null));
  if (!t) return c.json({ error: INVALID_INPUT_MESSAGE }, 400);

  // "AND user_id = ?" means you can only change your own rows;
  // someone else's id looks the same as an id that doesn't exist.
  const result = db.run(
    "UPDATE transactions SET type = ?, amount = ?, category = ?, date = ?, note = ? WHERE id = ? AND user_id = ?",
    [t.type, t.amount, t.category, t.date, t.note, id, c.get("user").id],
  );
  if (result.changes === 0) {
    return c.json({ error: "Transaction not found" }, 404);
  }

  return c.json(db.query(`SELECT ${COLUMNS} FROM transactions WHERE id = ?`).get(id));
});

// DELETE a transaction by id
app.delete("/api/transactions/:id", (c) => {
  const id = Number(c.req.param("id"));
  const result = db.run("DELETE FROM transactions WHERE id = ? AND user_id = ?", [
    id,
    c.get("user").id,
  ]);

  if (result.changes === 0) {
    return c.json({ error: "Transaction not found" }, 404);
  }
  return c.json({ deleted: id });
});

export default app;
