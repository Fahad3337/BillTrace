'use strict';

const express = require('express');
const db = require('../db');
const { requireAdmin, hashPassword } = require('../auth');
const { recordAudit } = require('../audit');

const router = express.Router();

router.use(requireAdmin);

async function countAdmins() {
  return (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")).n;
}

async function listUsers() {
  return db.all('SELECT id, username, role, created_at FROM users ORDER BY username');
}

async function renderList(res, { status = 200, errors = [], notice = null } = {}) {
  res.status(status).render('users/list', { title: 'Users', users: await listUsers(), errors, notice });
}

/** Parse a route :id param; returns a positive integer or null. */
function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get('/', async (req, res) => renderList(res));

router.post('/', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const role = String(req.body.role || '').trim();
  const password = String(req.body.password || '');
  const errors = [];

  if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
    errors.push('Username must be 3-50 characters (letters, digits, dot, dash, underscore).');
  }
  if (!['admin', 'viewer'].includes(role)) errors.push('Role must be admin or viewer.');
  if (password.length < 8) errors.push('Password must be at least 8 characters.');
  if (username && (await db.get('SELECT 1 AS x FROM users WHERE username = ?', [username]))) {
    errors.push('That username is already taken.');
  }
  if (errors.length) return renderList(res, { status: 400, errors });

  try {
    const row = await db.get(
      'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?) RETURNING id',
      [username, hashPassword(password), role, new Date().toISOString()]
    );
    await recordAudit({ user: req.session.user, action: 'user_create', details: { username, role, userId: row.id } });
    renderList(res, { notice: `User "${username}" created.` });
  } catch (err) {
    if (err.code === 'UNIQUE_VIOLATION') {
      return renderList(res, { status: 400, errors: ['That username is already taken.'] });
    }
    throw err;
  }
});

router.post('/:id/password', async (req, res) => {
  const id = parseId(req.params.id);
  const target = id && (await db.get('SELECT * FROM users WHERE id = ?', [id]));
  if (!target) return res.status(404).render('error', { title: 'Not found', message: 'No such user.' });

  const password = String(req.body.password || '');
  if (password.length < 8) {
    return renderList(res, { status: 400, errors: ['Password must be at least 8 characters.'] });
  }

  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(password), target.id]);
  await recordAudit({ user: req.session.user, action: 'user_password_reset', details: { username: target.username } });
  renderList(res, { notice: `Password reset for "${target.username}".` });
});

router.post('/:id/delete', async (req, res) => {
  const id = parseId(req.params.id);
  const target = id && (await db.get('SELECT * FROM users WHERE id = ?', [id]));
  if (!target) return res.status(404).render('error', { title: 'Not found', message: 'No such user.' });

  if (target.id === req.session.user.id) {
    return renderList(res, { status: 400, errors: ['You cannot delete your own account while signed in.'] });
  }
  if (target.role === 'admin' && (await countAdmins()) <= 1) {
    return renderList(res, { status: 400, errors: ['Cannot delete the last remaining admin.'] });
  }

  await db.run('DELETE FROM users WHERE id = ?', [target.id]);
  await recordAudit({ user: req.session.user, action: 'user_delete', details: { username: target.username, role: target.role } });
  renderList(res, { notice: `User "${target.username}" deleted.` });
});

module.exports = router;
