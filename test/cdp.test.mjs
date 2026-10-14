import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CDP, targets } from '../src/cdp.mjs';
import { options } from '../src/state.mjs';

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
