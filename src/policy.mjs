import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from '../vendor/toml.mjs';

export const defaultPluginId = 'codex-usage-lens@codex-usage-lens';

export function pluginPolicy(document, requestedId) {
  const plugins = document?.plugins;
  if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) return { state: 'uninstalled', enabled: false };
  let id = requestedId;
  if (!id) {
    const matches = Object.keys(plugins).filter(key => key.startsWith('codex-usage-lens@'));
    if (matches.includes(defaultPluginId)) id = defaultPluginId;
    else if (matches.length === 1) id = matches[0];
    else if (matches.length > 1) return { state: 'ambiguous-plugin', enabled: false };
  }
  if (!id || !Object.hasOwn(plugins, id)) return { state: 'uninstalled', enabled: false, pluginId: id };
  const entry = plugins[id];
  if (!entry || typeof entry !== 'object' || typeof entry.enabled !== 'boolean') {
    return { state: 'invalid-plugin-config', enabled: false, pluginId: id };
  }
  return { state: entry.enabled ? 'enabled' : 'disabled', enabled: entry.enabled, pluginId: id };
}

export async function readPolicy(codexHome, requestedId) {
  try {
    const source = await readFile(join(codexHome, 'config.toml'), 'utf8');
    return pluginPolicy(parse(source.replace(/^\uFEFF/, '')), requestedId);
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'uninstalled', enabled: false, pluginId: requestedId };
    // Config edits can be transient. Do not inject while its policy is unknown,
    // and never expose the TOML parser error (which can quote private settings).
    return { state: 'config-unavailable', enabled: false, pluginId: requestedId };
  }
}
