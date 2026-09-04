'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, request, init, createUser, loginAs, cleanup } = require('./helpers');

let admin; // supertest agent
let viewer;

before(async () => {
  await init();
  await createUser({ username: 'admin', role: 'admin' });
  await createUser({ username: 'viewer', role: 'viewer' });
  admin = await loginAs('admin');
  viewer = await loginAs('viewer');
});
after(cleanup);

async function addBill(agent, fields) {
  return agent.post('/bills').type('form').send({ bill_number: '', bill_date: '', note: '', ...fields });
}

test('admin can add a bill and it is stored + audited', async () => {
  const res = await addBill(admin, { bill_number: 'B-1001', bill_date: '2026-09-01', note: 'first' });
  assert.equal(res.status, 302);

  const row = await db.get('SELECT * FROM bills WHERE bill_number = ?', ['B-1001']);
  assert.ok(row);
  assert.equal(row.note, 'first');
  assert.equal(row.created_by, (await db.get("SELECT id FROM users WHERE username = 'admin'")).id);

  const audit = await db.get("SELECT * FROM audit_log WHERE action = 'create' AND bill_id = ?", [row.id]);
  assert.ok(audit);
});

test('a bill with no number is rejected with a validation error', async () => {
  const res = await addBill(admin, { bill_number: '   ' });
  assert.equal(res.status, 400);
  assert.match(res.text, /Bill number is required/);
});

test('a bad date format is rejected', async () => {
  const res = await addBill(admin, { bill_number: 'B-BADDATE', bill_date: '01-09-2026' });
  assert.equal(res.status, 400);
  assert.match(res.text, /YYYY-MM-DD/);
});

test('a duplicate bill number returns 409', async () => {
  await addBill(admin, { bill_number: 'B-DUP' });
  const res = await addBill(admin, { bill_number: 'B-DUP' });
  assert.equal(res.status, 409);
  assert.match(res.text, /already exists/);
});

test('a viewer cannot add a bill', async () => {
  const res = await addBill(viewer, { bill_number: 'B-VIEWER' });
  assert.equal(res.status, 403);
  const row = await db.get('SELECT * FROM bills WHERE bill_number = ?', ['B-VIEWER']);
  assert.equal(row, undefined);
});

test('search is an exact bill-number match (case-insensitive)', async () => {
  await addBill(admin, { bill_number: 'ABC-XYZ-9', note: 'findable note' });

  const exact = await admin.get('/').query({ q: 'abc-xyz-9' });
  assert.equal(exact.status, 200);
  assert.match(exact.text, /ABC-XYZ-9/);
});

// Helper: the "(N)" total the list header renders.
function shownTotal(html) {
  return Number(html.match(/Bill records <span class="muted">\((\d+)\)<\/span>/)[1]);
}

test('a partial bill number returns nothing and shows the typo hint', async () => {
  await addBill(admin, { bill_number: 'PARTIAL-1234' });
  await admin.get('/'); // clear the "added" flash
  const res = await admin.get('/').query({ q: 'PARTIAL' });
  assert.equal(res.status, 200);
  assert.equal(shownTotal(res.text), 0);
  assert.match(res.text, /typo/i);
});

test('search does not match on the note field', async () => {
  await addBill(admin, { bill_number: 'NOTE-HOST-1', note: 'special-keyword' });
  await admin.get('/');
  const res = await admin.get('/').query({ q: 'special-keyword' });
  assert.equal(res.status, 200);
  assert.equal(shownTotal(res.text), 0);
});

test('admin can edit a bill', async () => {
  await addBill(admin, { bill_number: 'B-EDIT', note: 'before' });
  const { id } = await db.get('SELECT id FROM bills WHERE bill_number = ?', ['B-EDIT']);

  const res = await admin
    .post(`/bills/${id}`)
    .type('form')
    .send({ bill_number: 'B-EDIT', bill_date: '2026-10-10', note: 'after' });
  assert.equal(res.status, 302);

  const row = await db.get('SELECT * FROM bills WHERE id = ?', [id]);
  assert.equal(row.note, 'after');
  assert.equal(row.bill_date, '2026-10-10');
});

test('editing a non-existent bill returns 404', async () => {
  const res = await admin.get('/bills/999999/edit');
  assert.equal(res.status, 404);
});

test('a non-numeric bill id returns 404, not 500', async () => {
  const res = await admin.get('/bills/not-an-id/edit');
  assert.equal(res.status, 404);
});

test('admin can delete a bill (and it is audited)', async () => {
  await addBill(admin, { bill_number: 'B-DELETE' });
  const { id } = await db.get('SELECT id FROM bills WHERE bill_number = ?', ['B-DELETE']);

  const res = await admin.post(`/bills/${id}/delete`).type('form').send({});
  assert.equal(res.status, 302);

  assert.equal(await db.get('SELECT * FROM bills WHERE id = ?', [id]), undefined);
  assert.ok(await db.get("SELECT * FROM audit_log WHERE action = 'delete' AND bill_id = ?", [id]));
});

test('CSV export is available to a viewer and has the expected header', async () => {
  const res = await viewer.get('/bills/export.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.text.split('\n')[0], /^bill_number,bill_date,note,created_at,created_by,updated_at,updated_by$/);
});
