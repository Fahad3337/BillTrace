'use strict';

// Exercises the dialect-neutral behaviour the route code depends on, so a
// regression here is caught before it reaches Postgres.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, init, cleanup } = require('./helpers');

before(() => init());
after(cleanup);

test('the backend is sqlite in the test environment', () => {
  assert.equal(db.name, 'sqlite');
});

test('a UNIQUE violation is normalised to err.code = "UNIQUE_VIOLATION"', async () => {
  await db.run('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)', [
    'uniq', 'x', 'viewer', new Date().toISOString(),
  ]);
  await assert.rejects(
    () =>
      db.run('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)', [
        'uniq', 'x', 'viewer', new Date().toISOString(),
      ]),
    (err) => err.code === 'UNIQUE_VIOLATION'
  );
});

test('ILIKE is honoured (case-insensitive) on the sqlite backend', async () => {
  await db.run(
    'INSERT INTO bills (bill_number, created_at, updated_at) VALUES (?, ?, ?)',
    ['MixedCase-1', new Date().toISOString(), new Date().toISOString()]
  );
  const row = await db.get('SELECT * FROM bills WHERE bill_number ILIKE ?', ['mixedcase-1']);
  assert.ok(row);
  assert.equal(row.bill_number, 'MixedCase-1');
});

test('COUNT(*) comes back as a JS number, not a string', async () => {
  const { n } = await db.get('SELECT COUNT(*) AS n FROM users');
  assert.equal(typeof n, 'number');
});

test('run() reports rowsAffected', async () => {
  const res = await db.run("UPDATE users SET role = 'viewer' WHERE username = ?", ['uniq']);
  assert.equal(res.rowsAffected, 1);
});

test('INSERT ... RETURNING id works through get()', async () => {
  const row = await db.get(
    'INSERT INTO bills (bill_number, created_at, updated_at) VALUES (?, ?, ?) RETURNING id',
    ['returning-test', new Date().toISOString(), new Date().toISOString()]
  );
  assert.equal(typeof row.id, 'number');
  assert.ok(row.id > 0);
});
