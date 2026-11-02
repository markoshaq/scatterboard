# Scatterboard

A local-first, infinite-canvas planning board. MIT licensed. No accounts,
no servers: everything lives in your browser.

## Develop

```
npm install
npm run dev
```

Open `http://localhost:5173/#/b/home` for the empty home board or
`http://localhost:5173/#/b/test` for the seeded test board (60 notes,
for pan/zoom and selection testing).

## Build

```
npm run build
```

Produces a static `dist/` deployable as-is (GitHub Pages or any static
host). `base` is `./` relative by default; override with
`SCATTERBOARD_BASE=/some/path/` (the legacy `PLANBOARD_BASE` is
still read).

## Test and lint

```
npm test            # vitest suite in test/
npm run typecheck   # tsc --noEmit
npm run lint        # biome
```

## Browsers

Needs a recent Chrome/Edge (108+), Firefox (111+) or Safari (16.4+):
persistence uses SQLite WASM on the OPFS sync-access-handle pool, with
localStorage as fallback. Node 22 is the pinned dev toolchain
(`>=20.19` required by Vite).

## Controls

- Pan: Space + drag, middle-mouse drag, or trackpad scroll.
- Zoom: Cmd + wheel, trackpad pinch, Cmd + = / - / 0, `Z` to fit.
- New note: double-click empty canvas, Cmd + Return chains another.
- Edit: click a selected note (or double-click it). Esc stops editing,
  Esc again deselects.
- Select: click, Shift + click, marquee drag, Cmd + A.
- Move: drag with snap-to-card and snap-to-grid guides. Arrow keys nudge.
- Delete: Delete or Backspace. Duplicate: Cmd + D.
- Undo / redo: Cmd + Z / Cmd + Shift + Z.
- Right-click the background toggles the dot grid for the board.

## Stack

TypeScript + Vite, no framework. Canvas2D for the grid, marquee, and
selection chrome; DOM for cards and text editing. Persistence is
SQLite WASM in OPFS behind `persist/storage.ts`, with a localStorage
adapter as migration source and fallback. Media blobs live in
IndexedDB. Desktop-first: built for mouse, trackpad, and keyboard;
touch and small screens are not a design goal yet.

## Privacy

Everything stays on your device by default. Two optional features talk
to the network, and only when you use them:

- "Enrich link cards" (off by default, under Settings > Online extras)
  fetches link previews through the public `api.allorigins.win` CORS
  proxy, which sees the URL you pasted.
- Embed cards (YouTube, Vimeo, Spotify, SoundCloud, Google Maps) load
  the provider's iframe when you add one.

## License

MIT, see LICENSE. Vendored third-party components are listed in
NOTICE.md. Scatterboard is an original work and is not affiliated with
any commercial product.
