# Third-party software in the prototype client

Only `client/` and the prototype page it builds (`proto/` on the GitHub Pages test site).

| Software | Version | Licence | Where it ends up |
|---|---|---|---|
| PixiJS | 8.21.0 | MIT | Bundled into the prototype page |
| Vite | 8.3.1 | MIT | Build tool only |
| TypeScript | 7.0.2 | Apache-2.0 | Build tool only |
| Playwright (`@playwright/test`) | 1.63.0 | Apache-2.0 | CI browser tests only |

The Pages site's `licenses.html` (from `site/licenses.html`) links PixiJS's full `LICENSE`,
copied at build time by `.github/workflows/pages.yml`.

Placeholder graphics are drawn by the page's own code from geometric shapes; no
third-party assets are used.
