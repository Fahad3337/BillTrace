'use strict';

const db = require('./db');

/**
 * Record an audit event.
 * @param {object} opts
 * @param {object|null} opts.user   - the acting user ({ id, username }) or null
 * @param {string} opts.action      - create | update | delete | login | login_failed
 * @param {number|null} [opts.billId]
 * @param {object|null} [opts.details] - arbitrary JSON-serialisable detail (e.g. field diff)
 */
function recordAudit({ user, action, billId = null, details = null }) {
  return db.run(
    `INSERT INTO audit_log (ts, user_id, username, action, bill_id, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      new Date().toISOString(),
      user ? user.id : null,
      user ? user.username : null,
      action,
      billId,
      details ? JSON.stringify(details) : null,
    ]
  );
}

/** Build a { field: { from, to } } diff between two plain objects, for the given fields. */
function diff(before, after, fields) {
  const changes = {};
  for (const f of fields) {
    const from = before ? before[f] : undefined;
    const to = after ? after[f] : undefined;
    if (from !== to) changes[f] = { from: from ?? null, to: to ?? null };
  }
  return changes;
}

module.exports = { recordAudit, diff };
