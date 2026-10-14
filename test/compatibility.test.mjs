import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CompatibilityGuard } from '../src/compatibility.mjs';

test('repeated renderer failures pause injection only for the affected renderer', () => {
  const guard = new CompatibilityGuard();
  guard.failed('old-renderer');
  guard.failed('old-renderer');
  assert.equal(guard.blocked('old-renderer'), false);
  guard.failed('old-renderer');
  assert.equal(guard.blocked('old-renderer'), true);
  assert.equal(guard.blocked('new-renderer'), false);
});

test('successful probes clear transient errors; unsupported schemas can be blocked immediately', () => {
  const guard = new CompatibilityGuard();
  guard.failed('renderer');
  guard.succeeded('renderer');
  guard.failed('renderer');
  assert.equal(guard.blocked('renderer'), false);
  guard.block('renderer');
  assert.equal(guard.blocked('renderer'), true);
});
