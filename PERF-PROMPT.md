# Prompt: implement the Scatterboard performance fixes

You are working in `/Users/marko/scatterboard`, a local-first infinite-canvas
app: vanilla TypeScript + Vite, Canvas2D for grid/lines/marquee,
absolutely-positioned DOM for cards, zero runtime dependencies, no
network calls. Read `AGENTS.md` first; it documents the layout,
conventions and the invariants you must preserve.

A full performance audit was run and measured real numbers on a board
seeded to 1,649 elements (1,200 notes, 6 columns of 15, 150 lines, 60
pinned comments, two 12x10 tables, three 20-item todos, 10 annotations
of 500 points, 4 board cards). This file is the implementation spec for
every finding. Line numbers below come from the audit and may have
drifted (app.ts is being refactored into `src/app/` submodules); locate
code by name, not by line.

## Ground rules

- No new runtime dependencies. Dev dependencies are fine for guards.
- Every mutation stays a typed action through `store.dispatch`.
- JS budget: under 150KB gzip. Measure with `npm run build`.
- `npm run typecheck` and `npm test` must pass when you finish.
- No comments unless the code is non-obvious. No em dashes or en
  dashes anywhere: code, copy, docs, comments.
- Match existing conventions: signature/`dataset` diffing (see
  `chips.ts`, `pins.ts`, `table.ts` `dataset.shown`), `BoardIndex`
  rev-keyed caches, `requestRender` coalescing.

## Baseline (what you are fixing)

Measured `App.render()` / canvas `draw()` call durations in Chrome,
1649-element board, dev build:

| Scenario | Cost |
|---|---|
| render() at z=1, 82 cards mounted | 2.2 ms |
| render() zoomed out, 1081 mounted | 18.8 ms |
| ... of which `layer.sync` | 11.6 ms |
| ... of which `syncLabelPills` | 5.1 ms |
| `TableCard.update` | 1.47 ms per table per render |
| `ColumnCard.update` | 0.26 ms per column per render |
| `BoardCard.update` | 0.22 ms per board card per render |
| `TodoCard.update` | 0.09 ms per todo per render |
| `dragMove` (dispatch path) | 1.36 ms/event + full render |
| keystroke (dispatch + render) | 19.7 ms zoomed out |
| marquee (setMarquee + render) | 18.5 ms zoomed out |
| save: `JSON.stringify` 549KB doc | 8.6 ms main thread |
| save: `structuredClone` into codec worker | 22.9 ms main thread |
| `drawGrid` worst case (~3900 dots) | 1.13 ms |
| bundle | 407.5 KB raw / 111.6 KB gzip (AGENTS.md says ~81KB, stale) |

Confirmed by measurement: pins and anno svgs never cull (61 pins + 11
svgs mounted with only 82 cards visible). Chips do cull.

## Work items

### W1. O(N) work inside `CardView.update()` (top priority)

`render()` runs every frame during pan/zoom/drag and once per
keystroke during edit. Any `update()` that scans the doc or touches
layout multiplies that cost. Fix these four cards.

**W1a. ColumnCard** (`src/cards/column.ts`, currently `column.ts:78`)
calls `columnMembers(this.ctx.doc, el.id)`, which is
`Object.values(doc.elements).filter().sort()` in
`src/state/schema.ts:523`, i.e. O(doc) per column per render. Replace
with the board index: expose `members(id)` on `CardCtx` (or pass the
`CardsLayer` member index through) wired to `CardsLayer.members`
(`src/cards/layer.ts`), which is already maintained by
`BoardIndex.byParent`. Filter out `line`/`annotation` as today.

**W1b. BoardCard** (`src/cards/board.ts`, currently `board.ts:83`)
calls `boardCardCount(this.ctx.doc, this.ref)` per render, another
O(doc) scan (`schema.ts:529`). Compute per-board card counts inside
`BoardIndex.ensure` (one `Map<ID, number>` built during the existing
single pass) and read it from the view.

**W1c. TableCard** (`src/cards/table.ts:874-909`) calls `syncGrips()`
every update, which does `grips.textContent = ''`, recreates every
grip/edge node, rebinds `bindColDrag`/`bindRowDrag`/`bindColResize`
listeners, and reads `offsetHeight`/`offsetLeft`/`offsetWidth`/`offsetTop`
per cell (`table.ts:615-652`): DOM churn plus layout reads every
render. Gate it on a signature: rebuild only when rows/cols/`widths`,
the `scale()` bucket, or a force flag after `buildGrid` changes. Keep
the `syncGrips()` call at the end of grip drags (`table.ts:696`) and
anywhere geometry can change without a sig change; if a case is
ambiguous, prefer correctness over the skip.

