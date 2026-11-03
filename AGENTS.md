# Scatterboard

Local-first infinite-canvas planning board in the visual-board
tradition, with original code, copy, art, and name. MIT.
Vanilla TypeScript + Vite. No frameworks, no UI libraries, no network
calls; fully offline.

## Commands

- `npm run dev`: Vite dev server
- `npm run build`: static build to `dist/` (deployable as-is)
- `npm run typecheck`: `tsc --noEmit`; must pass before finishing work
- `npm test`: `vitest run`; unit tests live in `test/`
- `npm run preview`: serve `dist/`
- `npm run agent:setup`: install the scatterboard MCP bridge for repo
  development. Run this when asked to "install the scatterboard/agent
  MCP". It installs `bridge/` deps and writes `mcpServers.scatterboard`
  (node + absolute agent.mjs path) to the Devin user config, Windsurf
  `mcp_config.json` and `.devin/config.local.json`. IDE-embedded
  sessions only read the user config for MCP servers (project
  `mcpServers` is ignored), so registering there is required; the
  entry is picked up live, no restart. Then `sb_status` returns the
  pairing URL and `sb_open` pairs a tab. For users outside this repo
  the bridge is published as `scatterboard-mcp`; the consumer config
  is `{"command":"npx","args":["-y","scatterboard-mcp"]}` (no clone,
  no npm install).
- Releases: `npm version patch|minor|major` bumps `package.json`,
  commits and tags `v*`; pushing the tag runs `release.yml` (tag must
  match the package version, CHANGELOG section required) and
  `pages.yml`. `__APP_VERSION__` is injected via vite `define` from
  `package.json` and shown in Help > About.

`window.__app` exposes the App instance on the dev page for poking
(`__app.selectOnly(id)`, `__app.store.doc`, `__app.vp`).

## Layout

- `src/state/`
  - `schema.ts`: Doc {boards, elements, comments, labels, trash,
    templates, seq},
    Element, Label, Comment, TrashEntry, factories, `UNSORTED` sentinel,
    `migrateDoc` (defaults for fields added after persisted v1). Board
    `presentOpts` holds the three presentation toggles (mutated directly
    like board.position, no undo). `ImageDoc` carries `natW`/`natH`
    (stored blob pixel size, written at
    ingest) and optional `strokes` in that natural space; crop/rotate/
    flip, background removal and replace bake a NEW blob and drop
    strokes (replace/crop) or keep them (background, same dims).
  - `actions.ts`: typed Action union + `applyAction` auto-inverse.
    `ElementPatch`/`BoardPatch` allow explicit `undefined` to clear
    optional fields.
  - `store.ts`: undo/redo stacks, `beginGroup`/`endGroup` for drags and
    edit sessions, patch coalescing.
  - `clipboard.ts`: in-memory element snapshot for cut/copy/paste.
  - `clone.ts`: `remapElements`, the shared fresh-id clone path used
    by paste/duplicate/Opt+drag and template instantiation.
  - `templates.ts`: Template snapshots {id, name, board, elements,
    labels}, 4 builtin presets, `snapshotTemplate`,
    `instantiateActions`.
- `src/canvas/`: `viewport` (one board-space transform), `renderer`
  (Canvas2D: grid, lines, marquee, selection outlines, guides), `input`
  (pointer gestures), `lines` (resolve/hit/midpoint), `snap`, `hit`.
- `src/cards/`: `layer.ts` (view registry, `rectOf`/`heightOf`,
  viewport culling), `factory.ts` (type -> CardView), `measure.ts`
  (pre-mount height estimates per type, co-located with the card DOM
  they approximate), `boardindex.ts` (rev-keyed member/count index),
  one file per card type. `CardView`/`CardEvents` interfaces live in `note.ts`.
  `beginEdit(pos?, field?)` takes a field name ('title'/'caption'/'url')
  on multi-field cards; `onEditField` requests a session. `link.ts`
  covers both 'link' and 'embed' (audio/map/video) elements.
  `document.ts` has icon/detail display modes; `sketch.ts` renders
  strokes via svg viewBox. `image.ts` renders draw-on strokes the same
  way (`.im-ink`, viewBox = ImageDoc.natW/natH). `annotation` elements
  have no card view; `ui/annotations.ts` renders them as svg paths
  seated inside `.cards` by el.z (host fallback = topmost).
  `table.ts` is the cell-grid card: cell focus lives in the view
  (`cellFocused()` drives the rail via `App.editingEl`; `onCellFocus`
  requests a re-render), `formula.ts` evaluates `=NAME(args)` cell
  text (6 functions, A1 refs/ranges, errors render raw).
