'use strict';

const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { recordAudit, diff } = require('../audit');

const router = express.Router();

const PAGE_SIZE = 25;
const BILL_FIELDS = ['bill_number', 'bill_date', 'note'];

const listSelect = `
  SELECT b.*, cu.username AS created_by_name, uu.username AS updated_by_name
  FROM bills b
  LEFT JOIN users cu ON cu.id = b.created_by
  LEFT JOIN users uu ON uu.id = b.updated_by
`;

// Exact bill-number lookup (case-insensitive: ILIKE with no wildcards). A search
// that doesn't match a whole bill number returns nothing on purpose.
function buildFilter(q) {
  if (!q) return { where: '', params: [] };
  return { where: 'WHERE b.bill_number ILIKE ?', params: [q] };
}

function parseSort(sort) {
  // NULLS LAST keeps undated bills at the bottom on both backends (SQLite and
  // Postgres disagree on where NULLs land by default).
  const allowed = {
    date_desc: 'b.bill_date DESC NULLS LAST, b.id DESC',
    date_asc: 'b.bill_date ASC NULLS LAST, b.id ASC',
    number_asc: 'b.bill_number ASC',
    number_desc: 'b.bill_number DESC',
    created_desc: 'b.created_at DESC',
  };
  return allowed[sort] ? { key: sort, sql: allowed[sort] } : { key: 'date_desc', sql: allowed.date_desc };
}

function validateBill(body) {
  const errors = [];
  const bill_number = String(body.bill_number || '').trim();
  const bill_date = String(body.bill_date || '').trim();
  const note = String(body.note || '').trim();

  if (!bill_number) {
    errors.push('Bill number is required.');
  } else if (!/^\d+$/.test(bill_number)) {
    errors.push('Bill number must be digits only (e.g. 6928).');
  } else if (bill_number.length > 20) {
    errors.push('Bill number is too long (max 20 digits).');
  }
  if (bill_date && !/^\d{4}-\d{2}-\d{2}$/.test(bill_date)) errors.push('Date must be in YYYY-MM-DD format.');
  if (note.length > 1000) errors.push('Note is too long (max 1000 characters).');

  return { errors, values: { bill_number, bill_date: bill_date || null, note: note || null } };
}

/** Parse a route :id param; returns a positive integer or null. */
function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function notFound(res) {
  return res.status(404).render('error', { title: 'Not found', message: 'That bill record does not exist.' });
}

// ---- List -----------------------------------------------------------------

