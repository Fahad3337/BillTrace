'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, init, createUser, loginAs, cleanup } = require('./helpers');

let admin;

before(async () => {
  await init();
  await createUser({ username: 'admin', role: 'admin' });
  await createUser({ username: 'viewer', role: 'viewer' });
  admin = await loginAs('admin');

  // Generate a couple of audited events.
  await admin.post('/bills').type('form').send({ bill_number: 'AUD-1', bill_date: '', note: '' });
  await admin.post('/bills').type('form').send({ bill_number: 'AUD-2', bill_date: '', note: '' });
});
after(cleanup);

test('a viewer cannot see the audit log', async () => {
  const viewer = await loginAs('viewer');
  const res = await viewer.get('/audit');
  assert.equal(res.status, 403);
});

test('admin sees the audit log', async () => {
  const res = await admin.get('/audit');
  assert.equal(res.status, 200);
  assert.match(res.text, /Audit log/);
  assert.match(res.text, /AUD-1/);
});

test('the action filter narrows the results', async () => {
  // login rows exist alongside the two create rows...
  assert.ok((await db.all("SELECT 1 FROM audit_log WHERE action = 'login'")).length > 0);

  const all = await admin.get('/audit');
  const totalAll = Number(all.text.match(/Audit log <span class="muted">\((\d+)\)<\/span>/)[1]);

  const res = await admin.get('/audit').query({ action: 'create' });
  assert.equal(res.status, 200);
  const totalCreate = Number(res.text.match(/Audit log <span class="muted">\((\d+)\)<\/span>/)[1]);

  assert.equal(totalCreate, 2, 'exactly the two bill-create events');
  assert.ok(totalCreate < totalAll, 'the filter excludes the login rows');
  assert.match(res.text, /AUD-1/);
});

test('the bill-number filter matches case-insensitively', async () => {
  const res = await admin.get('/audit').query({ bill_number: 'aud-1' });
  assert.equal(res.status, 200);
  assert.match(res.text, /AUD-1/);
});
