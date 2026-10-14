import { readdir, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { UsageSession, mergeSnapshots } from './usage.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function threadId(value) {
  if (typeof value !== 'string') return null;
  const id = value.replace(/^local:/, '');
  return uuid.test(id) ? id : null;
}

export class LogTail {
  constructor(path) {
    this.path = path;
    this.position = 0;
    this.pending = Buffer.alloc(0);
    this.session = new UsageSession();
    this.identity = null;
    this.modified = 0;
    this.discarding = false;
  }

  async update() {
    const handle = await open(this.path, 'r');
    try {
      const info = await handle.stat();
      const identity = `${info.dev}:${info.ino}:${info.birthtimeMs}`;
      if ((this.identity && identity !== this.identity) || info.size < this.position) {
        this.position = 0;
        this.pending = Buffer.alloc(0);
        this.session = new UsageSession();
        this.discarding = false;
      }
      this.identity = identity;
      this.modified = info.mtimeMs;
      const chunk = Buffer.alloc(256 * 1024);
      while (this.position < info.size) {
        const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, info.size - this.position), this.position);
        if (!bytesRead) break;
        this.position += bytesRead;
        this.feed(chunk.subarray(0, bytesRead));
      }
      return this.session.snapshot();
    } finally { await handle.close(); }
  }

  feed(chunk) {
    let data = Buffer.concat([this.pending, chunk]);
    this.pending = Buffer.alloc(0);
    let offset = 0;
    if (this.discarding) {
      const end = data.indexOf(10);
      if (end < 0) return;
      offset = end + 1;
      this.discarding = false;
    }
    for (;;) {
      const end = data.indexOf(10, offset);
      if (end < 0) break;
      const line = data.subarray(offset, end);
      if (line.length <= 8 * 1024 * 1024) {
        try { this.session.consume(JSON.parse(line.toString('utf8'))); } catch { /* Ignore malformed records. */ }
      }
      offset = end + 1;
    }
    const remainder = data.subarray(offset);
    if (remainder.length > 8 * 1024 * 1024) this.discarding = true;
    else this.pending = Buffer.from(remainder);
  }
}

async function scan(root, paths, depth = 0) {
  if (depth > 5) return;
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch (error) {
    if (['ENOENT', 'EACCES'].includes(error.code)) return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) await scan(path, paths, depth + 1);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) paths.push(path);
  }
}

export class SessionStore {
  constructor(codexHome) {
    this.roots = [join(codexHome, 'sessions'), join(codexHome, 'archived_sessions')];
    this.paths = [];
    this.scannedAt = 0;
    this.tails = new Map();
  }

  async get(value) {
    const id = threadId(value);
    if (!id) return null;
    if (Date.now() - this.scannedAt > 30000 || !this.paths.some(path => path.includes(id))) {
      const paths = [];
      for (const root of this.roots) await scan(root, paths);
      this.paths = paths;
      this.scannedAt = Date.now();
    }
    const candidates = [];
    for (const path of this.paths.filter(path => path.includes(id))) {
      try { candidates.push({ path, modified: (await stat(path)).mtimeMs }); } catch { /* Rollout may have moved. */ }
    }
    candidates.sort((a, b) => b.modified - a.modified);
    const snapshots = [];
    for (const { path } of candidates) {
      let tail = this.tails.get(path);
      if (!tail) { tail = new LogTail(path); this.tails.set(path, tail); }
      try {
        const snapshot = await tail.update();
        if (snapshot.id === id) snapshots.push(snapshot);
      } catch (error) {
        if (!['ENOENT', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      }
    }
    // Keep the active rollout cache bounded without dropping its turn history.
    for (const path of this.tails.keys()) if (!path.includes(id)) this.tails.delete(path);
    return mergeSnapshots(snapshots);
  }
}
