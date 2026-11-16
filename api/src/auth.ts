import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { db } from "./db";

export type AuthUser = { id: number; email: string };
export type AppEnv = { Variables: { user: AuthUser } };

const COOKIE_NAME = "session";
const SESSION_DAYS = 7;
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const isProduction = process.env.NODE_ENV === "production";

// ---------- sessions ----------

const hashToken = (token: string) =>
  new Bun.CryptoHasher("sha256").update(token).digest("hex");

// Make a random token, remember its hash, and put the token in a cookie.
function startSession(c: Parameters<MiddlewareHandler>[0], userId: number) {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  db.run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", [
    hashToken(token),
    userId,
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  ]);
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true, // JavaScript on the page can't read it
    sameSite: "Lax", // not sent on cross-site POSTs
    secure: isProduction, // https only when deployed
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

// Who is logged in for this request? null if nobody.
function currentUser(c: Parameters<MiddlewareHandler>[0]): AuthUser | null {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return null;

  const row = db
    .query(
      `SELECT users.id, users.email, sessions.expires_at
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.token_hash = ?`,
    )
    .get(hashToken(token)) as { id: number; email: string; expires_at: number } | null;

  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.run("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
    return null;
  }
  return { id: row.id, email: row.email };
}

// Put in front of routes that need a logged-in user. Gives them c.get("user").
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = currentUser(c);
  if (!user) return c.json({ error: "Not logged in" }, 401);
  c.set("user", user);
  await next();
};

// ---------- slowing down password guessing ----------
// Kept in memory, so it resets when the server restarts. Fine for a small app.

const failedLogins = new Map<string, { count: number; lockedUntil: number }>();

export const resetLoginLimiter = () => failedLogins.clear();

const isLockedOut = (email: string) => (failedLogins.get(email)?.lockedUntil ?? 0) > Date.now();

function recordFailedLogin(email: string) {
  const entry = failedLogins.get(email) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= MAX_FAILED_LOGINS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    entry.count = 0;
  }
  failedLogins.set(email, entry);
}

// ---------- routes ----------

// A real hash to compare against when the email doesn't exist, so a login for an
// unknown email takes about as long as one with a wrong password.
const DUMMY_HASH = await Bun.password.hash("not-a-real-password");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail = (value: unknown) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const auth = new Hono<AppEnv>();

// Create an account and log in.
auth.post("/signup", async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  const password = body?.password;

  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return c.json({ error: "Enter a valid email address." }, 400);
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 200) {
    return c.json({ error: "Password must be between 8 and 200 characters." }, 400);
  }

  const passwordHash = await Bun.password.hash(password); // argon2id, with its own random salt

  let userId: number;
  try {
    const result = db.run(
      "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)",
      [email, passwordHash, Date.now()],
    );
    userId = Number(result.lastInsertRowid);
  } catch {
    // The email column is UNIQUE, so inserting a second copy throws.
    return c.json({ error: "An account with this email already exists." }, 409);
  }

  startSession(c, userId);
  return c.json({ id: userId, email }, 201);
});

// Log in with email and password.
auth.post("/login", async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  const password = body?.password;

  if (isLockedOut(email)) {
    return c.json({ error: "Too many failed attempts. Try again in 15 minutes." }, 429);
  }

  const user = (
    email && typeof password === "string"
      ? db.query("SELECT id, email, password_hash FROM users WHERE email = ?").get(email)
      : null
  ) as { id: number; email: string; password_hash: string } | null;

  const passwordOk = await Bun.password.verify(
    typeof password === "string" ? password : "",
    user?.password_hash ?? DUMMY_HASH,
  );

  if (!user || !passwordOk) {
    recordFailedLogin(email);
    // Same message whether the email or the password was wrong.
    return c.json({ error: "Invalid email or password." }, 401);
  }

  failedLogins.delete(email);
  db.run("DELETE FROM sessions WHERE expires_at < ?", [Date.now()]); // tidy up old sessions
  startSession(c, user.id);
  return c.json({ id: user.id, email: user.email });
});

// Log out: forget this browser's session.
auth.post("/logout", (c) => {
  const token = getCookie(c, COOKIE_NAME);
  if (token) db.run("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
  deleteCookie(c, COOKIE_NAME, { path: "/" });
  return c.json({ ok: true });
});

// Who am I? Lets the page find out whether it's logged in.
auth.get("/me", (c) => {
  const user = currentUser(c);
  if (!user) return c.json({ error: "Not logged in" }, 401);
  return c.json(user);
});
