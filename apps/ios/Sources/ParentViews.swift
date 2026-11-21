import SwiftUI

struct RoleTabs: View {
    @EnvironmentObject private var house: House
    var body: some View {
        TabView {
            TodayView()
                .tabItem { Label(house.person?.isParent == true ? "Today" : "Chores", systemImage: "checkmark.circle") }
            DinnerView().tabItem { Label("Dinner", systemImage: "fork.knife") }
            if house.person?.isParent == true {
                GroceriesView().tabItem { Label("Groceries", systemImage: "basket") }
                ChoreManagementView().tabItem { Label("Chores", systemImage: "list.bullet") }
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
    @State private var configured: [String]?

    private var isParent: Bool { house.snapshot?.people.first { $0.id == personId }?.isParent == true }
    private var canClear: Bool {
        !isParent || (house.snapshot?.people.contains { $0.isParent && $0.id != personId && configured?.contains($0.id) == true } ?? false)
    }

    var body: some View {
        Form {
            Section {
                Picker("Who", selection: $personId) {
                    ForEach(house.snapshot?.people ?? []) { Text($0.name).tag($0.id) }
                }.accessibilityIdentifier("codes.person")
                if let configured {
                    Text(configured.contains(personId) ? "Code set" : "Not set").foregroundStyle(Plaza.muted)
                }
                SecureField(isParent ? "New parent code (6+ digits)" : "New kid code (4 digits)", text: $code)
                    .keyboardType(.numberPad).textContentType(.newPassword).accessibilityIdentifier("codes.new")
                if isParent && !code.isEmpty {
                    SecureField("Enter parent code again", text: $confirmation)
                        .keyboardType(.numberPad).textContentType(.newPassword).accessibilityIdentifier("codes.confirmation")
                }
                if isParent && !canClear { Text("Keep at least one parent code. Enter a new code to replace this one.").foregroundStyle(Plaza.muted) }
                Button(!code.isEmpty || !canClear ? "Save code" : "Clear code") { Task { await save() } }
                    .disabled(busy || personId.isEmpty || (code.isEmpty && !canClear)).accessibilityIdentifier("codes.save")
            } footer: {
                Text("Each parent has their own code of 6 or more digits. Each kid has a different four-digit birthday code (MMDD). \(canClear ? "Leave a code empty to clear it. " : "")Existing signed-in devices stay signed in.")
            }
            if !message.isEmpty { Text(message).accessibilityIdentifier("codes.success") }
            InlineError(message: error)
        }
        .scrollContentBackground(.hidden).background(Plaza.paper).navigationTitle("Family codes")
        .onChange(of: personId) { _, _ in code = ""; confirmation = ""; message = ""; error = "" }
        .task {
            personId = house.person?.id ?? ""
            do {
                let result: CodeSettings = try await house.api.request("auth/codes", token: house.session)
                configured = result.configuredPersonIds
            } catch { self.error = error.localizedDescription }
        }
    }

    private func save() async {
        busy = true; error = ""; message = ""
        defer { busy = false }
        do {
            let body = ["code": code, "confirmation": confirmation, "personId": personId]
            let _: OKResponse = try await house.api.request("auth/codes", method: "POST", body: body, token: house.session)
            configured = (configured ?? []).filter { $0 != personId } + (code.isEmpty ? [] : [personId])
            message = code.isEmpty ? "Code cleared." : "Code saved."
            code = ""; confirmation = ""
        } catch { self.error = error.localizedDescription }
    }
}