- `src/draw/`: `strokes.ts` (path/hit/bbox/serialize + file download),
  `pad.ts` `DrawPad` shared pen/select/eraser session: floating
  toolbar, stroke-level undo/redo, V/E/C/X/1-4 keys. `PadMount.viewBox`
  scales the svg when stroke space is not css pixels.
- `src/editor/`: `shell.ts` scrim (z-40, under tool-pop), `doceditor.ts`
  document editor (title + note-text surface + tool strip + export),
  `draweditors.ts` sketch editor (600x450 pad) and board draw mode,
  `imgeditor.ts` image editor: one overlay with mode chips
  {Draw on, Edit, Background} at `#/e/<id>?editing-drawing|editing|
  editing-background`, chips swap the hash and `setMode` re-mounts the
  body (`imgmode.ts` maps mode <-> hash param);
  `export.ts` html -> markdown/plaintext. Route `#/e/<id>` mounts
  them via `App.applyRoute`; Esc/back exits, document edits live-commit
  inside one store group, sketch/image saves land as one content patch.
- `src/canvas/imgops.ts`: raster ops for the image editor + More's
  Crop Image to Fit Dot Grid: `oriented` (rotate CCW/flip), `cropImage`,
  `removeBackground` (edge flood-fill cutout, client-side), `loadBitmap`,
  `canvasBlob`.
- `src/ui/`:
  - `rail.ts` contextual left rail: 'create' / 'tools' / 'edit' modes,
    driven by `TOOL_DEFS` + `SINGLE_TOOLS`/`EDIT_TOOLS` + `toolsFor`;
    Trash pinned bottom (deletes the card while editing, drag target)
    plus the board-accent colour well.
  - `richtext.ts` execCommand-based ops over the single contenteditable
    surface: block styles, marks, lists, colours, inline code, links,
    markdown autoformat, `richKeydown`, `isBlankSurface`.
  - `popup.ts` anchored tool popups (one open, Esc/outside-down close),
    `toolpopups.ts` colour/labels/reactions/menu/text-style/link
    builders + `openViewMenu` (topbar View menu: Present entry, per-board
    dot-grid toggle, presentation toggles),
    `duepopup.ts` the original dismiss pattern.
  - `panel.ts` slide-over chrome shared by Unsorted/Trash/Search
    (`openSearchPanel` in `search.ts`).
  - `boardicons.ts` the board-icon glyph set (~60) + keyword tags,
    `mountBoardIcon` renders 'g:'/'c:'/'e:'/'b:' icon values.
  - `iconpicker.ts` board icon popup (search, Recommended,
    Letters & numbers, Upload an image, clear).
  - `newboard.ts` new-board template picker (empty, presets, saved
    templates with inline rename + delete).
  - `settings.ts` settings popup {theme incl. System, language incl.
    Auto, UI scale, canvas prefs, formatting, toolbar-palette editor,
    templates} + `openAboutPopup` (Help > About: `__APP_VERSION__`,
    storage meter, source link); `theme.ts` light/dark/system state
    (unset follows the OS, `systemDark()`), `canvasColors()`,
    `cardBg()`, `setUiScale`. `toast.ts` also has `hint()` (dismissible) and
    `choice()` (one action + dismiss). `locale.ts` holds number/
    currency/date formatting prefs (browserLang + currency) read by
    table cells. `capture.ts` is the quick-capture popup (text ->
    Unsorted note). Language switches persist + reload; strings.ts
    bootLang() reads the saved pref, else the browser language list,
    before module-level label tables are captured.
  - `chips.ts` label/reaction chips overlay, `pins.ts` comment pins
    (both seated into `.cards` after their card to honour el.z; member
    anchors stay in the host),
    `shortcutpanel.ts` `/` modal, `topbar.ts` crumbs/zoom/unsorted
    chip/Export + View + Help menus,
    `icons.ts` all SVG icon strings, `util.ts` `dragGhost`,
    `files.ts` file/image ingest + paste parsing + `fmtSize`,
    `embeds.ts` provider URL -> iframe src parsing (YouTube/Vimeo/
    Spotify/SoundCloud/Maps; no fetch) plus `urlTitle` (URL-derived
    titles, no fetch). `shortcuts.ts` is the global
    keydown map (modal surfaces own their keys); `unfurl.ts` is the
    link-preview fetch through api.allorigins.win, the only fetch in
    the codebase besides embed iframes. Embed cards fetch their page
    title without the unfurl pref; link cards only with it.
- `src/lang/`: lazy locale tables (de/es/fr/pt) loaded by
  `strings.loadLang`; en lives inline in strings.ts.
