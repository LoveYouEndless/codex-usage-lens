import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CDP, targets, discover } from '../src/cdp.mjs';
import { options } from '../src/state.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('debug WebSocket connections are confined to loopback', async () => {
  await assert.rejects(CDP.connect('ws://example.com/debug'), /loopback/);
  await assert.rejects(CDP.connect('wss://127.0.0.1/debug'), /loopback/);
});

test('invalid ports are rejected before any network request', async () => {
  await assert.rejects(targets(0), /Invalid/);
  assert.throws(() => options(['--port', 'NaN']), /Invalid/);
  assert.throws(() => options(['--port', '70000']), /Invalid/);
  assert.throws(() => options(['--state-dir']), /Missing/);
  assert.throws(() => options(['--unknown', 'value']), /Unknown/);
});

test('auto discovery follows the launcher port and rejects unrelated page targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lens-port-'));
  const previous = process.env.CODEX_PLUS_STATE_DIR;
  let unrelated = false;
  const endpoint = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify([{
      id: 'main', type: 'page', url: unrelated ? 'https://example.com' : 'app://-/index.html',
      webSocketDebuggerUrl: `ws://127.0.0.1:${endpoint.address().port}/main`
    }]));
  });
  await new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve));
  const port = endpoint.address().port;
  try {
    process.env.CODEX_PLUS_STATE_DIR = root;
    await writeFile(join(root, 'latest-status.json'), JSON.stringify({ debug_port: port }));
    assert.equal((await discover(undefined, root)).port, port);
    unrelated = true;
    await assert.rejects(discover(port, root), /No Codex/);
    unrelated = false;
    await writeFile(join(root, 'latest-status.json'), JSON.stringify({ debug_port: 70000 }));
    await writeFile(join(root, 'install.json'), JSON.stringify({ product: 'codex-usage-lens', port }));
    assert.equal((await discover(undefined, root)).port, port);
    // 可选的启动器状态损坏时，仍能连接用户明确指定的端口。
    await writeFile(join(root, 'latest-status.json'), '{broken');
    assert.equal((await discover(port, root)).port, port);
  } finally {
    if (previous === undefined) delete process.env.CODEX_PLUS_STATE_DIR;
    else process.env.CODEX_PLUS_STATE_DIR = previous;
    await new Promise(resolve => endpoint.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
