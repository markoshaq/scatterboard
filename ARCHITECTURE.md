# Scatterboard architecture proposal

Status: original design proposal, kept for context. The shipped code
differs in places (folder layout, stroke rendering, input patterns).
AGENTS.md documents the current structure.

Constraints: local-first, single user, extremely fast and lightweight.
No framework lock-in, minimal dependencies, instant cold start.

## Stack

- **Language/tooling**: TypeScript + Vite (dev server + bundler, near-zero
  config). No React/Vue/Svelte: the app is a scene graph, not a form
  tree; vanilla TS with a ~100-line DOM helper is enough and keeps the
  bundle in the tens of KB.
- **Rendering, two layers**:
  1. Canvas2D layer: dot grid, lines/connectors, marquee rectangle,
     selection outlines, draw-mode strokes. One `<canvas>` covering the
     viewport; redraw on pan/zoom/dirty. Cheap: grid is a cached tile
     pattern, lines are stroked paths.
  2. DOM layer: card elements absolutely positioned in a transformed
     container (the standard split for DOM-card canvas apps). DOM gives
     text editing (contenteditable),
     selection, accessibility and layout for free. Virtualise: only
     cards intersecting the viewport (plus margin) are mounted; the DOM
     holds the visible set, the model holds everything.
- **State**: plain object graph (boards/elements/comments/labels per the
  schema in `src/state/schema.ts`) + a tiny event emitter. Mutations are typed
  action objects `{type, payload}` applied to state, appended to an
  undo stack, and queued for persistence, so undo/redo and future sync
  share one code path.
- **Persistence**: SQLite compiled to WASM (official sqlite3.wasm) in
  OPFS. Elements as rows; a `board_file` table per board. ACID,
  crash-safe, ~500KB wasm loaded once. Alternative considered: raw
  IndexedDB (no wasm, slightly less code, weaker querying); SQLite
  wins on integrity and export. Attach `export .board` (sqlite file)
  and `export .json` for interchange.
- **Rich text**: contenteditable with a custom document model
  (block list: heading/para/list/code/quote/callout + inline marks).
  No ProseMirror/TipTap (~200KB+ and heavy); our markdown autoformat
  + 6 colours + highlights fit in a few hundred lines. If this proves
  painful, `pex`-style minimal editor or Lexical-core only.
- **Images/files**: blobs in OPFS, thumbnails cached as resized
  JPEG/WebP; paste-image and drag-drop file import.
- **URL unfurl**: local-first means no server-side OG fetch. v1: store
  the URL + title; optional later fetch via a tiny local companion or
  a CORS-friendly metafetch.

## Layout

```
src/
  main.ts            bootstrap, routes (home/board), service worker init
  state/{store,actions,schema.ts}
  persist/{sqlite.ts,migrations.ts,files.ts}
  canvas/{renderer.ts,hit.ts,viewport.ts}   Canvas2D layer + pan/zoom
  cards/{factory.ts,note.ts,todo.ts,line.ts,column.ts,...}  DOM cards
  editor/{richtext.ts,markdown.ts}          inline text model
  ui/{palette.ts,menus.ts,search.ts,unsorted.ts,shortcuts.ts}
  worker/search-worker.ts                   card-text index (MiniSearch
                                            or hand-rolled trigram index)
tests/  vitest, jsdom-free where possible
```

## Performance rules

- 60fps pan/zoom: viewport transform on one CSS transform; canvas layer
  redraws only grid+lines (no card rasterisation).
- Cards mounted iff in viewport + 1 screen margin; on pan, enter/exit
  sets diffed, not rebuilt.
- Text editing model is a plain array; render only the edited card.
- No virtual DOM, no signals library, no CSS framework (hand-rolled
  classes); total JS target < 150KB gz excluding the SQLite wasm.
- SQLite runs in a dedicated Worker (OPFS requires it anyway); the main
  thread posts actions and never blocks on I/O. Search index lives in
  the same worker or its own.
- Canvas2D layer invalidates by rect, not full redraws; dot grid is a
  prerendered tile bitmap scaled by zoom bucket.
- Card DOM uses CSS containment (`contain: layout style paint`) so
  editing one card can't invalidate the layer above it.
- Strokes/sketches/annotations stored as point arrays; rendered to the
  canvas layer for board drawings and to a per-card canvas for
  sketches. No SVG nodes per stroke; canvas is faster at stroke counts
  that matter.
- Table is a hand-rolled grid: contenteditable cells in a plain table,
  formula eval on dirty only. No Handsontable-class dependency.
- Deps allowed: sqlite3.wasm only. Everything else hand-rolled:
  palette/menus/popovers, emoji picker (emoji-mart data set is a JSON
  blob, lazy-loaded), icon set (OSS font subset).

## Build order

