import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UsageSession, mergeSnapshots, counters } from '../src/usage.mjs';

export const sessionId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
export const event = (type, payload = {}, timestamp = '2026-10-14T01:00:00Z') =>
  ({ type: 'event_msg', timestamp, payload: { type, ...payload } });
export const raw = (input, output, cached = 0, reasoning = 0) => ({
  input_tokens: input, output_tokens: output, cached_input_tokens: cached,
  reasoning_output_tokens: reasoning, total_tokens: input + output
});
export const usage = (total, last = total, timestamp) =>
  event('token_count', { info: { total_token_usage: total, last_token_usage: last, model_context_window: 1000 } }, timestamp);
const message = id => ({ type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final', id } });
const session = () => {
  const result = new UsageSession();
  result.consume({ type: 'session_meta', payload: { id: sessionId, model_provider: 'example' } });
  return result;
};

test('one user turn sums multiple calls and does not add subset counters twice', () => {
  const state = session();
  state.consume(event('task_started', { turn_id: 'turn-1' }));
  state.consume({ type: 'turn_context', payload: { model: 'example-model' } });
  state.consume(usage(raw(100, 10, 60, 4)));
  state.consume(usage(raw(240, 30, 140, 12), raw(140, 20, 80, 8)));
  state.consume(message('msg-1'));
  state.consume(event('task_complete', { turn_id: 'turn-1' }));
  assert.deepEqual(state.current.usage, { input: 240, output: 30, cached: 140, reasoning: 12, total: 270 });
  assert.equal(state.current.calls, 2);
  assert.equal(state.current.model, 'example-model');
  assert.deepEqual(state.current.messages, ['msg-1']);
  assert.equal(state.current.complete, true);
  assert.equal(state.context, 140);
});

test('next turn is a cumulative difference, and rate-limit duplicate events do not add usage', () => {
  const state = session();
  state.consume(event('task_started', { turn_id: 'turn-1' }));
  state.consume(usage(raw(100, 10)));
  state.consume(event('task_complete', { turn_id: 'turn-1' }));
  state.consume(event('task_started', { turn_id: 'turn-2' }));
  state.consume(usage(raw(230, 25), raw(130, 15)));
  state.consume(usage(raw(230, 25), raw(130, 15)));
  assert.equal(state.current.usage.total, 145);
  assert.equal(state.current.calls, 1);
  assert.equal(state.total.total, 255);
});

test('first resumed cumulative record preserves session total and marks incomplete round', () => {
  const state = session();
  state.consume(event('task_started', { turn_id: 'turn-9' }));
  state.consume(usage(raw(10000, 1000), raw(100, 10)));
  assert.equal(state.total.total, 11000);
  assert.equal(state.current.usage.total, 110);
  assert.equal(state.current.partial, true);
});

test('counter reset creates a new epoch without negative usage', () => {
  const state = session();
  state.consume(event('task_started', { turn_id: 'turn-1' }));
  state.consume(usage(raw(100, 10)));
  state.consume(usage(raw(20, 3)));
  state.consume(usage(raw(45, 8), raw(25, 5)));
  assert.equal(state.total.total, 163);
  assert.equal(state.current.usage.total, 163);
});

test('missing records do not invent a last-call count or create buttons', () => {
  const state = session();
  state.consume(event('task_started', { turn_id: 'turn-1' }));
  state.consume(event('token_count', { info: { total_token_usage: raw(100, 10) } }));
  state.consume(message('msg-1'));
  assert.equal(state.total.total, 110);
  assert.equal(state.current.usage.total, 0);
  assert.equal(state.current.partial, true);
});

test('invalid total and rate-limit-only records do not reset a valid session', () => {
  const state = session();
  state.consume(usage(raw(100, 10)));
  state.consume(event('token_count', { info: { total_token_usage: {} } }));
  state.consume(event('token_count', { info: null }));
  assert.equal(state.total.total, 110);
});

test('aborted turn stays distinct and partial assistant progress has no final message binding', () => {
  const state = session();
  state.consume(event('task_started', { turn_id: 'turn-1' }));
  state.consume(usage(raw(100, 10)));
  state.consume({ type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'commentary', id: 'progress' } });
  state.consume(event('turn_aborted', { turn_id: 'turn-1' }));
  assert.equal(state.current.complete, false);
  assert.ok(state.current.endedAt);
  assert.deepEqual(state.current.messages, []);
});

test('desktop final_answer phase binds to the exact response annotation ID', () => {
  const state = session();
  state.consume(event('task_started', { turn_id: 'turn-1' }));
  state.consume({ type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', id: 'desktop-message' } });
  assert.deepEqual(state.current.messages, ['desktop-message']);
});

test('resumed rollouts merge historical turns without adding duplicate lifetime totals', () => {
  const first = session();
  first.consume(event('task_started', { turn_id: 'turn-1' }));
  first.consume(usage(raw(100, 10), undefined, '2026-10-14T01:00:00Z'));
  first.consume(message('msg-1'));
  const later = session();
  later.consume(event('task_started', { turn_id: 'turn-2' }));
  later.consume(usage(raw(230, 25), raw(130, 15), '2026-10-14T02:00:00Z'));
  later.consume(message('msg-2'));
  const merged = mergeSnapshots([later.snapshot(), first.snapshot()]);
  assert.equal(merged.total.total, 255);
  assert.equal(merged.turns.length, 2);
});

test('complete historical turn takes precedence over partial replay', () => {
  const base = { id: sessionId, usageAt: '2026-10-14', total: { total: 400 } };
  const good = { id: 'same', usage: { total: 100 }, partial: false };
  const replay = { id: 'same', usage: { total: 400 }, partial: true };
  assert.equal(mergeSnapshots([{ ...base, turns: [good] }, { ...base, turns: [replay] }]).turns[0], good);
});

test('unsafe or negative numeric counters are never rendered as usage', () => {
  assert.equal(counters({ input_tokens: -1, total_tokens: 2 ** 54 }).input, 0);
  assert.equal(counters({ total_tokens: 2 ** 54 }).total, 0);
});
