import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { readJSON, controlRequest } from '../src/state.mjs';
import { defaultPluginId } from '../src/policy.mjs';

const sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
async function waitUntil(check, limit = 10000) {
  const start = Date.now();
  while (Date.now() - start < limit) { if (await check()) return; await pause(80); }
  assert.fail('Mock connection condition did not become true.');
}
async function fixture({ available = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'lens-connection-'));
  const configPath = join(root, 'config.toml');
  await writeFile(configPath, `[plugins."${defaultPluginId}"]\nenabled=true\n`);
  await mkdir(join(root, 'sessions'));
  await writeFile(join(root, 'sessions', `rollout-${sessionId}.jsonl`), [
    { type: 'session_meta', payload: { id: sessionId } },
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 'mock-turn' } },
    { type: 'event_msg', payload: { type: 'token_count', info: {
      total_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
      last_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 }
    } } }
  ].map(item => JSON.stringify(item)).join('\n') + '\n');
  const state = { available, target: 'renderer-1', supported: true, idle: false, displayed: false, injections: 0, removals: 0 };
  let port;
  const http = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(state.available ? [{
      id: state.target, type: 'page', url: 'app://-/index.html',
      webSocketDebuggerUrl: `ws://127.0.0.1:${port}/renderer`
    }] : []));
  });
  const sockets = new WebSocketServer({ server: http });
  sockets.on('connection', socket => socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    const script = message.params.expression;
    let value = {};
    if (script.includes('function probePage')) value = { state: state.idle ? 'idle' : state.supported ? 'supported' : 'unsupported-ui' };
    else if (script.includes('function inspectPage')) value = { id: sessionId };
    else if (script.includes('function installLens')) {
      state.injections++; state.displayed = true;
      value = { activeThreadId: sessionId, buttons: 1 };
    } else if (script.includes('function removeLens')) {
      state.removals++; state.displayed = false;
    }
    socket.send(JSON.stringify({ id: message.id, result: { result: { type: 'object', value } } }));
  }));
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  port = http.address().port;
  const worker = spawn(process.execPath, [
    fileURLToPath(new URL('../src/worker.mjs', import.meta.url)),
    '--state-dir', root, '--codex-home', root, '--port', String(port)
  ], { windowsHide: true, stdio: 'ignore' });
  return {
    root, state, sockets, configPath,
    status: () => readJSON(join(root, 'status.json')),
    async close() {
      await controlRequest(root, 'stop');
      await Promise.race([once(worker, 'exit'), pause(2000)]);
      if (worker.exitCode === null) worker.kill();
      for (const socket of sockets.clients) socket.terminate();
      await new Promise(resolve => sockets.close(resolve));
      await new Promise(resolve => http.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  };
}

test('a waiting helper mounts automatically when a usable client connection appears', { timeout: 15000 }, async () => {
  const run = await fixture({ available: false });
  try {
    await waitUntil(async () => (await run.status())?.state === 'waiting');
    assert.equal(run.state.injections, 0);
    run.state.available = true;
    await waitUntil(() => run.state.displayed);
    await waitUntil(async () => (await run.status())?.state === 'connected');
  } finally { await run.close(); }
});

test('disabling an active plugin removes injected UI before the helper exits', { timeout: 15000 }, async () => {
  const run = await fixture();
  try {
    await waitUntil(() => run.state.displayed);
    await writeFile(run.configPath, `[plugins."${defaultPluginId}"]\nenabled=false\n`);
    await waitUntil(async () => (await run.status())?.state === 'disabled');
    assert.equal(run.state.displayed, false);
    assert.ok(run.state.removals >= 1);
    await waitUntil(async () => !await controlRequest(run.root, 'ping'));
  } finally { await run.close(); }
});

test('unsupported desktop markup withdraws statistics and stops reinjecting', { timeout: 15000 }, async () => {
  const run = await fixture();
  try {
    await waitUntil(() => run.state.displayed);
    run.state.supported = false;
    await waitUntil(async () => (await run.status())?.state === 'incompatible');
    const injections = run.state.injections;
    assert.equal(run.state.displayed, false);
    await pause(2500);
    assert.equal(run.state.injections, injections);
    assert.equal(await controlRequest(run.root, 'ping'), true);
  } finally { await run.close(); }
});

test('a replaced renderer reconnects without launching or closing the client', { timeout: 20000 }, async () => {
  const run = await fixture();
  try {
    await waitUntil(() => run.state.displayed);
    const injections = run.state.injections;
    run.state.target = 'renderer-2';
    for (const socket of run.sockets.clients) socket.terminate();
    await waitUntil(async () => (await run.status())?.state === 'waiting');
    await waitUntil(async () => (await run.status())?.state === 'connected');
    assert.ok(run.state.injections > injections);
  } finally { await run.close(); }
});

test('a loading or empty renderer waits and later displays statistics without a restart', { timeout: 15000 }, async () => {
  const run = await fixture();
  try {
    run.state.idle = true;
    await waitUntil(async () => (await run.status())?.state === 'waiting-for-reply');
    assert.equal(run.state.injections, 0);
    run.state.idle = false;
    await waitUntil(() => run.state.displayed);
    await waitUntil(async () => (await run.status())?.state === 'connected');
  } finally { await run.close(); }
});
