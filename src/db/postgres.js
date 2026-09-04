'use strict';

// Production / cloud backend: PostgreSQL (e.g. Supabase). Selected when DATABASE_URL
// is set. Exposes the same async interface as sqlite.js so the rest of the app does
// not know which backend it is talking to.

const path = require('path');
const fs = require('fs');
const { Pool, types } = require('pg');

// COUNT(*) and other bigint (int8, OID 20) values arrive as strings by default.
// Parse them to numbers so pagination math matches the SQLite backend.
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

const rawUrl = process.env.DATABASE_URL;

// Supabase (and most managed Postgres) require TLS; a local dev Postgres usually
// has none. Turn SSL off for localhost or an explicit sslmode=disable, otherwise
// connect with TLS but don't verify the chain (Supabase serves a cert that isn't
// in Node's default trust store). For strict verification, point `ssl` at
// Supabase's CA certificate instead.
const noSsl = /sslmode=disable/i.test(rawUrl) || /@(localhost|127\.0\.0\.1)[:/]/i.test(rawUrl);

// Drop any sslmode/ssl query params from the string: newer `pg` reads sslmode from
// the URL and would override the `ssl` object below (causing SELF_SIGNED_CERT errors).
// SSL is controlled entirely by the `ssl` option here.
const url = rawUrl.replace(/([?&])(sslmode|ssl)=[^&]*/gi, '$1').replace(/[?&]+$/, '').replace(/\?&/, '?');

const pool = new Pool({
  connectionString: url,
  ssl: noSsl ? false : { rejectUnauthorized: false },
  max: 10,
});

// A dropped idle connection (network blip, Supabase pooler recycling a socket)
// makes pg emit 'error' on the idle client. Without a listener that bubbles up as
// an uncaughtException and kills the process. Log it and let the pool reconnect
// on the next query.
pool.on('error', (err) => {
  console.error('  Postgres pool error (idle client, will reconnect):', err.message);
});

// The routes write SQL with `?` placeholders (SQLite style). Postgres wants $1, $2, ...
// None of our queries contain a literal `?`, so a positional rewrite is safe.
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function normalizeError(err) {
  if (err && err.code === '23505') {
    err.code = 'UNIQUE_VIOLATION';
  }
  return err;
}

async function get(sql, params = []) {
  try {
    const res = await pool.query(toPg(sql), params);
    return res.rows[0];
  } catch (err) {
    throw normalizeError(err);
  }
}

async function all(sql, params = []) {
  try {
    const res = await pool.query(toPg(sql), params);
    return res.rows;
  } catch (err) {
    throw normalizeError(err);
  }
}

async function run(sql, params = []) {
  try {
    const res = await pool.query(toPg(sql), params);
    return { rowsAffected: res.rowCount };
  } catch (err) {
    throw normalizeError(err);
  }
}

async function init() {
  const ddl = fs.readFileSync(path.join(__dirname, 'schema.postgres.sql'), 'utf8');
  await pool.query(ddl);
}

async function close() {
  await pool.end();
}

module.exports = { name: 'postgres', pool, get, all, run, init, close };
