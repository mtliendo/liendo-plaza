import SwiftUI

enum PairingLink: Equatable {
    case invite(String)

    init?(_ url: URL) {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
        let custom = url.scheme == "liendoplaza"
        let web = url.scheme == "https" && [
            "liendo-plaza.vercel.app",
            "liendo-plaza-git-cursor-liendo-pla-c65a88-focus-otters-projects.vercel.app"
        ].contains(url.host ?? "")
        guard custom || (web && ["/family", "/join"].contains(url.path)),
              let invite = parts.queryItems?.first(where: { $0.name == "invite" })?.value,
              !invite.isEmpty else { return nil }
        self = .invite(invite)
    }
}

@MainActor
final class House: ObservableObject {
    let api: APIClient
    private var pushToken = Keychain.read("apns.\(PushNotifications.environment)")
    private var pushRegistrationTask: Task<Void, Never>?
    private var signingOut = false
    @Published var session = Keychain.read("session")
    @Published var family = Keychain.read("family")
    @Published var person: Person?
    @Published var snapshot: Snapshot?
    @Published var pendingInstances: [ChoreInstance] = []
    @Published var loading = false
    @Published var codeSetupRequired = false
    @Published var error = ""
    @Published var pairingVersion = UUID()

    var pendingProofs: [ChoreInstance] {
        PendingProofs.merge(history: pendingInstances,
            today: snapshot?.chores.filter { $0.date == snapshot?.today } ?? [])
            .filter { person?.isParent == true || $0.personId == person?.id }
    }

    func chore(id: String) -> ChoreInstance? {
        ((snapshot?.chores ?? []) + pendingInstances).first {
            $0.id == id && (person?.isParent == true || $0.personId == person?.id)
        }
    }

    init(api: APIClient = APIClient()) {
        self.api = api
        if ProcessInfo.processInfo.arguments.contains("-uiTestReset") {
            do {
                try Keychain.write(nil, key: "session")
                try Keychain.write(nil, key: "family")
                session = nil
                family = nil
                UserDefaults.standard.removeObject(forKey: "phonePersonId")
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
            } catch {
                if !error.isRequestCancellation { self.error = error.localizedDescription }
            }
        } else {
            do {
                try Keychain.migrateExpoTokens()
                session = Keychain.read("session")
                family = Keychain.read("family")
            } catch {
                if !error.isRequestCancellation { self.error = error.localizedDescription }
            }
        }
    }

    func saveFamily(_ value: String) throws {
        try Keychain.write(value, key: "family")
        family = value
    }

    func accept(_ result: SessionResponse) throws {
        try Keychain.write(result.token, key: "session")
        person = result.person
        UserDefaults.standard.set(result.person.id, forKey: "phonePersonId")
        session = result.token
        codeSetupRequired = false
        error = ""
    }

    func clearSession() throws {
        try Keychain.write(nil, key: "session")
        session = nil
        person = nil
        snapshot = nil
        pendingInstances = []
        ChoreReminders.remove()
        pairingVersion = UUID()
    }

