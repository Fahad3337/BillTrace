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
  // timestamps are localisable <time> elements, not bare UTC text
  assert.match(res.text, /<time class="localtime" datetime="20\d\d-\d\d-\d\dT[\d:.]+Z">/);
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

// ---- CSV export --------------------------------------------------------------

test('admin can export the audit log as CSV', async () => {
  const res = await admin.get('/audit/export.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.headers['content-disposition'], /attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"/);

  const [head, ...rows] = res.text.trim().split('\n');
  assert.equal(head, 'timestamp,user,action,bill_number,details');
  assert.ok(rows.some((r) => r.includes('AUD-1') && r.includes('create')));
});

test('the CSV export honours the action filter', async () => {
  const all = (await admin.get('/audit/export.csv')).text.trim().split('\n').length;
  const res = await admin.get('/audit/export.csv').query({ action: 'create' });
  const lines = res.text.trim().split('\n');
  assert.ok(lines.length < all, 'filtered export is shorter');
  for (const row of lines.slice(1)) {
    assert.match(row, /,create,/);
  }
});

test('a viewer cannot export the audit log', async () => {
  const viewer = await loginAs('viewer');
  const res = await viewer.get('/audit/export.csv');
  assert.equal(res.status, 403);
});

// ---- Restore / revert ----------------------------------------------------

async function auditId(where) {
  const row = await db.get(`SELECT id FROM audit_log WHERE ${where} ORDER BY id DESC`);
  return row && row.id;
}

test('an admin can restore a deleted bill from its audit entry', async () => {
  await admin.post('/bills').type('form').send({ bill_number: 'REST-1', bill_date: '2026-01-02', note: 'keep me' });
  const { id } = await db.get('SELECT id FROM bills WHERE bill_number = ?', ['REST-1']);
  await admin.post(`/bills/${id}/delete`).type('form').send({});
  assert.equal(await db.get('SELECT * FROM bills WHERE bill_number = ?', ['REST-1']), undefined);

  const delId = await auditId("action = 'delete'");
  const res = await admin.post(`/audit/${delId}/restore`).type('form').send({});
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/');

  const back = await db.get('SELECT * FROM bills WHERE bill_number = ?', ['REST-1']);
  assert.ok(back, 'the bill exists again');
  assert.equal(back.bill_date, '2026-01-02');
  assert.equal(back.note, 'keep me');
  assert.ok(await db.get("SELECT * FROM audit_log WHERE action = 'restore' AND bill_id = ?", [back.id]));
});

test('restore fails cleanly when the bill number is taken again', async () => {
  await admin.post('/bills').type('form').send({ bill_number: 'REST-2', bill_date: '', note: '' });
  const { id } = await db.get('SELECT id FROM bills WHERE bill_number = ?', ['REST-2']);
  await admin.post(`/bills/${id}/delete`).type('form').send({});
  await admin.post('/bills').type('form').send({ bill_number: 'REST-2', bill_date: '', note: 'squatter' });

  const delId = await auditId("action = 'delete' AND bill_id = " + id);
  const res = await admin.post(`/audit/${delId}/restore`).type('form').send({});
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/audit');

  const rows = await db.all('SELECT * FROM bills WHERE bill_number = ?', ['REST-2']);
  assert.equal(rows.length, 1, 'no duplicate created');
});

test('restore rejects a non-delete audit entry', async () => {
  const createId = await auditId("action = 'create'");
  const res = await admin.post(`/audit/${createId}/restore`).type('form').send({});
  assert.equal(res.status, 404);
});

test('an admin can revert an edit to its previous values', async () => {
  await admin.post('/bills').type('form').send({ bill_number: 'REV-1', bill_date: '2026-03-03', note: 'original' });
  const { id } = await db.get('SELECT id FROM bills WHERE bill_number = ?', ['REV-1']);
  await admin.post(`/bills/${id}`).type('form').send({ bill_number: 'REV-1', bill_date: '2026-04-04', note: 'changed' });

  const updId = await auditId("action = 'update' AND bill_id = " + id);
  const res = await admin.post(`/audit/${updId}/revert`).type('form').send({});
  assert.equal(res.status, 302);

  const bill = await db.get('SELECT * FROM bills WHERE id = ?', [id]);
  assert.equal(bill.bill_date, '2026-03-03');
  assert.equal(bill.note, 'original');
});

test('revert fails cleanly when the bill was since deleted', async () => {
  await admin.post('/bills').type('form').send({ bill_number: 'REV-2', bill_date: '', note: 'a' });
  const { id } = await db.get('SELECT id FROM bills WHERE bill_number = ?', ['REV-2']);
  await admin.post(`/bills/${id}`).type('form').send({ bill_number: 'REV-2', bill_date: '', note: 'b' });
  const updId = await auditId("action = 'update' AND bill_id = " + id);
  await admin.post(`/bills/${id}/delete`).type('form').send({});

  const res = await admin.post(`/audit/${updId}/revert`).type('form').send({});
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/audit');
});
