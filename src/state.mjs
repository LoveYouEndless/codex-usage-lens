import { mkdir, readFile, writeFile, rename, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';

export const defaultHome = () => process.env.CODEX_HOME || join(homedir(), '.codex');
export const defaultState = () => process.platform === 'win32'
  ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'CodexUsageLens')
  : join(defaultHome(), 'usage-lens');

export function options(args) {
  const value = key => {
    const index = args.indexOf(key);
    if (index < 0) return undefined;
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${key}.`);
    return args[index + 1];
  };
  const portValue = value('--port');
  const port = portValue === undefined ? undefined : Number(portValue);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Invalid port.');
  const allowed = new Set(['--port', '--state-dir', '--codex-home', '--plugin-id']);
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index])) throw new Error(`Unknown option: ${args[index]}`);
    value(args[index]);
  }
  return {
    port, stateDir: resolve(value('--state-dir') || defaultState()),
    codexHome: resolve(value('--codex-home') || defaultHome()),
    pluginId: value('--plugin-id')
  };
}

export async function readJSON(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function atomicJSON(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, path);
}

export async function ensureState(directory) { await mkdir(directory, { recursive: true, mode: 0o700 }); }

export async function isPaused(directory) {
  try { await access(join(directory, 'paused')); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export async function controlRequest(directory, route) {
  const control = await readJSON(join(directory, 'control.json'));
  if (!control || !Number.isInteger(control.port) || !/^[a-f0-9]{64}$/.test(control.token)) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${control.port}/${route}`, {
      method: route === 'stop' ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${control.token}` },
      signal: AbortSignal.timeout(2000), redirect: 'error'
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result.product === 'codex-usage-lens' && result.pid === control.pid;
  } catch { return false; }
}
