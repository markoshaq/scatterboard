// Post-build bundle gate: every emitted JS chunk must stay under the
// gzip budget so the entry graph cannot silently bloat.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 150 * 1024;
const dir = fileURLToPath(new URL('../dist/assets', import.meta.url));

if (!existsSync(dir)) {
  console.error(`${dir} is missing: run npm run build first`);
  process.exit(1);
}

const files = readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
if (files.length === 0) {
  console.error(`${dir} has no .js chunks: run npm run build first`);
  process.exit(1);
}

let worst = 0;
let worstFile = '';
for (const f of files) {
  const size = gzipSync(readFileSync(join(dir, f))).length;
  console.log(`${(size / 1024).toFixed(1).padStart(7)} KB  ${f}`);
  if (size > worst) {
    worst = size;
    worstFile = f;
  }
}
if (worst > LIMIT) {
  console.error(`\n${worstFile} is ${(worst / 1024).toFixed(1)} KB gzip, over the 150 KB budget`);
  process.exit(1);
}
console.log(`\nLargest JS chunk ${(worst / 1024).toFixed(1)} KB gzip (limit 150 KB)`);
