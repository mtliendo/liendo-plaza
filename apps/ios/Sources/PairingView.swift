import SwiftUI

struct PairingView: View {
    @EnvironmentObject private var house: House
    @State private var people: [Person] = []
    @State private var firstParent = false
    @State private var picked: Person?
    @State private var pin = ""
    @State private var claim: Claim?
    @State private var loading = true
    @State private var busy = false
    @State private var error = ""
    @State private var retry = UUID()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Text("Liendo Plaza").font(.custom("Figtree", size: 15)).foregroundStyle(Plaza.muted)
                    if loading {
                        ProgressView("Getting this phone ready…").frame(maxWidth: .infinity).padding(.top, 60)
                    } else if let picked {
                        Text(picked.name).font(Plaza.title())
                        Text(firstParent ? "Enter your 6-digit parent PIN." :
                                "Enter your \(picked.isParent ? "6" : "4")-digit PIN.")
                            .foregroundStyle(Plaza.muted)
                        SecureField("PIN", text: $pin)
                            .keyboardType(.numberPad).textContentType(.password)
                            .padding(18).background(Plaza.card).clipShape(RoundedRectangle(cornerRadius: 16))
                            .accessibilityIdentifier("pin")
                        Button(busy ? "Opening…" : "Open") { Task { await login(picked) } }
                            .buttonStyle(PrimaryButton()).disabled(busy || pin.isEmpty)
                            .accessibilityIdentifier("open")
                        Button("Someone else") { self.picked = nil; pin = ""; error = "" }
                            .disabled(busy)
                    } else if !people.isEmpty {
                        Text(firstParent ? "First parent phone" : "Who are you?").font(Plaza.title())
                        if firstParent {
                            Text("Pick your name and enter your 6-digit PIN. Nobody needs a long secret.")
                                .foregroundStyle(Plaza.muted)
                        }
                        ForEach(people) { person in
                            Button {
                                picked = person; pin = ""; error = ""
                            } label: {
                                HStack(spacing: 16) {
                                    Avatar(person: person)
                                    Text(person.name)
                                    Spacer()
                                    Image(systemName: "chevron.right").font(.caption)
                                }
                                .padding(16)
                                .background(Plaza.personColor(person.slug).opacity(0.12))
                                .clipShape(RoundedRectangle(cornerRadius: 16))
                            }
                            .accessibilityIdentifier("person.\(person.slug)")
                        }
                    } else if let claim {
                        Text("Pair this phone").font(Plaza.title())
                        Text("A parent who is already signed in scans this code, or types it under Add a device.")
                            .foregroundStyle(Plaza.muted)
                        if let data = Data(base64Encoded: String(claim.qrDataUrl.split(separator: ",").last ?? "")),
                           let image = UIImage(data: data) {
                            Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
                                .frame(maxWidth: 260).frame(maxWidth: .infinity)
                                .accessibilityLabel("Pairing QR code")
                        }
                        Text(claim.displayCode).font(Plaza.title(42)).tracking(3)
                            .frame(maxWidth: .infinity).accessibilityIdentifier("pairing.code")
                        Text("Waiting for a parent • Expires in about ten minutes")
                            .font(.footnote).foregroundStyle(Plaza.muted)
                        Button("Get a new code") { retry = UUID() }
                            .accessibilityIdentifier("pairing.retry")
                    }
                    InlineError(message: error.isEmpty ? house.error : error)
                    if !loading && claim == nil && people.isEmpty {
                        Button("Try again") { retry = UUID() }.buttonStyle(PrimaryButton())
                    }
                }
                .padding(24)
            }
            .background(Plaza.paper)
            .task(id: retry) { await prepare() }
        }
    }

    private func loadPeople() async throws {
        let response: PeopleResponse = try await house.api.request("people", family: house.family)
        people = response.people
        firstParent = false
        claim = nil
    }

    private func prepare() async {
        loading = true
        error = ""
        picked = nil
        claim = nil
        people = []
        do {
            if house.family != nil {
                do {
                    try await loadPeople()
                    loading = false
                    return
                } catch let apiError as APIError where apiError.status == 401 {
                    try Keychain.write(nil, key: "family")
                    house.family = nil
                }
            }
            let status: StatusResponse = try await house.api.request("pair/status")
            firstParent = status.available
            if status.available {
                people = status.parents
                loading = false
                return
            }
            loading = false
            while !Task.isCancelled {
                let next: Claim = try await house.api.request("pair/claim", method: "POST", body: ["deviceKind": "phone"])
                claim = next
                while !Task.isCancelled {
                    try await Task.sleep(for: .seconds(2))
                    let poll: PollResponse = try await house.api.request("pair/poll", method: "POST",
                                                                         body: ["id": next.id, "pollSecret": next.pollSecret])
                    if let family = poll.familyToken {
                        try house.saveFamily(family)
                        try await loadPeople()
                        return
                    }
                    if poll.status == "expired" || poll.status == "paired" { break }
                }
            }
        } catch {
            guard !Task.isCancelled else { return }
            self.error = error.localizedDescription
            loading = false
        }
    }

    private func login(_ person: Person) async {
        busy = true
        error = ""
        defer { busy = false }
        do {
            var body = ["personId": person.id, "pin": pin, "deviceKind": "phone"]
            if !firstParent { body["familyToken"] = house.family }
            let response: SessionResponse = try await house.api.request(
                firstParent ? "pair/bootstrap" : "auth/login", method: "POST", body: body)
            try house.accept(response)
        } catch { self.error = error.localizedDescription }
    }
}
