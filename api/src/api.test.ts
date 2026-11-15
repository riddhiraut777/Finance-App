import { beforeEach, describe, expect, test } from "bun:test";

// Use a throwaway in-memory database so the real finance.db is never touched.
// This must be set BEFORE the app (and therefore db.ts) is loaded.
process.env.DB_PATH = ":memory:";
const { default: app } = await import("./index");
const { db } = await import("./db");

const valid = {
  type: "expense",
  amount: 45000,
  category: "Groceries",
  date: "2026-11-14",
  note: "Weekly shopping",
};

// Helpers to call the API without starting a real server.
const send = (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const add = (body: unknown = valid) => send("POST", "/api/transactions", body);

// Start every test with an empty table.
beforeEach(() => {
  db.run("DELETE FROM transactions");
});

describe("POST /api/transactions", () => {
  test("adds a valid transaction", async () => {
    const res = await add();
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject(valid);
    expect(typeof created.id).toBe("number");
  });

  test("note is optional", async () => {
    const { note, ...withoutNote } = valid;
    const res = await add(withoutNote);
    expect(res.status).toBe(201);
    expect((await res.json()).note).toBeNull();
  });

  test.each([
    ["bad type", { ...valid, type: "gift" }],
    ["negative amount", { ...valid, amount: -5 }],
    ["zero amount", { ...valid, amount: 0 }],
    ["decimal amount", { ...valid, amount: 10.5 }],
    ["amount as text", { ...valid, amount: "100" }],
    ["empty category", { ...valid, category: "   " }],
    ["missing category", { ...valid, category: undefined }],
    ["badly formatted date", { ...valid, date: "14-11-2026" }],
    ["missing date", { ...valid, date: undefined }],
  ])("rejects %s with 400", async (_name, body) => {
    const res = await add(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBeTruthy();
  });

  test("rejects a request body that is not JSON", async () => {
    const res = await app.request("/api/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  test("a rejected request saves nothing", async () => {
    await add({ ...valid, type: "gift" });
    const list = await (await send("GET", "/api/transactions")).json();
    expect(list).toHaveLength(0);
  });
});

describe("GET /api/transactions", () => {
  test("returns an empty list at first", async () => {
    const res = await send("GET", "/api/transactions");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("returns newest date first", async () => {
    await add({ ...valid, date: "2026-11-01", category: "old" });
    await add({ ...valid, date: "2026-11-20", category: "new" });
    await add({ ...valid, date: "2026-11-10", category: "middle" });

    const list = await (await send("GET", "/api/transactions")).json();
    expect(list.map((t: any) => t.category)).toEqual(["new", "middle", "old"]);
  });
});

describe("PUT /api/transactions/:id", () => {
  test("updates an existing transaction", async () => {
    const { id } = await (await add()).json();
    const changes = { type: "income", amount: 2500, category: "Salary", date: "2026-11-16", note: "changed" };

    const res = await send("PUT", `/api/transactions/${id}`, changes);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, ...changes });

    // The change must really be stored, not just echoed back.
    const list = await (await send("GET", "/api/transactions")).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, ...changes });
  });

  test("clearing the note stores null", async () => {
    const { id } = await (await add()).json();
    const { note, ...withoutNote } = valid;
    const res = await send("PUT", `/api/transactions/${id}`, withoutNote);
    expect((await res.json()).note).toBeNull();
  });

  test("rejects invalid input with 400 and leaves the row unchanged", async () => {
    const { id } = await (await add()).json();
    const res = await send("PUT", `/api/transactions/${id}`, { ...valid, amount: -1 });
    expect(res.status).toBe(400);

    const list = await (await send("GET", "/api/transactions")).json();
    expect(list[0].amount).toBe(valid.amount);
  });

  test("returns 404 for an unknown id", async () => {
    const res = await send("PUT", "/api/transactions/99999", valid);
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/transactions/:id", () => {
  test("deletes a transaction", async () => {
    const { id } = await (await add()).json();

    const res = await send("DELETE", `/api/transactions/${id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: id });

    const list = await (await send("GET", "/api/transactions")).json();
    expect(list).toHaveLength(0);
  });

  test("only deletes the requested row", async () => {
    const first = await (await add({ ...valid, category: "keep" })).json();
    const second = await (await add({ ...valid, category: "remove" })).json();

    await send("DELETE", `/api/transactions/${second.id}`);

    const list = await (await send("GET", "/api/transactions")).json();
    expect(list.map((t: any) => t.id)).toEqual([first.id]);
  });

  test("returns 404 for an unknown id", async () => {
    const res = await send("DELETE", "/api/transactions/99999");
    expect(res.status).toBe(404);
  });
});
