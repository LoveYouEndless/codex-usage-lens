import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LogTail, SessionStore, threadId } from '../src/logs.mjs';

const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const metadata = { type: 'session_meta', payload: { id } };
const count = total => ({
  type: 'event_msg', payload: { type: 'token_count', info: {
    total_token_usage: { input_tokens: total, output_tokens: 0, total_tokens: total },
    last_token_usage: { input_tokens: total, output_tokens: 0, total_tokens: total }
  } }
});
const line = value => `${JSON.stringify(value)}\n`;

test('incremental tail survives split UTF-8 and incomplete JSON without double counting', async () => {
  const path = await mkdtemp(join(tmpdir(), 'usage-lens-'));
  try {
    const file = join(path, 'session.jsonl');
    await writeFile(file, line(metadata));
    const tail = new LogTail(file);
    await tail.update();
    const buffer = Buffer.from(line({ type: 'session_meta', payload: { id, model_provider: '\u6d4b\u8bd5' } }) + line(count(100)));
    const split = buffer.indexOf(Buffer.from('\u6d4b')) + 1;
    await appendFile(file, buffer.subarray(0, split));
    assert.equal((await tail.update()).total.total, 0);
    await appendFile(file, buffer.subarray(split));
    assert.equal((await tail.update()).total.total, 100);
    assert.equal((await tail.update()).total.total, 100);
    assert.equal(tail.session.provider, '\u6d4b\u8bd5');
  } finally { await rm(path, { recursive: true, force: true }); }
});

test('truncated/replaced rollout resets the parser rather than retaining old usage', async () => {
  const path = await mkdtemp(join(tmpdir(), 'usage-lens-'));
  try {
    const file = join(path, 'session.jsonl');
    await writeFile(file, line(metadata) + line(count(100)));
    const tail = new LogTail(file);
    await tail.update();
    await writeFile(file, line(metadata));
    assert.equal((await tail.update()).total.total, 0);
  } finally { await rm(path, { recursive: true, force: true }); }
});

test('session store rejects mismatched metadata even when filename contains the requested ID', async () => {
  const path = await mkdtemp(join(tmpdir(), 'usage-lens-'));
  try {
    await mkdir(join(path, 'sessions'));
    await writeFile(join(path, 'sessions', `rollout-${id}.jsonl`),
      line({ type: 'session_meta', payload: { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' } }) + line(count(100)));
    const store = new SessionStore(path);
    assert.equal(await store.get(id), null);
    assert.equal(await store.get('../../credentials'), null);
  } finally { await rm(path, { recursive: true, force: true }); }
});

test('valid thread ID aliases are normalized and opaque remote IDs are not guessed', () => {
  assert.equal(threadId(`local:${id}`), id);
  assert.equal(threadId('client-new-thread:123'), null);
  assert.equal(threadId(null), null);
});

test('oversized malformed line is skipped without swallowing the next usage event', () => {
  const tail = new LogTail('unused');
  tail.feed(Buffer.alloc(9 * 1024 * 1024, 65));
  tail.feed(Buffer.from('\n' + line(metadata) + line(count(40))));
  assert.equal(tail.session.total.total, 40);
  assert.equal(tail.pending.length, 0);
});
