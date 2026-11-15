# Finance App

A simple personal finance tracker. Add income and expense transactions, edit or delete them, filter by month, and view total income, total expenses and balance.

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

Then open http://localhost:5173 in your browser.

The database file `api/finance.db` is created automatically the first time the API starts. It is ignored by git, so your data stays on your machine.

## How it fits together

```
Browser (React page)  ->  Vite dev server  ->  Hono API  ->  SQLite
      :5173                  proxies /api         :3000      api/finance.db
```

During development, Vite forwards any request starting with `/api` to the API on port 3000 (see `web/vite.config.ts`), so the page can call `/api/...` directly.

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/transactions` | List all transactions, newest first |
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

Invalid input returns status 400, and editing or deleting an unknown id returns 404.

## Tests

The API has automated tests (add, list, edit, delete and input validation):

```bash
cd api
bun run test
```

They run against a temporary in-memory database (via the `DB_PATH` environment variable), so your real `api/finance.db` is never touched.

## Project structure

```
api/src/index.ts    API routes
api/src/db.ts       SQLite connection and table setup
api/src/api.test.ts API tests
web/src/App.tsx     the main screen (form, list, summary, month filter)
web/src/App.css     styles
web/vite.config.ts  Vite config, including the /api proxy
```
