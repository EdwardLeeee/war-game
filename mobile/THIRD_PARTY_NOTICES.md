# Third-party notices: the iOS app (`mobile/`)

The app carries the game (`client/`, see `client/THIRD_PARTY_NOTICES.md` for what that build
contains) inside a native shell made with the following. Their licence texts go into the app with
the game (`scripts/web.ts` copies them to `licenses/`).

| Component | Version | Licence | Used for |
|---|---|---|---|
| Capacitor (`@capacitor/core`, `@capacitor/ios`, `@capacitor/cli`; the native `Capacitor` and `Cordova` frameworks from `capacitor-swift-pm`) | 8.6.2 | MIT | The iOS shell: the web view that runs the game |

Build and test tools that do not go into the app: `xcodeproj` (Ruby gem, MIT; CI only, adds the
smoke test target), Xcode and the iOS SDK (Apple).
