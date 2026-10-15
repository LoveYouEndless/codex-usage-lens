import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm, stat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { controlRequest, readJSON } from '../src/state.mjs';
import { defaultPluginId } from '../src/policy.mjs';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { setTimeout as pause } from 'node:timers/promises';

const projectRoot = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const cliPath = join(projectRoot, 'src', 'cli.mjs');
async function run(executable, args, options = {}, input = '') {
  const child = spawn(executable, args, { windowsHide: true, ...options });
  let output = '';
  let error = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { error += data; });
  child.stdin.on('error', () => {});
  child.stdin.end(input);
  const [code] = await once(child, 'exit');
  return { code, output, error };
}
async function invokeHook(root, input = '', port = 65432) {
  const hooks = JSON.parse(await readFile(join(projectRoot, 'hooks', 'hooks.json'), 'utf8'));
  const handler = hooks.hooks.SessionStart[0].hooks[0];
  const command = handler.commandWindows.replaceAll('${PLUGIN_ROOT}', projectRoot)
    + ` -StateDir "${root}"` + (port ? ` -Port ${port}` : '');
  return run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${command}"`], {
    windowsVerbatimArguments: true,
    env: { ...process.env, CODEX_HOME: root, CODEX_PLUS_STATE_DIR: root }
  }, input);
}
const windows = { skip: process.platform !== 'win32', timeout: 45000 };

test('the packaged Windows hook deploys once, stays quiet, shares a helper, and respects Stop', windows, async () => {
  const root = await mkdtemp(join(tmpdir(), 'lens hook & spaces-'));
  const args = ['--state-dir', root, '--codex-home', root, '--port', '65432'];
  const secret = 'hook-prompt-must-not-be-retained-5a3c09';
  try {
    const config = `[plugins."${defaultPluginId}"]\nenabled=true\n`;
    await writeFile(join(root, 'config.toml'), config);
    const first = await invokeHook(root, JSON.stringify({
      hook_event_name: 'UserPromptSubmit', prompt: secret.repeat(5000)
    }));
    assert.deepEqual(first, { code: 0, output: '', error: '' });
    assert.equal(await controlRequest(root, 'ping'), true);
    const installation = await readJSON(join(root, 'install.json'));
    assert.equal(installation.codexHome, root);
    assert.equal(installation.desktopInstalled, false);
    assert.equal(installation.loginRecovery, false);
    await assert.rejects(stat(join(root, 'restart-request.json')), { code: 'ENOENT' });
    const deployed = join(installation.runtimePath, 'src', 'cli.mjs');
    const modified = (await stat(deployed)).mtimeMs;
    const pid = (await readJSON(join(root, 'control.json'))).pid;
    const repeated = await Promise.all([invokeHook(root), invokeHook(root)]);
    assert.ok(repeated.every(result => result.code === 0 && !result.output && !result.error));
    assert.equal((await readJSON(join(root, 'control.json'))).pid, pid);
    assert.equal((await stat(deployed)).mtimeMs, modified);
    assert.equal(await readFile(join(root, 'config.toml'), 'utf8'), config);
    assert.ok(!(await readFile(join(root, 'helper.log'), 'utf8')).includes(secret));
    assert.equal((await run(process.execPath, [cliPath, 'stop', ...args])).code, 0);
    assert.deepEqual(await invokeHook(root), { code: 0, output: '', error: '' });
    assert.equal(await controlRequest(root, 'ping'), false);
    assert.equal(JSON.parse((await run(process.execPath, [cliPath, 'status', ...args])).output).paused, true);
  } finally {
    await run(process.execPath, [cliPath, 'stop', ...args]);
    await rm(root, { recursive: true, force: true });
  }
});

test('a trusted hook discovers a launcher connection and restores the recorded session', windows, async () => {
  const root = await mkdtemp(join(tmpdir(), 'lens-hook-connection-'));
  const sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  let injected = null;
  const endpoint = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify([{
      id: 'main', type: 'page', url: 'app://-/index.html',
      webSocketDebuggerUrl: `ws://127.0.0.1:${endpoint.address().port}/renderer`
    }]));
  });
  const sockets = new WebSocketServer({ server: endpoint });
  sockets.on('connection', socket => socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    const expression = message.params.expression;
    let value = {};
    if (expression.includes('function probePage')) value = { state: 'supported' };
    else if (expression.includes('function inspectPage')) value = { id: sessionId };
    else if (expression.includes('function installLens')) {
      injected = JSON.parse(expression.slice(expression.lastIndexOf(')(') + 2, -1));
      value = { activeThreadId: sessionId, buttons: 1 };
    }
    socket.send(JSON.stringify({ id: message.id, result: { result: { type: 'object', value } } }));
  }));
  await new Promise(resolve => endpoint.listen(0, '127.0.0.1', resolve));
  try {
    await writeFile(join(root, 'config.toml'), `[plugins."${defaultPluginId}"]\nenabled=true\n`);
    await writeFile(join(root, 'latest-status.json'), JSON.stringify({ debug_port: endpoint.address().port }));
    await mkdir(join(root, 'sessions'));
    await writeFile(join(root, 'sessions', `rollout-${sessionId}.jsonl`), [
      { type: 'session_meta', payload: { id: sessionId } },
      { type: 'event_msg', payload: { type: 'task_started', turn_id: 'test-turn' } },
      { type: 'event_msg', payload: { type: 'token_count', info: {
        total_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
        last_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 }
      } } }
    ].map(item => JSON.stringify(item)).join('\n') + '\n');
    assert.deepEqual(await invokeHook(root, '', 0), { code: 0, output: '', error: '' });
    for (let attempt = 0; attempt < 80 && !injected; attempt++) await pause(100);
    assert.equal(injected?.session?.id, sessionId);
    assert.equal(injected?.session?.total.total, 110);
    assert.equal((await readJSON(join(root, 'status.json'))).state, 'connected');
    await assert.rejects(stat(join(root, 'restart-request.json')), { code: 'ENOENT' });
  } finally {
    await run(process.execPath, [cliPath, 'stop', '--state-dir', root, '--codex-home', root]);
    for (const socket of sockets.clients) socket.terminate();
    await new Promise(resolve => sockets.close(resolve));
    await new Promise(resolve => endpoint.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test('disabled, missing, or invalid plugin settings make the hook a quiet no-op', windows, async () => {
  for (const config of [null, `[plugins."${defaultPluginId}"]\nenabled=false\n`, 'private="do-not-log"\ninvalid=[']) {
    const root = await mkdtemp(join(tmpdir(), 'lens-hook-disabled-'));
    try {
      if (config) await writeFile(join(root, 'config.toml'), config);
      assert.deepEqual(await invokeHook(root), { code: 0, output: '', error: '' });
      assert.equal(await controlRequest(root, 'ping'), false);
      await assert.rejects(stat(join(root, 'install.json')), { code: 'ENOENT' });
      const status = await readJSON(join(root, 'hook-status.json'));
      assert.equal(status?.state, 'unavailable');
      assert.ok(!JSON.stringify(status).includes('do-not-log'));
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});
