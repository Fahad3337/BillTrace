'use strict';

// Builds and returns the Express app. No side effects beyond that: the caller
// (src/server.js, or the test helper) is responsible for db.init() and listen().
// Splitting this out from server.js is what makes the app testable with supertest.

// Lets async route handlers reject straight into the Express error middleware below.
require('express-async-errors');

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');

const db = require('./db');
const { requireAuth } = require('./auth');

const authRoutes = require('./routes/auth');
const billRoutes = require('./routes/bills');
const userRoutes = require('./routes/users');
const auditRoutes = require('./routes/audit');

const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET === 'change-me-to-a-long-random-string') {
  console.error('\n  ERROR: SESSION_SECRET is not set. Copy .env.example to .env and set a random value.\n');
  process.exit(1);
}

function buildSessionStore() {
  if (db.name === 'postgres') {
    const PgStore = require('connect-pg-simple')(session);
    return new PgStore({ pool: db.pool, createTableIfMissing: true });
  }
  const SqliteStore = require('better-sqlite3-session-store')(session);
  return new SqliteStore({
    client: db.client,
    expired: { clean: true, intervalMs: 24 * 60 * 60 * 1000 },
  });
}

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', 'loopback');

app.use(helmet({ contentSecurityPolicy: { directives: { 'default-src': ["'self'"], 'style-src': ["'self'", "'unsafe-inline'"] } } }));
app.use(express.urlencoded({ extended: false }));
app.use('/static', express.static(path.join(__dirname, '..', 'public')));

app.use(
  session({
    store: buildSessionStore(),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 },
  })
);

// Public routes
app.use('/', authRoutes);

// Everything below requires a session
app.use(requireAuth);

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

app.use('/', billRoutes);
app.use('/users', userRoutes);
app.use('/', auditRoutes);

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: 'That page does not exist.' });
});

// Errors
app.use((err, req, res, next) => {
  if (process.env.NODE_ENV !== 'test') console.error(err);
  res.status(500).render('error', { title: 'Something went wrong', message: 'An unexpected error occurred.' });
});

module.exports = app;
