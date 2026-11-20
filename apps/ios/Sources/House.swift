import SwiftUI

@MainActor
final class House: ObservableObject {
    let api = APIClient()
    @Published var session = Keychain.read("session")
    @Published var family = Keychain.read("family")
    @Published var person: Person?
    @Published var snapshot: Snapshot?
    @Published var loading = false
    @Published var error = ""
    @Published var pairingVersion = UUID()

    init() {
        if ProcessInfo.processInfo.arguments.contains("-uiTestReset") {
            do {
                try Keychain.write(nil, key: "session")
                try Keychain.write(nil, key: "family")
                session = nil
                family = nil
#if DEBUG
                let environment = ProcessInfo.processInfo.environment
                if let token = environment["LP_TEST_SESSION_TOKEN"] {
                    try Keychain.write(token, key: "session")
                    session = token
                }
                if let token = environment["LP_TEST_FAMILY_TOKEN"] {
                    try saveFamily(token)
                }
#endif
            } catch { self.error = error.localizedDescription }
        }
    }

    func saveFamily(_ value: String) throws {
        try Keychain.write(value, key: "family")
        family = value
    }

    func accept(_ result: SessionResponse) throws {
        try Keychain.write(result.token, key: "session")
        person = result.person
        session = result.token
        error = ""
    }

    func clearSession() throws {
        try Keychain.write(nil, key: "session")
        session = nil
        person = nil
        snapshot = nil
        pairingVersion = UUID()
    }

    func load() async {
        guard let token = session else { return }
        loading = true
        error = ""
        defer { loading = false }
        do {
            let me: MeResponse = try await api.request("me", token: token)
            let result: Snapshot = try await api.request("snapshot", token: token)
            guard session == token else { return }
            person = me.actor.person
            snapshot = result
        } catch {
            guard session == token else { return }
            if (error as? APIError)?.status == 401 {
                do { try clearSession() } catch { self.error = error.localizedDescription }
            } else if !(error is CancellationError) {
                self.error = error.localizedDescription
            }
        }
    }

    func signOut() async {
        do {
            if person?.isParent == true && family == nil {
                try await provisionFamily()
            }
            let _: OKResponse = try await api.request("auth/logout", method: "POST", token: session)
            try clearSession()
        } catch { self.error = error.localizedDescription }
    }

    func provisionFamily() async throws {
        struct Invite: Decodable { let deepLink: String }
        let invite: Invite = try await api.request("pair/invite", method: "POST",
                                                   body: ["deviceKind": "phone"], token: session)
        guard let components = URLComponents(string: invite.deepLink),
              let value = components.queryItems?.first(where: { $0.name == "invite" })?.value else {
            throw APIError(status: 0, message: "The house returned an invalid invite.")
        }
        let response: FamilyResponse = try await api.request("pair/redeem", method: "POST", body: ["invite": value])
        try saveFamily(response.familyToken)
    }

    func toggle(_ chore: ChoreInstance) async throws {
        let action = chore.status == "done" ? "undo" : "complete"
        let response: InstanceResponse = try await api.request(
            "chores/instances/\(chore.id)/\(action)", method: "POST", token: session)
        if let index = snapshot?.chores.firstIndex(where: { $0.id == chore.id }) {
            snapshot?.chores[index] = response.instance
        }
    }

    func open(_ url: URL) async {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
              url.scheme == "liendoplaza" ||
                (url.scheme == "https" && [
                    "liendo-plaza.vercel.app",
                    "liendo-plaza-git-cursor-liendo-pla-c65a88-focus-otters-projects.vercel.app"
                ].contains(url.host ?? "") && ["/family", "/join"].contains(url.path)),
              let invite = parts.queryItems?.first(where: { $0.name == "invite" })?.value else { return }
        do {
            let response: FamilyResponse = try await api.request("pair/redeem", method: "POST", body: ["invite": invite])
            try clearSession()
            try saveFamily(response.familyToken)
            pairingVersion = UUID()
        } catch { self.error = error.localizedDescription }
    }
}
