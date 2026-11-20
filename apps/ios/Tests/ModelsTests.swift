import XCTest
@testable import LiendoPlaza

final class ModelsTests: XCTestCase {
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
