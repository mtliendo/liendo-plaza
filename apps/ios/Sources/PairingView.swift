import SwiftUI

struct CodeStatus: Decodable { let setupRequired: Bool; let people: [Person] }
struct CodeLogin: Decodable { let token: String?; let person: Person?; let parents: [Person]? }

struct PairingView: View {
    @EnvironmentObject private var house: House
    @State private var status: CodeStatus?
    @State private var parents: [Person] = []
    @State private var personId = ""
    @State private var code = ""
    @State private var confirmation = ""
    @State private var kids: [String: String] = [:]
    @State private var busy = false
    @State private var error = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("Liendo Plaza").font(.custom("Figtree", size: 15)).foregroundStyle(Plaza.muted)
                    Text(status?.setupRequired == true ? "Set up Liendo Plaza" : parents.isEmpty ? "Enter your code" : "Who are you?")
                        .font(Plaza.title())
                    if let status {
                        if !parents.isEmpty {
                            ForEach(parents) { person in
                                Button(person.name) { Task { await submit(person.id) } }
                                    .buttonStyle(PrimaryButton()).disabled(busy)
                                    .accessibilityIdentifier("person.\(person.slug)")
                            }
                            Button("Use another code") { parents = []; code = ""; error = "" }.disabled(busy)
                        } else {
                            SecureField(status.setupRequired ? "Parent code (6+ digits)" : "Enter your code", text: $code)
                                .keyboardType(.numberPad).textContentType(status.setupRequired ? .newPassword : .password)
                                .padding(18).background(Plaza.card).clipShape(RoundedRectangle(cornerRadius: 16))
                                .accessibilityIdentifier("code")
                            if status.setupRequired {
                                SecureField("Enter parent code again", text: $confirmation)
                                    .keyboardType(.numberPad).textContentType(.newPassword)
                                    .padding(18).background(Plaza.card).clipShape(RoundedRectangle(cornerRadius: 16))
                                    .accessibilityIdentifier("code.confirmation")
                                Picker("Sign in as", selection: $personId) {
                                    ForEach(status.people.filter(\.isParent)) { Text($0.name).tag($0.id) }
                                }.accessibilityIdentifier("setup.parent")
                                Text("Optional: each kid’s birthday as four digits (MMDD). You can set these later in Family.")
                                    .foregroundStyle(Plaza.muted)
                                ForEach(status.people.filter { !$0.isParent }) { person in
                                    SecureField("\(person.name) code (optional)", text: Binding(
                                        get: { kids[person.id] ?? "" }, set: { kids[person.id] = $0 }))
                                        .keyboardType(.numberPad).textContentType(.newPassword)
                                        .padding(18).background(Plaza.card).clipShape(RoundedRectangle(cornerRadius: 16))
                                        .accessibilityIdentifier("setup.\(person.slug)")
                                }
                            }
                            Button(busy ? "Opening…" : status.setupRequired ? "Set up and sign in" : "Open") {
                                Task { await submit() }
                            }.buttonStyle(PrimaryButton()).disabled(busy || code.isEmpty)
                                .accessibilityIdentifier("open")
                        }
                    } else {
                        if error.isEmpty { ProgressView("Getting ready…") }
                        else { Button("Try again") { Task { await prepare() } } }
                    }
                    InlineError(message: error.isEmpty ? house.error : error)
                }.padding(24)
            }.background(Plaza.paper).task { await prepare() }
        }
    }

    private func prepare() async {
        error = ""
        do {
            let result: CodeStatus = try await house.api.request("auth/codes/status")
            status = result
            personId = result.people.first(where: \.isParent)?.id ?? ""
        } catch { if !error.isRequestCancellation { self.error = error.localizedDescription } }
    }

    private func submit(_ picked: String? = nil) async {
        busy = true; error = ""
        defer { busy = false }
        do {
            var body: [String: Any] = ["code": code, "deviceKind": "phone"]
            if status?.setupRequired == true {
                body["confirmation"] = confirmation
                body["personId"] = personId
                body["kids"] = kids.filter { !$0.value.isEmpty }.map { ["personId": $0.key, "code": $0.value] }
            } else if let picked { body["personId"] = picked }
            let result: CodeLogin = try await house.api.request(status?.setupRequired == true ? "auth/codes/setup" : "auth/login",
                                                               method: "POST", payload: JSONSerialization.data(withJSONObject: body))
            if let parents = result.parents { self.parents = parents }
            else if let token = result.token, let person = result.person {
                try house.accept(SessionResponse(token: token, person: person))
                code = ""; confirmation = ""; kids = [:]
            } else { throw APIError(status: 0, message: "Please try again.") }
        } catch {
            if (error as? APIError)?.status == 409 && status?.setupRequired == true {
                await prepare(); code = ""; confirmation = ""; kids = [:]
            } else if !error.isRequestCancellation { self.error = error.localizedDescription }
        }
    }
}
