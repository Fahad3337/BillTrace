'use strict';

require('dotenv').config();

const app = require('./app');
const db = require('./db');

const PORT = parseInt(process.env.PORT, 10) || 3000;

let server;

async function start() {
  await db.init();
  console.log(`  Using ${db.name} database.`);

  const { n: userCount } = await db.get('SELECT COUNT(*) AS n FROM users');
  if (userCount === 0) {
    console.log('\n  No users yet. Create the first admin with:');
    console.log('    npm run create-user -- --username admin --role admin\n');
  }

  server = app.listen(PORT, () => {
    console.log(`  Bill recorder running at http://localhost:${PORT}`);
  });
}

// Graceful shutdown: stop accepting connections, then close the DB cleanly
// (SQLite checkpoints the WAL; Postgres drains the pool).
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n  ${signal} received, shutting down...`);
  const done = () => {
    Promise.resolve(db.close())
      .catch((e) => console.error('  Error closing database:', e))
      .finally(() => {
        console.log('  Closed HTTP server and database. Bye.');
        process.exit(0);
      });
  };
  if (server) server.close(done);
  else done();
  // Don't hang forever if a connection won't drain.
  setTimeout(() => process.exit(0), 10000).unref();
}

['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => shutdown(sig)));

// An uncaught error / rejection means state is unknown: log it, close the DB,
// and exit so a process manager can restart with a clean database handle.
function crash(label, err) {
  console.error(`  ${label}:`, err);
  Promise.resolve(db.close()).finally(() => process.exit(1));
}
process.on('uncaughtException', (err) => crash('Uncaught exception', err));
process.on('unhandledRejection', (err) => crash('Unhandled rejection', err));

start().catch((err) => {
  console.error('  Failed to start:', err);
  process.exit(1);
});
