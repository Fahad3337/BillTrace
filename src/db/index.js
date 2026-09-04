'use strict';

// One database interface, two backends:
//   - DATABASE_URL set   -> PostgreSQL (cloud, e.g. Supabase)   [src/db/postgres.js]
//   - DATABASE_URL unset -> local SQLite file                   [src/db/sqlite.js]
//
// Both expose: name, get(sql, params), all(sql, params), run(sql, params),
// init(), close(), and a backend-specific handle for the session store
// (`client` for sqlite, `pool` for postgres).

module.exports = process.env.DATABASE_URL
  ? require('./postgres')
  : require('./sqlite');
