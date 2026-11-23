# Design decisions

Why the main pieces of Scatterboard are built the way they are. Each
section names the decision, the alternatives that lost, and the cost
of the choice.

## Typed actions with derived inverses instead of snapshot undo

Every mutation goes through `applyAction`, a typed action union that
returns the inverse action as a byproduct (`src/state/actions.ts`,
`src/state/store.ts`). Undo replays inverses; redo replays the
original actions.

The alternatives:

- Snapshot undo (push the whole doc per step). Simple, but the doc
  holds thousands of elements and drag gestures generate hundreds of
  intermediate states. Copy-on-write helps memory but still gives a
  blunt undo unit: you cannot coalesce twelve pointermove patches
  into one undo step, which is the behaviour users expect.
- Command objects with hand-written undo per operation. That is what
  this is, except the inverse is computed from the old state at apply
  time rather than declared by hand. Nothing can drift out of sync
  with the data.

The cost: every new mutation needs a correct inverse in one place,
and grouped edits need bookkeeping (`beginGroup`/`endGroup`, tagged
groups so an agent batch does not swallow the user's own undo steps).
That bookkeeping is the fiddliest code in the codebase, but it is
fiddly once, in one file.

## DOM cards over a Canvas2D layer, not canvas rendering

Cards are absolutely positioned DOM in a transformed container;
Canvas2D draws only the dot grid, connector lines, marquee, and
selection chrome.

Canvas-everything (Excalidraw, tldraw) renders uniformly and exports
to raster easily, but you reimplement text layout, selection,
editing, and accessibility yourself. DOM gives all of that free:
native contenteditable, real selection, find-in-page, screen readers,
crisp text at any zoom. The cost is two coordinate systems, viewport
culling so the DOM only mounts visible cards, and a PNG export that
snapshots the DOM through an SVG foreignObject.

## No framework, no runtime dependencies

Vanilla TypeScript plus a small DOM helper. The dependency budget is
zero by rule, the gzip budget is 150KB of app JS enforced in CI by
`scripts/check-size.mjs`.

A framework would buy structure the codebase currently gets from
convention (one store, a view registry per card type, explicit render
passes). The trade: no framework updates to chase, no bundle tax, no
impedance mismatch with contenteditable surfaces that frameworks
fight over anyway, and the whole thing stays readable end to end.
The cost is that reactivity is manual; the store's change events plus
a `rev` counter for lazy cache invalidation cover what a signal
library would.

## SQLite in OPFS behind an adapter, localStorage as fallback

Persistence sits behind `StorageAdapter` with two implementations
(`src/persist/sqlite.ts`, `src/persist/local.ts`). The primary one
runs sqlite-wasm on the OPFS sync-access-handle pool in a dedicated
worker; localStorage is the first-boot migration source and the
fallback when OPFS is unavailable.

Alternatives that lost:

- Plain IndexedDB for the doc. Fine for key-value, awkward for
  structured queries and integrity. Media blobs do live in IndexedDB
  (`src/persist/blobs.ts`) because they are exactly key-value.
- localStorage only. Synchronous, 5MB cap, string-only. Worked as a
  v1, does not scale.
- The OPFS `opfs` VFS requires SharedArrayBuffer, which requires
  COOP/COEP headers GitHub Pages cannot send. The `opfs-sahpool` VFS
  does not need SAB, at the cost of a dedicated worker. That
  constraint picked the storage architecture: an adapter interface
  was non-negotiable once one backend required a worker and the
  fallback did not.

JSON for the workspace payload is serialized off-thread in the same
worker (`src/persist/json.worker.ts`) so a large save cannot block
the UI thread.

## execCommand for rich text, not ProseMirror

Notes, headings, documents, and table cells share one contenteditable
surface driven by `document.execCommand` plus a block-model layer for
styles the command set cannot express (`src/ui/richtext.ts`).

execCommand is deprecated and ugly, but it interoperates with the
platform: native undo behaves sanely inside the surface, IME and
autocorrect work, mobile keyboards work. A model-driven editor
(ProseMirror, Lexical) would be a ~200KB dependency that takes over
the DOM the rest of the card system renders into, and its undo stack
would have to be reconciled with the store's. The escape hatch stays
open: the editor touches the DOM only through `richtext.ts`, so
swapping engines is a one-file change.

## Hash routing

Boards live at `#/b/<id>`, editors at `#/e/<id>`. The app deploys as
static files to GitHub Pages, which has no server rewrites, so path
routing would 404 on refresh. Hash routing is the boring correct
answer for a local-first SPA: deep links work, no server config, the
service worker scope is the only deploy concern.

## Service worker precache, production only

`public/sw.js` precaches the shell and walks the script bundle so the
app works fully offline after one visit. It is registered only in
production builds; keeping it out of dev avoids the classic
stale-cache confusion loop, at the cost of the offline path only
being exercised in built bundles (the test suite covers the storage
and boot logic it depends on, not the sw itself).

## BroadcastChannel tab safety

A save announces the new workspace revision on a BroadcastChannel
(`src/persist/tabs.ts`). A second open tab pulls the newer workspace
instead of blindly overwriting it with an older one. Multi-tab
conflict handling is the usual weak point of local-first apps; this
is a last-write-wins policy made visible instead of silent. Not CRDT
sync, deliberately: single user, last write is almost always right.

## Local agent bridge, opt-in and undoable

The MCP bridge (`bridge/`, published as `scatterboard-mcp`) lets an
external agent drive a live board over a localhost WebSocket.
Two constraints shaped it: it stays off until the user enables it and
confirms a one-time pairing token in the app, and every mutation the
agent makes goes through the same action dispatch as the UI, so
agent work is normal undoable history and is refused while presenting
with editing locked. Giving the agent its own edit path would have
been simpler to write and permanently wrong.

## What this architecture gives up

- Real-time collaboration. The doc model and action store would
  support it, but sync needs a server and the project is deliberately
  serverless.
- Guaranteed-consistent multi-tab edits. Last-write-wins is a
  policy, not a merge.
- A mature rich-text editor. execCommand covers the shipped feature
  set; anything richer means paying the ProseMirror tax described
  above.
