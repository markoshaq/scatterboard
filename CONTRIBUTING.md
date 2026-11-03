# Contributing

Thanks for helping out. A few ground rules keep this project clean.

## Setup

```
npm install
npm run dev
```

`npm run typecheck` and `npm run lint` must pass before you open a PR.
`npm test` runs the vitest suite in `test/`; add cases when you change
state logic, schema migration, import/export, or parsing.

## Rules of the road

- Everything in this repo is original work. Do not copy code, icons,
  copy, or assets from other products, open source or not, without
  checking the license first. If you vendor a third-party component,
  add it to NOTICE.md.
- Vanilla TypeScript only. No frameworks, no UI libraries, no new
  runtime dependencies without a discussion first.
- Compact, idiomatic code. No comments unless the code is genuinely
  non-obvious.
- Keep the app fully offline. No network calls in the default path.
- Keep JS gzip size under the 150KB budget noted in AGENTS.md.
- Read AGENTS.md before large changes; it documents the architecture
  and the conventions the codebase follows.

## Pull requests

Keep PRs small and focused. Describe the behaviour change and how you
verified it. By contributing you agree your changes are licensed under
the project's MIT license.