**W1d. TodoCard** (`src/cards/todo.ts:333-334`) reads
`r.text.innerText` per row per render to diff text; `innerText` is a
layout-forcing read. Store the last written text on the row record
created in `makeRow` (e.g. `r.shown`) and compare `item.text` against
it, mirroring `dataset.shown` in `table.ts:968`. Only write when
different and not focused, exactly as now.

Acceptance: on the 1649-element seed zoomed out, `layer.sync` drops
from ~11.6 ms to under ~4 ms; per-type update timings drop roughly to
note levels (single-digit microseconds).

### W2. Overlay culling + cover-check gating

**W2a. `coveredByCard` call sites** (`src/app.ts`, currently
`:1324` and `:1273`): `syncLabelPills` calls it per labeled line and
it iterates all mounted views. Skip the call entirely when the pill
midpoint is outside `vp.viewRect(0)` (an offscreen pill cannot be
seen). Also skip pill positioning for lines whose rect misses the
view: keep pills mounted only for visible labeled lines, the same way
`chipTargets` culls.

**W2b. Comment pins** (`pinItems`, currently `app.ts:969-992`):
skip anchored comments whose anchor rect misses `vp.viewRect(60)`
with `rectsIntersect`, matching `chipTargets`.

**W2c. Annotations** (`annoItems`, currently `app.ts:1005-1009`, and
`src/ui/annotations.ts:54`): cull items whose bbox misses the view,
and stop recomputing `strokesBBox(c.strokes)` every render:
`annotations.ts:66` already keys its rebuild sig on strokes identity,
so cache the bbox alongside that sig. Separately,
`CardsLayer.heightOf` (`layer.ts:198-201`) calls `strokesBBox` for
annotations on every rect-cache miss; make it use the same cached
bbox (or compute once per strokes identity).

Acceptance: at z=1 on the seed, pin/svg node counts drop from 61/11 to
only what is near the viewport; `syncLabelPills` drops from ~5 ms
zoomed-out to sub-millisecond.

### W3. Light render path for viewport/marquee-only frames

`setMarquee` (currently `app.ts:1132`) and viewport pan both funnel
into the full `render()`, but a marquee rect touches only canvas
state, and during pan the element data is unchanged.

- Split `render()` so canvas scene state (grid/marquee/guides/
  outlines/lines/draft) can be pushed via `renderer.setScene` +
  `invalidate()` without `layer.sync`, chip/pin/anno syncs, rail or
  panel work. `setMarquee` should use only the light path.
- For `vp.onchange`, still run `layer.sync` (mount/unmount needs it)
  but let card `update()` skip elements that are provably unchanged.
  The `Change` object emitted by `store.dispatch`
  (`src/state/actions.ts:42`) already names dirty element ids; carry
  a `lastDirty: Set<ID>` (or `dirtyRev` per element) on `App` and pass
  it down so `layer.sync` calls `view.update(el)` only for dirty or
  newly-mounted views. Positions written by `update` (left/top/width)
  must still apply on mount and on board change. Careful: viewport
  moves can change what `update` would compute only through culling,
  so skipping unchanged elements is safe; column member layouts that
  depend on the column are fine because member `update` is driven by
  the column's own `update`, which you can also gate on its own
  dirty/geometry state.
- Keep `syncChips`/`syncPins`/`syncAnno`/`syncLabelPills`/`syncConnectHandle`
  on every render for now (they are cheap after W2) unless skipping
  them is trivially safe.

Acceptance: marquee drag at zoom-out goes from ~18.5 ms/frame to under
~1-2 ms; pan at zoom-out drops roughly proportionally to the removed
`update()` work. Full renders still occur on every `store` change.

### W4. Save path main-thread cost

`SqliteAdapter.save` (`src/persist/sqlite.ts:225-233`) posts the whole
workspace object to `JsonCodec`, which structured-clones it on the
main thread (22.9 ms at 549KB) so the worker can stringify it (8.6
ms). Stringifying inline on the main thread and posting the string is
measurably cheaper end to end (8.6 ms + ~memcpy of a 550KB string).

