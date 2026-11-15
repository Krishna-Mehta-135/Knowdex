import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createHandler, readConfig } from './server.mjs';

function responseMock() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    write(chunk) { this.body += chunk; },
    end(chunk = '') { this.body += chunk; },
  };
}

describe('fake Gemini configuration', () => {
  it('reads delay, token rate, and 429 rate without network access', () => {
    assert.deepEqual(readConfig({ FAKE_GEMINI_DELAY_MS: '25', FAKE_GEMINI_TOKEN_RATE: '10', FAKE_GEMINI_429_RATE: '0.25' }), {
      delayMs: 25, tokenRate: 10, rate429: 0.25,
    });
  });

  it('streams tokens at the configured rate after the configured delay', async () => {
    const sleeps = [];
    const response = responseMock();
    await createHandler({ delayMs: 25, tokenRate: 10, rate429: 0 }, {
      random: () => 1,
      sleep: async (ms) => sleeps.push(ms),
    })({ url: '/generate' }, response);
    assert.equal(response.status, 200);
    assert.equal(response.body.match(/data:/g).length, 4);
    assert.deepEqual(sleeps, [25, 100, 100, 100, 100]);
  });

  it('returns a configurable 429 without streaming a response', async () => {
    const response = responseMock();
    await createHandler({ delayMs: 0, tokenRate: 0, rate429: 1 }, { random: () => 0 })({ url: '/generate' }, response);
    assert.equal(response.status, 429);
    assert.equal(response.body.includes('data:'), false);
  });
});
