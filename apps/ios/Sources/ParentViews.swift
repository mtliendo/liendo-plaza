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
    @State private var configured: [String]?
    @State private var error = ""

    private var people: [Person] { house.snapshot?.people ?? [] }
    private var me: Person? { people.first { $0.id == house.person?.id } }
    private var otherParents: [Person] { people.filter { $0.isParent && $0.id != house.person?.id } }
    private var kids: [Person] { people.filter { !$0.isParent } }

    var body: some View {
        NavigationStack {
            List {
                if let me { Section("Your code") { row(me) } }
                if !otherParents.isEmpty { Section("Parent codes") { ForEach(otherParents) { row($0) } } }
                if !kids.isEmpty { Section("Kid codes") { ForEach(kids) { row($0) } } }
                InlineError(message: error)
                Section {
                    Button("Sign out") { Task { await house.signOut() } }.accessibilityIdentifier("signOut")
                } footer: {
                    Text("Version \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0")")
                }
            }
            .scrollContentBackground(.hidden).background(Plaza.paper)
            .navigationTitle("Family")
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private func row(_ person: Person) -> some View {
        NavigationLink {
            FamilyCodeView(person: person, configured: $configured)
        } label: {
            LabeledContent(person.id == house.person?.id ? "\(person.name) (you)" : person.name,
                           value: configured.map { $0.contains(person.id) ? "Set" : "Not set" } ?? "")
        }
        .accessibilityIdentifier("code.\(person.slug)")
    }

    private func load() async {
        do {
            let result: CodeSettings = try await house.api.request("auth/codes", token: house.session)
            configured = result.configuredPersonIds; error = ""
        } catch { if !error.isRequestCancellation { self.error = error.localizedDescription } }
    }
}

struct FamilyCodeView: View {
    @EnvironmentObject private var house: House
    let person: Person
    @Binding var configured: [String]?
    @State private var code = ""
    @State private var confirmation = ""
    @State private var message = ""
    @State private var error = ""
    @State private var busy = false

    private var personId: String { person.id }
    private var isParent: Bool { person.isParent }
    private var canClear: Bool {
        configured?.contains(personId) == true && (!isParent ||
            (house.snapshot?.people.contains { $0.isParent && $0.id != personId && configured?.contains($0.id) == true } ?? false))
    }

    var body: some View {
        Form {
            Section {
                if let configured {
                    Text(configured.contains(personId) ? "Code set" : "Not set").foregroundStyle(Plaza.muted)
                        .accessibilityIdentifier("codes.status")
                }
                SecureField(isParent ? "New parent code (6+ digits)" : "New kid code (4 digits)", text: $code)
                    .keyboardType(.numberPad).textContentType(.newPassword).accessibilityIdentifier("codes.new")
                if isParent && !code.isEmpty {
                    SecureField("Enter parent code again", text: $confirmation)
                        .keyboardType(.numberPad).textContentType(.newPassword).accessibilityIdentifier("codes.confirmation")
                }
                Button("Save code") { Task { await save() } }
                    .disabled(busy || code.isEmpty).accessibilityIdentifier("codes.save")
                if canClear {
                    Button("Clear code", role: .destructive) { code = ""; confirmation = ""; Task { await save() } }
                        .disabled(busy).accessibilityIdentifier("codes.clear")
                }
            } footer: {
                Text(isParent
                     ? "Parent codes are 6 or more digits. At least one parent needs a code. Signed-in phones stay signed in."
                     : "Kid codes are a different four-digit birthday code (MMDD) for each kid. Signed-in phones stay signed in.")
            }
            if !message.isEmpty { Text(message).accessibilityIdentifier("codes.success") }
            InlineError(message: error)
        }
        .scrollContentBackground(.hidden).background(Plaza.paper)
        .navigationTitle(person.id == house.person?.id ? "Your code" : "\(person.name)’s code")
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
