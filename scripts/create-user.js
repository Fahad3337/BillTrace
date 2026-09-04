'use strict';

require('dotenv').config();

const readline = require('readline');
const db = require('../src/db');
const { hashPassword } = require('../src/auth');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--username') out.username = argv[++i];
    else if (a === '--role') out.role = argv[++i];
  }
  return out;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

// ---- input --------------------------------------------------------------------
// On a real terminal we prompt interactively and mask password input.
// When stdin is piped (tests, scripts) we read every line up front, because
// readline.question() does not deliver lines queued after stdin hits EOF.

const isTTY = process.stdin.isTTY;
let pipedLines = null;

function readPipedLines() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data.split(/\r?\n/)));
  });
}

function askTTY(question, hidden) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let masking = false;
  rl._writeToOutput = (str) => {
    if (masking && str.length === 1 && str !== '\n' && str !== '\r') rl.output.write('*');
    else rl.output.write(str);
  };
  return new Promise((resolve) => {
    masking = hidden;
    rl.question(question, (answer) => {
      if (hidden) process.stdout.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

async function ask(question, { hidden = false } = {}) {
  if (isTTY) return askTTY(question, hidden);
  if (pipedLines === null) pipedLines = await readPipedLines();
  const line = pipedLines.length ? pipedLines.shift() : '';
  return line;
}

// ---- main --------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Make sure the tables exist (first run against a fresh SQLite file or a new
  // cloud Postgres database).
  await db.init();

  const username = (args.username || (await ask('Username: '))).trim();
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(username)) {
    fail('Username must be 3-50 characters (letters, digits, dot, dash, underscore).');
  }

  const role = (args.role || (await ask('Role (admin/viewer): '))).trim();
  if (!['admin', 'viewer'].includes(role)) {
    fail('Role must be "admin" or "viewer".');
  }

  if (await db.get('SELECT 1 AS x FROM users WHERE username = ?', [username])) {
    fail(`A user named "${username}" already exists.`);
  }

  const pw1 = await ask('Password (min 8 chars): ', { hidden: true });
  if (pw1.length < 8) fail('Password must be at least 8 characters.');

  const pw2 = await ask('Confirm password: ', { hidden: true });
  if (pw1 !== pw2) fail('Passwords do not match.');

  await db.run(
    'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)',
    [username, hashPassword(pw1), role, new Date().toISOString()]
  );

  console.log(`Created ${role} user "${username}" in the ${db.name} database.`);
  await db.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
