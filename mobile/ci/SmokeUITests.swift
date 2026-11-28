// The app's smoke test (D-163, stage 1), on an iPhone simulator made fresh for it, with the smoke
// copy of the game (mobile/scripts/web.ts --smoke: the game records' Worker turned into a dead
// address, so the app reaches nothing on the network). Played as a person would, by the page's own
// buttons, no test page: a fresh install starts a game, plays past 2 minutes of game time, goes to
// the background (the page saves), is killed, opens again and goes on with 繼續上一局.
//
// Not committed into the Xcode project: mobile/ci/add-ui-tests.rb adds it on the runner.
// Each step prints a "SMOKE <seconds> <what>" line; the workflow puts them in the run's Summary.
// The main path stops at its first failure (with the accessibility tree printed, to see what the
// test could see in the web view); page errors and the like are collected and fail the test at the end.

import XCTest

final class SmokeUITests: XCTestCase {
    private let app = XCUIApplication()
    private var t0 = Date()
    /// Problems that do not stop the main path; the test fails on them at the end.
    private var findings: [String] = []

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

    private struct Stopped: Error, CustomStringConvertible {
        let description: String
    }

    /// The main path cannot go on: what was on screen and in the accessibility tree, and the error
    /// to throw (the test fails with it; the screenshots so far stay in the result).
    private func stop(_ why: String) -> Stopped {
        shot("failed")
        log("FAILED: \(why)")
        print(app.debugDescription)
        return Stopped(description: why)
    }

    /// The first element of a type whose label matches.
    private func first(_ type: XCUIElement.ElementType, _ format: String, _ arg: String) -> XCUIElement {
        app.descendants(matching: type).matching(NSPredicate(format: format, arg)).firstMatch
    }

    /// smoke/mobile-diag.js's line: page errors since the page opened, and the web view's facts.
    private func checkDiag(_ when: String) {
        let e = first(.staticText, "label BEGINSWITH %@", "mobile-diag ")
        guard e.waitForExistence(timeout: 10) else {
            findings.append("mobile-diag not found \(when)")
            log("diag \(when): not found")
            return
        }
        // Read once: each read is a new query of a line the page rewrites.
        let label = e.label
        log("diag \(when): \(label)")
        if !label.contains("\"errors\":0") { findings.append("page errors \(when): \(label)") }
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

    /// Waits until the HUD's game time reaches `seconds`, closing any 知道了 dialog on the way
    /// and saying when the clock stops; the last time seen (-1: no clock at all).
    private func waitForGameTime(_ seconds: Int, timeout: TimeInterval) -> Int {
        var last = -1
        var since = Date()
        var stalled = false
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            let ok = app.buttons["知道了"].firstMatch
            if ok.exists && ok.isHittable {
                shot("dialog-\(Int(Date().timeIntervalSince(t0)))s")
                ok.tap()
                log("closed a 知道了 dialog")
            }
            if let s = gameSeconds() {
                if s != last {
                    if last < 0 || s / 30 != last / 30 { log(String(format: "game time %d:%02d", s / 60, s % 60)) }
                    last = s
                    since = Date()
                    stalled = false
                } else if !stalled && Date().timeIntervalSince(since) > 20 && s < seconds {
                    stalled = true
                    log(String(format: "game time stuck at %d:%02d for 20 s", s / 60, s % 60))
                    shot("stuck-\(s)s")
                }
                if s >= seconds { break }
            }
            sleep(2)
        }
        return last
    }

    /// The web view's screen (mobile-diag.js's "mobile-view" line) in both landscapes, for the
    /// client's tests (2026-11-27). smoke.sh runs it on its own, after the smoke test, with
    /// VIEW_LABEL saying the system's text size; testViewFactsSafari reads the same page in Safari.
    private func readView(_ a: XCUIApplication, _ label: String) throws {
        let e = a.descendants(matching: .staticText).matching(NSPredicate(format: "label BEGINSWITH %@", "mobile-view ")).firstMatch
        if !e.waitForExistence(timeout: 180) { throw stop("no mobile-view line (\(label))") }
        for (name, o) in [("left", UIDeviceOrientation.landscapeLeft), ("right", .landscapeRight), ("left again", .landscapeLeft)] {
            XCUIDevice.shared.orientation = o
            sleep(4)
            log("VIEW \(label) landscape \(name): \(e.label)")
            shot("view-\(label)-\(name.replacingOccurrences(of: " ", with: "-"))")
        }
    }

    func testViewFacts() throws {
        t0 = Date()
        app.launch()
        try readView(app, ProcessInfo.processInfo.environment["VIEW_LABEL"] ?? "app")
    }