- Change `save` to `JSON.stringify(w)` inline and pass the string to
  `put`, dropping the stringify hop through `JsonCodec`. Keep
  `JsonCodec.parse` for `load` if desired, or parse inline; justify
  whichever you keep in the PR description.
- The `LocalStorageAdapter.save` path (`src/persist/local.ts:32-34`)
  stays synchronous by necessity; no change needed, but confirm the
  sqlite path no longer defeats its own worker.

Acceptance: main-thread cost per full save drops from ~23 ms to ~9 ms
on the seed doc; `planboard.sqlite3` round-trips correctly
(save -> reload -> same doc).

### W5. `pushOverlaps` stale-rect correctness bug

`src/app.ts` `pushOverlaps` computes pushed positions in `pos`, then
tests overlap with `this.layer.rectOf(pa ? { ...ae, ...pa } : ae)`.
The spread keeps the same `id`, and `rectOf` caches by `id`
(`layer.ts:216-222`), so it returns the *stored* rect, not the pushed
one. Result: the overlap test never sees pushed positions, so cards
that remain "overlapping" in stale space get re-pushed every pass, up
to 6x too far and emitting excess `element.patch` actions.

- Do not route hypothetical positions through the id-keyed rect cache.
  Compute the rect directly (`computeRect` equivalent for a moved
  element is just `{x, y, w, h: heightOf(el)}` for canvas cards; keep
  column members excluded as they already are via `movable()`).
- Keep the 6-pass cap and the existing undo-group join.

Acceptance: with `noOverlap` on, dropping a card over a neighbour
pushes it exactly enough to clear (+8px), once; no runaway drift; the
emitted batch contains only the elements that actually moved.

### W6. blob objectURL eviction

`src/persist/blobs.ts:52,79-96`: the `urls` map never evicts, so every
blob ever rendered keeps a live object URL pinning its Blob in memory
for the session. Cards share refs (clones), so URLs cannot be revoked
per view.

- Add an LRU or refcount layer: simplest correct version is a max-size
  LRU (e.g. 64 entries) that `URL.revokeObjectURL`s and re-reads from
  IndexedDB on miss, plus keep `inflight` dedup as-is. `deleteBlob`
  already revokes; keep that. `downloadBlobRef`/`blobTotalSize` are
  unaffected.
- Make sure a revoked-then-re-needed URL rehydrates transparently
  through `blobUrl` (it will, since `inflight`/`urls` miss goes to
  `getBlob`).

Acceptance: object URL count bounded; scrolling an image-heavy board
does not grow retained blob memory unboundedly.

### W7. Grid tile pattern

`src/canvas/renderer.ts:125-140` emits one `fillRect` per dot (up to
~3,900/frame at 1.13 ms measured). ARCHITECTURE.md specified a cached
tile; implement it: prerender one `step x step` tile to an offscreen
canvas per (step, radius, theme) bucket, `createPattern` it, and fill
the viewport once. Invalidate the tile on theme change and on step
change (the existing `while (step * vp.z < 16) step *= 2` bucketing
already quantizes it). Keep the existing radius clamp.

### W8. Remaining smaller items

- **F14 present/filter pass** (`app.ts`, the `dimming` block):
  `querySelectorAll` over all card+overlay nodes each render while
  presenting/filtering is fine to keep, but skip the second
  `classList.toggle('filter-hit', ...)` work when there is no filter
  (it is already gated by `dimming`; tighten so present-only renders
  do one pass, not two-class writes per node, if the cost is trivially
  separable).
- **F16 boards panel sig** (`renderPanel`, `app.ts` `b:${store.rev}`):
  rebuild the panel only when board membership/element counts could
  change; a cheap improvement is to keep the rev sig but skip rebuild
  when the panel is not visible, or compute the sig from the row data
  rather than rev. Small win; do not over-engineer.
- **F18 search**: `searchBoard` scans the doc per keystroke while the
  panel is open (`src/ui/search.ts:44-80`, input handler `:177`).
  Debounce the render by ~120 ms; a full index is out of scope.
- **F20 allocations**: `resolvedLines` allocates a fresh
  `SceneLine[]` per render and `hitLines` sorts a copy per pointerdown.
  Low priority; only touch if it is a free simplification.
