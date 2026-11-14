import { Hono } from "hono";
import { db } from "./db";

const app = new Hono();

app.get("/api/hello", (c) => {
  return c.json({ message: "Hello from the finance tracker API" });
});

// LIST all transactions, newest first
app.get("/api/transactions", (c) => {
  const rows = db
    .query("SELECT * FROM transactions ORDER BY date DESC, id DESC")
    .all();
  return c.json(rows);
});

// ADD a transaction
// Expects JSON: { type, amount, category, date, note? }
// amount is in the smallest unit (e.g. 450.00 -> 45000)
app.post("/api/transactions", async (c) => {
  const body = await c.req.json().catch(() => null);

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
    return c.json(
      {
        error:
          "Invalid input. Need: type ('income'|'expense'), amount (positive integer), category (text), date (YYYY-MM-DD).",
      },
      400,
    );
  }

  const result = db.run(
    "INSERT INTO transactions (type, amount, category, date, note) VALUES (?, ?, ?, ?, ?)",
    [body.type, body.amount, body.category.trim(), body.date, body.note ?? null],
  );

  const created = db
    .query("SELECT * FROM transactions WHERE id = ?")
    .get(result.lastInsertRowid);
  return c.json(created, 201);
});

// DELETE a transaction by id
app.delete("/api/transactions/:id", (c) => {
  const id = Number(c.req.param("id"));
  const result = db.run("DELETE FROM transactions WHERE id = ?", [id]);

  if (result.changes === 0) {
    return c.json({ error: "Transaction not found" }, 404);
  }
  return c.json({ deleted: id });
});

export default app;