- `src/export/`: board-level export writers, all client-side:
  `boardpng.ts` raster (offscreen CardsLayer mounts every card, svg
  foreignObject snapshot via a data-URL image; blob: svg URLs taint
  the canvas in Chrome/Safari, data: does not; Canvas2D rect+text
  fallback when the snapshot refuses), `pdf.ts` minimal one-page
  JPEG PDF writer, `linear.ts` reading-order serializer (md/txt/
  word-html), `jsonio.ts` subtree export + re-id import actions,
  `zip.ts` store-only archive, `menu.ts` the topbar Export popup,
  `download.ts` blob download/slug/dedup-name helpers. Doc-local
  export stays in `editor/export.ts`.
- `src/persist/`: `storage.ts` `StorageAdapter`/`DocStorage`/
  `PersistedWorkspace` (version 1, additive fields only; `prefs`
  threads through `App.saveNow`), `local.ts` localStorage impl,
  `sqlite.ts` sqlite-wasm OPFS-SAHPool adapter (custom worker1
  promiser, vendored `public/jswasm/` worker + wasm, localStorage
  is the first-boot migration source and fallback),
  `blobs.ts` IndexedDB blob store {blobRef -> Blob} + objectURL cache +
  orphan purge; `blobRefsInDoc` covers elements, trash, board icons
  and template elements. All storage ids are `scatterboard:*`; the
  remaining `planboard:*` literals exist only for the one-time
  copy-forward from pre-rename installs. `scatterboard:lang` and
  `scatterboard:theme` mirror explicit prefs so boot can resolve
  them synchronously; unset means follow the browser/OS.
- `src/app.ts`: wiring: selection, drag gestures entry points, canvas
  overlays (chips/pins/label pills/connect handle), render loop,
  autosave. Collaborators live in `src/app/`: `editing.ts` (edit
  sessions, text commits, sync groups, helper offers, link/embed
  enrich),
  `tools.ts` (rail tool dispatch + card ops incl. converts),
  `panels.ts` (side panels: unsorted/trash/search/boards, board ops,
  icons, templates, route filters), `gestures.ts` (drag/drop, trash +
  column drop hints, resize, pan, overlap push), `export.ts` (PNG/PDF/
  linear/zip/JSON export + import), `overlays.ts` (label pills, chips,
  pins, annotation seating, column member line spans, connect handle,
  coveredByCard). Delegates
  reach App internals via
  an `App` back-reference; App keeps public shims for outside callers.
- `src/main.ts` + `src/boot.ts`: entry. main.ts loads the boot locale
  (`strings.loadLang`) before importing boot so module-level label
  tables capture the right strings, then registers `sw.js` in prod
  only (`?v=__BUILD_ID__` busts the runtime cache per deploy). boot.ts
  runs `migrateStorageKeys`, picks the adapter (sqlite OPFS else
  localStorage), loads/seeds/migrates the doc, mounts App, and applies
  the initial `#/b/`/`#/e/` route; `window.__app` is dev-only.
- `src/state/seed.ts`: first-run welcome board + `seedPerfDoc(n)`
  profiling doc (dev-only `?seed=N`).
- `src/agent/` (lazy chunk, loaded by boot on `?do=`/`?agent=`/
  `prefs.agent` or by the settings toggle): `api.ts`
  `createAgentApi(app)` over a structural `AgentHost` interface;
  commands plan-validate first, then run inside one store group
  (abort = endGroup + undo + future cleared; nested batches join the
  outer group). `validate.ts` `AgentError {code,message}` + field/ref/
  shape checks; `cmdurl.ts` `?do=<base64url JSON>` one-shot command
  lists; `client.ts` persistent `ws://127.0.0.1` session (token pair,
  stored-key reconnect, backoff, serialized requests,
  `sb-agent-status` window event for the settings status line);
  `index.ts` `init` + `setAgentEnabled`.
- `bridge/agent.mjs`: node >=20 localhost bridge + MCP stdio server,
  published to npm as `scatterboard-mcp` (`files: agent.mjs` only;
  `ws` + `@modelcontextprotocol/sdk` deps in `bridge/package.json`, a
  separate manifest from the app). `setup.mjs` registers the server
  into the Devin/Windsurf configs. One app session at a time: Origin
  allowlist on upgrade, token pair then `{bridgeId,key}` reconnect,
  identity in `~/.config/scatterboard-agent`
  (`%APPDATA%\scatterboard-agent` on Windows). Agent sockets and the
  `sb_*` MCP tools relay `{id,method,params}` to the app.
- `src/ui/sanitize.ts`: whitelist HTML scrubber applied to richtext
  fields on JSON import (note/heading/document/table cells).
  `presenting` body class hides chrome (DOM stays mounted), `dims()`
  drives the Focus-on-selected opacity pass over cards/lines/chips/
  annos, `lockedView()` (presenting + prevent-editing) is the single
  guard every mutation entry point checks.
