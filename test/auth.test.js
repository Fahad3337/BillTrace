'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, db, request, init, createUser, loginAs, cleanup } = require('./helpers');

before(async () => {
  await init();
  await createUser({ username: 'admin', role: 'admin' });
});
after(cleanup);

test('GET /login renders the sign-in form', async () => {
  const res = await request(app).get('/login');
  assert.equal(res.status, 200);
  assert.match(res.text, /Sign in/);
});

test('an unauthenticated request to a protected page redirects to /login', async () => {
  const res = await request(app).get('/');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/login');
});

test('login with wrong password is rejected and audited', async () => {
  const res = await request(app).post('/login').type('form').send({ username: 'admin', password: 'nope' });
  assert.equal(res.status, 401);
  assert.match(res.text, /Invalid username or password/);

  const row = await db.get("SELECT * FROM audit_log WHERE action = 'login_failed' ORDER BY id DESC");
  assert.ok(row, 'a login_failed audit row was written');
  assert.equal(row.username, 'admin');
});

test('login with the right password sets a session and is audited', async () => {
  const agent = request.agent(app);
  const login = await agent.post('/login').type('form').send({ username: 'admin', password: 'password123' });
  assert.equal(login.status, 302);
  assert.equal(login.headers.location, '/');

  const home = await agent.get('/');
  assert.equal(home.status, 200);
  assert.match(home.text, /Bill records/);

  const row = await db.get("SELECT * FROM audit_log WHERE action = 'login' ORDER BY id DESC");
  assert.ok(row);
  assert.equal(row.username, 'admin');
});

test('logout clears the session', async () => {
  const agent = await loginAs('admin');
  const out = await agent.post('/logout');
  assert.equal(out.status, 302);

  const home = await agent.get('/');
  assert.equal(home.status, 302);
  assert.equal(home.headers.location, '/login');
});