router.get('/', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const sort = parseSort(req.query.sort);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const { where, params } = buildFilter(q);

  const total = (await db.get(`SELECT COUNT(*) AS n FROM bills b ${where}`, params)).n;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages);
  const offset = (current - 1) * PAGE_SIZE;

  const rows = await db.all(
    `${listSelect} ${where} ORDER BY ${sort.sql} LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, offset]
  );

  // Read and clear the flash BEFORE rendering — res.render ends the response and
  // persists the session, so deleting afterwards leaves the message in the store
  // and it shows again on the next page.
  const flash = req.session.flash || null;
  delete req.session.flash;

  res.render('bills/list', {
    title: 'Bill records',
    bills: rows,
    q,
    sort: sort.key,
    page: current,
    pages,
    total,
    rangeStart: total === 0 ? 0 : offset + 1,
    rangeEnd: Math.min(offset + PAGE_SIZE, total),
    flash,
  });
});

// ---- CSV export ----------------------------------------------------------

router.get('/bills/export.csv', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const { where, params } = buildFilter(q);
  const rows = await db.all(`${listSelect} ${where} ORDER BY b.bill_date DESC NULLS LAST, b.id DESC`, params);

  const header = ['bill_number', 'bill_date', 'note', 'created_at', 'created_by', 'updated_at', 'updated_by'];
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [r.bill_number, r.bill_date, r.note, r.created_at, r.created_by_name, r.updated_at, r.updated_by_name]
        .map(escape)
        .join(',')
    );
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="bill-records-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join('\n') + '\n');
});

// ---- Create ------------------------------------------------------------------

router.get('/bills/new', requireAdmin, (req, res) => {
  res.render('bills/form', {
    title: 'Add bill record',
    mode: 'new',
    bill: { bill_number: '', bill_date: new Date().toISOString().slice(0, 10), note: '' },
    confirmValue: '',
    errors: [],
  });
});

router.post('/bills', requireAdmin, async (req, res) => {
  const { errors, values } = validateBill(req.body);

  // Double-entry check: the number must be typed the same way twice.
  const confirm = String(req.body.bill_number_confirm || '').trim();
  if (values.bill_number && confirm !== values.bill_number) {
    errors.push('The two bill numbers do not match — re-check both.');
  }

  if (errors.length) {
    return res
      .status(400)
      .render('bills/form', { title: 'Add bill record', mode: 'new', bill: values, confirmValue: confirm, errors });
  }

  const now = new Date().toISOString();
  try {
    const row = await db.get(
      `INSERT INTO bills (bill_number, bill_date, note, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [values.bill_number, values.bill_date, values.note, now, req.session.user.id, now, req.session.user.id]
    );

    await recordAudit({
      user: req.session.user,
      action: 'create',
      billId: row.id,
      details: { values },
    });
    req.session.flash = { type: 'ok', message: `Bill ${values.bill_number} added.` };
    res.redirect('/');
  } catch (err) {
    if (err.code === 'UNIQUE_VIOLATION') {
      return res.status(409).render('bills/form', {
        title: 'Add bill record',
        mode: 'new',
        bill: values,
        confirmValue: confirm,
        errors: [`Bill number "${values.bill_number}" already exists.`],
      });
    }
    throw err;
  }
});

// ---- Edit ------------------------------------------------------------------

router.get('/bills/:id/edit', requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return notFound(res);
  const bill = await db.get('SELECT * FROM bills WHERE id = ?', [id]);
  if (!bill) return notFound(res);
  res.render('bills/form', { title: 'Edit bill record', mode: 'edit', bill, errors: [] });
});

router.post('/bills/:id', requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return notFound(res);
  const bill = await db.get('SELECT * FROM bills WHERE id = ?', [id]);
  if (!bill) return notFound(res);

  const { errors, values } = validateBill(req.body);
  if (errors.length) {
    return res
      .status(400)
      .render('bills/form', { title: 'Edit bill record', mode: 'edit', bill: { ...bill, ...values }, errors });
  }

  const now = new Date().toISOString();
  try {
    await db.run(
      `UPDATE bills SET bill_number = ?, bill_date = ?, note = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
      [values.bill_number, values.bill_date, values.note, now, req.session.user.id, bill.id]
    );

    const changes = diff(bill, values, BILL_FIELDS);
    await recordAudit({ user: req.session.user, action: 'update', billId: bill.id, details: { changes } });
    req.session.flash = { type: 'ok', message: `Bill ${values.bill_number} updated.` };
    res.redirect('/');
  } catch (err) {
    if (err.code === 'UNIQUE_VIOLATION') {
      return res.status(409).render('bills/form', {
        title: 'Edit bill record',
        mode: 'edit',
        bill: { ...bill, ...values },
        errors: [`Bill number "${values.bill_number}" already exists.`],
      });
    }
    throw err;
  }
});

// ---- Delete ------------------------------------------------------------------

router.post('/bills/:id/delete', requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return notFound(res);
  const bill = await db.get('SELECT * FROM bills WHERE id = ?', [id]);
  if (!bill) return notFound(res);

  await db.run('DELETE FROM bills WHERE id = ?', [bill.id]);
  await recordAudit({
    user: req.session.user,
    action: 'delete',
    billId: bill.id,
    details: {
      values: { bill_number: bill.bill_number, bill_date: bill.bill_date, note: bill.note },
    },
  });
  req.session.flash = { type: 'ok', message: `Bill ${bill.bill_number} deleted.` };
  res.redirect('/');
});

module.exports = router;
