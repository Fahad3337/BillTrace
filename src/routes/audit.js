'use strict';

const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();

const PAGE_SIZE = 100;
const ACTIONS = [
  'create', 'update', 'delete',
  'login', 'login_failed',
  'user_create', 'user_delete', 'user_password_reset',
];

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
  });
});

module.exports = router;
