import UIKit
import UserNotifications
import Combine

@MainActor
final class PushNavigation: ObservableObject {
    static let shared = PushNavigation()
    @Published var tab = "today"
    @Published private(set) var refreshID: UUID?

    func receive(_ userInfo: [AnyHashable: Any], openChores: Bool = true) {
        guard userInfo["type"] as? String == "chores" else { return }
        if openChores { tab = "today" }
        refreshID = UUID()
    }
}

struct PushRegistration: Equatable {
    let token: String
    let environment: String
    var body: [String: String] { ["token": token, "kind": "apns", "environment": environment] }

    init?(deviceToken: Data, environment: String) {
        guard !deviceToken.isEmpty, ["sandbox", "production"].contains(environment) else { return nil }
        token = deviceToken.map { String(format: "%02x", $0) }.joined()
        self.environment = environment
    }
}

enum PushNotifications {
    static let tokenReceived = Notification.Name("APNsTokenReceived")
    static var environment: String {
        Bundle.main.object(forInfoDictionaryKey: "LPAPNSEnvironment") as? String == "development" ? "sandbox" : "production"
    }

    @MainActor
    static func register() async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        let allowed: Bool
        if settings.authorizationStatus == .notDetermined {
            allowed = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) == true
        } else {
            allowed = [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus)
        }
        guard allowed, !Task.isCancelled else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }
}

final class PushAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: PushNotifications.tokenReceived, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("APNs device registration failed.")
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        Task { @MainActor in
            PushNavigation.shared.receive(notification.request.content.userInfo, openChores: false)
            completionHandler([.banner, .sound])
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        Task { @MainActor in
            PushNavigation.shared.receive(response.notification.request.content.userInfo)
            completionHandler()
        }
    }
}
