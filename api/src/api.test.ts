import { beforeEach, describe, expect, test } from "bun:test";

// Use a throwaway in-memory database so the real finance.db is never touched.
// This must be set BEFORE the app (and therefore db.ts) is loaded.
process.env.DB_PATH = ":memory:";
const { default: app } = await import("./index");
const { db } = await import("./db");
const { resetLoginLimiter } = await import("./auth");

const PASSWORD = "correct horse battery";

const valid = {
  type: "expense",
  amount: 45000,
  category: "Groceries",
  date: "2026-11-14",
  note: "Weekly shopping",
};

// Helpers to call the API without starting a real server.
// `cookie` is the logged-in session sent with each request (a different one can be passed).
let cookie = "";

const send = (method: string, path: string, body?: unknown, sessionCookie: string | null = cookie) =>
  app.request(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const add = (body: unknown = valid) => send("POST", "/api/transactions", body);

// Pull "session=abc..." out of a response's Set-Cookie header.
const cookieFrom = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";

// Create an account and return its session cookie.
async function signUp(email: string) {
  const res = await send("POST", "/api/signup", { email, password: PASSWORD }, null);
  expect(res.status).toBe(201);
  return cookieFrom(res);
}

// Start every test with empty tables and a fresh logged-in user.
beforeEach(async () => {
  db.run("DELETE FROM sessions");
  db.run("DELETE FROM transactions");
  db.run("DELETE FROM users");
  resetLoginLimiter();
  cookie = await signUp("me@example.com");
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
      headers: { "Content-Type": "application/json", Cookie: cookie },
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

describe("signup", () => {
  test("creates an account, sets a protected cookie and returns the user", async () => {
    const res = await send("POST", "/api/signup", { email: "new@example.com", password: PASSWORD }, null);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ email: "new@example.com" });

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  });

  test("never stores the password itself", async () => {
    const row = db.query("SELECT password_hash FROM users WHERE email = ?").get("me@example.com") as {
      password_hash: string;
    };
    expect(row.password_hash).not.toContain(PASSWORD);
    expect(row.password_hash.startsWith("$argon2")).toBe(true);
  });

  test("stores only a hash of the session token", async () => {
    const token = cookie.split("=")[1];
    const rows = db.query("SELECT token_hash FROM sessions").all() as { token_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(token);
  });

  test("treats emails as case-insensitive and rejects duplicates with 409", async () => {
    const res = await send("POST", "/api/signup", { email: "  ME@Example.com ", password: PASSWORD }, null);
    expect(res.status).toBe(409);
  });

  test.each([
    ["missing email", { password: PASSWORD }],
    ["email without @", { email: "nope", password: PASSWORD }],
    ["email without domain dot", { email: "a@b", password: PASSWORD }],
    ["short password", { email: "x@example.com", password: "short" }],
    ["missing password", { email: "x@example.com" }],
    ["password as number", { email: "x@example.com", password: 12345678 }],
  ])("rejects %s with 400", async (_name, body) => {
    const res = await send("POST", "/api/signup", body, null);
    expect(res.status).toBe(400);
  });
});

describe("login", () => {
  test("logs in with the right password and sets a cookie", async () => {
    const res = await send("POST", "/api/login", { email: "me@example.com", password: PASSWORD }, null);
    expect(res.status).toBe(200);
    expect(cookieFrom(res)).toContain("session=");
  });

  test("email is not case-sensitive", async () => {
    const res = await send("POST", "/api/login", { email: "ME@EXAMPLE.COM", password: PASSWORD }, null);
    expect(res.status).toBe(200);
  });

  test("wrong password and unknown email give the same 401 message", async () => {
    const wrongPassword = await send("POST", "/api/login", { email: "me@example.com", password: "wrong-password" }, null);
    const unknownEmail = await send("POST", "/api/login", { email: "nobody@example.com", password: PASSWORD }, null);

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
  });

  test("locks the account after 5 wrong passwords, even for the right one", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await send("POST", "/api/login", { email: "me@example.com", password: "wrong-password" }, null);
      expect(res.status).toBe(401);
    }
    const locked = await send("POST", "/api/login", { email: "me@example.com", password: PASSWORD }, null);
    expect(locked.status).toBe(429);
  });
});

describe("session", () => {
  test("/api/me returns the logged-in user", async () => {
    const res = await send("GET", "/api/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ email: "me@example.com" });
  });

  test("/api/me returns 401 with no cookie or a made-up one", async () => {
    expect((await send("GET", "/api/me", undefined, null)).status).toBe(401);
    expect((await send("GET", "/api/me", undefined, "session=made-up-token")).status).toBe(401);
  });

  test("logout ends the session", async () => {
    const out = await send("POST", "/api/logout");
    expect(out.status).toBe(200);

    expect((await send("GET", "/api/me")).status).toBe(401);
  });

  test("an expired session is rejected", async () => {
    db.run("UPDATE sessions SET expires_at = ?", [Date.now() - 1000]);
    expect((await send("GET", "/api/me")).status).toBe(401);
  });
});

describe("transactions need login", () => {
  test.each([
    ["GET", "/api/transactions"],
    ["POST", "/api/transactions"],
    ["PUT", "/api/transactions/1"],
    ["DELETE", "/api/transactions/1"],
  ])("%s %s returns 401 without a session", async (method, path) => {
    const res = await send(method, path, valid, null);
    expect(res.status).toBe(401);
  });
});

describe("users cannot see or change each other's data", () => {
  test("each user only sees their own transactions", async () => {
    await add({ ...valid, category: "mine" });
    const otherCookie = await signUp("other@example.com");
    await send("POST", "/api/transactions", { ...valid, category: "theirs" }, otherCookie);

    const mine = await (await send("GET", "/api/transactions")).json();
    const theirs = await (await send("GET", "/api/transactions", undefined, otherCookie)).json();
    expect(mine.map((t: any) => t.category)).toEqual(["mine"]);
    expect(theirs.map((t: any) => t.category)).toEqual(["theirs"]);
  });

  test("another user's transaction cannot be edited or deleted (404) and stays unchanged", async () => {
    const { id } = await (await add()).json();
    const otherCookie = await signUp("other@example.com");

    const edit = await send("PUT", `/api/transactions/${id}`, { ...valid, amount: 1 }, otherCookie);
    const del = await send("DELETE", `/api/transactions/${id}`, undefined, otherCookie);
    expect(edit.status).toBe(404);
    expect(del.status).toBe(404);

    const mine = await (await send("GET", "/api/transactions")).json();
    expect(mine).toHaveLength(1);
    expect(mine[0].amount).toBe(valid.amount);
  });

  test("old rows with no owner are never shown", async () => {
    db.run("INSERT INTO transactions (type, amount, category, date) VALUES ('expense', 100, 'old', '2026-01-01')");
    const list = await (await send("GET", "/api/transactions")).json();
    expect(list).toEqual([]);
  });

  test("the user_id is not sent to the browser", async () => {
    const created = await (await add()).json();
    expect(created).not.toHaveProperty("user_id");
  });
});