1. Canvas pan/zoom + dot grid + selection/marquee.
2. Note card create/edit/move/resize + autosave to sqlite.
3. Column + drag-in containment; Board card + navigation.
4. To-do (due dates), Heading, Color swatch, Line + Connect.
5. Labels, reactions, comments, Unsorted, search, shortcuts panel.
6. Table, Document, Sketch + board Draw + Annotation, Link unfurl-lite,
   image import.
7. Export PNG/JSON, templates, dark mode, presentation mode.

## Post-audit deltas (fifth pass)

Verified findings that adjust the plan:

- **File cards**: new element type `{ file: {blobRef, name, size, mime} }`.
  Icon view (paper icon + name + size) and detail view (name +
  Download/Open + size). No server preview renderers; client-side
  thumbnails for images/text only.
- **Synced note copies**: duplicating a note offers "keep in sync" ->
  linked elements sharing one content node. Schema: `content` can be a
  ref to another element's content, or a `syncGroup` id on elements.
- **Ink effect**: strokes need per-point pressure/width, not just
  point arrays. Store {points, widths} or PressureEvent-compatible
  tuples; canvas renderer already handles variable width.
- **Card overlap prevention**: layout engine needs a push pass. When a
  card grows (edit/resize), neighbours that would overlap shift along
  the growth axis. Local, incremental, undoable.
- **Per-board dot-grid toggle**: Board.grid flag; canvas renderer
  skips the tile pattern when off. Background right-click toggles it
  (the only right-click in the app, background only).
- **Toolbar palette customization**: settings persist a palette
  whitelist; palette component reads it.
- **Locale/currency table cells**: Number/Currency/Date cell types
  format via Intl with a user currency + locale setting.
- **i18n**: string tables from day one; they ship en/es/fr/pt. Keep
  all UI strings in one module, lazy-load non-default locales.
- **Image background removal**: manual cut-out
  (lasso/flood-fill to alpha) in v1; an ONNX/WASM
  matting model (u2netp, ~5MB via onnxruntime-web) is an optional
  power feature later, never required.
- **Document card views**: displayMode ICON_VIEW vs DETAIL_VIEW
  (rendered preview): renderer branches per mode, cheap.

## Honest risk call-outs

- Hand-rolled contenteditable is still the riskiest piece: the audit
  shows the real surface (7 block styles, 6 text colours, 6
  highlights, inline code, underline, lists with indent, center
  toggle, callout/quote/code blocks, markdown autoformat). Build it
  block-model-first and keep the door open to Lexical if it fights.
- The ~150KB JS target excludes: sqlite wasm (~500KB, lazy), emoji
  data (lazy JSON), icon set (subset font). Still plausible.
- Everything else in v1 verified as client-side: PNG export via
  canvas raster, PDF via print pipeline, JSON/.board files for
  sync-folder workflows, unfurl/embeds/clipper via third-party or
  user-keyed APIs.

## Deployment: static hosting (GitHub Pages verified-compatible)

The whole app is a static SPA; GitHub Pages can host it as-is. Hard
constraints discovered and how the plan handles them:

- **No COOP/COEP headers on Pages** -> crossOriginIsolated stays
  false, so SharedArrayBuffer is unavailable. SQLite must use the
  `opfs-sahpool` VFS (SyncAccessHandle pool, no SAB needed), NOT the
  `opfs` VFS which requires SAB. SAH pool needs a dedicated Worker,
  which the architecture already mandates. Plain async OPFS also
  works without isolation. IndexedDB is the zero-risk fallback path.
- **No server rewrites** -> use hash routing (`#/b/<id>`) or the
  404.html -> index.html redirect trick. Board URLs stay
  shareable as plain links (read-only local boards, not hosted
  public boards; section 10 unchanged).
- **Base path**: project sites live under `/<repo>/`; set Vite
  `base`, scope the service worker accordingly.
- **PWA/offline**: Pages serves HTTPS, so service worker, OPFS,
  Notification API, and wasm all work. `.wasm` MIME is served
  correctly.
- **"Everyone" caveat**: each visitor gets their own local-first
  instance; data lives in THEIR browser (OPFS). Sharing boards =
  export/import `.board`/JSON files, not live sync. That is the
  product.
- **Browser support**: OPFS sync access handles -> Chrome/Edge 108+,
  Firefox 111+, Safari 16.4+. Older browsers get an IndexedDB
  persistence fallback or a session-only warning.
- **Chromium-only API**: File System Access (writing `.board` files
  into a synced folder) works in Chrome/Edge; Firefox/Safari get
  download/upload import-export instead. Spec it as progressive
  enhancement.
- **Notifications**: Notification API on HTTPS works on desktop;
  iOS needs the installed PWA. Reminders degrade to in-app.
- **Third-party calls from a static page**: YouTube/Vimeo/Spotify/
  SoundCloud/Maps iframes fine; Google favicon service fine; Pexels
  search with the user's own key is CORS-enabled; URL unfurl needs a
  CORS-friendly reader/proxy (already spec'd with offline fallback).
- **Nothing on Pages can break the build**: no env secrets, no
  server endpoints, no websockets. The only infra in v1 is the
  static bundle itself.
