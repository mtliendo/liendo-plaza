import XCTest
import Security
import UIKit
@testable import LiendoPlaza

private final class RevokedSessionProtocol: URLProtocol {
    static var paths: [String] = []
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.paths.append(request.url!.path)
        let response = HTTPURLResponse(url: request.url!, statusCode: 401, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"error":"Sign in first."}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class PhotoProtocol: URLProtocol {
    static var status = 200
    static var response = Data()
    static var request: URLRequest?
    static var requestCount = 0
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.request = request
        Self.requestCount += 1
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: Self.status,
            httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.response)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class CancelledProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        client?.urlProtocol(self, didFailWithError: URLError(.cancelled))
    }
    override func stopLoading() {}
}

private final class ToggleProtocol: URLProtocol {
    static var stars = #"{"stars":[{"personId":"kid","balance":2}]}"#
    static var starsStatus = 200
    static var toggleStatus = 200
    static var paths: [String] = []
    static func instance(_ status: String) -> String {
        """
        {"id":"a","choreId":"c","personId":"kid","date":"2026-11-20","status":"\(status)",
         "title":"Dishes","stars":2,"starsAwarded":\(status == "done" ? 2 : 0),"requiresPhoto":false,"steps":[]}
        """
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path
        Self.paths.append(path)
        let isStars = path == "/api/stars"
        let status = isStars ? Self.starsStatus : Self.toggleStatus
        let instance = Self.instance(path.hasSuffix("/undo") ? "open" : "done")
        let body = status != 200 ? #"{"error":"Try again."}"# :
            (isStars ? Self.stars : "{\"instance\":\(instance)}")
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status,
            httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class ModelsTests: XCTestCase {
    func testCancellationClassificationKeepsRealErrors() {
        XCTAssertTrue(CancellationError().isRequestCancellation)
        XCTAssertTrue(URLError(.cancelled).isRequestCancellation)
        XCTAssertFalse(URLError(.timedOut).isRequestCancellation)
        XCTAssertFalse(APIError(status: 401, message: "Sign in first.").isRequestCancellation)
    }

    @MainActor
    func testCancelledLoadAndPairingLinkStaySilent() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CancelledProtocol.self]
        let network = URLSession(configuration: configuration)
        defer { network.invalidateAndCancel() }
        let house = House(api: APIClient(session: network))
        house.session = "test-session"
        await house.load()
        XCTAssertTrue(house.error.isEmpty)
        XCTAssertFalse(house.loading)
        XCTAssertEqual(house.session, "test-session")
        house.person = nil
        await house.open(try XCTUnwrap(URL(string: "liendoplaza://pair?code=abc123")))
        XCTAssertTrue(house.error.isEmpty)
        XCTAssertNil(house.deviceApproval)
    }