- **F17 `absorbUndo`**: `g.undo = [...kept, ...g.undo]` re-splices and
  reindexes per dispatch. Groups are small in practice; leave unless a
  measurement says otherwise.
- **F19 boot serialization**: `SqliteAdapter.create` blocks first
  paint on worker spawn + wasm compile + OPFS open (`main.ts`
  `boot()`). Optional: construct `App` against the
  `LocalStorageAdapter` first, swap in sqlite when ready, or at least
  parallelize worker spawn with module eval. Do this only if it is a
  small, safe change; document the choice either way.

### W9. Bundle weight and splitting

Everything is statically imported; the single chunk is 407.5 KB /
111.6 KB gzip against the "~81KB" figure in AGENTS.md. Recover ~25-30
KB gzip:

- `openElementEditor` (`app.ts`): dynamic `import()` the editors
  (`editor/imgeditor`, `editor/doceditor`, `editor/draweditors` and
  what they pull, `draw/pad`, `canvas/imgops`) instead of top-level
  imports.
- Export menu handlers (`app.ts` `exportPng`/`exportPdf`/`exportLinear`/
  `exportFilesZip`/`exportJson`): dynamic `import()` `export/boardpng`,
  `export/pdf`, `export/linear`, `export/zip`, `export/jsonio` on first
  use.
- `seedDoc`/`seedMedia` (`src/main.ts`, ~22KB source): move to a
  module imported only on the fresh-doc path (`main.ts` `boot`).
- Non-en locale tables (`src/strings.ts`): split `es`/`fr`/`pt` behind
  a `loadLang(lang)` that `bootLang` awaits before module-level `t()`
  tables are captured (AGENTS.md already specifies this intent;
  settings `onLang` already reloads the page after persisting).
- Do not split anything on the boot-critical path (sqlite adapter,
  renderer, cards).

Acceptance: `npm run build` reports noticeably smaller main chunk
gzip; editors/exports still work on first invocation (check for
double-loading via network panel if unsure).

### W10. Stay-fast guards

- Add a bundle-size gate: smallest possible script (e.g.
  `scripts/check-size.mjs` run after `vite build`, or a vite plugin)
  that fails the build when the main JS chunk exceeds 150KB gzip. Wire
  it into `npm run build` or a new `npm run sizecheck` called from
  `prebuild`.
- Add a vitest perf guard in `test/`: build a ~2,000-element doc with
  the schema factories and assert the cheap invariants, e.g.
  `BoardIndex.members` returns column members without scanning
  `doc.elements` (spy on `Object.values` or just assert complexity by
  construction), and a grep-level invariant test that `src/cards/*.ts`
  `update(` bodies do not call `Object.values(` or `innerText` reads.
  Prefer structural assertions over wall-clock assertions (CI timing
  is flaky).
- Update `AGENTS.md`: correct the "~81KB" figure, and add the
  invariants: `update()` is O(card), never O(doc); no layout reads
  (`innerText`, `offset*`, `getBoundingClientRect`) inside
  `update()`/`sync()`; overlays cull like cards; `render()` may run
  per frame and per keystroke.
- Optional: a `?seed=N` or `#/b/test` bulk-seed helper (schema
  factories behind an env/dev check) so the profiling board from the
  audit is reproducible from the UI.

## Order of work

1. W1 (biggest measured win), then W2, W3 (frame-time).
2. W5 (correctness bug, small).
3. W4 (save hitches), W6 (memory), W7 (grid).
4. W8 sweep (batch the small ones).
5. W9 (splitting, verify gzip drop), W10 (guards).

Re-measure after W1-W3 using the same 1649-element seed so the
before/after is comparable.

## Verification checklist

- `npm run typecheck` clean, `npm test` green, `npm run build` clean
  with the size table noted.
- Manual smoke on `#/b/test` and on a bulk-seeded board: pan, zoom,
  drag a card with snapping guides, marquee-select, edit a note, edit
  a todo row, resize a table column, undo/redo, reload (persistence
  round-trip), present mode with focus toggle.
- Report: per-work-item before/after render() timings where measurable
  (use the same `__app` instrumentation: wrap `app.render`,
  `app.layer.sync`, `app['syncLabelPills']`, per-view `v.update`
  timings in `performance.now()` loops over ~40 iterations).
