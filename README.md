# Finance App

A simple personal finance tracker. Create an account, then add income and expense transactions, edit or delete them, filter by month, and see total income, total expenses, balance and your top 3 expense categories. Each account only sees its own transactions.

## Tech stack

- **Frontend (`web/`):** React 19 + TypeScript, built with Vite
- **Backend (`api/`):** Hono web server running on Bun
- **Database:** SQLite (a single file, via Bun's built-in `bun:sqlite`)
- **Tooling:** Bun workspaces (one repo, two packages)

## Prerequisites

- [Bun](https://bun.sh) installed (`bun --version` should work)

## Setup

From the project root:

```bash
bun install
```

## Running the app

The frontend and backend run as two separate programs, so use two terminals.

**Terminal 1: API (http://localhost:3000)**

```bash
cd api
bun run dev
```

**Terminal 2: Web app (http://localhost:5173)**

```bash
cd web
bun run dev
```

Then open http://localhost:5173 in your browser and sign up with an email and a password (at least 8 characters). You stay logged in for 7 days, or until you click **Log out**.

The database file `api/finance.db` is created automatically the first time the API starts. It is ignored by git, so your data stays on your machine.

If you have a database from before accounts existed, its old transactions have no owner, so no account can see them. They stay in the file untouched.

## How it fits together

```
Browser (React page)  ->  Vite dev server  ->  Hono API  ->  SQLite
      :5173                  proxies /api         :3000      api/finance.db
```

During development, Vite forwards any request starting with `/api` to the API on port 3000 (see `web/vite.config.ts`), so the page can call `/api/...` directly.

## API

**Accounts**

| Method | Path | Description |
|---|---|---|
| POST | `/api/signup` | Create an account and log in. JSON: `{ "email", "password" }` |
| POST | `/api/login` | Log in. Same JSON as signup |
| POST | `/api/logout` | Log out |
| GET | `/api/me` | The logged-in user, or 401 if not logged in |

**Transactions** (all require being logged in, otherwise 401, and only touch the logged-in user's own transactions)

| Method | Path | Description |
|---|---|---|
| GET | `/api/transactions` | List your transactions, newest first |
| POST | `/api/transactions` | Add a transaction |
| PUT | `/api/transactions/:id` | Replace all fields of a transaction (same JSON as POST) |
| DELETE | `/api/transactions/:id` | Delete a transaction |

A transaction is sent as JSON:

```json
{ "type": "expense", "amount": 45000, "category": "Groceries", "date": "2026-11-14", "note": "Weekly shopping" }
```

- `type` is `"income"` or `"expense"`
- `amount` is a positive integer in the smallest currency unit (45000 = 450.00), which avoids decimal rounding errors
- `date` is `YYYY-MM-DD`
- `note` is optional

Invalid input returns status 400, and editing or deleting an unknown id (or one that belongs to someone else) returns 404.

## How login works

- Passwords are never stored. Only an argon2 hash of each password is saved.
- Logging in sets a random session token in a cookie (`HttpOnly`, `SameSite=Lax`, and `Secure` when `NODE_ENV=production`). The database stores only a hash of the token.
- A wrong password and an unknown email give the same error message. After 5 wrong passwords the email is locked for 15 minutes (kept in memory, so it resets when the API restarts).
- There is no password reset yet, since that needs email sending.

## Tests

The API has automated tests (accounts, login, sessions, add, list, edit, delete, input validation, and users not seeing each other's data):

```bash
cd api
bun run test
```

They run against a temporary in-memory database (via the `DB_PATH` environment variable), so your real `api/finance.db` is never touched.

## Project structure

```
api/src/index.ts    API routes
api/src/auth.ts     signup, login, logout and the "must be logged in" check
api/src/db.ts       SQLite connection and table setup (users, sessions, transactions)
api/src/api.test.ts API tests
web/src/App.tsx     the main screen (form, list, summary, month filter, top categories chart)
web/src/Login.tsx   the login / signup screen
web/src/App.css     styles
web/vite.config.ts  Vite config, including the /api proxy
```
