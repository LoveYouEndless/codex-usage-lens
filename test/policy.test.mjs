import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from '../vendor/toml.mjs';
import { readPolicy, pluginPolicy, defaultPluginId } from '../src/policy.mjs';

test('plugin policy handles standard tables, inline tables, comments, and unrelated settings', () => {
  const document = parse(`
    [model_providers.example]
    enabled = false
    [plugins."${defaultPluginId}"]
    enabled = true # real plugin switch
    [plugins."other@example"]
    enabled = false
  `);
  assert.equal(pluginPolicy(document).enabled, true);
  assert.equal(pluginPolicy(parse(`[plugins]\n"${defaultPluginId}" = { enabled = false }`)).state, 'disabled');
});

test('alternate marketplace names work only when they are unambiguous or explicitly selected', () => {
  assert.equal(pluginPolicy({ plugins: { 'codex-usage-lens@team': { enabled: true } } }).pluginId,
    'codex-usage-lens@team');
  const document = { plugins: { 'codex-usage-lens@a': { enabled: true }, 'codex-usage-lens@b': { enabled: false } } };
  assert.equal(pluginPolicy(document).state, 'ambiguous-plugin');
  assert.equal(pluginPolicy(document, 'codex-usage-lens@b').state, 'disabled');
});

test('uninstalled and incorrectly typed switches disable collection', () => {
  assert.equal(pluginPolicy({}).state, 'uninstalled');
  assert.equal(pluginPolicy({ plugins: { [defaultPluginId]: { enabled: 'true' } } }).enabled, false);
});

test('TOML edit failures pause collection without exposing private settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lens-policy-'));
  try {
    assert.equal((await readPolicy(root)).state, 'uninstalled');
    await writeFile(join(root, 'config.toml'), 'secret="private-token"\ninvalid=[\n');
    const policy = await readPolicy(root);
    assert.equal(policy.state, 'config-unavailable');
    assert.ok(!JSON.stringify(policy).includes('private-token'));
    await writeFile(join(root, 'config.toml'), `\uFEFF[plugins."${defaultPluginId}"]\nenabled=true`);
    assert.equal((await readPolicy(root)).enabled, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
