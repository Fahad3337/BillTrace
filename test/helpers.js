'use strict';

// Shared test setup. Requiring this module (before anything requires ../src/app)
// pins the app to a throwaway SQLite file and a test session secret. `node --test`
// runs each test file in its own process, so every file gets a fresh database.

const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-' + crypto.randomBytes(12).toString('hex');
delete process.env.DATABASE_URL; // force the SQLite backend

const dbFile = path.join(os.tmpdir(), `ir-test-${process.pid}-${crypto.randomBytes(4).toString('hex')}.db`);
process.env.DB_PATH = dbFile;

const request = require('supertest');
const db = require('../src/db');
const app = require('../src/app');
const { hashPassword } = require('../src/auth');

let ready;
function init() {
  if (!ready) ready = db.init();
  return ready;
}

async function createUser({ username, role = 'admin', password = 'password123' }) {
  await init();
  await db.run(
    'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)',
    [username, hashPassword(password), role, new Date().toISOString()]
  );
  return db.get('SELECT * FROM users WHERE username = ?', [username]);
}

// Returns a supertest agent with a logged-in session cookie.
async function loginAs(username, password = 'password123') {
  const agent = request.agent(app);
  const res = await agent.post('/login').type('form').send({ username, password });
  if (res.status !== 302) throw new Error(`login failed for "${username}": got ${res.status}`);
  return agent;
}

// POST /bills, auto-filling the double-entry "confirm" field unless overridden.
function createBill(agent, fields = {}) {
  const f = { bill_number: '', bill_date: '', note: '', ...fields };
  if (f.bill_number_confirm === undefined) f.bill_number_confirm = f.bill_number;
  return agent.post('/bills').type('form').send(f);
}

function cleanup() {
  return Promise.resolve(db.close()).finally(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(dbFile + suffix);
      } catch {
        /* already gone */
      }
    }
  });
}

module.exports = { app, db, request, init, createUser, loginAs, createBill, cleanup, dbFile };
