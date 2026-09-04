'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { db, init, createUser, loginAs, createBill, cleanup } = require('./helpers');

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

const addBill = createBill;

test('admin can add a bill and it is stored + audited', async () => {
  const res = await addBill(admin, { bill_number: '71001', bill_date: '2026-09-01', note: 'first' });
  assert.equal(res.status, 302);

  const row = await db.get('SELECT * FROM bills WHERE bill_number = ?', ['71001']);
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

test('a non-numeric bill number is rejected', async () => {
  const res = await addBill(admin, { bill_number: 'test' });
  assert.equal(res.status, 400);
  assert.match(res.text, /digits only/i);
  assert.equal(await db.get('SELECT * FROM bills WHERE bill_number = ?', ['test']), undefined);
});

test('the confirm field must match the bill number', async () => {
  const res = await addBill(admin, { bill_number: '70100', bill_number_confirm: '70200' });
  assert.equal(res.status, 400);
  assert.match(res.text, /do not match/i);
  assert.equal(await db.get('SELECT * FROM bills WHERE bill_number = ?', ['70100']), undefined);
});

test('a bad date format is rejected', async () => {
  const res = await addBill(admin, { bill_number: '70001', bill_date: '01-09-2026' });
  assert.equal(res.status, 400);
  assert.match(res.text, /YYYY-MM-DD/);
});

test('a duplicate bill number returns 409', async () => {
  await addBill(admin, { bill_number: '70002' });
  const res = await addBill(admin, { bill_number: '70002' });
  assert.equal(res.status, 409);
  assert.match(res.text, /already exists/);
});

test('a viewer cannot add a bill', async () => {
  const res = await addBill(viewer, { bill_number: '70003' });
  assert.equal(res.status, 403);
  assert.equal(await db.get('SELECT * FROM bills WHERE bill_number = ?', ['70003']), undefined);
});

// Helper: the "(N)" total the list header renders.
function shownTotal(html) {
  return Number(html.match(/Bill records <span class="muted">\((\d+)\)<\/span>/)[1]);
}

test('search is an exact bill-number match', async () => {
  await addBill(admin, { bill_number: '72229', note: 'findable note' });
  const res = await admin.get('/').query({ q: '72229' });
  assert.equal(res.status, 200);
  assert.match(res.text, /72229/);
});

test('a partial bill number returns nothing and shows the typo hint', async () => {
  await addBill(admin, { bill_number: '71234' });
  await admin.get('/'); // clear the "added" flash
  const res = await admin.get('/').query({ q: '712' });
  assert.equal(res.status, 200);
  assert.equal(shownTotal(res.text), 0);
  assert.match(res.text, /typo/i);
});

test('search does not match on the note field', async () => {
  await addBill(admin, { bill_number: '70004', note: 'special-keyword' });
  await admin.get('/');
  const res = await admin.get('/').query({ q: 'special-keyword' });
  assert.equal(res.status, 200);
  assert.equal(shownTotal(res.text), 0);
});

test('admin can edit a bill', async () => {
  await addBill(admin, { bill_number: '70005', note: 'before' });
  const { id } = await db.get('SELECT id FROM bills WHERE bill_number = ?', ['70005']);

  const res = await admin
    .post(`/bills/${id}`)
    .type('form')
    .send({ bill_number: '70005', bill_date: '2026-10-10', note: 'after' });
  assert.equal(res.status, 302);

  const row = await db.get('SELECT * FROM bills WHERE id = ?', [id]);
  assert.equal(row.note, 'after');
  assert.equal(row.bill_date, '2026-10-10');
});

test('editing to a non-numeric bill number is rejected', async () => {
  await addBill(admin, { bill_number: '70009' });
  const { id } = await db.get('SELECT id FROM bills WHERE bill_number = ?', ['70009']);
  const res = await admin.post(`/bills/${id}`).type('form').send({ bill_number: 'oops', bill_date: '', note: '' });
  assert.equal(res.status, 400);
  assert.match(res.text, /digits only/i);
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
  await addBill(admin, { bill_number: '70006' });
  const { id } = await db.get('SELECT id FROM bills WHERE bill_number = ?', ['70006']);

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

test('the success flash shows exactly once, then is gone', async () => {
  await addBill(admin, { bill_number: '70007' });

  const first = await admin.get('/');
  assert.match(first.text, /Bill 70007 added\./);

  const second = await admin.get('/');
  assert.doesNotMatch(second.text, /Bill 70007 added\./);
});

test('the list renders timestamps as localisable <time> elements (UTC fallback text)', async () => {
  await addBill(admin, { bill_number: '70008', bill_date: '2026-09-01' });
  const res = await admin.get('/');
  assert.match(res.text, /<time class="localtime" datetime="20\d\d-\d\d-\d\dT[\d:.]+Z">/);
  assert.match(res.text, /\d\d:\d\d UTC<\/time>/);
});
