import SwiftUI

struct CodeStatus: Decodable {
    let setupRequired: Bool
    let people: [Person]

    enum CodingKeys: String, CodingKey { case setupRequired, people }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        setupRequired = try values.decode(Bool.self, forKey: .setupRequired)
        people = try values.decodeIfPresent([Person].self, forKey: .people) ?? []
    }
}
struct CodeLogin: Decodable { let token: String; let person: Person }
struct CodeSettings: Decodable { let configuredPersonIds: [String] }

struct PairingView: View {
    @EnvironmentObject private var house: House
    @State private var status: CodeStatus?
    @State private var personId = ""
    @State private var code = ""
    @State private var confirmation = ""
    @State private var kids: [String: String] = [:]
    @State private var parentCodes: [String: String] = [:]
    @State private var busy = false
    @State private var error = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("Liendo Plaza").font(.custom("Figtree", size: 15)).foregroundStyle(Plaza.muted)
                    Text(status?.setupRequired == true ? "Set up Liendo Plaza" : "Enter your code")
                        .font(Plaza.title())
                    if let status {
                        if status.setupRequired && personId.isEmpty {
                            Text("Liendo Plaza isn't set up yet. Open it on a parent's phone that's already signed in to finish setup.")
                                .accessibilityIdentifier("setup.parentRequired")
                        } else {
                            if status.setupRequired {
                                Text("Setting up as \(house.person?.name ?? "")")
                                    .accessibilityIdentifier("setup.parent")
                            }
                            SecureField(status.setupRequired ? "Parent code (6+ digits)" : "Enter your code", text: $code)
                                .keyboardType(.numberPad).textContentType(status.setupRequired ? .newPassword : .password)
                                .padding(18).background(Plaza.card).clipShape(RoundedRectangle(cornerRadius: 16))
                                .accessibilityIdentifier("code")
                            if status.setupRequired {
                                SecureField("Enter parent code again", text: $confirmation)
                                    .keyboardType(.numberPad).textContentType(.newPassword)
                                    .padding(18).background(Plaza.card).clipShape(RoundedRectangle(cornerRadius: 16))
                                    .accessibilityIdentifier("code.confirmation")
                                ForEach(status.people.filter { $0.isParent && $0.id != personId }) { person in
                                    SecureField("\(person.name) code (optional, 6+ digits)", text: Binding(
                                        get: { parentCodes[person.id] ?? "" }, set: { parentCodes[person.id] = $0 }))
                                        .keyboardType(.numberPad).textContentType(.newPassword)
                                        .padding(18).background(Plaza.card).clipShape(RoundedRectangle(cornerRadius: 16))
                                        .accessibilityIdentifier("setup.\(person.slug)")
                                }
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
            let result: CodeStatus = try await house.api.request("auth/codes/status", token: house.session)
            status = result
            personId = house.person?.isParent == true && result.people.contains(where: { $0.id == house.person?.id })
                ? house.person?.id ?? "" : ""
        } catch { if !error.isRequestCancellation { self.error = error.localizedDescription } }
    }

    private func submit() async {
        busy = true; error = ""
        defer { busy = false }
        do {
            var body: [String: Any] = ["code": code, "deviceKind": "phone"]
            if status?.setupRequired == true {
                body["confirmation"] = confirmation
                body["personId"] = personId
                body["kids"] = kids.filter { !$0.value.isEmpty }.map { ["personId": $0.key, "code": $0.value] }
                body["parents"] = parentCodes.filter { $0.key != personId && !$0.value.isEmpty }.map { ["personId": $0.key, "code": $0.value] }
            }
            let result: CodeLogin = try await house.api.request(status?.setupRequired == true ? "auth/codes/setup" : "auth/login",
                                                               method: "POST", token: house.session, payload: JSONSerialization.data(withJSONObject: body))
            try house.accept(SessionResponse(token: result.token, person: result.person))
            code = ""; confirmation = ""; kids = [:]; parentCodes = [:]
        } catch {
            if (error as? APIError)?.status == 409 && status?.setupRequired == true {
                await prepare(); code = ""; confirmation = ""; kids = [:]
            } else if !error.isRequestCancellation { self.error = error.localizedDescription }
        }
    }
}
