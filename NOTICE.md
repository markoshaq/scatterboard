# Third-party notices

This project vendors the following third-party components. Everything
else in the repository is original work licensed under MIT (see
LICENSE).

## SQLite WASM build (`public/jswasm/`)

Files: `sqlite3.wasm`, `sqlite3-worker1.mjs`
Source: https://sqlite.org (SQLite 3.54.1, built with Emscripten SDK
5.0.5)

The SQLite library is in the public domain. From the upstream source:

> The author disclaims copyright to this source code. In place of a
> legal notice, here is a blessing:
>
> - May you do good and not evil.
> - May you find forgiveness for yourself and forgive others.
> - May you share freely, never taking more than you give.

The Emscripten-generated JavaScript glue code inside
`sqlite3-worker1.mjs` is covered by the MIT license and the University
of Illinois/NCSA Open Source License, as described at
https://emscripten.org/docs/introducing_emscripten/emscripten_license.html
The license banner is preserved at the top of that file.
