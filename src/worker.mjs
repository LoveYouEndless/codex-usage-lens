import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { SessionStore } from './logs.mjs';
import { CDP, discover } from './cdp.mjs';
import { installLens, inspectPage, removeLens } from './ui.mjs';
import { options, ensureState, atomicJSON, readJSON } from './state.mjs';
import { readPolicy } from './policy.mjs';
import { probePage, CompatibilityGuard } from './compatibility.mjs';

const config = options(process.argv.slice(2));
await ensureState(config.stateDir);
const token = randomBytes(32).toString('hex');
const store = new SessionStore(config.codexHome);
let client = null;
let stopping = false;
let timer = null;
let connectedPort = null;
let tickPromise = null;
let targetId = null;
const guard = new CompatibilityGuard();
const statusPath = join(config.stateDir, 'status.json');
const controlPath = join(config.stateDir, 'control.json');
const status = async value => atomicJSON(statusPath, {
  product: 'codex-usage-lens', version: '0.2.0', pid: process.pid,
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
  let delay = 2000;
  try {
    const policy = await readPolicy(config.codexHome, config.pluginId);
    if (!policy.enabled) {
      await clearUI();
      if (policy.state === 'config-unavailable') {
        await status({ state: policy.state, port: connectedPort });
      } else {
        setTimeout(() => void shutdown(policy.state), 0);
      }
      return;
    }
    if (!client) {
      const found = await discover(config.port);
      connectedPort = found.port;
      targetId = found.page.id;
      if (guard.blocked(targetId)) {
        delay = 30000;
        await status({ state: 'incompatible', port: connectedPort,
          message: 'Statistics paused for this renderer. Codex can continue normally.' });
        return;
      }
      client = await CDP.connect(found.page.webSocketDebuggerUrl);
    }
    const compatibility = await client.evaluate(`(${probePage.toString()})()`);
    if (compatibility?.state === 'idle') {
      await clearUI();
      delay = 5000;
      await status({ state: 'waiting-for-reply', port: connectedPort });
      return;
    }
    if (compatibility?.state !== 'supported') {
      await clearUI();
      guard.block(targetId);
      client.close();
      client = null;
      delay = 30000;
      await status({ state: 'incompatible', port: connectedPort,
        message: 'Unsupported desktop interface. Statistics paused; no client restart is required.' });
      return;
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
    guard.succeeded(targetId);
  } catch (error) {
    if (client) {
      await clearUI();
      guard.failed(targetId);
    }
    client?.close();
    client = null;
    const incompatible = guard.blocked(targetId);
    delay = incompatible ? 30000 : 5000;
    if (!stopping) await status({
      state: incompatible ? 'incompatible' : 'waiting',
      message: incompatible ? 'Statistics paused after repeated renderer errors.' : 'Waiting for a usable local Codex connection.',
      port: config.port || connectedPort || null
    }).catch(() => {});
  } finally {
    if (!stopping) timer = setTimeout(() => { tickPromise = tick(); }, delay);
  }
}

async function clearUI() {
  try { if (client) await client.evaluate(`(${removeLens.toString()})()`); }
  catch { /* Never restart or terminate Codex to remove temporary UI. */ }
}

async function shutdown(finalState = 'stopped') {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  // Finish an in-flight injection before removing the UI.
  await tickPromise?.catch(() => {});
  await clearUI();
  client?.close();
  await status({ state: finalState, port: connectedPort }).catch(() => {});
  const control = await readJSON(controlPath).catch(() => null);
  if (control?.pid === process.pid) await unlink(controlPath).catch(() => {});
  server.close();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
await status({ state: 'starting' });
tickPromise = tick();
