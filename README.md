# Insurance Bill Number Recorder

A small local web app for keeping a searchable, audit-friendly record of insurance
**bill numbers** and their dates. The bills themselves live in another system — this
tool just tracks which bill numbers exist so they are easy to look up later.

- **Admin** users can add, edit, and delete records and manage user accounts.
- **Viewer** users can search, browse, and export records (read-only).
- Every change (and every login) is written to an **audit log**.

## Requirements

- Node.js 18+ (tested on Node 24)
- A database. By default the app uses a single local SQLite file under `data/` — no
  setup needed. Point it at a cloud Postgres (Supabase) by setting `DATABASE_URL`
  (see [Cloud database](#cloud-database-supabase)).

## Setup

```bash
npm install

cp .env.example .env
# then edit .env and set SESSION_SECRET, e.g.:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# create the first admin account (prompts for a password)
npm run create-user -- --username admin --role admin

npm start
```

Open <http://localhost:3000> and sign in.

## Everyday use

- **Add a record**: *Add record* → enter the bill number, pick the date, optional note.
- **Find a record**: type part of a bill number or note into the search box.
- **Export**: *Export CSV* downloads the current list (respects the active search) for
  handing to an auditor.
- **Audit log** (admin): *Audit log* shows who did what and when, filterable by action
  and bill number.
- **Users** (admin): *Users* — create viewer/admin accounts, reset passwords, remove
  accounts. The last remaining admin cannot be deleted.

## Tests

```bash
npm test
```

`node --test` integration tests (in `test/`) using supertest against a throwaway
SQLite database — one temp DB per test file, deleted after. They cover auth and
sessions, bill CRUD + validation + permissions, user management, the audit log, the
login rate limiter, and the dialect-neutral DB-adapter contract (`?`/`ILIKE`
handling, `UNIQUE_VIOLATION` normalisation, `RETURNING`, `COUNT` typing) that the
Postgres backend relies on.

## Managing users from the terminal

```bash
npm run create-user -- --username jane --role viewer
```

## Cloud database (Supabase)

The app runs against **either** a local SQLite file **or** a cloud PostgreSQL database.
The switch is the `DATABASE_URL` environment variable:

| `DATABASE_URL` | Backend |
|---|---|
| unset | local SQLite file at `DB_PATH` (default — good for development) |
| set | PostgreSQL at that connection string (e.g. Supabase) |

To use Supabase:

1. Create a project at [supabase.com](https://supabase.com) and wait for it to provision.
2. **Project Settings → Database → Connection string → URI.** Copy it, fill in your
   database password, and append `?sslmode=require`. Either the "Session pooler" or
   the direct connection (port 5432) works.
3. Put it in `.env`:
   ```
   DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.YOUR_REF.supabase.co:5432/postgres?sslmode=require
   ```
4. Create the first admin (this also creates the tables in Postgres):
   ```bash
   npm run create-user -- --username admin --role admin
   ```
5. `npm start`. The startup log prints `Using postgres database`.

The `users`, `bills`, `audit_log`, and `session` tables are created automatically on
first run. The app keeps running on your machine — only the data lives in the cloud,
so it now survives disk loss and is reachable if the app is later hosted.

## Data & backup

**SQLite (dev):** everything is in `data/app.db`. Back up by copying that file on a
schedule. The `-wal` / `-shm` files next to it are normal SQLite working files.

**Postgres (Supabase):** Supabase takes automatic daily backups (see the dashboard);
point-in-time recovery and manual `pg_dump` exports are also available there.

## Notes / limitations

- Built to run on **localhost** on one machine. To let other people on your network or
  the internet use it you would additionally need to: bind to the right host, put it
  behind HTTPS (a reverse proxy such as Caddy or nginx), and set up regular backups of
  `data/app.db`.
- Bill numbers must be unique; adding a duplicate shows an error. If your bill numbers
  can legitimately repeat, relax the `UNIQUE` constraint on `bills.bill_number` in
  `src/db/schema.sqlite.sql` and `src/db/schema.postgres.sql`.

## Project layout

```
src/server.js        app bootstrap + middleware
src/db/              database layer: index picks sqlite.js or postgres.js by DATABASE_URL;
                     schema.*.sql per backend
src/auth.js          password hashing + auth middleware
src/audit.js         audit-log helper
src/routes/          auth, bills, users, audit route handlers
src/app.js           builds the Express app (imported by server.js and the tests)
views/               EJS templates
public/              CSS + a tiny confirm-dialog script
scripts/create-user.js   CLI to add a user
test/                node --test integration + adapter tests
```
