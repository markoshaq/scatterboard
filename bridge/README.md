# scatterboard-mcp

Localhost bridge + MCP stdio server for [Scatterboard](https://markoshaq.github.io/scatterboard/), a local-first infinite-canvas planning board.

The bridge listens on `ws://127.0.0.1:7341`; a paired Scatterboard tab
dials out to it, and the `sb_*` MCP tools relay commands into the live
app (boards, cards, connectors, viewport, undo, PNG snapshots).

## Install

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

Or with Devin CLI: `devin mcp add scatterboard -- npx -y scatterboard-mcp`

## Pairing

Call `sb_status` for the pairing URL, or `sb_open` to launch the app in
your browser. Once a tab is paired it reconnects automatically.

## Flags

`--port=N` (default 7341), `--app=URL` (pairing target),
`--origin=URL` (extra allowed Origin, repeatable), `--token=T` (fixed
pairing token, for tests).

Requires node >= 20. MIT.
