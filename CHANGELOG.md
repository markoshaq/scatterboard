# Changelog

Notable changes per release, newest first. Sections: Added, Changed, Fixed, Removed.

## [Unreleased]

## [0.3.0] - 2026-11-06

Workspace encryption, repeating and reminded due dates, table CSV,
elbow lines, and browsable snapshots.

### Added

- Settings > Privacy > Encrypt workspace protects the whole
  workspace, media included, with a passphrase. Reloading locks it
  behind an unlock screen, Lock now locks it on demand, and Remove
  encryption decrypts it again. A forgotten passphrase cannot be
  recovered.
- The due picker gains a Repeat field: to-do items can recur daily,
  weekly, monthly or yearly. Checking one off lines up the next date
  as a fresh item, and repeating items show a ↻ badge.
- Settings > Due reminders pings you when dated to-do items come due
  while the app is open: timed items at their time, date-only items
  at 9am.
- Dropping or pasting a .csv file onto the board creates a table
  card, and a table card's menu downloads its cells back out as CSV.
- While editing a table, the focused cell's menu sorts its rows by
  that column, A to Z or Z to A.
- A selected line gains a Route tool: straight or elbow.
- Version history rows offer Browse snapshot: look inside a
  snapshot's boards and cards, then restore one board or one card
  without rolling the whole workspace back.
- Settings > Backup gains an Export a backup button, and when no
  backup folder is set up the app reminds you to export one once it
  has been a while since the last.

## [0.2.3] - 2026-11-06

Folder backup, named version history, a board minimap, a Due panel
for dated to-dos, a new icon, and a round of quality-of-life wins.

### Added

- Settings > Backup mirrors the workspace and its media into a folder
  you pick (browsers with File System Access, like Chrome and Edge).
  Point it at a synced folder for device sync; a newer mirror offers
  a restore on open.
- Settings > Version history keeps named workspace snapshots you can
  restore or delete, plus a daily automatic snapshot.
- A corner minimap shows the whole board and the visible area; click
  or drag it to pan. View > Minimap hides it.
- A topbar chip counts to-do items that are overdue or due today and
  opens a Due panel listing every dated item across all boards, with
  jump-to-card and mark done.
- A second open tab picks up saves from the first; when it has
  unsaved or in-flight work it asks before reloading.
- Deleting cards offers an Undo toast.
- Clicking a colour swatch's value copies its hex.
- `Z` frames the selected cards when something is selected.
- Search results answer to the arrow keys and Enter, and a scope
  switch lets search scan every board, not just the current one,
  with the board named on each hit.
- Double-click the board name in the topbar to rename it.
- Dragging a card to the screen edge pans the board.
- Boards panel rows can copy a board's link.
- Image cards take alt text for screen readers.
- On touch, holding a card and tapping a second finger opens its menu.
- High-contrast mode strengthens muted colours, and About shows the
  last export date.
- Copy also puts the cards' text on the system clipboard, so pasting
  into other apps works.
- The card menu offers Copy Link to Card, Copy as Image (a rendered
  PNG of the pick), Copy Image on image cards, and an Edited
  timestamp.
- Arrow keys step card to card while presenting.
- The Boards panel opens with a Recently viewed jump list.
- Trash offers Restore all.
- The Unsorted panel sorts by recently added, oldest, last modified,
  A to Z, or type.
- Settings gains a spell check toggle.
- The browser tab title shows the current board's name.
- Pasting a URL while a link or embed card is selected re-points that
  card instead of creating a new one.
- If local saves keep failing, the app warns and offers a JSON export
  so nothing is lost.

### Changed

- Touch: dragging on a card now pans the board; cards only move when
  you drag one that is already selected (tap selects).
- New app icon: three fanned cards in light and dark variants, and the
  browser tab icon follows your system theme.
- Status messages drop the colored edge strip for a small dot that
  matches the rest of the app.

## [0.2.2] - 2026-11-05

A phone layout, keyboard navigation, app install and sharing, a
right-click menu, and a broad accessibility and polish pass.

### Added

- Phones get their own layout: the tool rail becomes a bottom bar,
  popups dock as sheets, and the topbar tucks into a '...' menu.
- Touch: pinch to zoom, two-finger pan, hold for marquee select.
- Right-click a card, line or comment pin for its tools.
- Keyboard navigation: Tab and Shift+Tab step through cards, Enter
  starts editing, and an arrow key with nothing selected jumps to the
  nearest card.
- Installable as an app: Help > Install app where offered, Share > Add
  to Home Screen on iOS, home-screen shortcuts for quick capture and a
  new board, and sharing text or links to Scatterboard files them into
  Unsorted.
- After one visit the whole app is stored for offline use, so even a
  fresh install launches with no connection.
- Empty boards show a hint with an Add a note button.
- Colour swatches can be resized.
- Map embeds get an Open map button; embed placeholders tint by
  provider.
- Spotify embeds get their own compact player face, and still swap in
  the real player on click.
- Exports and imports show progress and confirm when done.
- Board icons can be changed from the boards panel, and clicking a
  card's label or reaction chip opens that popup.
- The shortcut panel groups keys under Cards, Editing, View and
  Presentation.

### Changed

- "Projects" are called "Boards" everywhere.
- Zoom buttons and shortcuts glide to the new level instead of jumping.
- New cards pop in, deleted cards fade out, and every popup and panel
  shares one closing fade.
- If something goes wrong the app saves first, then offers a reload.
- Saved data that can no longer be read is kept aside and offered as a
  backup download instead of being overwritten.
- Icon buttons have tooltips, and menus, pickers and editors work with
  keyboards and screen readers.
- Sketch and image editors fit small windows.

### Fixed

