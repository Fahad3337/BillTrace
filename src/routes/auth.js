'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { findUserByUsername, verifyPassword } = require('../auth');
const { recordAudit } = require('../audit');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please wait 15 minutes and try again.',
  // The rate limit is exercised by its own test; skip it elsewhere so a run of
  // failed-login assertions doesn't trip it.
  skip: () => process.env.NODE_ENV === 'test' && process.env.TEST_RATE_LIMIT !== '1',
});

router.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.render('login', { title: 'Sign in', error: null, username: '' });
});

router.post('/login', loginLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  const user = await findUserByUsername(username);
  const ok = user && verifyPassword(password, user.password_hash);

  if (!ok) {
    await recordAudit({
      user: user ? { id: user.id, username: user.username } : { id: null, username },
      action: 'login_failed',
    });
    return res.status(401).render('login', {
      title: 'Sign in',
      error: 'Invalid username or password.',
      username,
    });
  }

  req.session.regenerate(async (err) => {
    if (err) {
      return res.status(500).render('login', {
        title: 'Sign in',
        error: 'Could not start a session. Please try again.',
        username,
      });
    }
    req.session.user = { id: user.id, username: user.username, role: user.role };
    try {
      await recordAudit({ user: req.session.user, action: 'login' });
    } catch (e) {
      console.error('audit write failed for login:', e);
    }
    res.redirect('/');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

module.exports = router;
