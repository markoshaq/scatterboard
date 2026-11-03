# Changelog

Notable changes per release, newest first. Sections: Added, Changed, Fixed, Removed.

## [Unreleased]

## [0.1.1] - 2026-11-03

Bug fixes and small feature polish on 0.1.0.

### Added

- Settings toggle "Edit new cards on drop" (on by default): notes, to-dos, headings, documents, comments, tables and columns dragged or clicked from the rail open straight into editing.
- To-do due dates support an optional time: the picker keeps an "Add due time" row, and the card label shows the clock time when one is set.
- Link and embed cards derive a title from the URL itself where possible (Google Maps place names and search queries), and embed cards unfurl the page title without needing the link-preview setting.
- Underline and inline code sit directly in the note and heading edit rail instead of the More menu.

### Fixed

- The per-item reaction button on to-do cards opened the date picker instead of the reaction picker.
- Link cards kept the bare host as their title even after a successful unfurl; fetched titles now replace auto-derived ones.
- Links in note, heading, document and table text opened inside the app tab; http(s) links now open in a new tab, and clicking one no longer enters edit mode.
- Label and reaction chips on column members overlapped the card below; members with chips now reserve room for the row.
- Board draw mode drew a stroke when a toolbar button was clicked: the toolbar sat inside the capture surface and the click started a gesture underneath it.
- Column members painted no selection ring when selected.
- The welcome board's "Get around" list was a note styled like checkboxes; it is now a real to-do card, and notes no longer fake checklist blocks.
- Release notes on GitHub wrapped early because changelog bullets were hard-wrapped; bullets are now single lines.
- Cards looked blurry during and after pan and zoom: the board layer was pinned as a composited surface showing a stale scaled raster, and fractional pan offsets split 1px edges across two pixels; the pin is gone and pan now snaps to the device-pixel grid.
- Wheel zoom restyled the board per event and re-measured counter-scaled handles every 2% of zoom; transform writes now coalesce into the animation frame and the counter-scale updates at a coarser step.
- To-do cards had no resize handle at all, and rows could clip their due pill: cards now grow to keep due, assignee and reaction chips on one line (never shrink past a manual resize).
- To-do row chrome mixed per-element margin fudges with self-centered pills; everything now centers on the row's cross axis.
- To-do due and reaction buttons reveal on row hover instead of requiring an edit session first.
- The emoji picker opened flush with its anchor's top edge and covered the row; it now drops just below the button like the date picker.
- Column members mid-reorder clipped at the column's edge (paint containment) and left their label/reaction chips behind in the slot; the column drops paint clipping and the chips ride the lifted card.
- Chip rows anchored in the overlay host (column members, dragged cards) stacked every chip on its own line: the host is 0x0 so the row shrink-fit to its narrowest width; rows now size to their content and wrap only at the card-width cap.
- Member chips and pins lived in the overlay host above every card, so a dragged card slid under a member's labels and reactions; they now seat after the member's column and honour the same z order.
- Selection rings were canvas-drawn under every card, so a card above a column lost its ring to the column's surface; mounted cards carry a DOM outline at their own z (culled selections keep the canvas ring).
- During a column reorder the lifted member occludes its siblings: their chips and comment pins hide instead of floating above it, and the connect handle now disappears for the whole drag, not just member lifts.
- Lines attached to a column member lost their tail inside the column's opaque surface; the inside-column span renders as svg inside the column card, between its surface and the member stack, so z order stays honest for covering cards, and line endpoints follow a member's reorder lift.

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
