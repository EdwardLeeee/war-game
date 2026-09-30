# Third-party software in the engine spike

Only the spike (`spikes/`) and its GitHub Pages test pages. The game itself has no
third-party code yet.

| Software | Version | Licence | Where it ends up |
|---|---|---|---|
| PixiJS | 8.21.0 | MIT | Bundled into the web test page and the Capacitor simulator apps |
| Capacitor (core, iOS, Android, CLI) | 8.5.2 | MIT | Simulator apps built in CI only; not published |
| Godot Engine | 4.7.2 | MIT, plus the third-party components listed in its `COPYRIGHT.txt` | Godot web test page and simulator apps |
| Emscripten runtime (inside the Godot web export) | as shipped with Godot 4.7.2 | MIT / University of Illinois NCSA | Godot web test page |
| Vite | 8.3.1 | MIT | Build tool only |
| TypeScript | 7.0.2 | Apache-2.0 | Build tool only |
| Playwright | 1.63.0 | Apache-2.0 | CI browser test only |

The Pages site links the full licence texts from `licenses.html`: PixiJS's `LICENSE` from
the installed package, and Godot's `LICENSE.txt` and `COPYRIGHT.txt` from the
`4.7.2-stable` tag, copied at build time by `.github/workflows/spike-pages.yml`.

Placeholder art (`web/public/art/`, `godot/art/`, `godot/icon.png`) is drawn by
`tools/make-art.mjs` from geometric shapes; no third-party assets are used.
