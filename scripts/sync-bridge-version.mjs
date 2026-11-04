// npm `version` lifecycle hook: keeps the bridge manifest in sync with
// the app version npm just bumped, so the published scatterboard-mcp
// package can never drift. Runs after the bump, before the commit.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

const write = (rel, mutate) => {
  const file = join(root, rel);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  mutate(json);
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
};

write(join('bridge', 'package.json'), (j) => {
  j.version = version;
});
write(join('bridge', 'package-lock.json'), (j) => {
  j.version = version;
  if (j.packages?.[''] && typeof j.packages[''] === 'object') j.packages[''].version = version;
});
// Stage the edits so npm's version commit includes them; a failure here
// (no git, unclean tree) must not abort the version bump.
spawnSync('git', ['add', 'bridge/package.json', 'bridge/package-lock.json'], { cwd: root });
console.log(`synced bridge manifests to ${version}`);
