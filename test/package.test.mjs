import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('marketplace resolves to the actual installable plugin and skill', async () => {
  const marketplace = JSON.parse(await readFile(new URL('../.agents/plugins/marketplace.json', import.meta.url), 'utf8'));
  const source = marketplace.plugins[0].source;
  assert.equal(source.source, 'local');
  assert.ok(source.path.startsWith('./'));
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)), source.path);
  const manifest = JSON.parse(await readFile(join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, marketplace.plugins[0].name);
  assert.equal(manifest.license, 'MIT');
  assert.ok((await stat(join(root, manifest.skills, 'usage-lens', 'SKILL.md'))).isFile());
  const hooks = JSON.parse(await readFile(join(root, manifest.hooks), 'utf8'));
  assert.deepEqual(Object.keys(hooks.hooks), ['SessionStart', 'UserPromptSubmit']);
  for (const groups of Object.values(hooks.hooks)) {
    assert.equal(groups.length, 1);
    const [handler] = groups[0].hooks;
    assert.equal(handler.type, 'command');
    assert.equal(handler.async, true);
    assert.equal(handler.command, 'true');
    assert.match(handler.commandWindows, /-File "\$\{PLUGIN_ROOT\}\/scripts\/hook-windows\.ps1"/);
    assert.ok(handler.timeout >= 30);
  }
  assert.ok((await stat(join(root, 'scripts', 'hook-windows.ps1'))).isFile());
});
