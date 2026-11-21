import SwiftUI

struct RoleTabs: View {
    @EnvironmentObject private var house: House
    @ObservedObject private var navigation = PushNavigation.shared
    var body: some View {
        TabView(selection: $navigation.tab) {
            TodayView()
                .tabItem { Label(house.person?.isParent == true ? "Today" : "Chores", systemImage: "checkmark.circle") }
                .tag("today")
            DinnerView().tabItem { Label("Dinner", systemImage: "fork.knife") }.tag("dinner")
            if house.person?.isParent == true {
                GroceriesView().tabItem { Label("Groceries", systemImage: "basket") }.tag("groceries")
                ChoreManagementView().tabItem { Label("Chores", systemImage: "list.bullet") }.tag("manage")
                FamilyView().tabItem { Label("Family", systemImage: "person.2") }.tag("family")
            }
        }
        .onAppear { navigation.tab = "today" }
    }
}

struct FamilyView: View {
    @EnvironmentObject private var house: House
    var body: some View {
        NavigationStack {
            List {
                NavigationLink("Family codes") { FamilyCodesView() }.accessibilityIdentifier("familyCodes")
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

struct FamilyCodesView: View {
    @EnvironmentObject private var house: House
    @State private var personId = ""
    @State private var code = ""
    @State private var confirmation = ""
    @State private var message = ""
    @State private var error = ""
    @State private var busy = false

    var body: some View {
        Form {
            Section {
                Picker("Who", selection: $personId) {
                    Text("Shared parent code").tag("")
                    ForEach(house.snapshot?.people.filter { !$0.isParent } ?? []) { Text($0.name).tag($0.id) }
                }.accessibilityIdentifier("codes.person")
                SecureField(personId.isEmpty ? "New parent code (6+ digits)" : "New kid code (4 digits)", text: $code)
                    .keyboardType(.numberPad).textContentType(.newPassword).accessibilityIdentifier("codes.new")
                if personId.isEmpty {
                    SecureField("Enter parent code again", text: $confirmation)
                        .keyboardType(.numberPad).textContentType(.newPassword).accessibilityIdentifier("codes.confirmation")
                }
                Button(personId.isEmpty || !code.isEmpty ? "Save code" : "Clear kid code") { Task { await save() } }
                    .disabled(busy || (personId.isEmpty && code.isEmpty)).accessibilityIdentifier("codes.save")
            } footer: {
                Text("One shared parent code. Each kid has a different four-digit birthday code (MMDD). Leave a kid’s code empty to clear it. Existing signed-in devices stay signed in.")
            }
            if !message.isEmpty { Text(message).accessibilityIdentifier("codes.success") }
            InlineError(message: error)
        }
        .scrollContentBackground(.hidden).background(Plaza.paper).navigationTitle("Family codes")
        .onChange(of: personId) { _, _ in code = ""; confirmation = ""; message = ""; error = "" }
    }

    private func save() async {
        busy = true; error = ""; message = ""
        defer { busy = false }
        do {
            var body = ["code": code, "confirmation": confirmation]
            if !personId.isEmpty { body["personId"] = personId }
            let _: OKResponse = try await house.api.request("auth/codes", method: "POST", body: body, token: house.session)
            message = code.isEmpty ? "Kid code cleared." : "Code saved."
            code = ""; confirmation = ""
        } catch { self.error = error.localizedDescription }
    }
}
