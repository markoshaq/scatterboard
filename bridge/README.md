# scatterboard-mcp

Localhost bridge + MCP stdio server for [Scatterboard](https://markoshaq.github.io/scatterboard/), a local-first infinite-canvas planning board.

The bridge listens on `ws://127.0.0.1:7341`; a paired Scatterboard tab
dials out to it, and the `sb_*` MCP tools relay commands into the live
app (boards, cards, connectors, viewport, undo, PNG snapshots).

## Install

Devin CLI (user scope — required; project scope is ignored by
IDE-embedded sessions):

```
devin mcp add -s user scatterboard -- npx -y scatterboard-mcp
```

Or add this to `mcpServers` in the user config
(`%APPDATA%\devin\config.json` on Windows, `~/.config/devin/config.json`
elsewhere) or Windsurf's `mcp_config.json`:

```json
{
  "mcpServers": {
    "scatterboard": {
      "command": "npx",
      "args": ["-y", "scatterboard-mcp"]
    }
  }
}
```

No restart needed; the `sb_*` tools appear in the current session.

## Pairing

Call `sb_status` for the pairing URL, or `sb_open` to launch the app in
your browser. Once a tab is paired it reconnects automatically.

## Flags

`--port=N` (default 7341), `--app=URL` (pairing target),
`--origin=URL` (extra allowed Origin, repeatable), `--token=T` (fixed
pairing token, for tests).

Requires node >= 20. MIT.
