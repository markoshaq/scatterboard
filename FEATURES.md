# Scatterboard feature spec

An open-source, local-first infinite-canvas planning board.
Feature-for-feature parity with commercial visual-board
tools; original code, copy, art and name.

Legal guardrails: implement features and interactions freely (not
copyrightable). Do NOT copy any third party's code, icons,
illustrations, onboarding copy, help text, branding, template
contents, or pixel-exact layout. Different name, different look, MIT
license.

Scope split: v1 = everything that works offline against local storage.
v2 = features that need accounts, servers or third-party APIs. Almost
the whole product is v1.

## 1. Core model

- A workspace of infinite 2D canvases ("boards") on a dot-grid
  background. Boards nest: a board card on a parent board opens a child
  board. Breadcrumb navigation (Home / A / B), Cmd+U to parent.
- "Home" is the root board. Cards placed freely; no grid snapping.
- Cards: position (x,y), optional width, z-order, lock flag, parent
  (canvas or container card), section, colour.
- Column = inline container; members render stacked inside it; header
  counts "N cards, M documents" separately. Column "Convert to Board"
  turns the column (members included) into a nested BOARD card;
  undoable.
- Element placement enum (a section field per element): CANVAS
  (direct board child), INBOX (column member), ATTACHED (comment
  pinned to a card). No user-facing "sections" feature; in our schema
  this is just parentId = canvas | columnId | unsorted | cardId.
- Board card = thumbnail + name + "N cards" count; member count is
  live. Board also carries a default colour palette: the rail-bottom
  colour well sets the accent colour applied to newly created cards.
- Autosave: every mutation debounced; status chip Saving.../Saved.

## 2. Card types (17 + file drops)

