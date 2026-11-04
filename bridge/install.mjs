// Registers the `scatterboard` MCP server into the config locations
// MCP clients actually read. Shared by `npx scatterboard-mcp install`
// (any directory) and `npm run agent:setup` (repo dev, --local).
//
// Targets (all the standard {mcpServers} shape):
//   - Devin user config (%APPDATA%\devin\config.json / ~/.config/devin)
//   - Windsurf, Cursor, Gemini CLI, Claude Desktop/Code when installed
//   - .devin/config.local.json in cwd (standalone CLI sessions)
// Codex (TOML), Zed (context_servers) and others use different shapes;
// the README shows the manual block for them.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// JSONC-tolerant parse: strips // and /* */ outside strings, then
// trailing commas (a `,` before } or ] outside strings).
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
  let stripped = '';
  inStr = false;
  esc = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (inStr) {
      stripped += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; stripped += c; continue; }
    if (c === ',') {
      let j = i + 1;
      while (j < out.length && /\s/.test(out[j])) j++;
      if (out[j] === '}' || out[j] === ']') continue;
    }
    stripped += c;
  }
  return JSON.parse(stripped);
}

export function installMcp({ local = false, cwd = process.cwd(), log = console.log } = {}) {
  const entry = local
    ? { command: 'node', args: [join(here, 'agent.mjs').replaceAll('\\', '/')] }
    : platform() === 'win32'
      ? // Bare `npx` does not spawn on Windows; go through cmd.
        { command: 'cmd', args: ['/c', 'npx', '-y', 'scatterboard-mcp'] }
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
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
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

  // Other hosts sharing the {mcpServers} shape get the same entry when
  // their install dir exists (Windsurf may lack mcp_config.json yet,
  // Claude Code keeps user-scope servers in ~/.claude.json).
  const home = homedir();
  const appData = process.env.APPDATA || join(home, 'AppData', 'Roaming');
  const hostDirs = [
    [join(home, '.codeium', 'windsurf'), 'mcp_config.json'],
    [join(home, '.cursor'), 'mcp.json'],
    [join(home, '.gemini'), 'settings.json'],
    [
      platform() === 'win32'
        ? join(appData, 'Claude')
        : platform() === 'darwin'
          ? join(home, 'Library', 'Application Support', 'Claude')
          : join(home, '.config', 'Claude'),
      'claude_desktop_config.json',
    ],
  ];
  for (const [dir, file] of hostDirs) if (existsSync(dir)) register(join(dir, file));
  const claudeJson = join(home, '.claude.json');
  if (existsSync(claudeJson)) register(claudeJson);

  // Project-local Devin config only where a project actually lives.
  if (existsSync(join(cwd, '.devin')) || existsSync(join(cwd, 'package.json'))) {
    register(join(cwd, '.devin', 'config.local.json'));
  }

  log('\ndone. The sb_* tools appear in Devin sessions immediately (config is re-read per call);');
  log('other MCP clients may need a restart to pick up the new server.');
  log('Then: sb_status prints the pairing URL, sb_open pairs a browser tab.');
}
