import SwiftUI

@main
struct LiendoPlazaApp: App {
    @StateObject private var house = House()
    var body: some Scene {
        WindowGroup {
            Group {
                if house.session != nil {
                    TodayView()
                } else {
                    PairingView().id(house.pairingVersion)
                }
            }
            .environmentObject(house)
            .font(.custom("Figtree", size: 17, relativeTo: .body))
            .foregroundStyle(Plaza.ink).tint(Plaza.accent)
            .preferredColorScheme(.light)
            .onOpenURL { url in Task { await house.open(url) } }
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                if let url = activity.webpageURL { Task { await house.open(url) } }
            }
        }
    }
}