    @MainActor
    func testToggleRefreshesStarsOnCompleteUndoEmptyAndFailure() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ToggleProtocol.self]
        let network = URLSession(configuration: configuration)
        defer { network.invalidateAndCancel() }
        let house = House(api: APIClient(session: network))
        house.session = "test-session"
        house.snapshot = try JSONDecoder().decode(Snapshot.self, from: Data("""
        {"now":"2026-11-20T12:00:00-06:00","timezone":"America/Chicago",
         "chores":[\(ToggleProtocol.instance("open"))],"people":[],"meals":[],
         "stars":[{"personId":"kid","balance":0}]}
        """.utf8))
        ToggleProtocol.starsStatus = 200
        ToggleProtocol.toggleStatus = 200
        ToggleProtocol.paths = []
        ToggleProtocol.stars = #"{"stars":[{"personId":"kid","balance":2}]}"#
        try await house.toggle(XCTUnwrap(house.snapshot?.chores.first))
        XCTAssertEqual(house.snapshot?.stars?.first?.balance, 2)
        ToggleProtocol.stars = #"{"stars":[{"personId":"kid","balance":0}]}"#
        try await house.toggle(XCTUnwrap(house.snapshot?.chores.first))
        XCTAssertEqual(house.snapshot?.stars?.first?.balance, 0)
        XCTAssertEqual(ToggleProtocol.paths, ["/api/chores/instances/a/complete", "/api/stars",
                                             "/api/chores/instances/a/undo", "/api/stars"])
        ToggleProtocol.starsStatus = 500
        try await house.toggle(XCTUnwrap(house.snapshot?.chores.first))
        XCTAssertEqual(house.snapshot?.chores.first?.status, "done")
        XCTAssertEqual(house.snapshot?.stars?.first?.balance, 0)
        XCTAssertEqual(house.error, "Try again.")
        ToggleProtocol.starsStatus = 200
        ToggleProtocol.stars = #"{"stars":[]}"#
        try await house.toggle(XCTUnwrap(house.snapshot?.chores.first))
        XCTAssertEqual(house.snapshot?.stars?.count, 0)
        ToggleProtocol.toggleStatus = 500
        ToggleProtocol.paths = []
        do {
            try await house.toggle(XCTUnwrap(house.snapshot?.chores.first))
            XCTFail("A failed toggle must throw without fetching stars")
        } catch { XCTAssertEqual(error.localizedDescription, "Try again.") }
        XCTAssertEqual(ToggleProtocol.paths, ["/api/chores/instances/a/complete"])
        XCTAssertEqual(house.snapshot?.chores.first?.status, "open")
    }

    @MainActor
    func testPhotoUploadReplacesInstanceAndPropagatesErrors() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PhotoProtocol.self]
        let network = URLSession(configuration: configuration)
        defer { network.invalidateAndCancel() }
        let house = House(api: APIClient(session: network))
        house.session = "test-session"
        let instance = """
        {"id":"a","choreId":"c","personId":"kid","date":"2026-11-20","status":"open",
         "title":"Dishes","stars":2,"starsAwarded":0,"requiresPhoto":true,"steps":[]}
        """
        house.snapshot = try JSONDecoder().decode(Snapshot.self, from: Data("""
        {"now":"2026-11-20T12:00:00-06:00","timezone":"America/Chicago",
         "chores":[\(instance)],"people":[],"meals":[]}
        """.utf8))
        PhotoProtocol.status = 200
        let pending = instance.replacingOccurrences(of: "\"open\"", with: "\"pending\"")
        PhotoProtocol.response = Data("{\"instance\":\(pending)}".utf8)
        try await house.uploadPhoto(Data([0xFF, 0xD8]), for: "a")
        XCTAssertEqual(house.snapshot?.chores.first?.statusLabel, "Waiting")
        XCTAssertEqual(PhotoProtocol.request?.url?.path, "/api/chores/instances/a/photo")
        XCTAssertEqual(PhotoProtocol.request?.httpMethod, "POST")
        XCTAssertEqual(PhotoProtocol.request?.value(forHTTPHeaderField: "Content-Type"), "image/jpeg")
        XCTAssertEqual(PhotoProtocol.request?.value(forHTTPHeaderField: "authorization"), "Bearer test-session")
        PhotoProtocol.response = Data()
        do {
            try await house.uploadPhoto(Data([1]), for: "a")
            XCTFail("Empty responses must not replace an instance")
        } catch { XCTAssertTrue(error is DecodingError) }
        PhotoProtocol.status = 400
        PhotoProtocol.response = Data(#"{"error":"Attach a photo."}"#.utf8)
        do {
            try await house.uploadPhoto(Data(), for: "a")
            XCTFail("Upload errors must reach the caller")
        } catch { XCTAssertEqual(error.localizedDescription, "Attach a photo.") }
        XCTAssertEqual(house.snapshot?.chores.first?.status, "pending")
    }

    func testGuidePhotoUploadRemovalAndFailures() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PhotoProtocol.self]
        let network = URLSession(configuration: configuration)
        defer { network.invalidateAndCancel() }
        let api = APIClient(session: network)
        let body = """
        {"chore":{"id":"c","title":"Dishes","assignedPersonId":"kid","stars":2,
        "requiresPhoto":false,"repeatType":"daily","steps":[],"active":true,"guidePhotoPath":"local:new.jpg"}}
        """
        PhotoProtocol.status = 200
        PhotoProtocol.response = Data(body.utf8)
        let path = try await api.setGuidePhoto(Data([0xff, 0xd8]), for: "c", token: "parent")
        XCTAssertEqual(path, "local:new.jpg")
        XCTAssertEqual(PhotoProtocol.request?.url?.path, "/api/chores/c/guide-photo")
        XCTAssertEqual(PhotoProtocol.request?.httpMethod, "POST")
        XCTAssertEqual(PhotoProtocol.request?.value(forHTTPHeaderField: "Content-Type"), "image/jpeg")
        XCTAssertEqual(PhotoProtocol.request?.value(forHTTPHeaderField: "authorization"), "Bearer parent")
        PhotoProtocol.response = Data(body.replacingOccurrences(of: #""local:new.jpg""#, with: "null").utf8)
        let removed = try await api.setGuidePhoto(nil, for: "c", token: "parent")
        XCTAssertNil(removed)
        XCTAssertEqual(PhotoProtocol.request?.httpMethod, "DELETE")
        PhotoProtocol.response = Data()
        do {
            _ = try await api.setGuidePhoto(Data([1]), for: "c", token: "parent")
            XCTFail("Empty upload responses must fail")
        } catch { XCTAssertTrue(error is DecodingError) }
        PhotoProtocol.status = 403
        PhotoProtocol.response = Data(#"{"error":"Parents only."}"#.utf8)
        for photo in [Data([1]), nil] as [Data?] {
            do {
                _ = try await api.setGuidePhoto(photo, for: "c", token: "kid")
                XCTFail("Guide errors must reach the editor")
            } catch { XCTAssertEqual(error.localizedDescription, "Parents only.") }
        }
    }

    @MainActor
    func testCameraPreparationResizesAndProducesDecodableJPEG() throws {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let original = UIGraphicsImageRenderer(size: CGSize(width: 3200, height: 2000), format: format).image { _ in
            UIColor.systemBlue.setFill()
            UIRectFill(CGRect(x: 0, y: 0, width: 3200, height: 2000))
        }
        let data = try XCTUnwrap(Camera.prepare(original))
        let image = try XCTUnwrap(UIImage(data: data))
        XCTAssertEqual(image.size, CGSize(width: 1600, height: 1000))
        XCTAssertEqual(Array(data.prefix(2)), [0xff, 0xd8])
    }

    func testSuccessfulReplacementClearsGuideLeftAfterCreateUploadFailure() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PhotoProtocol.self]
        let network = URLSession(configuration: configuration)
        defer { network.invalidateAndCancel() }
        let api = APIClient(session: network)
        let body = """
        {"chore":{"id":"created","title":"Dishes","assignedPersonId":"kid","stars":2,
        "requiresPhoto":false,"repeatType":"daily","steps":[],"active":true,"guidePhotoPath":null}}
        """
        PhotoProtocol.status = 200
        PhotoProtocol.response = Data(body.utf8)
        PhotoProtocol.requestCount = 0
        let created: ChoreResponse = try await api.request("chores", method: "POST", token: "parent")
        var chore = created.chore
        let original = Data([1])
        var pendingGuide: Data? = original
        PhotoProtocol.status = 500
        PhotoProtocol.response = Data(#"{"error":"Upload failed."}"#.utf8)
        do {
            _ = try await api.setGuidePhoto(original, for: chore.id, token: "parent")
            XCTFail("The initial upload must fail")
        } catch { XCTAssertEqual(error.localizedDescription, "Upload failed.") }
        XCTAssertEqual(chore.id, "created")
        XCTAssertEqual(pendingGuide, original)
        do {
            let path = try await api.setGuidePhoto(Data([2]), for: chore.id, token: "parent")
            chore.didReplaceGuidePhoto(path, pendingGuide: &pendingGuide)
            XCTFail("The failed replacement must retain the pending photo")
        } catch { XCTAssertEqual(error.localizedDescription, "Upload failed.") }
        XCTAssertEqual(pendingGuide, original)
        PhotoProtocol.status = 200
        PhotoProtocol.response = Data(body.replacingOccurrences(of: #""guidePhotoPath":null"#,
            with: #""guidePhotoPath":"local:replacement.jpg""#).utf8)
        let path = try await api.setGuidePhoto(Data([2]), for: chore.id, token: "parent")
        chore.didReplaceGuidePhoto(path, pendingGuide: &pendingGuide)
        XCTAssertNil(pendingGuide)
        XCTAssertEqual(chore.guidePhotoPath, "local:replacement.jpg")
        let saved: ChoreResponse = try await api.request("chores/\(chore.id)", method: "PATCH", token: "parent",
            payload: JSONEncoder().encode(chore))
        if let photo = pendingGuide {
            _ = try await api.setGuidePhoto(photo, for: chore.id, token: "parent")
        }
        XCTAssertEqual(saved.chore.guidePhotoPath, "local:replacement.jpg")
        XCTAssertEqual(PhotoProtocol.request?.httpMethod, "PATCH")
        XCTAssertEqual(PhotoProtocol.requestCount, 5)
    }

    func testDinnerAndStarsDecode() throws {
        let data = Data("""
        {"now":"2026-11-20T12:00:00-06:00","timezone":"America/Chicago",
         "chores":[],"people":[],"meals":[{"date":"2026-11-20","name":"Pizza","photoPath":"meals/a.jpg"}],
         "stars":[{"personId":"kid","balance":12,"weekEarned":2}],
         "settings":{"choreReminderHour":17,"choreReminderMinute":30}}
        """.utf8)
        let snapshot = try JSONDecoder().decode(Snapshot.self, from: data)
        XCTAssertEqual(snapshot.stars?.first?.balance, 12)
        XCTAssertEqual(snapshot.meals.first?.photoPath, "meals/a.jpg")
        let now = ISO8601DateFormatter().date(from: "2026-11-20T18:00:00Z")!
        XCTAssertEqual(ChoreReminders.triggerDate(snapshot: snapshot, now: now),
                       ISO8601DateFormatter().date(from: "2026-11-20T23:30:00Z"))
        XCTAssertNil(ChoreReminders.triggerDate(snapshot: snapshot,
            now: ISO8601DateFormatter().date(from: "2026-11-21T00:00:00Z")!))
    }

    func testReminderRejectsOvernightSnapshotButUsesSnapshotTimezone() throws {
        let snapshot = try JSONDecoder().decode(Snapshot.self, from: Data("""
        {"now":"2026-11-20T12:00:00-08:00","timezone":"America/Los_Angeles",
         "chores":[{"id":"old","choreId":"c","personId":"kid","date":"2026-11-20",
         "status":"open","title":"Dishes","stars":2,"starsAwarded":0,"requiresPhoto":false,"steps":[]}],
         "people":[],"meals":[],"settings":{"choreReminderHour":23,"choreReminderMinute":0}}
        """.utf8))
        let kid = Person(id: "kid", slug: "kid", name: "Kid", role: "kid", color: "", avatarKey: nil)
        XCTAssertEqual(snapshot.chores(for: kid).count, 1)
        let dates = ISO8601DateFormatter()
        XCTAssertEqual(ChoreReminders.triggerDate(snapshot: snapshot,
            now: dates.date(from: "2026-11-21T01:00:00Z")!),
            dates.date(from: "2026-11-21T07:00:00Z"))
        XCTAssertNil(ChoreReminders.triggerDate(snapshot: snapshot,
            now: dates.date(from: "2026-11-21T09:00:00Z")!))
        XCTAssertNil(ChoreReminders.triggerDate(snapshot: snapshot,
            now: dates.date(from: "2026-11-20T04:00:00Z")!))
    }

    func testReminderInvalidTimezoneFallsBackToCurrentTimezone() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let now = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 11, day: 20, hour: 12)))
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = .current
        let snapshot = Snapshot(now: formatter.string(from: now), timezone: "Invalid/Timezone",
            chores: [], meals: [], people: [], stars: nil,
            settings: FamilySettings(choreReminderHour: 23, choreReminderMinute: 59))
        XCTAssertEqual(ChoreReminders.triggerDate(snapshot: snapshot, now: now),
            calendar.date(bySettingHour: 23, minute: 59, second: 0, of: now))
    }

    func testReminderDefaultsAndMalformedMeal() throws {
        let snapshot = try JSONDecoder().decode(Snapshot.self, from: Data("""
        {"now":"2026-06-20T12:00:00-05:00","timezone":"America/Chicago",
         "chores":[],"people":[],"meals":[]}
        """.utf8))
        XCTAssertNil(snapshot.stars)
        XCTAssertEqual(ChoreReminders.triggerDate(snapshot: snapshot,
            now: ISO8601DateFormatter().date(from: "2026-06-20T17:00:00Z")!),
            ISO8601DateFormatter().date(from: "2026-06-20T23:00:00Z"))
        XCTAssertThrowsError(try JSONDecoder().decode(MealsResponse.self, from: Data(#"{"meals":[{"date":"bad"}]}"#.utf8)))
    }

    @MainActor
    func testSignOutClearsRevokedParentDespiteLogoutFailure() async throws {
        let saved = Keychain.read("session")
        defer { try? Keychain.write(saved, key: "session") }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RevokedSessionProtocol.self]
        let network = URLSession(configuration: configuration)
        defer { network.invalidateAndCancel() }
        let house = House(api: APIClient(session: network))
        house.person = Person(id: "parent", slug: "focus", name: "Focus", role: "parent", color: "", avatarKey: nil)
        house.session = "revoked-session"
        house.family = nil
        try Keychain.write("revoked-session", key: "session")
        RevokedSessionProtocol.paths = []
        await house.signOut()
        XCTAssertEqual(RevokedSessionProtocol.paths, ["/api/auth/logout"])
        XCTAssertNil(house.session)
        XCTAssertNil(house.person)
        XCTAssertNil(Keychain.read("session"))
    }

    func testPairingApprovalURLForms() throws {
        for value in [
            "liendoplaza://pair?code=abc-123",
            "https://liendo-plaza.vercel.app/family/pair?code=abc-123",
            "https://liendo-plaza-git-cursor-liendo-pla-c65a88-focus-otters-projects.vercel.app/family/pair?code=abc-123"
        ] {
            XCTAssertEqual(PairingLink(try XCTUnwrap(URL(string: value))), .approval("ABC-123"))
        }
    }

    func testPairingURLRejectsEmptyCodesAndUntrustedHosts() throws {
        for value in [
            "liendoplaza://pair", "liendoplaza://pair?code=",
            "liendoplaza://pair?code=%20",
            "https://example.com/family/pair?code=ABC123",
            "http://liendo-plaza.vercel.app/family/pair?code=ABC123",
            "https://liendo-plaza.vercel.app/other?code=ABC123"
        ] {
            XCTAssertNil(PairingLink(try XCTUnwrap(URL(string: value))))
        }
    }

    func testPairingInviteURLFormsStillWork() throws {
        for value in [
            "liendoplaza://?invite=token",
            "https://liendo-plaza.vercel.app/family?invite=token",
            "https://liendo-plaza.vercel.app/join?invite=token"
        ] {
            XCTAssertEqual(PairingLink(try XCTUnwrap(URL(string: value))), .invite("token"))
        }
    }

    @MainActor
    func testApprovalLinkRequiresParentAndRoutesCode() async throws {
        let house = House()
        let link = try XCTUnwrap(URL(string: "liendoplaza://pair?code=abc123"))
        house.session = nil
        await house.open(link)
        XCTAssertEqual(house.error, "Sign in first.")
        XCTAssertNil(house.deviceApproval)
        house.session = "test-session"
        house.person = Person(id: "kid", slug: "noah", name: "Noah", role: "kid", color: "", avatarKey: nil)
        await house.open(link)
        XCTAssertEqual(house.error, "Only a parent can do that.")
        XCTAssertNil(house.deviceApproval)
        house.person = Person(id: "parent", slug: "focus", name: "Focus", role: "parent", color: "", avatarKey: nil)
        await house.open(link)
        XCTAssertEqual(house.deviceApproval?.code, "ABC123")
        XCTAssertEqual(house.error, "")
    }

    private func withMigrationState(_ run: () throws -> Void) throws {
        let keys = ["session", "family", "expoMigration"]
        let saved = keys.map { Keychain.read($0) }
        var savedExpo: [(query: [String: Any], data: Data)] = []
        for service in ["app:no-auth", "app"] {
            for key in ["lp.session", "lp.family"] {
                let query: [String: Any] = [
                    kSecClass as String: kSecClassGenericPassword,
                    kSecAttrService as String: service,
                    kSecAttrAccount as String: Data(key.utf8),
                    kSecAttrGeneric as String: Data(key.utf8)
                ]
                var search = query
                search[kSecReturnData as String] = true
                var result: CFTypeRef?
                let status = SecItemCopyMatching(search as CFDictionary, &result)
                XCTAssertTrue(status == errSecSuccess || status == errSecItemNotFound)
                if let data = result as? Data { savedExpo.append((query, data)) }
                SecItemDelete(query as CFDictionary)
            }
        }
        defer {
            for service in ["app:no-auth", "app"] {
                for key in ["lp.session", "lp.family"] {
                    SecItemDelete([
                        kSecClass as String: kSecClassGenericPassword,
                        kSecAttrService as String: service,
                        kSecAttrAccount as String: Data(key.utf8)
                    ] as CFDictionary)
                }
            }
            for entry in savedExpo {
                var item = entry.query
                item[kSecValueData as String] = entry.data
                XCTAssertEqual(SecItemAdd(item as CFDictionary, nil), errSecSuccess)
            }
            for (key, value) in zip(keys, saved) { try? Keychain.write(value, key: key) }
        }
        for key in keys { try Keychain.write(nil, key: key) }
        try run()
    }

    private func writeExpo(_ key: String, data: Data, service: String = "app:no-auth") {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: Data("lp.\(key)".utf8),
            kSecAttrGeneric as String: Data("lp.\(key)".utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlocked,
            kSecValueData as String: data
        ]
        XCTAssertEqual(SecItemAdd(query as CFDictionary, nil), errSecSuccess)
    }

    func testMigratesExpoTokensOnceAndLeavesOriginals() throws {
        try withMigrationState {
            writeExpo("session", data: Data("expo-session-✓".utf8))
            writeExpo("family", data: Data("expo-family".utf8))
            try Keychain.migrateExpoTokens()
            XCTAssertEqual(Keychain.read("session"), "expo-session-✓")
            XCTAssertEqual(Keychain.read("family"), "expo-family")
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "app:no-auth",
                kSecAttrAccount as String: Data("lp.session".utf8),
                kSecAttrGeneric as String: Data("lp.session".utf8)
            ]
            XCTAssertEqual(SecItemCopyMatching(query as CFDictionary, nil), errSecSuccess)
            try Keychain.write(nil, key: "session")
            try Keychain.migrateExpoTokens()
            XCTAssertNil(Keychain.read("session"))
        }
    }

    func testExpoMigrationPreservesNativeAndReadsLegacyService() throws {
        try withMigrationState {
            try Keychain.write("native", key: "session")
            writeExpo("session", data: Data("old".utf8))
            writeExpo("family", data: Data("legacy-family".utf8), service: "app")
            try Keychain.migrateExpoTokens()
            XCTAssertEqual(Keychain.read("session"), "native")
            XCTAssertEqual(Keychain.read("family"), "legacy-family")
        }
    }

    func testExpoMigrationWithNoItems() throws {
        try withMigrationState {
            try Keychain.migrateExpoTokens()
            XCTAssertNil(Keychain.read("session"))
            XCTAssertNil(Keychain.read("family"))
            XCTAssertEqual(Keychain.read("expoMigration"), "1")
        }
    }

    func testExpoMigrationInvalidEncodingDoesNotMarkComplete() throws {
        try withMigrationState {
            writeExpo("session", data: Data([0xFF]))
            XCTAssertThrowsError(try Keychain.migrateExpoTokens())
            XCTAssertNil(Keychain.read("expoMigration"))
        }
    }

    func testSnapshotIgnoresUnneededFieldsAndFiltersByServerDay() throws {
        let data = Data("""
        {"now":"2026-11-20T00:01:00-06:00","timezone":"America/Chicago","weather":null,
         "events":[],"people":[],"meals":[{"date":"2026-11-20","name":"Pizza","photoPath":null}],
         "chores":[
         {"id":"a","choreId":"c","personId":"kid","date":"2026-11-20","status":"open",
          "title":"Dishes","stars":2,"starsAwarded":0,"requiresPhoto":false,"steps":[]},
         {"id":"b","choreId":"c","personId":"other","date":"2026-11-20","status":"pending",
          "title":"Fish","stars":1,"starsAwarded":0,"requiresPhoto":true,"steps":[]},
         {"id":"d","choreId":"c","personId":"kid","date":"2026-11-21","status":"done",
          "title":"Tomorrow","stars":1,"starsAwarded":1,"requiresPhoto":false,"steps":[]}]}
        """.utf8)
        let snapshot = try JSONDecoder().decode(Snapshot.self, from: data)
        let kid = Person(id: "kid", slug: "noah", name: "Noah", role: "kid", color: "", avatarKey: nil)
        let parent = Person(id: "parent", slug: "focus", name: "Focus", role: "parent", color: "", avatarKey: nil)
        XCTAssertEqual(snapshot.today, "2026-11-20")
        XCTAssertEqual(snapshot.chores(for: kid).map(\.id), ["a"])
        XCTAssertEqual(snapshot.chores(for: parent).map(\.id), ["a", "b"])
        XCTAssertEqual(snapshot.chores[1].statusLabel, "Waiting")
    }

    func testEmptySnapshot() throws {
        let data = Data("""
        {"now":"2026-11-20T00:00:00-06:00","timezone":"America/Chicago","chores":[],"people":[],"meals":[]}
        """.utf8)
        XCTAssertTrue(try JSONDecoder().decode(Snapshot.self, from: data).chores.isEmpty)
    }

    func testMalformedSnapshotIsNotSilentlyEmpty() {
        XCTAssertThrowsError(try JSONDecoder().decode(Snapshot.self, from: Data("{}".utf8)))
    }

    func testCodeLoginResponses() throws {
        let decoder = JSONDecoder()
        let setup = try decoder.decode(CodeStatus.self, from: Data("{\"setupRequired\":true,\"people\":[]}".utf8))
        XCTAssertTrue(setup.setupRequired)
        XCTAssertTrue(setup.people.isEmpty)
        let login = try decoder.decode(CodeLogin.self, from: Data(#"{"token":"session","person":{"id":"parent","slug":"focus","name":"Focus","role":"parent","color":"red"}}"#.utf8))
        XCTAssertEqual(login.token, "session")
        XCTAssertTrue(login.person.isParent)
        XCTAssertThrowsError(try decoder.decode(CodeLogin.self, from: Data("{}".utf8)))
        let settings = try decoder.decode(CodeSettings.self, from: Data("{\"configuredPersonIds\":[\"parent\"]}".utf8))
        XCTAssertEqual(settings.configuredPersonIds, ["parent"])
        XCTAssertThrowsError(try decoder.decode(CodeStatus.self, from: Data("{}".utf8)))
    }
}
