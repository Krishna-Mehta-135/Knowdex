import { createServer } from 'node:http';

const tokens = ['ProjectBench', ' local', ' fake', ' response'];

export function readConfig(env = process.env) {
  const number = (name, fallback) => {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
    return value;
  };
  const tokenRate = number('FAKE_GEMINI_TOKEN_RATE', 0);
  const delayMs = number('FAKE_GEMINI_DELAY_MS', 0);
  const rate429 = number('FAKE_GEMINI_429_RATE', 0);
  if (rate429 > 1) throw new Error('FAKE_GEMINI_429_RATE must be between 0 and 1');
  return { delayMs, tokenRate, rate429 };
}

const responseFor = (text) => JSON.stringify({
  candidates: [{ content: { parts: [{ text }] } }],
});

export function createHandler(config, { random = Math.random, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  return async (request, serverResponse) => {
    if (request.url === '/health') {
      serverResponse.writeHead(200, { 'content-type': 'text/plain' });
      serverResponse.end('ok');
      return;
    }
    if (random() < config.rate429) {
      serverResponse.writeHead(429, { 'content-type': 'application/json' });
      serverResponse.end(JSON.stringify({ error: { message: 'fake rate limit' } }));
      return;
    }
    if (config.delayMs > 0) await sleep(config.delayMs);
    serverResponse.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const intervalMs = config.tokenRate > 0 ? 1000 / config.tokenRate : 0;
    for (const token of tokens) {
      serverResponse.write(`data: ${responseFor(token)}\n\n`);
      if (intervalMs > 0) await sleep(intervalMs);
    }
    serverResponse.end();
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  createServer(createHandler(readConfig())).listen(9000, '0.0.0.0');
}
