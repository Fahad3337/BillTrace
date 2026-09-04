'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, db, request, init, createUser, loginAs, cleanup } = require('./helpers');

let admin;

before(async () => {
  await init();
  await createUser({ username: 'admin', role: 'admin' });
  admin = await loginAs('admin');
});
after(cleanup);

test('a viewer cannot reach /users', async () => {
  await createUser({ username: 'v1', role: 'viewer' });
  const viewer = await loginAs('v1');
  const res = await viewer.get('/users');
  assert.equal(res.status, 403);
});

test('admin can create a user', async () => {
  const res = await admin
    .post('/users')
    .type('form')
    .send({ username: 'newbie', role: 'viewer', password: 'longenough1' });
  assert.equal(res.status, 200);
  assert.match(res.text, /created/i);

  const row = await db.get('SELECT * FROM users WHERE username = ?', ['newbie']);
  assert.equal(row.role, 'viewer');
});

test('creating a duplicate username is rejected', async () => {
  await admin.post('/users').type('form').send({ username: 'dupe', role: 'viewer', password: 'longenough1' });
  const res = await admin
    .post('/users')
    .type('form')
    .send({ username: 'dupe', role: 'viewer', password: 'longenough1' });
  assert.equal(res.status, 400);
  assert.match(res.text, /already taken/);
});

test('a short password is rejected', async () => {
  const res = await admin.post('/users').type('form').send({ username: 'shorty', role: 'viewer', password: 'x' });
  assert.equal(res.status, 400);
  assert.match(res.text, /at least 8/);
});

test("admin can reset another user's password", async () => {
  await createUser({ username: 'resetme', role: 'viewer', password: 'oldpassword1' });
  const { id } = await db.get('SELECT id FROM users WHERE username = ?', ['resetme']);

  const res = await admin.post(`/users/${id}/password`).type('form').send({ password: 'brandnew12' });
  assert.equal(res.status, 200);

  const login = await request(app).post('/login').type('form').send({ username: 'resetme', password: 'brandnew12' });
  assert.equal(login.status, 302, 'the new password works');
});

test('admin cannot delete their own account', async () => {
  const { id } = await db.get('SELECT id FROM users WHERE username = ?', ['admin']);
  const res = await admin.post(`/users/${id}/delete`).type('form').send({});
  assert.equal(res.status, 400);
  assert.match(res.text, /cannot delete your own account/i);
});

test('admin can delete another user, and it is audited', async () => {
  await createUser({ username: 'goner', role: 'viewer' });
  const { id } = await db.get('SELECT id FROM users WHERE username = ?', ['goner']);

  const res = await admin.post(`/users/${id}/delete`).type('form').send({});
  assert.equal(res.status, 200);
  assert.equal(await db.get('SELECT * FROM users WHERE id = ?', [id]), undefined);
  assert.ok(await db.get("SELECT * FROM audit_log WHERE action = 'user_delete' ORDER BY id DESC"));
});

test('deleting a non-existent user returns 404', async () => {
  const res = await admin.post('/users/999999/delete').type('form').send({});
  assert.equal(res.status, 404);
});
