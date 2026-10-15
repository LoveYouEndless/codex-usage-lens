import { join } from 'node:path';
import { homedir } from 'node:os';
import { readJSON, defaultState } from './state.mjs';

const acceptedPorts = [9229, 9222, 9230, 9223];

export async function targets(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid debug port.');
  const response = await fetch(`http://127.0.0.1:${port}/json`, {
    signal: AbortSignal.timeout(1500),
    redirect: 'error'
  });
  if (!response.ok) throw new Error(`Debug endpoint returned ${response.status}.`);
  const value = await response.json();
  if (!Array.isArray(value)) throw new Error('Invalid debug target list.');
  return value.filter(item => item.type === 'page' && /^app:\/\//.test(item.url || '')
    && !/avatar-overlay|initialRoute=/i.test(item.url || ''));
}

export async function discover(port, stateDir = defaultState()) {
  let candidates = [port];
  if (port === undefined) {
    const plusRoot = process.env.CODEX_PLUS_STATE_DIR || join(homedir(), '.codex-session-delete');
    const plus = await readJSON(join(plusRoot, 'latest-status.json')).catch(() => null);
    const installation = await readJSON(join(stateDir, 'install.json')).catch(() => null);
    candidates = [plus?.debug_port,
      installation?.product === 'codex-usage-lens' ? installation.port : null, ...acceptedPorts];
  }
  for (const candidate of new Set(candidates.filter(value => Number.isInteger(value) && value >= 1 && value <= 65535))) {
    try {
      const pages = await targets(candidate);
      const page = pages.find(item => /^app:\/\/(?:-|codex)\/index\.html(?:[?#]|$)/.test(item.url || ''));
      if (page?.webSocketDebuggerUrl) return { port: candidate, page };
    } catch { /* 客户端未运行时端口关闭属于正常情况。 */ }
  }
  throw new Error('No Codex desktop debug connection. Launch Codex with a loopback debugging port first.');
}

export class CDP {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      const waiting = this.pending.get(message.id);
      if (!waiting) return;
      clearTimeout(waiting.timer);
      this.pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result);
    });
    socket.addEventListener('close', () => this.fail(new Error('Codex renderer disconnected.')));
    socket.addEventListener('error', () => this.fail(new Error('Codex debug connection failed.')));
  }

  static async connect(address) {
    const url = new URL(address);
    if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error('Only loopback debug WebSockets are accepted.');
    }
    const socket = new WebSocket(address);
    const client = new CDP(socket);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('Debug connection timed out.')); }, 3000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Cannot connect to renderer.')); }, { once: true });
    });
    return client;
  }

  fail(error) {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
  }

  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (this.socket.readyState !== WebSocket.OPEN) return reject(new Error('Debug connection is closed.'));
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out: ${method}`));
      }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async evaluate(expression) {
    const reply = await this.call('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true
    });
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.text || 'Injected script failed.');
    return reply.result?.value;
  }

  close() { this.fail(new Error('Connection closed.')); this.socket.close(); }
}
