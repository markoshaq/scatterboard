# Changelog

Notable changes per release, newest first. Sections: Added, Changed, Fixed, Removed.

## [Unreleased]

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
