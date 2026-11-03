// Registers the `scatterboard` MCP server into the config locations
// MCP clients actually read. Shared by `npx scatterboard-mcp install`
// (any directory) and `npm run agent:setup` (repo dev, --local).
//
// Targets:
//   - Devin user config (%APPDATA%\devin\config.json / ~/.config/devin)
//   - Windsurf mcp_config.json (what the IDE host lists via ACP)
//   - .devin/config.local.json in cwd (standalone CLI sessions)
// User scope is required: IDE-embedded Devin ignores project mcpServers.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

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

export function installMcp({ local = false, cwd = process.cwd(), log = console.log } = {}) {
  const entry = local
    ? { command: 'node', args: [join(here, 'agent.mjs').replaceAll('\\', '/')] }
    : { command: 'npx', args: ['-y', 'scatterboard-mcp'] };

  const register = (file) => {
    let cfg = {};
    if (existsSync(file)) {
      try {
        cfg = parseJsonc(readFileSync(file, 'utf8'));
      } catch {
        log(`  skip ${file} (unparseable; edit it by hand)`);
        return;
      }
    }
    if (!cfg.mcpServers || typeof cfg.mcpServers !== 'object') cfg.mcpServers = {};
    const cur = cfg.mcpServers.scatterboard;
    if (cur && cur.command === entry.command && JSON.stringify(cur.args) === JSON.stringify(entry.args)) {
      log(`  ok   ${file} (already registered)`);
      return;
    }
    cfg.mcpServers.scatterboard = entry;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
    log(`  wrote ${file}`);
  };

  const devinDir =
    platform() === 'win32'
      ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'devin')
      : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'devin');

  log('registering scatterboard MCP server:');
  register(join(devinDir, 'config.json'));
  register(join(devinDir, 'mcp_config.json'));
  const windsurfCfg = join(homedir(), '.codeium', 'windsurf', 'mcp_config.json');
  if (existsSync(windsurfCfg)) register(windsurfCfg);
  register(join(cwd, '.devin', 'config.local.json'));

  log('\ndone. The sb_* tools appear in Devin sessions immediately (config is re-read per call).');
  log('Then: sb_status prints the pairing URL, sb_open pairs a browser tab.');
}
