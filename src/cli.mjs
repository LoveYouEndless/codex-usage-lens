#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { open, mkdir, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { options, ensureState, readJSON, atomicJSON, controlRequest, isPaused } from './state.mjs';
import { readPolicy } from './policy.mjs';
import { discover } from './cdp.mjs';

async function acquireLock(lock) {
  // 启动、恢复和停止共用一把锁，避免并发 hook 重复拉起或误停助手。
  for (let attempt = 0; attempt < 120; attempt++) {
    try { await mkdir(lock); return; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - (await stat(lock)).mtimeMs > 60000) {
          await rmdir(lock);
          continue;
        }
      } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      await pause(100);
    }
  }
  throw new Error('Another Lens operation is still in progress.');
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
  const [action = 'help', ...args] = process.argv.slice(2);
  if (['help', '--help', '-h'].includes(action)) {
    console.log('Codex Usage Lens\nnode src/cli.mjs start|resume|stop|status|connection [--port PORT] [--state-dir DIR] [--codex-home DIR] [--plugin-id ID]');
    return;
  }
  if (!['start', 'resume', 'stop', 'status', 'connection'].includes(action)) throw new Error(`Unknown command: ${action}`);
  const config = options(args);
  const statusPath = join(config.stateDir, 'status.json');
  if (action === 'connection') {
    try { const found = await discover(config.port, config.stateDir); console.log(JSON.stringify({ connected: true, port: found.port })); }
    catch { console.log(JSON.stringify({ connected: false })); }
    return;
  }
  if (action === 'status') {
    const running = await controlRequest(config.stateDir, 'ping');
    const status = await readJSON(statusPath);
    const policy = await readPolicy(config.codexHome, config.pluginId);
    const restart = await readJSON(join(config.stateDir, 'restart-request.json'));
    const installation = await readJSON(join(config.stateDir, 'install.json'));
    const paused = await isPaused(config.stateDir);
    console.log(JSON.stringify({
      ...status, running, paused, policy: policy.state,
      state: running ? status?.state || 'starting' : paused ? 'paused' : status?.state || 'stopped',
      ...(restart && { restart: {
        state: restart.state === 'waiting-for-exit' && Date.parse(restart.expiresAt) <= Date.now() ? 'expired' : restart.state,
        expiresAt: restart.expiresAt
      } }),
      ...(installation?.product === 'codex-usage-lens' && {
        loginRecovery: installation.loginRecovery === true
      })
    }, null, 2));
    return;
  }
  await ensureState(config.stateDir);
  const lock = join(config.stateDir, 'starting');
  await acquireLock(lock);
  try {
    if (action === 'stop') {
      await writeFile(join(config.stateDir, 'paused'), '', { mode: 0o600 });
      const restartPath = join(config.stateDir, 'restart-request.json');
      const restart = await readJSON(restartPath);
      if (restart?.state === 'waiting-for-exit') await atomicJSON(restartPath, { ...restart, state: 'cancelled' });
      const requested = await controlRequest(config.stateDir, 'stop');
      if (requested) {
        for (let attempt = 0; attempt < 40; attempt++) {
          if (!await controlRequest(config.stateDir, 'ping')) break;
          await pause(250);
        }
        if (await controlRequest(config.stateDir, 'ping')) throw new Error('Helper is still stopping. Check status before restarting.');
      }
      console.log(requested ? 'Codex Usage Lens paused and stopped.' : 'Codex Usage Lens is paused.');
      return;
    }
    const policy = await readPolicy(config.codexHome, config.pluginId);
    if (!policy.enabled) {
      await controlRequest(config.stateDir, 'stop');
      console.log(JSON.stringify({ product: 'codex-usage-lens', state: policy.state, running: false }, null, 2));
      return;
    }
    if (action === 'start') {
      await unlink(join(config.stateDir, 'paused')).catch(error => { if (error.code !== 'ENOENT') throw error; });
    } else if (await isPaused(config.stateDir)) {
      console.log(JSON.stringify({ product: 'codex-usage-lens', running: false, state: 'paused' }));
      return;
    }
    const packageInfo = await readJSON(new URL('../package.json', import.meta.url));
    const control = await readJSON(join(config.stateDir, 'control.json'));
    if (action === 'resume' && control?.version === packageInfo.version
      && control.codexHome === config.codexHome && control.debugPort === (config.port || null)
      && await controlRequest(config.stateDir, 'ping')) {
      console.log(JSON.stringify({ product: 'codex-usage-lens', running: true, state: 'already-running' }));
      return;
    }
    if (await controlRequest(config.stateDir, 'ping')) {
      await controlRequest(config.stateDir, 'stop');
      for (let attempt = 0; attempt < 40; attempt++) {
        if (!await controlRequest(config.stateDir, 'ping')) break;
        await pause(250);
      }
      if (await controlRequest(config.stateDir, 'ping')) throw new Error('Previous helper has not stopped.');
    }
    const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url));
    const log = await open(join(config.stateDir, 'helper.log'), 'w', 0o600);
    const child = spawn(process.execPath, [worker, ...args], {
      detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd]
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    await log.close();
    for (let attempt = 0; attempt < 24; attempt++) {
      const status = await readJSON(statusPath);
      if (status?.pid === child.pid && status.state !== 'starting') {
        console.log(JSON.stringify(status, null, 2));
        return;
      }
      await pause(250);
    }
    if (!await controlRequest(config.stateDir, 'ping')) throw new Error('Helper did not start. Check the local helper.log.');
    console.log('Codex Usage Lens started; waiting for the first connection.');
  } finally { await rmdir(lock).catch(() => {}); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
