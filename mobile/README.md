# mobile/：iOS app（war-game-mobile）

The game as an iPhone app (D-163; brief `docs/briefs/2026-11-ios-app.md`). Capacitor 8 wraps
the client's build, carried inside the app (no website shell). iPhone only, landscape only, full
screen. Free: no purchases, no ads. TestFlight first.

| Path | What |
|---|---|
| `package.json` | Capacitor's three packages, one exact version (`scripts/check-versions.ts` checks them against `ios/App/CapApp-SPM/Package.swift` and any `@capacitor/*` in `client/`) |
| `capacitor.config.json` | bundle ID `com.edwardleeee.wargame` (can never change after the first upload), web dir `www/` |
| `ios/` | the native project, from `npx cap add ios` (Swift Package Manager), then: iPhone only, landscape, status bar hidden, `ITSAppUsesNonExemptEncryption` false, `PrivacyInfo.xcprivacy`, version 0.1.0 |
| `scripts/web.ts` | copies `client/dist` into `www/` with the licence texts and checks that nothing in it comes from the network; `--smoke` makes the smoke test's copy |
| `scripts/icon.py` | the temporary icon: the web app's crystal shard at 1024 × 1024, opaque |
| `smoke/mobile-diag.js` | in the smoke copy only: page errors and web view facts, for the test to read |
| `ci/` | the CI's smoke test (XCUITest, added to the project on the runner only), its runner script and the built app's checks |

## Building

On a Mac (CI does this on `macos-latest`; this repo's machines are Linux, see `.github/workflows/mobile-pr.yml`):

```sh
(cd client && npm ci && node scripts/fetch-art.ts && npm run build)
cd mobile && npm ci
node scripts/web.ts            # www/ = the game as it ships
npx cap sync ios               # www/ → ios/App/App/public, Package.swift
```

then build `ios/App/App.xcodeproj`, scheme `App`. `www/`, `ios/App/App/public/` and the generated
config files are build products, never committed.

Upgrading Capacitor: the three packages to the same exact version, `npx cap sync ios` (rewrites
`Package.swift`), `node scripts/check-versions.ts`.

## Keys

Signing keys, certificates, provisioning profiles, `.p8` and `.p12` files never go into the repo or
any file in it, and are never printed. They live in GitHub Actions secrets, set by the user with
`gh secret set`.
