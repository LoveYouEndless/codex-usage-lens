import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { controlRequest, readJSON } from '../src/state.mjs';
import { defaultPluginId } from '../src/policy.mjs';

const workerPath = fileURLToPath(new URL('../src/worker.mjs', import.meta.url));
const cliPath = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
async function waitUntil(check, limit = 8000) {
  const start = Date.now();
  while (Date.now() - start < limit) {
    if (await check()) return;
    await pause(100);
  }
  assert.fail('Lifecycle condition did not become true.');
}
async function cli(args) {
  const child = spawn(process.execPath, [cliPath, ...args], { windowsHide: true });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  const [code] = await once(child, 'exit');
  return { code, output };
}
test('status exposes a pending reopen and Stop cancels it even without a running helper', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lens-restart-'));
  const args = ['--state-dir', root, '--codex-home', root];
  const restartPath = join(root, 'restart-request.json');
  try {
    const request = {
      state: 'waiting-for-exit', token: 'a'.repeat(32),
      expiresAt: new Date(Date.now() + 60000).toISOString(), processes: [{ pid: 101 }]
    };
    await writeFile(restartPath, JSON.stringify(request));
    const status = await cli(['status', ...args]);
    assert.equal(status.code, 0);
    assert.deepEqual(JSON.parse(status.output).restart, {
      state: 'waiting-for-exit', expiresAt: request.expiresAt
    });
    assert.equal((await cli(['stop', ...args])).code, 0);
    assert.equal((await readJSON(restartPath)).state, 'cancelled');
    await writeFile(restartPath, JSON.stringify({ ...request, expiresAt: '2020-01-01T00:00:00Z' }));
    assert.equal(JSON.parse((await cli(['status', ...args])).output).restart.state, 'expired');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('helper exits on disabled config; resume respects it and re-enable starts a fresh helper', { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'lens-lifecycle-'));
  const args = ['--state-dir', root, '--codex-home', root, '--port', '65432'];
  let worker;
  try {
    await writeFile(join(root, 'config.toml'), `[plugins."${defaultPluginId}"]\nenabled=true\n`);
    worker = spawn(process.execPath, [workerPath, ...args], { windowsHide: true, stdio: 'ignore' });
    await waitUntil(() => controlRequest(root, 'ping'));
    const pid = (await readJSON(join(root, 'control.json'))).pid;
    const resume = await cli(['resume', ...args]);
    assert.equal(resume.code, 0);
    assert.equal((await readJSON(join(root, 'control.json'))).pid, pid);
    await writeFile(join(root, 'config.toml'), `[plugins."${defaultPluginId}"]\nenabled=false\n`);
    await waitUntil(async () => (await readJSON(join(root, 'status.json')))?.state === 'disabled');
    await waitUntil(async () => !await controlRequest(root, 'ping'));
    assert.equal((await cli(['resume', ...args])).code, 0);
    assert.equal(await controlRequest(root, 'ping'), false);
    await writeFile(join(root, 'config.toml'), `[plugins."${defaultPluginId}"]\nenabled=true\n`);
    assert.equal((await cli(['resume', ...args])).code, 0);
    assert.equal(await controlRequest(root, 'ping'), true);
  } finally {
    await cli(['stop', ...args]);
    if (worker && worker.exitCode === null) {
      await Promise.race([once(worker, 'exit'), pause(2000)]);
      if (worker.exitCode === null) worker.kill();
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('Stop persists across automatic resumes and only explicit Start clears the pause', { timeout: 20000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'lens-pause-'));
  const args = ['--state-dir', root, '--codex-home', root, '--port', '65432'];
  try {
    await writeFile(join(root, 'config.toml'), `[plugins."${defaultPluginId}"]\nenabled=true\n`);
    assert.equal((await cli(['stop', ...args])).code, 0);
    for (let attempt = 0; attempt < 2; attempt++) {
      const resumed = await cli(['resume', ...args]);
      assert.equal(resumed.code, 0);
      assert.equal(JSON.parse(resumed.output).state, 'paused');
      assert.equal(await controlRequest(root, 'ping'), false);
    }
    const status = JSON.parse((await cli(['status', ...args])).output);
    assert.equal(status.paused, true);
    assert.equal(status.state, 'paused');
    assert.equal((await cli(['start', ...args])).code, 0);
    assert.equal(await controlRequest(root, 'ping'), true);
    assert.equal(JSON.parse((await cli(['status', ...args])).output).paused, false);
  } finally {
    await cli(['stop', ...args]);
    await rm(root, { recursive: true, force: true });
  }
});

test('overlapping resumes share one helper and replace an older runtime once', { timeout: 25000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'lens-overlap-'));
  const args = ['--state-dir', root, '--codex-home', root, '--port', '65432'];
  try {
    await writeFile(join(root, 'config.toml'), `[plugins."${defaultPluginId}"]\nenabled=true\n`);
    const results = await Promise.all(Array.from({ length: 4 }, () => cli(['resume', ...args])));
    assert.ok(results.every(result => result.code === 0));
    const control = await readJSON(join(root, 'control.json'));
    const outputs = results.map(result => JSON.parse(result.output));
    assert.equal(outputs.filter(item => item.state === 'already-running').length, 3);
    assert.equal(outputs.find(item => item.pid)?.pid, control.pid);
    await writeFile(join(root, 'control.json'), JSON.stringify({ ...control, version: '0.2.0' }));
    assert.equal((await cli(['resume', ...args])).code, 0);
    const replacement = await readJSON(join(root, 'control.json'));
    assert.notEqual(replacement.pid, control.pid);
    assert.equal(replacement.version, '0.3.0');
    assert.equal(JSON.parse((await cli(['resume', ...args])).output).state, 'already-running');
    assert.equal((await readJSON(join(root, 'control.json'))).pid, replacement.pid);
  } finally {
    await cli(['stop', ...args]);
    await rm(root, { recursive: true, force: true });
  }
});
