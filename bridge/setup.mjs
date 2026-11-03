#!/usr/bin/env node
// Installs bridge deps and registers the `scatterboard` MCP server so
// `devin mcp` / Windsurf sessions expose the sb_* tools. Safe to re-run.
//
// Writes mcpServers.scatterboard to every config location MCP clients
// actually read in this environment:
//   - Devin user config (%APPDATA%\devin\config.json / ~/.config/devin)
//   - Windsurf mcp_config.json (what the IDE host lists via ACP)
//   - .devin/config.local.json (standalone CLI sessions; gitignored)
// Project config alone is NOT enough inside Windsurf: the embedded
// Devin only merges the user config, not project mcpServers.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bridgeDir = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(bridgeDir);
const agentPath = join(bridgeDir, 'agent.mjs').replaceAll('\\', '/');
const entry = { command: 'node', args: [agentPath] };

// JSONC-tolerant parse: strips // and /* */ outside strings.
function parseJsonc(text) {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return JSON.parse(out);
}

function register(file) {
  let cfg = {};
  if (existsSync(file)) {
    try {
      cfg = parseJsonc(readFileSync(file, 'utf8'));
    } catch {
      console.log(`  skip ${file} (unparseable; edit it by hand)`);
      return;
    }
  }
  if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') cfg.mcpServers = {};
  const cur = cfg.mcpServers.scatterboard;
  if (cur && cur.command === entry.command && JSON.stringify(cur.args) === JSON.stringify(entry.args)) {
    console.log(`  ok   ${file} (already registered)`);
    return;
  }
  cfg.mcpServers.scatterboard = entry;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  console.log(`  wrote ${file}`);
}

if (!existsSync(join(bridgeDir, 'node_modules', 'ws'))) {
  console.log('installing bridge deps...');
  const npm = platform() === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: bridgeDir, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const devinDir =
  platform() === 'win32'
    ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'devin')
    : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'devin');

console.log('registering scatterboard MCP server:');
register(join(devinDir, 'config.json'));
register(join(devinDir, 'mcp_config.json'));
const windsurfCfg = join(homedir(), '.codeium', 'windsurf', 'mcp_config.json');
if (existsSync(windsurfCfg)) register(windsurfCfg);
register(join(projectDir, '.devin', 'config.local.json'));

console.log('\ndone. New sessions see the sb_* tools immediately (config is re-read per call).');
console.log('Then: sb_status prints the pairing URL, sb_open pairs a browser tab.');
