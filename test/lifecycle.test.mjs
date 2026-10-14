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
