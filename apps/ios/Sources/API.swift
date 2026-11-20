import Foundation
import Security

struct Person: Codable, Identifiable, Equatable {
    let id, slug, name, role, color: String
    let avatarKey: String?
    var isParent: Bool { role == "parent" }
}

struct ChoreInstance: Codable, Identifiable {
    let id, choreId, personId, date, status, title: String
    let stars, starsAwarded: Int
    let requiresPhoto: Bool
    let description: String?
    let photoPath: String?
    let steps: [String]
    var statusLabel: String {
        switch status {
        case "done": return "Done"
        case "pending": return "Waiting"
        case "rejected": return "Try again"
        default: return "To do"
        }
    }
}

struct Meal: Codable, Identifiable {
    let date, name: String
    let photoPath: String?
    var id: String { date }
}
struct MealsResponse: Decodable { let meals: [Meal] }
struct StarSummary: Codable { let personId: String; let balance: Int }
struct FamilySettings: Codable { let choreReminderHour: Int; let choreReminderMinute: Int? }
struct Snapshot: Codable {
    let now, timezone: String
    var chores: [ChoreInstance]
    let meals: [Meal]
    let people: [Person]
    var stars: [StarSummary]?
    let settings: FamilySettings?
    var today: String { String(now.prefix(10)) }
    func chores(for person: Person) -> [ChoreInstance] {
        chores.filter { $0.date == today && (person.isParent || $0.personId == person.id) }
    }
}
struct SessionResponse: Decodable { let token: String; let person: Person }
struct StatusResponse: Decodable { let available: Bool; let parents: [Person] }
struct PeopleResponse: Decodable { let people: [Person] }
struct MeResponse: Decodable {
    struct Actor: Decodable { let person: Person? }
    let actor: Actor
}
struct Claim: Decodable { let id, displayCode, pollSecret, qrDataUrl, expiresAt: String }
struct PollResponse: Decodable { let status: String; let familyToken: String? }
struct FamilyResponse: Decodable { let familyToken: String }
struct InstanceResponse: Decodable { let instance: ChoreInstance }
struct PendingResponse: Decodable {
    struct Item: Decodable, Identifiable { let id, displayCode, label, deviceKind: String }
    let requests: [Item]
}
struct OKResponse: Decodable { let ok: Bool }
struct APIError: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
}

extension Error {
    var isRequestCancellation: Bool {
        self is CancellationError || (self as? URLError)?.code == .cancelled
    }
}

struct APIClient {
    private struct Message: Decodable { let error: String }
    let baseURL: URL
    let session: URLSession
    init(session: URLSession = .shared) {
        self.session = session
        let value = ProcessInfo.processInfo.environment["LP_API_URL"]
            ?? Bundle.main.object(forInfoDictionaryKey: "LPAPIURL") as? String
            ?? "http://localhost:3000"
        baseURL = URL(string: value)!
    }
    func photoURL(_ path: String) -> URL {
        if path.hasPrefix("/") { return baseURL.appendingPathComponent(String(path.dropFirst())) }
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        let component = path.addingPercentEncoding(withAllowedCharacters: allowed)!
        return URL(string: baseURL.appendingPathComponent("api/photos").absoluteString + "/" + component)!
    }
    func request<T: Decodable>(_ path: String, method: String = "GET",
                               body: [String: String]? = nil, token: String? = nil,
                               family: String? = nil, photo: Data? = nil,
                               query: [String: String] = [:], payload: Data? = nil) async throws -> T {
        var url = URLComponents(url: baseURL.appendingPathComponent("api/" + path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { url.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
        var request = URLRequest(url: url.url!)
        request.httpMethod = method
        request.timeoutInterval = 30
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let photo {
            request.httpBody = photo
            request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        }
        if let payload {
            request.httpBody = payload
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
        if let family { request.setValue(family, forHTTPHeaderField: "x-family-token") }
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(Message.self, from: data).error)
                ?? "The house could not answer. Please try again."
            throw APIError(status: status, message: message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

enum Keychain {
    static func migrateExpoTokens() throws {
        guard read("expoMigration") == nil else { return }
        for key in ["session", "family"] where read(key) == nil {
            let encodedKey = Data("lp.\(key)".utf8)
            for service in ["app:no-auth", "app"] {
                let query: [String: Any] = [
                    kSecClass as String: kSecClassGenericPassword,
                    kSecAttrService as String: service,
                    kSecAttrAccount as String: encodedKey,
                    kSecAttrGeneric as String: encodedKey,
                    kSecReturnData as String: true,
                    kSecMatchLimit as String: kSecMatchLimitOne
                ]
                var result: CFTypeRef?
                let status = SecItemCopyMatching(query as CFDictionary, &result)
                if status == errSecItemNotFound { continue }
                guard status == errSecSuccess, let data = result as? Data,
                      let token = String(data: data, encoding: .utf8) else {
                    throw APIError(status: 0, message: "Could not migrate secure storage (\(status)).")
                }
                try write(token, key: key)
                break
            }
        }
        try write("1", key: "expoMigration")
    }

    private static func query(_ key: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "com.focusotter.liendoplaza",
         kSecAttrAccount as String: key]
    }
    static func read(_ key: String) -> String? {
        var query = query(key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func write(_ value: String?, key: String) throws {
        let deletion = SecItemDelete(query(key) as CFDictionary)
        guard deletion == errSecSuccess || deletion == errSecItemNotFound else {
            throw APIError(status: 0, message: "Could not update secure storage (\(deletion)).")
        }
        guard let value else { return }
        var query = query(key)
        query[kSecValueData as String] = Data(value.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw APIError(status: 0, message: "Could not save secure storage (\(status)).")
        }
    }
}