- `src/strings.ts`: all user-facing copy (i18n table) + date helpers.

## Conventions

- One board-space transform: `.doc` inside `.viewport`; Canvas2D for
  grid/lines/marquee/selection chrome, absolutely positioned DOM for
  cards and editing. Cards stay CSS-crisp at all zooms.
- Every mutation is a typed action through `store.dispatch`; use
  `batch` for multi-element gestures so they undo as one entry.
- Overlay hosts live in `docEl` (`.line-labels`, `.card-chips`,
  `.comment-pins`, `.connect-handle`) and are re-synced in
  `App.render()`; keep `pointer-events: none` unless interactive.
  Overlay nodes that must honour `el.z` (chips, pins, anno svgs) get
  seated inside `.cards` right after/before a card node rather than
  staying in the host. DOM hit affordances (resize handle, connect
  handle, pins, table grips) counter-scale via `calc(Npx * var(--iz))`
  so targets stay constant screen px; `--iz` is set on `.doc` in
  `App.applyTransform`. Overlay anchors occluded by a card hide via
  `App.coveredByCard` (label pills, connect handle).
- `[data-noclick]` marks in-card controls that must not enter edit or
  start a drag-into-edit.
- Lines are elements with `from`/`to` endpoints (`LineEnd {el?, x, y}`);
  resolve through `resolveLine`. Anchored comments (`anchorId`) render
  as pins and are skipped by card views, position ops, and drag ids.
- `parentId` values: `null` = canvas, column id = member, `'unsorted'`
  = filed. Trash entries hold an Element snapshot + `deletedAt`.
- Image/file content holds `blobRef` only; blobs live in IndexedDB and
  resolve to objectURLs lazily (missing blob = placeholder, not error).
  `trash.add` keeps blobs; `emptyTrash` + boot-time orphan purge release
  them (shared refs between clones survive).
- Paste runs through the DOM 'paste' event (`App.pasteExternal`):
  internal clipboard -> OS files -> URL text; Cmd+V in shortcuts.ts is
  intentionally inert. Cmd+Opt+V (paste styles) does not fire it.
- Debounced autosave via `App.scheduleSave`; hash routing `#/b/<id>`.
- No right-click menus anywhere; the rail is the only menu surface.
- Perf invariants, guarded by test/perf.test.ts:
  - `CardView.update()` is O(card), never O(doc): member lists and
    board counts come from `CardCtx.members`/`cardCount` (BoardIndex),
    not `doc.elements` scans.
  - No layout reads inside `update()`/`sync()`: no `innerText`,
    `offset*` or `getBoundingClientRect`; cache displayed values like
    `dataset.shown`/`Row.shown` and write them from input handlers.
    Table grips rebuild only on a geometry signature.
  - Overlays cull like cards: pins, annotation svgs and label pills
    skip offscreen items against `vp.viewRect`; `coveredByCard` runs
    only for in-view candidates. Stroke bboxes are memoized via
    `strokesBBoxCached` (strokes swap identity on patch).
  - `App.render()` may run per frame and per keystroke: the layer's
    `sync(dirty)` updates only elements touched since the last pass
    (`App.dirtyEls` from store.onChange; `refreshCards` for non-element
    inputs like theme/board meta). Canvas-only changes (marquee) go
    through `renderScene()` and skip the DOM pass entirely.
- Table cells: `TableCell {text, html?, type?, alignH?, alignV?,
  color?}`; display formatting applies to text (number/currency/
  percent/datetime), checkbox cells bind a 0/1 text value. Cell rail
  tools act on the focused cell via `TableCard` methods; Opt+arrows
  insert rows/columns in-card. "View formula help" is dropped (no docs
  to link).

## Style rules

- No em dashes or en dashes anywhere: code, copy, docs, comments.
- Original code, copy, and icons only. Match the behaviour of
  comparable visual-board tools; never copy a third party's assets or
  text.
- Compact idiomatic TS; no comments unless the code is non-obvious.
- Budget: under 150KB JS gzip per chunk (currently ~95KB initial;
  largest ~87KB). `npm run sizecheck` gates it after `vite build`;
  editors, export writers, seed and non-en locales are lazy chunks.
- Dark mode: CSS vars on `body` flipped by `body.dark`; canvas colors
  from `theme.ts canvasColors()`; user card colours darken via
  `cardBg()` color-mix. UI scale is `--ui` on body; chrome font sizes
  are `calc(Npx * var(--ui))`, board-space sizes stay px.
- No AI attribution anywhere: no "Generated with", "Co-Authored-By",
  or tool references in commit messages, tags, PRs, code, or comments.
- Commit only when the user asks. Commit messages use a short
  imperative subject, no trailers, no boilerplate.
