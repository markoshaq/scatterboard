#!/usr/bin/env node
// Repo-dev setup: install bridge deps, then register the MCP server
// against the checked-out agent.mjs (--local). Consumers do not need
// this script; `npx -y scatterboard-mcp install` does everything.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { installMcp } from './install.mjs';

const bridgeDir = dirname(fileURLToPath(import.meta.url));

if (!existsSync(join(bridgeDir, 'node_modules', 'ws'))) {
  console.log('installing bridge deps...');
  const npm = platform() === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: bridgeDir, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

installMcp({ local: true });
