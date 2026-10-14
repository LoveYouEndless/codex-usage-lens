import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const packageInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const accountIndex = process.argv.indexOf('--account');
const account = accountIndex >= 0 ? process.argv[accountIndex + 1] : null;
if (account && !/^[a-zA-Z0-9-]+$/.test(account)) throw new Error('Invalid GitHub account name.');
const credentials = spawnSync('git', ['credential-manager', 'get'], {
  input: `protocol=https\nhost=github.com\n${account ? `username=${account}\n` : ''}\n`, encoding: 'utf8',
  env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
  windowsHide: true
});
if (credentials.status !== 0) {
  throw new Error('No usable GitHub credential. Sign in to Git Credential Manager or GitHub CLI first.');
}
const values = Object.fromEntries(credentials.stdout.trim().split('\n').map(line => {
  const split = line.indexOf('=');
  return [line.slice(0, split), line.slice(split + 1)];
}));
if (!values.password) throw new Error('No GitHub token available.');
async function request(path, method = 'GET', body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method, signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${values.password}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'codex-usage-lens-publisher',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${result.message}`);
  return result;
}
const user = await request('/user');
console.log(JSON.stringify({ login: user.login }));
if (process.argv.includes('--create')) {
  const repo = await request('/user/repos', 'POST', {
    name: 'codex-usage-lens', private: false,
    description: 'Local per-turn token usage buttons for Codex Desktop. Independent, open source, zero runtime dependencies.',
    auto_init: false, has_wiki: false
  });
  console.log(JSON.stringify({ url: repo.html_url, remote: repo.clone_url }));
}
if (process.argv.includes('--release')) {
  const notesIndex = process.argv.indexOf('--notes');
  if (notesIndex < 0 || !process.argv[notesIndex + 1]) throw new Error('Release notes file is required: --notes PATH.');
  const notes = await readFile(process.argv[notesIndex + 1], 'utf8');
  const release = await request(`/repos/${user.login}/codex-usage-lens/releases`, 'POST', {
    tag_name: `v${packageInfo.version}`, name: `Codex Usage Lens v${packageInfo.version}`, body: notes
  });
  console.log(JSON.stringify({ release: release.html_url }));
}
