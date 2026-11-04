# scatterboard-mcp

Localhost bridge + MCP stdio server for [Scatterboard](https://markoshaq.github.io/scatterboard/), a local-first infinite-canvas planning board.

The bridge listens on `ws://127.0.0.1:7341`; a paired Scatterboard tab
dials out to it, and the `sb_*` MCP tools relay commands into the live
app (boards, cards, connectors, viewport, undo, PNG snapshots).

## Install

```
npx -y scatterboard-mcp install
```

One command, from any directory: it registers the `scatterboard`
server wherever it finds a compatible MCP host: the Devin user config,
Windsurf `mcp_config.json`, Cursor `mcp.json`, Gemini `settings.json`,
Claude Desktop `claude_desktop_config.json`, Claude Code
`~/.claude.json`, and `.devin/config.local.json` in the current
project. Any stdio-capable MCP client works; hosts the installer does
not know (Codex, Zed, Cline, ...) need the manual config below. Devin
picks the server up live; other clients may need a restart.

Equivalent manual config for `mcpServers` (user scope required —
IDE-embedded Devin ignores project `mcpServers`; user config is
`%APPDATA%\devin\config.json` on Windows, `~/.config/devin/config.json`
elsewhere):

```json
{
  "scatterboard": {
    "command": "npx",
    "args": ["-y", "scatterboard-mcp"]
  }
}
```

Or with Devin CLI: `devin mcp add -s user scatterboard -- npx -y scatterboard-mcp`

## Pairing

Call `sb_status` for the pairing URL, or `sb_open` to launch the app in
your browser. The app asks you to confirm in a centered dialog; click Connect.
Once a tab is paired it reconnects automatically. The
pairing token is one-time use (it rotates after a successful pairing);
app and agent sockets authenticate with separate keys. `sb_status`
also reports `agentKey`, the credential direct WebSocket clients need
for `{type:'hello', role:'agent', bridgeId, key}` handshakes.

## Flags

`--port=N` (default 7341), `--app=URL` (pairing target),
`--origin=URL` (extra allowed Origin, repeatable), `--token=T` (fixed
pairing token, for tests).

Requires node >= 20. MIT.
