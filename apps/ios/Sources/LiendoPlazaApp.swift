import SwiftUI

@main
struct LiendoPlazaApp: App {
    @StateObject private var house = House()
    var body: some Scene {
        WindowGroup {
            Group {
                if house.session != nil {
                    RoleTabs()
                } else {
                    PairingView().id(house.pairingVersion)
                }
            }
            .environmentObject(house)
            .font(.custom("Figtree", size: 17, relativeTo: .body))
            .foregroundStyle(Plaza.ink).tint(Plaza.accent)
            .preferredColorScheme(.light)
            .sheet(item: $house.deviceApproval) { approval in
                NavigationStack {
                    AddDeviceView(code: approval.code)
                }
                .environmentObject(house)
                .font(.custom("Figtree", size: 17, relativeTo: .body))
                .foregroundStyle(Plaza.ink).tint(Plaza.accent)
            }
            .onOpenURL { url in Task { await house.open(url) } }
            .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                if let url = activity.webpageURL { Task { await house.open(url) } }
            }
        }
    }
}