    /// client/src/lab/stable-buttons.ts's line: the client keeps these names (2026-11-27).
    private struct Stable {
        let step: Int
        let total: Int
        let done: Bool
        let ok: Bool
        /// seq: one more for every tap the page asks for (the same place may be asked twice in a row).
        let next: (id: String, x: Double, y: Double, times: Int, gap: Int, seq: Int?)?
    }

    private func stable(_ label: String) -> Stable? {
        guard let i = label.firstIndex(of: "{"),
              let o = (try? JSONSerialization.jsonObject(with: Data(label[i...].utf8))) as? [String: Any]
        else { return nil }
        let num = { (v: Any?) in (v as? NSNumber)?.doubleValue }
        var next: (id: String, x: Double, y: Double, times: Int, gap: Int, seq: Int?)?
        if let n = o["next"] as? [String: Any], let x = num(n["x"]), let y = num(n["y"]) {
            next = (n["id"] as? String ?? "?", x, y, Int(num(n["times"]) ?? 1), Int(num(n["gap"]) ?? 150),
                    num(n["seq"]).map { Int($0) })
        }
        return Stable(step: Int(num(o["step"]) ?? -1), total: Int(num(o["total"]) ?? -1),
                      done: o["done"] as? Bool ?? false, ok: o["ok"] as? Bool ?? false, next: next)
    }

    /// 按鈕不動 (ceo 2026-11-27; the user on TestFlight 0.1.0 (4): the boxes jump when a unit's + and −
    /// are pressed). client's page (?test=1&mock=1&stable=1) lists the buttons, says where to tap next
    /// and measures every box from the first touch to a second after the last; this test taps there
    /// for real, as a finger does. The page's CSS px are this window's points (run 45970799576: 開始
    /// at 446.19,189.5 on the page, 446,189 here). Fails when the page ends not ok: a box moved more
    /// than 1 px, a tap landed elsewhere, or a button did the wrong thing. STABLE_REQUIRED (smoke.sh:
    /// the build has the client's module) makes a page without the line a failure.
    func testStableButtons() throws {
        t0 = Date()
        let env = ProcessInfo.processInfo.environment
        let required = env["STABLE_REQUIRED"] == "1"
        // mobile-stable-fake: mobile-diag.js's stand-in, checking this side alone (smoke.sh).
        let which = env["STABLE_LINK"] ?? "mobile-stable-buttons"
        app.launch()
        let link = app.links[which].firstMatch
        if !link.waitForExistence(timeout: 180) { throw stop("no \(which) link on the start screen") }
        link.tap()
        log("opened \(which)")
        let line = first(.staticText, "label BEGINSWITH %@", "stable-buttons ")
        if !line.waitForExistence(timeout: 120) {
            shot("stable-no-line")
            if required { throw stop("the page shows no stable-buttons line") }
            log("STABLE skipped: no stable-buttons line (this build has no client/src/lab/stable-buttons.ts)")
            return
        }
        // The page's whole account, written at the end of each step (client, 2026-11-27): which boxes
        // moved and by how much, where each tap landed, whether the reaction was right.
        let detail = first(.staticText, "label BEGINSWITH %@", "stable-detail ")
        let readDetail = { (when: String) in
            if detail.exists { self.log("STABLE detail \(when): \(detail.label)") }
        }
        let origin = app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
        // A tap is asked for once: by next.seq (client 2026-11-28: run 46053784184 read a step's
        // finished next a second time and tapped the old place again, hitting another button), or
        // by step on a page without seq. Nothing is tapped again until the page asks anew.
        var tapped: String?
        var seenStep = -1
        var since = Date()
        let end = Date().addingTimeInterval(1500)
        while Date() < end {
            let label = line.label
            guard let s = stable(label) else { throw stop("unreadable stable-buttons line: \(label)") }
            if s.done {
                readDetail("at the end")
                log("STABLE \(label)")
                shot("stable-done")
                if !s.ok { XCTFail("按鈕不動: \(label)") }
                return
            }
            if s.step != seenStep {
                if seenStep >= 0 { readDetail("after step \(seenStep)") }
                seenStep = s.step
            }
            let ask = s.next.map { n in n.seq.map { "seq \($0)" } ?? "step \(s.step)" }
            if let n = s.next, let ask, ask != tapped {
                for k in 0 ..< max(n.times, 1) {
                    if k > 0 { usleep(useconds_t(max(n.gap, 0) * 1000)) }
                    origin.withOffset(CGVector(dx: n.x, dy: n.y)).tap()
                }
                log("STABLE step \(s.step)/\(s.total) \(ask) \(n.id) at \(Int(n.x)),\(Int(n.y)) ×\(n.times)")
                tapped = ask
                since = Date()
            } else if Date().timeIntervalSince(since) > 60 {
                throw stop("the page asked nothing new for 60 s (step \(s.step), last \(tapped ?? "none")): \(label)")
            } else {
                usleep(300_000)
            }
        }
        throw stop("not done in 25 minutes: \(line.label)")
    }

