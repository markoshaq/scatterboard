# Changelog

Notable changes per release, newest first. Sections: Added, Changed,
Fixed, Removed.

## [Unreleased]

## [0.1.0] - 2026-11-02

### Added

- Initial release: infinite-canvas planning boards with 17 card types,
  nested boards, columns, and labelled connector lines.
- Rich text editing across notes, headings, documents, and table cells
  with markdown autoformat; dedicated document editor with Word,
  Markdown, and plain text export.
- Tables with per-cell types and `SUM`, `IF`, `MIN`, `MAX`, `COUNT`,
  `AVERAGE` formulas over A1 references and ranges.
- Drawing tools: pressure-sensitive sketch cards, draw-on-image, board
  draw mode, and a client-side image editor (crop, rotate, flip,
  background cutout).
- Organization: labels, reactions, comment threads, Unsorted inbox,
  Trash with restore, board search, templates, quick capture, synced
  note copies, dark mode, presentation mode.
- Local-first storage: SQLite WASM on the OPFS sync-access-handle pool
  with a localStorage fallback, media blobs in IndexedDB; installable
  offline PWA.
- Import/export: board PNG, standard and high-quality PDF, linear
  Word/Markdown/plain text, media zip, and full-board JSON.
- Optional online extras: link-card enrichment and YouTube, Vimeo,
  Spotify, SoundCloud, and Google Maps embeds.
- UI in English, Deutsch, Español, Français, and Português.
