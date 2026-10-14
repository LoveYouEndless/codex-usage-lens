import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { SessionStore } from './logs.mjs';
import { CDP, discover } from './cdp.mjs';
import { installLens, inspectPage, removeLens } from './ui.mjs';
import { options, ensureState, atomicJSON, readJSON } from './state.mjs';

const config = options(process.argv.slice(2));
await ensureState(config.stateDir);
const token = randomBytes(32).toString('hex');
const store = new SessionStore(config.codexHome);
let client = null;
let stopping = false;
let timer = null;
let connectedPort = null;
let tickPromise = null;
const statusPath = join(config.stateDir, 'status.json');
const controlPath = join(config.stateDir, 'control.json');
const status = async value => atomicJSON(statusPath, {
  product: 'codex-usage-lens', version: '0.1.2', pid: process.pid,
  updatedAt: new Date().toISOString(), ...value
});

const server = createServer((request, response) => {
  const incoming = Buffer.from(request.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${token}`);
  if (incoming.length !== expected.length || !timingSafeEqual(incoming, expected)) {
    response.writeHead(403).end();
    return;
  }
  if ((request.url === '/ping' && request.method === 'GET')
    || (request.url === '/stop' && request.method === 'POST')) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ product: 'codex-usage-lens', pid: process.pid }));
    if (request.url === '/stop') void shutdown();
  } else response.writeHead(404).end();
});
server.requestTimeout = 3000;
server.headersTimeout = 3000;
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await atomicJSON(controlPath, { pid: process.pid, port: server.address().port, token });

async function tick() {
  if (stopping) return;
  try {
    if (!client) {
      const found = await discover(config.port);
      connectedPort = found.port;
      client = await CDP.connect(found.page.webSocketDebuggerUrl);
    }
    const page = await client.evaluate(`(${inspectPage.toString()})()`);
    const session = await store.get(page?.id);
    if (stopping) return;
    const rendered = await client.evaluate(`(${installLens.toString()})(${JSON.stringify({ session })})`);
    await status({
      state: session ? 'connected' : 'no-session-data', port: connectedPort,
      threadId: rendered.activeThreadId, buttons: rendered.buttons,
      sessionTokens: session?.total.total || 0
    });
  } catch (error) {
    client?.close();
    client = null;
    if (!stopping) await status({ state: 'waiting', message: error.message, port: config.port || connectedPort || null });
  } finally {
    if (!stopping) timer = setTimeout(() => { tickPromise = tick(); }, 2000);
  }
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  // Finish an in-flight injection before removing the UI.
  await tickPromise?.catch(() => {});
  try {
    if (client) await client.evaluate(`(${removeLens.toString()})()`);
  } catch { /* A closed renderer has already removed temporary UI. */ }
  client?.close();
  await status({ state: 'stopped', port: connectedPort }).catch(() => {});
  const control = await readJSON(controlPath);
  if (control?.pid === process.pid) await unlink(controlPath).catch(() => {});
  server.close();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
await status({ state: 'starting' });
tickPromise = tick();