- Pasted markup could smuggle active content into card text; edits are
  now scrubbed on save.
- Typing in a synced note copy could leak into copies on other boards.
- Deleting a board with sub-boards could delete cards it should have
  kept; column members now unfile and loose ends detach instead.
- An aborted AI-agent run could eat your last undo, and malformed agent
  commands could half-apply; both are now refused cleanly.
- The due-date picker could open off-screen on small windows.

## [0.2.1] - 2026-11-04

Drag and drop fixes, an agent menu in the topbar, and a clearer
pairing prompt.

### Added

- A robot icon between Help and Settings opens the agent menu: connection
  status, connect/disconnect, and a setup prompt you can copy to your AI
  agent. The agent row moved here out of Settings.
- Pairing now asks in a centered dialog over a darkened board instead of
  a toast.

### Changed

- Enrich link cards is on by default; your setting stays if you already
  changed it.
- Language is a dropdown instead of radio rows. "Automatic" reads "Auto"
  and "Toolbar palette" is now "Manage toolbar palette".
- Clicking through the boards panel keeps it open and moves the
  current-board marker.

### Fixed

- `sb_open` put the pairing token after the `#` in board URLs, so the app
  never saw it and no prompt appeared.
- Fast drags often never landed: any zero-button pointermove cancelled
  the gesture. It now only cancels when the pointer really leaves the
  window.
- Cards dragged from Unsorted or Trash onto a column ended up hidden
  under it on the canvas; they now file into the column.
- Palette items dropped over the side panel or an editor scrim spawned
  a hidden card; the drop now cancels instead.
- The toolbar palette editor opened over its button instead of below it.
- Side panels had no left border, and popup headings sat left of their
  rows.

## [0.2.0] - 2026-11-03

AI tools can drive a live board through an optional local agent, plus
a reworked welcome board and assorted fixes.

### Added

- "Local agent" setting (off by default, Settings > Online extras): pairs the tab with a localhost bridge so MCP tools can read and edit boards. `npx -y scatterboard-mcp install` registers the bridge, `sb_open` pairs a tab; every change lands as normal undoable history and is refused while presenting with editing locked.
- Command links: a shared `?do=` link runs a command list once at boot, and a list that would change anything asks for confirmation first.
- The welcome board is now a top-to-bottom guided tour with numbered sections and a live example of every card type.

### Fixed

- WebP, GIF, SVG and AVIF images pasted or dropped onto the board lost their transparency to JPEG; alpha is now kept for every format that can carry it.
- Pasting a bare "localhost:3000" now makes a link card; previously only dotted hosts were recognized.
- Link cards can no longer store a URL that would run code on click.
- Search no longer lists anchored comment pins, which have no card to jump to.
- PNG export could hang on a stuck SVG image; it now falls back after 5s, and the fallback renderer follows the theme instead of hardcoded colours.
- Drag fixes: a drop between column members lands in the right slot, the trash hint rings only real cards, a selected but locked card still works as a snap target, and a gesture in flight cannot mutate the board while presenting with editing locked.
- The Help menu opened level with its button instead of below it like View and Export.
- Heading cards drew a square selection outline instead of a rounded one.
- The service worker purged every cache it found on activation; it now only clears its own.

## [0.1.1] - 2026-11-03

Bug fixes and small feature polish on 0.1.0.

### Added

- "Edit new cards on drop" setting (on by default): cards created from the rail open straight into editing.
- To-do due dates can carry a clock time, shown on the card when set.
- Link and embed cards derive a title from the URL itself (Google Maps place names, search queries); embed cards also fetch the page title without the link-preview setting.
- Underline and inline code are now direct rail tools on notes and headings.

### Fixed

- To-do cards: the reaction button opened the date picker, due and reaction buttons needed an edit session to appear, there was no resize handle, and rows could clip their pills. Buttons now reveal on row hover, rows center consistently, and the card grows to keep every row on one line.
- Links in card text opened inside the app tab; http(s) links now open in a new tab without entering edit mode.
- Link cards kept the bare host as their title even after a successful unfurl.
- Column members showed no selection ring, their chips overlapped the card below and detached or mis-stacked during reorder, and a dragged card slid under member chips and pins.
- Lines attached to a column member lost their tail inside the column; the inside span now renders and endpoints follow the member's reorder lift.
- Cards looked blurry during and after pan and zoom, and wheel zoom did redundant restyle work per event.
- The emoji picker covered its row instead of dropping below the button.
- Board draw mode drew a stroke when a toolbar button was clicked.
- The welcome board's "Get around" list is now a real to-do card instead of a note faking checkboxes.

## [0.1.0] - 2026-11-03

First public release.

- Infinite-canvas boards on a dot grid, with 17 card types: notes, headings, to-dos, links, video/audio/map embeds, nested boards, columns, comments, colour swatches, documents, tables, sketches, annotations, images and files, plus connector lines.
- Rich text with markdown autoformat, and a dedicated document editor with word count and Word, Markdown and plain-text export.
- Tables with typed cells and six formulas (SUM, IF, MIN, MAX, COUNT, AVERAGE).
- Drawing: pressure-sensitive sketch cards, drawing on images, board draw mode, and an image editor for crop, rotate, flip and background cutout.
- Organization: labels, emoji reactions, comments, an Unsorted inbox, Trash with restore, board search, templates, quick capture, synced note copies, dark mode, a per-board dot-grid toggle and presentation mode.
- Export: board PNG, standard and high-quality PDF, Word, Markdown, plain text, a media zip, and full-board JSON for backup or device-to-device sync.
- Local-first and offline: boards live in the browser and nothing phones home; installable as an app. The only online extras, link previews and embed players, are off by default.
- UI in English, Deutsch, Español, Français and Português.
