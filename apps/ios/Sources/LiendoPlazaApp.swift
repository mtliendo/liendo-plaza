import SwiftUI

@main
struct LiendoPlazaApp: App {
    @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var house = House()
    @ObservedObject private var pushNavigation = PushNavigation.shared
    var body: some Scene {
        WindowGroup {
            Group {
                if house.sessionUnresolved {
                    ProgressView("Opening Liendo Plaza…")
                } else if house.session != nil && !house.codeSetupRequired {
                    RoleTabs()
                } else {
                    PairingView().id(house.pairingVersion)
                }
            }
            .environmentObject(house)
            .font(.custom("Figtree", size: 17, relativeTo: .body))
            .foregroundStyle(Plaza.ink).tint(Plaza.accent)
            .preferredColorScheme(.light)
            .onOpenURL { url in Task { await house.open(url) } }
            .task(id: house.session) { await house.checkCodeSetup() }
            .task(id: house.person?.id) { await registerPush() }
            .task(id: pushNavigation.refreshID) {
                if pushNavigation.refreshID != nil { await house.load() }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    Task {
                        await house.checkCodeSetup()
                        await registerPush()
                    }
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: PushNotifications.tokenReceived)) { notification in
                if let data = notification.object as? Data {
                    Task { await house.registerPushToken(data) }
                }
            }
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                if let url = activity.webpageURL { Task { await house.open(url) } }
            }
        }
    }

    @MainActor
    private func registerPush() async {
        guard house.session != nil, house.person != nil,
              ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil,
              !ProcessInfo.processInfo.arguments.contains("-uiTestReset") else { return }
        await PushNotifications.register()
        await house.updateReminder()
    }
}
