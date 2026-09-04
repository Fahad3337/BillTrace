'use strict';

const bcrypt = require('bcryptjs');
const db = require('./db');

const ROUNDS = 12;

function hashPassword(plain) {
  return bcrypt.hashSync(plain, ROUNDS);
}

function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function findUserByUsername(username) {
  return db.get('SELECT * FROM users WHERE username = ?', [username]);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    res.locals.currentUser = req.session.user;
    return next();
  }
  return res.redirect('/login');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  return res.status(403).render('error', {
    title: 'Forbidden',
    message: 'You need an admin account to do that.',
  });
}

module.exports = {
  hashPassword,
  verifyPassword,
  findUserByUsername,
  requireAuth,
  requireAdmin,
};
