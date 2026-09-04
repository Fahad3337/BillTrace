'use strict';

const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { recordAudit } = require('../audit');

const router = express.Router();

const PAGE_SIZE = 100;
const ACTIONS = [
  'create', 'update', 'delete', 'restore',
  'login', 'login_failed',
  'user_create', 'user_delete', 'user_password_reset',
];

const BILL_FIELDS = ['bill_number', 'bill_date', 'note'];

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function getEntry(id) {
  const row = await db.get('SELECT * FROM audit_log WHERE id = ?', [id]);
  if (!row) return null;
  return { ...row, details: row.details ? JSON.parse(row.details) : null };
}

// ---- Audit log view --------------------------------------------------------

router.get('/audit', requireAdmin, async (req, res) => {
  const action = ACTIONS.includes(req.query.action) ? req.query.action : '';
  const billNumber = String(req.query.bill_number || '').trim();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);

  const clauses = [];
  const params = [];
  if (action) {
    clauses.push('a.action = ?');
    params.push(action);
  }
  if (billNumber) {
    clauses.push('a.bill_id IN (SELECT id FROM bills WHERE bill_number ILIKE ?)');
    params.push(`%${billNumber}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const total = (await db.get(`SELECT COUNT(*) AS n FROM audit_log a ${where}`, params)).n;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pages);
  const offset = (current - 1) * PAGE_SIZE;

  const rows = (
    await db.all(
      `SELECT a.*, b.bill_number
       FROM audit_log a
       LEFT JOIN bills b ON b.id = a.bill_id
       ${where}
       ORDER BY a.ts DESC, a.id DESC
       LIMIT ? OFFSET ?`,
      [...params, PAGE_SIZE, offset]
    )
  ).map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));

  res.render('audit', {
    title: 'Audit log',
    rows,
    actions: ACTIONS,
    action,
    billNumber,
    page: current,
    pages,
    total,
    flash: req.session.flash || null,
  });
  delete req.session.flash;
});

// ---- Restore a deleted bill from its audit entry ---------------------------

router.post('/audit/:id/restore', requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  const entry = id && (await getEntry(id));
  if (!entry || entry.action !== 'delete') {
    return res.status(404).render('error', { title: 'Not found', message: 'No restorable audit entry with that id.' });
  }

  const values = entry.details && entry.details.values;
  if (!values || !values.bill_number) {
    req.session.flash = { type: 'error', message: 'That audit entry has no bill data to restore.' };
    return res.redirect('/audit');
  }

  const now = new Date().toISOString();
  try {
    const row = await db.get(
      `INSERT INTO bills (bill_number, bill_date, note, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [values.bill_number, values.bill_date ?? null, values.note ?? null, now, req.session.user.id, now, req.session.user.id]
    );
    await recordAudit({
      user: req.session.user,
      action: 'restore',
      billId: row.id,
      details: { values, restoredFromAudit: entry.id },
    });
    req.session.flash = { type: 'ok', message: `Bill ${values.bill_number} restored.` };
    res.redirect('/');
  } catch (err) {
    if (err.code === 'UNIQUE_VIOLATION') {
      req.session.flash = {
        type: 'error',
        message: `Cannot restore: bill number "${values.bill_number}" already exists.`,
      };
      return res.redirect('/audit');
    }
    throw err;
  }
});

// ---- Revert an edit to its previous values --------------------------------

router.post('/audit/:id/revert', requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  const entry = id && (await getEntry(id));
  if (!entry || entry.action !== 'update' || !entry.bill_id) {
    return res.status(404).render('error', { title: 'Not found', message: 'No revertable audit entry with that id.' });
  }

  const changes = entry.details && entry.details.changes;
  if (!changes || !Object.keys(changes).length) {
    req.session.flash = { type: 'error', message: 'That audit entry records no field changes.' };
    return res.redirect('/audit');
  }

  const bill = await db.get('SELECT * FROM bills WHERE id = ?', [entry.bill_id]);
  if (!bill) {
    req.session.flash = {
      type: 'error',
      message: 'That bill no longer exists — use Restore on its delete entry instead.',
    };
    return res.redirect('/audit');
  }

  const sets = [];
  const params = [];
  const reverted = {};
  for (const [field, change] of Object.entries(changes)) {
    if (!BILL_FIELDS.includes(field)) continue;
    const target = change.from ?? null;
    sets.push(`${field} = ?`);
    params.push(target);
    reverted[field] = { from: bill[field] ?? null, to: target };
  }
  if (!sets.length) {
    req.session.flash = { type: 'error', message: 'Nothing to revert on that entry.' };
    return res.redirect('/audit');
  }

  const now = new Date().toISOString();
  sets.push('updated_at = ?', 'updated_by = ?');
  params.push(now, req.session.user.id, bill.id);

  try {
    await db.run(`UPDATE bills SET ${sets.join(', ')} WHERE id = ?`, params);
    await recordAudit({
      user: req.session.user,
      action: 'update',
      billId: bill.id,
      details: { changes: reverted, revertedFromAudit: entry.id },
    });
    req.session.flash = { type: 'ok', message: `Bill ${bill.bill_number} reverted to its earlier values.` };
    res.redirect('/');
  } catch (err) {
    if (err.code === 'UNIQUE_VIOLATION') {
      req.session.flash = { type: 'error', message: 'Cannot revert: that would duplicate an existing bill number.' };
      return res.redirect('/audit');
    }
    throw err;
  }
});

module.exports = router;