    func testViewFactsSafari() throws {
        t0 = Date()
        // smoke.sh opened the smoke copy in Safari (simctl openurl) just before.
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        try readView(safari, "safari")
    }

    func testFreshInstallPlaySaveContinue() throws {
        t0 = Date()

        // 1. A fresh install opens on the start screen, with nothing to go on with.
        app.launch()
        log("launched")
        let start = app.buttons["開始"].firstMatch
        if !start.waitForExistence(timeout: 180) { throw stop("開始 never appeared") }
        log("start screen")
        shot("01-start-screen")
        checkDiag("on the start screen")
        if first(.button, "label BEGINSWITH %@", "繼續上一局").exists { findings.append("a fresh install already offers 繼續上一局") }

        // 2. A game: 開局提示 (D-044) pauses it until 知道了.
        start.tap()
        log("tapped 開始")
        let ok = app.buttons["知道了"].firstMatch
        if ok.waitForExistence(timeout: 240) {
            shot("02-town-hint")
            ok.tap()
            log("closed 開局提示")
        } else {
            log("no 開局提示 within 240 s")
        }

        // 3a. Away and back, not killed (D-163, the background save): the page's live log says
        // whether "hidden" came, how long the page ran and when the save landed.
        let early = waitForGameTime(70, timeout: 300)
        if early < 70 { throw stop("the game time never passed 1:10 (last seen \(early) s)") }
        XCUIDevice.shared.press(.home)
        log(String(format: "pressed Home at %d:%02d, coming back", early / 60, early % 60))
        sleep(8)
        app.activate()
        log("back in front")
        sleep(3)
        checkDiag("back from Home")
        let resume = app.buttons["繼續"].firstMatch
        if resume.exists && resume.isHittable {
            resume.tap()
            log("tapped 繼續")
        }

        // 3. Past 2 minutes of game time (normal speed, 30 ticks a second: about 80 s).
        let played = waitForGameTime(130, timeout: 600)
        if played < 130 { throw stop("the game time never passed 2:10 (last seen \(played) s)") }
        shot("03-battle-past-2-minutes")
        checkDiag("after 2 minutes")

        // 4. Away (the page keeps the game on visibilitychange), then killed.
        let atHome = gameSeconds() ?? played
        log(String(format: "game time at Home %d:%02d", atHome / 60, atHome % 60))
        XCUIDevice.shared.press(.home)
        log("pressed Home")
        sleep(5)
        app.terminate()
        log("terminated")

        // 5. Opened again: 「繼續上一局（第 N 分）」 with N ≥ 2.
        app.launch()
        log("launched again")
        let goOn = first(.button, "label BEGINSWITH %@", "繼續上一局")
        if !goOn.waitForExistence(timeout: 180) { throw stop("no 繼續上一局 after opening again") }
        checkDiag("after opening again")
        // Read before the tap: the button is gone after it.
        let offered = goOn.label
        log("offered: \(offered)")
        shot("04-continue-offered")
        let minute = Int(offered.components(separatedBy: CharacterSet.decimalDigits.inverted).joined()) ?? -1
        if minute < 2 { throw stop("kept at minute \(minute): \(offered)") }

        // 6. Going on: the simulation runs again up to where it was, then the battlefield, paused.
        goOn.tap()
        log("tapped \(offered)")
        let back = waitForGameTime(minute * 60, timeout: 300)
        if back < minute * 60 { throw stop("the battlefield did not come back at minute \(minute) (last seen \(back) s)") }
        // Paused where the kept game was: the background save's time, not only the last minute's.
        sleep(3)
        let continued = gameSeconds() ?? back
        log(String(format: "continued at %d:%02d (Home at %d:%02d)", continued / 60, continued % 60, atHome / 60, atHome % 60))
        if continued < atHome - 5 {
            findings.append(String(format: "the background save is missing: Home at %d:%02d, continued at %d:%02d", atHome / 60, atHome % 60, continued / 60, continued % 60))
        }
        if start.exists && start.isHittable { findings.append("開始 still on screen after going on") }
        shot("05-continued")
        checkDiag("after going on")

        log(findings.isEmpty ? "done" : "done, \(findings.count) finding(s)")
        for f in findings { log("FINDING: \(f)") }
        if !findings.isEmpty {
            print(app.debugDescription)
            XCTFail(findings.joined(separator: "\n"))
        }
    }
}