| Type | Content | Card-specific tools |
|---|---|---|
| Note | rich text | text styles, colours, labels, reactions, comment; Convert to Document |
| Link | URL -> unfurled card (favicon, hero image, title, description) | Preview toggle (hero image on/off), Link info (URL), Rename, Caption; More {Add Image, Copy Link Address, Lock Position} |
| To-do | checkbox list + optional title | per-item due date popup: month calendar (past days disabled) + "Add due time" 3-col time picker {hours 12/01-11, minutes 5-step, am/pm} + reminder select {No reminder, 9 AM the day it's due, 9 AM the day before}; set date shows relative "Due X" chip; per-item Assign chip, title, labels, reactions |
| Line | connector between cards/edges | per-endpoint marker cycle {arrowhead, dot} (Start/End click toggles), inline label pill on the midpoint, Dashed toggle (dasharray 5,5), Weight {thin, medium, thick}, colour |
| Board | nested board card | Icon (picker below), Rename; More {Open in New Tab, Create Shortcut, Copy Link, Convert to Template, Lock, z-order} |
| Column | container, stacks members | rename, Convert to Board |
| Comment | anchored thread | reply, edit, author + timestamp |
| Heading | single-line large text | text style |
| Color swatch | colour block + hex + auto name + caption | caption, show-value toggle |
| Document | long-form text; dbl-click opens dedicated editor at /e/<id> (title, Insert {Emoji, Divider line, Link to board, Mention}, own Export {PDF, Word, Markdown, Plain text}, word count) | Card view toggles displayMode ICON_VIEW (icon+title+words) / DETAIL_VIEW (rendered text preview); ICON rail {Color, Card view, Rename, More{Lock, z-order}}; DETAIL rail {Color, Labels, Reactions, Comment, Card view, Rename, Caption, More{Convert to Note, Lock}} |
| Table | cell grid (see below) | title, caption, labels, reactions |
| Sketch | in-card drawing | resizable; dbl-click opens modal draw editor at /e/<id> |
| Annotation | board-level freehand drawing (saved strokes overlay) | More only {Download SVG, Convert to Sketch Card, Lock, z-order} |
| Audio | Spotify/Soundcloud embed | same LINK rail family |
| Map | Google Maps link -> map embed | same LINK rail family |
| Video | YouTube/Vimeo embed: paste URL -> thumbnail + play overlay; click play -> provider iframe (autoplay) | empty card: Color, Labels, Reactions, Comment, Rename, Caption, More {Add Image, Copy Link Address, Lock}; URL set: + Preview, Link info |
| Image | upload, stock-search result, or drag-drop | caption, labels, reactions, Draw on (sketch-toolbar annotate at /e/<id>?editing-drawing), Edit (Crop, Rotate left, Flip H/V), Background (bg-removal editor: Cut out + Remove-background toggle, transparency-grid preview), source credit; More {Download Original Image, Replace Image, Crop Image to Fit Dot Grid, Lock, z-order} |
| File | non-image upload | ICON_VIEW: paper icon + name + size; DETAIL_VIEW: name + Download link + Open + size; More {Download, Copy Link to File, Lock, z-order} |

File upload: file picker + drag-onto-canvas. Stock image search is a
v2 option (needs an API key); v1 uses local import instead.

Universal card tools (selected state): Colour (card bg), Labels,
Reactions, Comment, Rename/Title, More menu {type conversions, Lock
Position, Bring to Front/Send to Back, created-by attribution}.

### Table details
- New table = 3x4 empty grid; cells are rich-text editable.
- Cell rail: Text style, Cell type, Color, Formula, Alignment,
  Add column, Add row, More.
- Cell types: Auto (default), Number, Currency, Percentage, Text,
  Date & Time, Checkbox.
- Formulas: "=" in a cell opens autocomplete {SUM, IF, MIN, MAX,
  COUNT, AVERAGE}: exactly six functions.
- Add column/row inserts right of/below the selected cell. Cell More:
  Add Row Above (Opt+Up), Add Column Left (Opt+Left), Clear Cell,
  Delete Row, Delete Column.
- Alignment popup: horizontal {left, center, right} + vertical
  {top, middle, bottom}.
- Cell colour/type/alignment apply per-cell. The grid is a plain
  custom build (no dependency).

### Board icon picker
- Icon search input over an icon library (we ship our own
  hand-drawn set plus emoji).
- "Recommended" section generated per word of the board title.
- "Letters & numbers": monogram of initials, each title letter,
  digits 0-9.
- "Upload an image": custom icon file.

### Drawing
- Sketch card dbl-click -> modal editor (full-screen white canvas over
  dimmed board, dedicated route).
- Toolbar (same in card and board mode): Pen, Selection tool, Eraser |
  Colour (swatch + palette) | Line weight (4 sizes, keys 1-4) |
  Undo, Redo | Cancel/Discard, Save. Save disabled until a stroke
  exists. Single pen type.
- Board Draw (rail/Shift+D): board dims, draw over everything;
  Save -> Annotation element; Cancel discards.

## 3. Interactions

- Create: drag type from left palette onto canvas; double-click canvas
  = note at cursor; Cmd+Return chains create.
- Palette: Note, Link, To-do, Line, Board, Column, Comment, "..."
  overflow {Sketch, Color, Document, Audio, Map, Video, Heading,
  Table}, Add image, Upload, Draw, Trash, default-colour well.
- Select: click card (single); click again enters edit; Esc exits
  edit, keeps selection, second Esc deselects. Rubber-band marquee +
  Cmd+A select-all + Shift-click range.
- Move: drag selected card(s); drag onto column drops inside; drag to
  Trash deletes; Opt+` sends to Unsorted inbox; arrows nudge.
- Resize: bottom-right handle (width) on notes and media cards.
- Multi-select tools: Colour, Align (6), Distribute,
  Connect with Lines, Lock, z-order.
- Pan: Space+drag (or wheel/trackpad); zoom Cmd+wheel / Cmd+=/-/0,
  Z scale-to-fit.
- Duplicate Cmd+D or Opt+drag; cut/copy/paste Cmd+X/C/V; paste styles
  Cmd+Opt+V; undo/redo; z-order shortcuts.
- Lines attach to card edges; endpoints drag to re-attach. Quick
  connect: a draggable circle+arrow handle appears at the right edge
  of a selected card (selection only, not hover); drag it onto
  another card to draw a line. Multi-select "Connect with Lines" is
  the batch version.
- Colour eyedropper: I key -> native OS screen colour picker
  (window.EyeDropper); sampled colour applies to the selected card.
- No right-click menus anywhere: the contextual left rail is the only
  menu surface.

## 4. Text editing (notes, headings, documents, table cells)

- In-place editing, "Start typing..." placeholder, auto-grow height,
  width resizable.
- Block styles: Large heading, Heading, Normal, Small, Code block,
  Callout, Quote block.
- Inline: Bold, Italic, Underline, Strikethrough, Highlight (6),
  text colour (6), Hyperlink.
- Lists: bullet, numbered, checkbox; indent/outdent via Tab/S-Tab.
- Markdown autoformat at line start: `#` `##` `*` `1.` `[]` `>` ` ``` `
  `!` `---`.
- @ mention (v2/collab only, omitted in v1); text alignment is a
  binary center toggle (rail icon + Cmd+\); spellcheck on.
- Hyperlink popup via Cmd+K or rail link icon: single URL field.
- Note edit rail order: Text style | Bold | Italic |
  Strikethrough | Bullet | Numbered | Center | Link | Comment |
  More {Inline code, Underline} | Trash. Link/Comment disabled until
  text selected. Document editor rail adds Indent/Unindent and moves
  Strikethrough+Center+Underline+Inline code under More.

## 5. Organisation features

- Labels: per-board named tags with colours; panel to create/apply/
  remove; chip rendered on card; searchable.
- Reactions: emoji picker on any card (search + categories + skin
  tone; to-do items take per-item reactions too).
- Comments: free-standing comment cards AND per-card comment threads;
  replies, edit; unread badge on cards.
- Unsorted inbox: side panel holding unplaced cards; Opt+` to file.
- Search (Cmd+F): board + card-content search (indexes note text,
  doc body, to-do items), sort by last viewed / modified / relevance,
  "Shared with" collaborator filter (empty single-user), "Recently
  viewed" list. Deep-links: board hit -> ?filter_query=<q>; card hit
  -> ?filter_query=<q>&filter_ids=<elementId> with card highlighted.
  Deep-links are live: board hit -> `#/b/<id>?filter_query=<q>`, card
  hit -> `&filter_ids=<elementId>`; on arrival the matched cards are
  selected and the first is centred. Simplification: highlight-and-centre
  only, no dimming pass.
- Trash: restorable bin: deleted cards grouped by day in a side
  panel; drag an item back onto the canvas to restore; "Empty trash"
  purges.
- Templates: new board offers template picker (empty + presets +
  "keep example content" toggle); any board convertible to template.
  We ship our own original template designs.
- Dark mode toggle; interface scale (smaller/larger UI).
- Presentation mode (Cmd+Opt+P or View > Present): `presenting`
  class hides chrome + rail; "Stop presenting (Esc)" button; toggles
  Focus on selected cards, Hide comments, Prevent editing.
- View menu: Zoom {out, 100% readout, in, Reset to 100%,
  Scale to fit} + Cmd+wheel tip; Presentation section {Present +
  the 3 toggles}.
- Preferences-surfaced features (all v1): card-overlap prevention
  (auto-push neighbours when a card grows), synced note copies
  ("Keep this copy in sync?" on duplicate), "Convert to a document?"
  helper on long notes, dot-grid toggle per board (background
  right-click), toolbar palette customization, ink effect
  (pressure/speed-sensitive pen width), undo/redo arrows toggle.
- Table numbers/dates are locale-aware (Use browser language) +
  currency-aware (per-user currency setting).
- i18n: ships English, Deutsch, Español, Français, Português.

## 6. Export

- Board layout: PNG; PDF standard (small) and high quality.
- Linear document: Word-style / Markdown / plain text, optional
  "Include sub-boards".
- Download all images/files as archive.
- Full board import/export as JSON (our format), replaces cloud sync.
- Annotation: Download SVG.

## 7. Keyboard shortcuts (complete map from in-app panel)

Essential: `/` shortcuts; dbl-click new note; Cmd+Return chain-create;
Space+drag pan; Cmd+Opt+P present; Cmd+F search; Delete delete;
Opt+` to unsorted; arrows nudge; @ mention; Cmd+dbl-click board ->
new tab; Cmd+Opt+click board -> new window; I eyedropper.
Basics: Cmd+X/C/V cut/copy/paste; Cmd+Opt+V paste styles; Cmd+Z undo;
Cmd+A select all; Esc deselect; Cmd+D duplicate (Opt+drag);
Cmd+Shift+Down/Up send back/bring forward.
Text: Cmd+Shift+1/2/0/9 large-h/h/normal/small; Cmd+B/I/U bold/italic/
underline; Cmd+Shift+U bullets; Cmd+Shift+O numbered; Cmd+K link;
Cmd+J highlight; Cmd+Shift+X strike; Cmd+> code; Cmd+" quote;
Cmd+Shift+6 callout; Cmd+\ centre; Tab/S-Tab indent.
To-do: Opt+Return title; Cmd+Shift+1 due date; Cmd+Shift+2 assign.
Table cell: Opt+Up row above; Opt+Left column left (Opt+Down/Right
presumed below/right).
Draw: Shift+D start; V select; E eraser; C palette; X prev colour;
1-4 pen size; Esc/Cmd+S save.
Nav: Cmd+[ / Cmd+] back/fwd; Cmd+U parent.
View: Cmd+Shift+D dark; Cmd+Shift+</> UI scale; Z fit; Cmd+=/- zoom;
Cmd+0 100%.

## 8. Data schema (ours; informed by the observed model)

```ts
Board { id, title, icon, color, palette, welcomeMessage?, parentId,
        position, grid, createdAt, modifiedAt, version }
Element { id, boardId, type, parentId (canvas|columnId|unsorted|cardId),
          x, y, w?, z, locked, syncGroup?, content: TypeContent, labels,
          reactions, createdBy?, createdAt, modifiedAt }
TypeContent =
  | { note: richdoc }
  | { link: url, preview: {title, desc, image, provider}, showPreview }
  | { todo: {title?, items: [{text, done, dueAt?, reminder?, assignee?}]} }
  | { line: {from, to, fromMarker, toMarker, dashed, weight, label} }
  | { boardRef: boardId }
  | { column: {title} }
  | { heading: text, level }
  | { swatch: color, name, caption?, showValue }
  | { document: richdoc, displayMode, wordCount }
  | { table: rows x cols cells [{text, type, align}], formulas }
  | { sketch: strokes[] }               // stroke = {pts:[x,y][], w?:widths[]} incl. pressure for ink effect
  | { annotation: strokes[] }           // board drawing layer element
  | { embed: {kind: audio|map|video, url, providerData, poster?} }
  | { image: {blobRef, caption?, source, credit?, mask?} }
  | { file: {blobRef, name, size, mime, ext} }
Comment { id, cardId|boardId, threadId, author, text, createdAt, editedAt }
Label { id, boardId, name, color }
Template = Board snapshot.
```

## 9. v1 scope: everything that works offline

### App shell / full user journey

- Opens straight into the app, no login, no onboarding gate.
- First run: Home board seeded with a small welcome/example board;
  dismissible hint toasts for core gestures (dbl-click note, drag
  palette, Space pan, `/` shortcuts).
- New boards: inline picker (empty, template, keep-example-content);
  duplicate any board via Convert to Template -> new board.
- Getting data in: drag files/images onto canvas, paste image or URL
  from clipboard, file picker, JSON import.
- Non-image files become generic file cards (icon + name + size +
  download on click). The card layout is our own minimal design.
- Clipboard: cut/copy/paste works within and across boards.
- Installable PWA: service worker caches app + sqlite wasm; fully
  offline after first load; data in OPFS survives restarts.
- Getting data out: all export formats, copy link address, Download
  SVG for drawings, Download all images/files.
- Settings surface (local): dark mode, UI scale, shortcuts panel,
  template management, storage usage indicator (bytes used per board
  type).

Included: all 17 card types incl. Annotation, nested boards, columns,
lines + connect + markers, labels, reactions, comments (local),
Unsorted, search, trash-with-restore, templates (our own designs),
dark mode, UI scale, presentation mode, full text editing, due dates
(local reminders optional), to-do assign (self only), alignment/
distribute, sketch + board draw + annotation, document editor,
table + 6 formulas, image/file import, board default colour,
eyedropper, icon picker (our icon set + monogram + upload), export
(PNG/PDF/Markdown/JSON/SVG), the full shortcut map, autosave,
quick-capture inbox, i18n
(en/es/fr/pt string tables), card
overlap prevention, synced note copies, ink-effect pen pressure,
per-board dot-grid toggle, toolbar palette customization,
locale/currency-aware table cells, document ICON/DETAIL card views,
image draw-on + cut-out/remove-background, file cards with
Download/Open.

Link unfurl: no server-side OG fetch offline. v1 stores URL + title
(+ manual thumbnail); when online, optionally enriches via a
CORS-safe metafetch or Google's favicon service (user choice).

### Online-capable, still no backend of ours (in v1)

These call third-party/public APIs straight from the browser. All
degrade gracefully when offline; each sits behind a setting.

- Stock image search: Pexels (or Unsplash) with the user's own free
  API key. Full UI already spec'd: search box, Recommended +
  per-title-word tabs, drag-to-place grid, Load more, "Photo by"
  credit, Upload your own fallback.
- URL unfurl: fetch OG title/desc/image via a CORS-friendly proxy or
  reader service; favicon via Google's favicon service. Falls back
  to manual entry offline.
- Embed players: YouTube, Vimeo, Spotify, SoundCloud, Google Maps:
  pure client-side iframes; show an offline placeholder with no
  connection.
- Web clipper: browser extension saving to the local app over
  extension messaging/localhost, no backend required. Build late v1.
- Reminders: local Notification API for due-date reminders while the
  app runs; no push server.
- Self-synced storage: boards can also live as .board files in a
  user-synced folder (iCloud/Dropbox/WebDAV mount) or be passed
  device-to-device, poor man's sync with zero server.

## 10. Out of scope: needs OUR backend

The only features excluded, and only because they require
infrastructure we are not building:

- Accounts, login, cloud sync, real-time collaboration.
- Editor invites (email/link), board member lists beyond self.
- Cross-user notify-on-edit bell, read-only public links, passwords,
  public embed codes, welcome messages, view counters.
- Mobile-app capture feed and any cloud-hosted clipper.
- In-app support chat widget.
