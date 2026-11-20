import XCTest
import Security
@testable import LiendoPlaza

final class ModelsTests: XCTestCase {
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
}