    func load(includingPendingProofs: Bool = true) async {
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
            await updateReminder()
        } catch {
            guard session == token else { return }
            if (error as? APIError)?.status == 401 {
                do { try clearSession() } catch {
                    if !error.isRequestCancellation { self.error = error.localizedDescription }
                }
            } else if !error.isRequestCancellation {
                self.error = error.localizedDescription
            }
        }
        if includingPendingProofs { await loadPendingProofs() }
    }

    func checkCodeSetup() async {
        guard let token = session else { return }
        do {
            let status: CodeStatus = try await api.request("auth/codes/status")
            guard session == token else { return }
            codeSetupRequired = status.setupRequired
        } catch {
            if !error.isRequestCancellation { self.error = error.localizedDescription }
        }
    }

    func loadPendingProofs() async {
        guard person?.isParent == true, let token = session else {
            pendingInstances = []
            return
        }
        do {
            let result: PendingInstancesResponse = try await api.request("chores/instances/pending", token: token)
            guard session == token else { return }
            pendingInstances = result.instances
        } catch {
            guard session == token, !error.isRequestCancellation else { return }
            self.error = error.localizedDescription
        }
    }

    func signOut() async {
        signingOut = true
        await pushRegistrationTask?.value
        if let pushToken, let token = session {
            await unregisterPush(pushToken, session: token)
        }
        let _: OKResponse? = try? await api.request("auth/logout", method: "POST", token: session)
        do {
            try clearSession()
        } catch {
            if !error.isRequestCancellation { self.error = error.localizedDescription }
        }
        signingOut = false
    }

    func registerPushToken(_ data: Data) async {
        guard !signingOut, let token = session, person != nil,
              let registration = PushRegistration(deviceToken: data, environment: PushNotifications.environment) else { return }
        let previous = pushRegistrationTask
        let task = Task {
            await previous?.value
            guard session == token, !signingOut else { return }
            let oldToken = pushToken
            pushToken = registration.token
            do {
                try Keychain.write(registration.token, key: "apns.\(registration.environment)")
                let _: OKResponse = try await api.request("push/register", method: "POST", body: registration.body, token: token)
                guard session == token, !signingOut else {
                    await unregisterPush(registration.token, session: token)
                    return
                }
                if let oldToken, oldToken != registration.token {
                    await unregisterPush(oldToken, session: token)
                }
            } catch {
                if !error.isRequestCancellation { print("Push token registration failed; will retry on activation.") }
            }
        }
        pushRegistrationTask = task
        await task.value
    }

    private func unregisterPush(_ value: String, session: String) async {
        let _: OKResponse? = try? await api.request("push/unregister", method: "POST",
            body: ["token": value, "kind": "apns", "environment": PushNotifications.environment], token: session)
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
        let token = session
        let action = chore.status == "done" ? "undo" : "complete"
        let response: InstanceResponse = try await api.request(
            "chores/instances/\(chore.id)/\(action)", method: "POST", token: token)
        guard session == token else { return }
        if let index = snapshot?.chores.firstIndex(where: { $0.id == chore.id }) {
            snapshot?.chores[index] = response.instance
        }
        await updateReminder()
        do {
            struct StarsResponse: Decodable { let stars: [StarSummary] }
            let result: StarsResponse = try await api.request("stars", token: token)
            guard session == token else { return }
            snapshot?.stars = result.stars
        } catch {
            guard session == token, !error.isRequestCancellation else { return }
            self.error = error.localizedDescription
        }
    }

    func uploadPhoto(_ data: Data, for id: String) async throws {
        let response: InstanceResponse = try await api.request(
            "chores/instances/\(id)/photo", method: "POST", token: session, photo: data)
        if let index = snapshot?.chores.firstIndex(where: { $0.id == id }) {
            snapshot?.chores[index] = response.instance
        }
        await updateReminder()
    }

    func review(_ id: String, action: String) async throws {
        let token = session
        let response: InstanceResponse = try await api.request(
            "chores/instances/\(id)/review", method: "POST", body: ["action": action], token: token)
        guard session == token else { return }
        if let index = snapshot?.chores.firstIndex(where: { $0.id == id }) {
            snapshot?.chores[index] = response.instance
        }
        pendingInstances.removeAll { $0.id == id }
        await loadPendingProofs()
    }

    func updateReminder() async {
        guard let snapshot, let person, !person.isParent else { ChoreReminders.remove(); return }
        await ChoreReminders.update(snapshot: snapshot, person: person)
    }

    func open(_ url: URL) async {
        guard let link = PairingLink(url) else { return }
        do {
            switch link {
            case .invite(let invite):
                let response: FamilyResponse = try await api.request("pair/redeem", method: "POST", body: ["invite": invite])
                try clearSession()
                try saveFamily(response.familyToken)
                pairingVersion = UUID()
            }
        } catch {
            if !error.isRequestCancellation { self.error = error.localizedDescription }
        }
    }
}
