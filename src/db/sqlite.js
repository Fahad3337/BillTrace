'use strict';

// Local development backend: a single better-sqlite3 file. Selected when DATABASE_URL
// is not set. The synchronous better-sqlite3 calls are wrapped in async functions so
// this adapter and the Postgres one share one interface.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dbPath = path.resolve(process.env.DB_PATH || './data/app.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const client = new Database(dbPath);
client.pragma('journal_mode = WAL');
client.pragma('foreign_keys = ON');
// Wait up to 5s for a competing writer (e.g. a backup) instead of throwing SQLITE_BUSY.
client.pragma('busy_timeout = 5000');
// Full sync: the OS is told to flush to disk on every commit. Safe against power loss,
// slightly slower. Appropriate for an audit/record-keeping app.
client.pragma('synchronous = FULL');

// The routes write dialect-neutral SQL using ILIKE for case-insensitive matching.
// SQLite has no ILIKE, but its LIKE is already case-insensitive for ASCII, which is
// the behaviour the search has always relied on.
function toSqlite(sql) {
  return sql.replace(/\bILIKE\b/gi, 'LIKE');
}

function normalizeError(err) {
  if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    err.code = 'UNIQUE_VIOLATION';
  }
  return err;
}

async function get(sql, params = []) {
  try {
    return client.prepare(toSqlite(sql)).get(...params);
  } catch (err) {
    throw normalizeError(err);
  }
}

async function all(sql, params = []) {
  try {
    return client.prepare(toSqlite(sql)).all(...params);
  } catch (err) {
    throw normalizeError(err);
  }
}

async function run(sql, params = []) {
  try {
    const info = client.prepare(toSqlite(sql)).run(...params);
    return { rowsAffected: info.changes };
  } catch (err) {
    throw normalizeError(err);
  }
}

async function init() {
  const ddl = fs.readFileSync(path.join(__dirname, 'schema.sqlite.sql'), 'utf8');
  client.exec(ddl);
}

async function close() {
  if (client.open) {
    try {
      client.pragma('wal_checkpoint(TRUNCATE)');
    } catch (_) {
      /* checkpoint is best-effort */
    }
    client.close();
  }
}

module.exports = { name: 'sqlite', client, get, all, run, init, close };
