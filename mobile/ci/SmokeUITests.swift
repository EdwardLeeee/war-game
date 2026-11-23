// The app's smoke test (D-163, stage 1), on an iPhone simulator made fresh for it, with the smoke
// copy of the game (mobile/scripts/web.ts --smoke: the game records' Worker turned into a dead
// address, so the app reaches nothing on the network). Played as a person would, by the page's own
// buttons, no test page: a fresh install starts a game, plays past 2 minutes of game time, goes to
// the background (the page saves), is killed, opens again and goes on with 繼續上一局.
//
// Not committed into the Xcode project: mobile/ci/add-ui-tests.rb adds it on the runner.
// Each step prints a "SMOKE <seconds> <what>" line; the workflow puts them in the run's Summary.

import XCTest

final class SmokeUITests: XCTestCase {
    private let app = XCUIApplication()
    private var t0 = Date()

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
    }

    private func log(_ what: String) {
        print(String(format: "SMOKE %6.1fs %@", Date().timeIntervalSince(t0), what))
    }

    private func shot(_ name: String) {
        let a = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        a.name = name
        a.lifetime = .keepAlways
        add(a)
        log("screenshot \(name)")
    }

    /// The first element of a type whose label matches.
    private func first(_ type: XCUIElement.ElementType, _ format: String, _ arg: String) -> XCUIElement {
        app.descendants(matching: type).matching(NSPredicate(format: format, arg)).firstMatch
    }

    /// smoke/mobile-diag.js's line: page errors since the page opened, and the web view's facts.
    private func diag() -> String {
        let e = first(.staticText, "label BEGINSWITH %@", "mobile-diag ")
        return e.exists ? e.label : "(mobile-diag not found)"
    }

    private func assertNoPageErrors(_ when: String) {
        let d = diag()
        log("diag \(when): \(d)")
        XCTAssertTrue(d.contains("\"errors\":0"), "page errors \(when): \(d)")
    }

    /// The game time the HUD shows (m:ss) in seconds; nil when none is on screen.
    private func gameSeconds() -> Int? {
        let clocks = app.descendants(matching: .staticText).matching(NSPredicate(format: "label MATCHES %@", "^[0-9]+:[0-9]{2}$"))
        var best: Int?
        for i in 0 ..< clocks.count {
            let parts = clocks.element(boundBy: i).label.split(separator: ":")
            if parts.count == 2, let m = Int(parts[0]), let s = Int(parts[1]) { best = max(best ?? 0, m * 60 + s) }
        }
        return best
    }

    /// Waits until the HUD's game time reaches `seconds`; the last time seen.
    private func waitForGameTime(_ seconds: Int, timeout: TimeInterval) -> Int {
        var last = -1
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if let s = gameSeconds() {
                if last < 0 || s / 30 != last / 30 { log(String(format: "game time %d:%02d", s / 60, s % 60)) }
                last = s
                if s >= seconds { break }
            }
            sleep(3)
        }
        return last
    }

    func testFreshInstallPlaySaveContinue() throws {
        t0 = Date()

        // 1. A fresh install opens on the start screen, with nothing to go on with.
        app.launch()
        let start = app.buttons["開始"]
        XCTAssertTrue(start.waitForExistence(timeout: 180), "開始 never appeared")
        log("start screen")
        shot("01-start-screen")
        assertNoPageErrors("on the start screen")
        XCTAssertFalse(first(.button, "label BEGINSWITH %@", "繼續上一局").exists, "a fresh install already offers 繼續上一局")

        // 2. A game: 開局提示 (D-044) pauses it until 知道了.
        start.tap()
        log("tapped 開始")
        let ok = app.buttons["知道了"]
        if ok.waitForExistence(timeout: 240) {
            shot("02-town-hint")
            ok.tap()
            log("closed 開局提示")
        } else {
            log("no 開局提示 within 240 s")
        }

        // 3. Past 2 minutes of game time (normal speed, 30 ticks a second: about 80 s).
        let played = waitForGameTime(130, timeout: 600)
        XCTAssertGreaterThanOrEqual(played, 130, "the game time never passed 2:10 (last seen \(played) s)")
        shot("03-battle-past-2-minutes")
        assertNoPageErrors("after 2 minutes")

        // 4. Away (the page keeps the game on visibilitychange), then killed.
        XCUIDevice.shared.press(.home)
        log("pressed Home")
        sleep(5)
        app.terminate()
        log("terminated")

        // 5. Opened again: 「繼續上一局（第 N 分）」 with N ≥ 2.
        app.launch()
        let goOn = first(.button, "label BEGINSWITH %@", "繼續上一局")
        XCTAssertTrue(goOn.waitForExistence(timeout: 180), "no 繼續上一局 after opening again")
        log("opened again: \(goOn.label)")
        shot("04-continue-offered")
        let minute = Int(goOn.label.components(separatedBy: CharacterSet.decimalDigits.inverted).joined()) ?? -1
        XCTAssertGreaterThanOrEqual(minute, 2, "kept at minute \(minute): \(goOn.label)")

        // 6. Going on: the simulation runs again up to where it was, then the battlefield, paused.
        goOn.tap()
        log("tapped \(goOn.label)")
        let back = waitForGameTime(minute * 60, timeout: 300)
        XCTAssertGreaterThanOrEqual(back, minute * 60, "the battlefield did not come back at minute \(minute) (last seen \(back) s)")
        XCTAssertFalse(start.exists && start.isHittable, "still on the start screen")
        shot("05-continued")
        assertNoPageErrors("after going on")
        log("done")
    }
}
