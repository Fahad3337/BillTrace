'use strict';

// The login rate limiter is skipped in the test env by default (so other suites
// can make many login attempts). This file opts back in via TEST_RATE_LIMIT=1,
// set before ./helpers pulls in the app.

process.env.TEST_RATE_LIMIT = '1';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, request, init, createUser, cleanup } = require('./helpers');

before(async () => {
  await init();
  await createUser({ username: 'admin', role: 'admin' });
});
after(cleanup);

test('too many failed logins are eventually blocked', async () => {
  const agent = request.agent(app);
  let sawLimit = false;

  for (let i = 0; i < 15; i++) {
    const res = await agent.post('/login').type('form').send({ username: 'admin', password: 'wrong' });
    if (res.status === 429) {
      sawLimit = true;
      break;
    }
  }

  assert.ok(sawLimit, 'the limiter returns 429 within 15 attempts (max is 10)');
});
