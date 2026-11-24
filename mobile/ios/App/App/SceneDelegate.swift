import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    /// The game keeps itself when the page goes to the background (繼續上一局, D-083): the page asks
    /// the simulation for its log and writes it to IndexedDB. Without more time iOS suspends the app
    /// at once and the write never lands, so a game killed in the background went back to its last
    /// minute's save (D-163, the smoke test). Up to 10 s, ended early if iOS asks for it back.
    private var keeping: UIBackgroundTaskIdentifier = .invalid

    func sceneDidEnterBackground(_ scene: UIScene) {
        guard keeping == .invalid else { return }
        var task: UIBackgroundTaskIdentifier = .invalid
        task = UIApplication.shared.beginBackgroundTask(withName: "keep the game") { [weak self] in
            self?.endKeeping(task)
        }
        keeping = task
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { [weak self] in
            self?.endKeeping(task)
        }
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        endKeeping(keeping)
    }

    /// Ends `task` only while it is the one running: the timer or expiry of an earlier trip to the
    /// background (away, back and away again within 10 s) never ends a later one (ceo 2026-11-24).
    private func endKeeping(_ task: UIBackgroundTaskIdentifier) {
        guard task != .invalid, task == keeping else { return }
        UIApplication.shared.endBackgroundTask(task)
        keeping = .invalid
    }
}
