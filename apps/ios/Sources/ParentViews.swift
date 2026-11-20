import SwiftUI

struct RoleTabs: View {
    @EnvironmentObject private var house: House
    var body: some View {
        TabView {
            TodayView()
                .tabItem { Label(house.person?.isParent == true ? "Today" : "Chores", systemImage: "checkmark.circle") }
            DinnerView().tabItem { Label("Dinner", systemImage: "fork.knife") }
            if house.person?.isParent == true {
                FamilyView().tabItem { Label("Family", systemImage: "person.2") }
            }
        }
    }
}

struct FamilyView: View {
    @EnvironmentObject private var house: House
    var body: some View {
        NavigationStack {
            List {
                NavigationLink("Add a device") { AddDeviceView() }.accessibilityIdentifier("addDevice")
                Button("Sign out") { Task { await house.signOut() } }.accessibilityIdentifier("signOut")
                Text("Version \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0")")
                    .foregroundStyle(Plaza.muted)
            }
            .scrollContentBackground(.hidden).background(Plaza.paper)
            .navigationTitle("Family")
        }
    }
}
