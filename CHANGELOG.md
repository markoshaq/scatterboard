# Changelog

Notable changes per release, newest first. Sections: Added, Changed, Fixed, Removed.

## [Unreleased]

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
