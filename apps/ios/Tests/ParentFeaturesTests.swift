import XCTest
@testable import LiendoPlaza

private final class PendingProofsProtocol: URLProtocol {
    static var paths: [String] = []
    static var failure = false
    static var snapshotFailure = false
    static var pendingIDs: [String] = []
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url!.path
        Self.paths.append(path)
        let failed = Self.failure || (Self.snapshotFailure && path.hasSuffix("/snapshot"))
        let body: String
        if failed {
            body = #"{"error":"Could not load proofs."}"#
        } else if path.hasSuffix("/me") {
            body = """
            {"actor":{"person":{"id":"parent","slug":"focus","name":"Parent","role":"parent","color":""}}}
            """
        } else if path.hasSuffix("/snapshot") {
            body = """
            {"now":"2026-11-20T12:00:00Z","timezone":"America/Chicago","chores":[],"meals":[],"people":[]}
            """
        } else if path.hasSuffix("/review") {
            body = """
            {"instance":{"id":"old","choreId":"c","personId":"kid","date":"2026-11-19",
             "status":"done","title":"Dishes","stars":2,"starsAwarded":2,"requiresPhoto":true,"steps":[]}}
            """
        } else {
            let instances = Self.pendingIDs.map { id in
                """
                {"id":"\(id)","choreId":"c","personId":"kid","date":"2026-11-19",
                 "status":"pending","title":"Dishes","stars":2,"starsAwarded":0,"requiresPhoto":true,"steps":[]}
                """
            }.joined(separator: ",")
            body = #"{"instances":["# + instances + "]}"
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!,
            statusCode: failed ? 500 : 200, httpVersion: nil, headerFields: nil)!,
            cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

@MainActor
private final class UnavailableGroceriesStore: GroceriesStore {
    var allowed = false
    func requestAccess() async throws -> Bool { allowed }
    func items() async throws -> [GroceryItem] { [] }
    func add(_ title: String) async throws { throw APIError(status: 0, message: "Could not save reminder.") }
    func complete(_ id: String) async throws {}
    func clearChecked() async throws {}
}

final class ParentFeaturesTests: XCTestCase {
    func testChoreDestinationsUseInstanceIdentity() {
        let first = ChoreDestination(id: "instance-a")
        let repeated = ChoreDestination(id: "instance-a")
        let second = ChoreDestination(id: "instance-b")
        XCTAssertEqual(first, repeated)
        XCTAssertNotEqual(first, second)
        XCTAssertEqual(Set([first, repeated, second]).count, 2)
    }

    private func instance(_ id: String, date: String, status: String = "pending") -> ChoreInstance {
        ChoreInstance(id: id, choreId: "c", personId: "kid", date: date, status: status,
            title: "Dishes", stars: 2, starsAwarded: 0, requiresPhoto: true,
            description: nil, photoPath: "local:proof.jpg", steps: [])
    }

    func testPendingProofsMergeDeduplicatesAndSortsOldestFirst() {
        let old = instance("old", date: "2026-11-19")
        let today = instance("today", date: "2026-11-20")
        let merged = PendingProofs.merge(history: [today, old], today: [today])
        XCTAssertEqual(merged.map(\.id), ["old", "today"])
        XCTAssertEqual(PendingProofs.merge(history: [], today: [today]).map(\.id), ["today"])
        XCTAssertEqual(PendingProofs.merge(history: [old], today: []).map(\.id), ["old"])
        XCTAssertTrue(PendingProofs.merge(history: [], today: []).isEmpty)
    }

    func testPendingProofsExcludeReviewedItemsAndPreferFreshHistory() {
        let stale = instance("same", date: "2026-11-20")
        for status in ["done", "open", "rejected"] {
            let fresh = instance("same", date: "2026-11-20", status: status)
            XCTAssertTrue(PendingProofs.merge(history: [fresh], today: [stale]).isEmpty)
        }
        let a = instance("a", date: "2026-11-20")
        let b = instance("b", date: "2026-11-20")
        XCTAssertEqual(PendingProofs.merge(history: [b, a], today: []).map(\.id), ["a", "b"])
    }

    @MainActor
    func testKidModelsOnlyExposeOwnInstancesEvenWithUnfilteredCachedData() {
        let house = House()
        let kid = Person(id: "kid", slug: "noah", name: "Kid", role: "kid", color: "", avatarKey: nil)
        let own = instance("own", date: "2026-11-20")
        let other = ChoreInstance(id: "other", choreId: "other-chore", personId: "other-kid",
            date: "2026-11-20", status: "pending", title: "Private proof title",
            stars: 2, starsAwarded: 0, requiresPhoto: true, description: nil, photoPath: nil, steps: [])
        house.snapshot = Snapshot(now: "2026-11-20T12:00:00Z", timezone: "America/Chicago",
            chores: [own, other], meals: [], people: [kid], stars: nil, settings: nil)
        house.pendingInstances = [own, other]
        house.person = kid
        XCTAssertEqual(house.snapshot?.chores(for: kid).map(\.id), ["own"])
        XCTAssertEqual(house.pendingProofs.map(\.id), ["own"])
        XCTAssertNotNil(house.chore(id: own.id))
        XCTAssertNil(house.chore(id: other.id))
        house.person = Person(id: "parent", slug: "focus", name: "Parent", role: "parent", color: "", avatarKey: nil)
        XCTAssertEqual(Set(house.pendingProofs.map(\.id)), Set(["own", "other"]))
        XCTAssertNotNil(house.chore(id: other.id))
        house.person = nil
        XCTAssertTrue(house.pendingProofs.isEmpty)
        XCTAssertNil(house.chore(id: own.id))
    }

    @MainActor
    func testTodayRefreshAwaitsSnapshotAndNewHistoricalProofs() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PendingProofsProtocol.self]
        let network = URLSession(configuration: configuration)
        defer {
            network.invalidateAndCancel()
            PendingProofsProtocol.pendingIDs = []
        }
        let house = House(api: APIClient(session: network))
        house.session = "test-session"
        PendingProofsProtocol.failure = false
        PendingProofsProtocol.paths = []
        await house.load()
        XCTAssertNotNil(house.snapshot)
        XCTAssertTrue(house.pendingProofs.isEmpty)
        XCTAssertEqual(PendingProofsProtocol.paths, ["/api/me", "/api/snapshot", "/api/chores/instances/pending"])

        PendingProofsProtocol.pendingIDs = ["new-old-proof"]
        PendingProofsProtocol.paths = []
        await house.load(includingPendingProofs: false)
        XCTAssertTrue(house.pendingProofs.isEmpty)
        XCTAssertEqual(PendingProofsProtocol.paths, ["/api/me", "/api/snapshot"])
        await house.loadPendingProofs()
        XCTAssertEqual(house.pendingProofs.map(\.id), ["new-old-proof"])
        XCTAssertEqual(PendingProofsProtocol.paths, ["/api/me", "/api/snapshot", "/api/chores/instances/pending"])
    }

    @MainActor
    func testTodayRefreshStillLoadsProofsWhenSnapshotFails() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PendingProofsProtocol.self]
        let network = URLSession(configuration: configuration)
        defer {
            network.invalidateAndCancel()
            PendingProofsProtocol.snapshotFailure = false
            PendingProofsProtocol.pendingIDs = []
        }
        let house = House(api: APIClient(session: network))
        house.session = "test-session"
        house.person = Person(id: "parent", slug: "focus", name: "Parent", role: "parent", color: "", avatarKey: nil)
        PendingProofsProtocol.failure = false
        PendingProofsProtocol.snapshotFailure = true
        PendingProofsProtocol.pendingIDs = ["old"]
        PendingProofsProtocol.paths = []
        await house.load(includingPendingProofs: false)
        await house.loadPendingProofs()
        XCTAssertNil(house.snapshot)
        XCTAssertFalse(house.error.isEmpty)
        XCTAssertEqual(house.pendingProofs.map(\.id), ["old"])
        XCTAssertEqual(PendingProofsProtocol.paths, ["/api/me", "/api/snapshot", "/api/chores/instances/pending"])
    }

    @MainActor
    func testPendingProofLoadEmptyFailureReviewRefreshAndKidGating() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PendingProofsProtocol.self]
        let network = URLSession(configuration: configuration)
        defer { network.invalidateAndCancel() }
        let house = House(api: APIClient(session: network))
        house.session = "test-session"
        house.person = Person(id: "parent", slug: "focus", name: "Parent", role: "parent", color: "", avatarKey: nil)
        let old = instance("old", date: "2026-11-19")
        house.pendingInstances = [old]
        XCTAssertEqual(house.chore(id: old.id)?.id, old.id)
        PendingProofsProtocol.failure = true
        PendingProofsProtocol.paths = []
        await house.loadPendingProofs()
        XCTAssertEqual(house.pendingProofs.map(\.id), ["old"])
        XCTAssertEqual(house.error, "Could not load proofs.")
        PendingProofsProtocol.failure = false
        try await house.review(old.id, action: "approve")
        XCTAssertTrue(house.pendingProofs.isEmpty)
        XCTAssertEqual(PendingProofsProtocol.paths, ["/api/chores/instances/pending",
            "/api/chores/instances/old/review", "/api/chores/instances/pending"])
        house.pendingInstances = [old]
        PendingProofsProtocol.paths = []
        house.person = Person(id: "kid", slug: "noah", name: "Kid", role: "kid", color: "", avatarKey: nil)
        await house.loadPendingProofs()
        XCTAssertTrue(PendingProofsProtocol.paths.isEmpty)
        XCTAssertTrue(house.pendingInstances.isEmpty)
    }

    func testPhotoAccessibilityLabelsMatchContext() {
        XCTAssertEqual(MealPhoto(path: "meal.jpg").accessibilityLabel, "Dinner photo")
        XCTAssertEqual(MealPhoto(path: "proof.jpg", accessibilityLabel: "Proof photo").accessibilityLabel, "Proof photo")
        XCTAssertEqual(MealPhoto(path: "guide.jpg", accessibilityLabel: "Guide photo").accessibilityLabel, "Guide photo")
    }

    func testChoreGuideDecodingSupportsPresentMissingAndNullPaths() throws {
        let base = try JSONSerialization.jsonObject(with: JSONEncoder().encode(instance("guide", date: "2026-11-20"))) as! [String: Any]
        for path in ["local:guide.jpg", NSNull()] as [Any] {
            var json = base
            json["guidePhotoPath"] = path
            let chore = try JSONDecoder().decode(ChoreInstance.self, from: JSONSerialization.data(withJSONObject: json))
            XCTAssertEqual(chore.guidePhotoPath, path as? String)
        }
        XCTAssertNil(try JSONDecoder().decode(ChoreInstance.self, from: JSONSerialization.data(withJSONObject: base)).guidePhotoPath)
        var invalid = base
        invalid["guidePhotoPath"] = 42
        XCTAssertThrowsError(try JSONDecoder().decode(ChoreInstance.self, from: JSONSerialization.data(withJSONObject: invalid)))
    }

    func testChoreRepeatPayloadClearsUnrelatedFieldsForCreateAndEdit() throws {
        for id in ["", "existing"] {
            for repeatType in ["daily", "weekdays", "weekly", "once"] {
                let chore = ChoreDefinition(id: id, title: "Plants", assignedPersonId: "kid",
                    stars: 2, requiresPhoto: false, repeatType: repeatType, weekdays: [1, 3, 5],
                    weeklyWeekday: 6, onceDate: "2026-11-22", description: nil, steps: [], active: true)
                let data = try JSONEncoder().encode(chore)
                let values = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
                if repeatType == "weekdays" {
                    XCTAssertEqual(values["weekdays"] as? [Int], [1, 3, 5])
                } else { XCTAssertTrue(values["weekdays"] is NSNull) }
                if repeatType == "weekly" {
                    XCTAssertEqual(values["weeklyWeekday"] as? Int, 6)
                } else { XCTAssertTrue(values["weeklyWeekday"] is NSNull) }
                if repeatType == "once" {
                    XCTAssertEqual(values["onceDate"] as? String, "2026-11-22")
                } else { XCTAssertTrue(values["onceDate"] is NSNull) }
            }
        }
    }

    func testPhotoURLsPreservePublicAndStoredPaths() {
        let api = APIClient()
        XCTAssertEqual(api.photoURL("/meals/tacos.jpg").path, "/meals/tacos.jpg")
        XCTAssertTrue(api.photoURL("local:photo.jpg").absoluteString.hasSuffix("/api/photos/local%3Aphoto.jpg"))
        XCTAssertTrue(api.photoURL("https://example.com/meal.jpg").absoluteString
            .hasSuffix("/api/photos/https%3A%2F%2Fexample.com%2Fmeal.jpg"))
    }

    @MainActor
    func testGroceriesEmptyAddCompleteAndClear() async {
        let model = GroceriesModel(store: MemoryGroceriesStore())
        await model.load()
        XCTAssertFalse(model.denied)
        XCTAssertTrue(model.items.isEmpty)
        let empty = await model.add("   ")
        XCTAssertFalse(empty)
        let added = await model.add(" Milk ")
        XCTAssertTrue(added)
        XCTAssertEqual(model.items.map(\.title), ["Milk"])
        if let id = model.items.first?.id { await model.complete(id) }
        XCTAssertTrue(model.items.isEmpty)
        await model.clearChecked()
        XCTAssertTrue(model.error.isEmpty)
    }

    @MainActor
    func testGroceriesDeniedAndSaveFailure() async {
        let store = UnavailableGroceriesStore()
        let model = GroceriesModel(store: store)
        await model.load()
        XCTAssertTrue(model.denied)
        store.allowed = true
        await model.load()
        XCTAssertFalse(model.denied)
        let added = await model.add("Milk")
        XCTAssertFalse(added)
        XCTAssertEqual(model.error, "Could not save reminder.")
        XCTAssertTrue(model.items.isEmpty)
        XCTAssertFalse(model.busy)
    }

    func testWeekNavigationAcrossYearBoundary() {
        let now = MealWeek.formatter().date(from: "2026-01-01")!
        XCTAssertEqual(MealWeek.days(offset: 0, now: now).first, "2025-12-28")
        XCTAssertEqual(MealWeek.days(offset: 0, now: now).last, "2026-01-03")
        XCTAssertEqual(MealWeek.days(offset: 1, now: now).first, "2026-01-04")
        XCTAssertEqual(MealWeek.days(offset: -1, now: now).last, "2025-12-27")
    }

    func testChoreDefinitionDecodesAndEncodesEditorFields() throws {
        let data = Data("""
        {"chores":[{"id":"c","title":"Water plants","assignedPersonId":"kid","stars":3,
         "requiresPhoto":true,"repeatType":"weekdays","weekdays":[1,3,5],"weeklyWeekday":null,
         "onceDate":null,"description":"Use a cup","steps":["Fill cup","Water"],"active":true,"guidePhotoPath":"local:guide.jpg"}]}
        """.utf8)
        let response = try JSONDecoder().decode(ChoreListResponse.self, from: data)
        let chore = try XCTUnwrap(response.chores.first)
        XCTAssertEqual(chore.guidePhotoPath, "local:guide.jpg")
        let encoded = try JSONDecoder().decode(ChoreDefinition.self, from: JSONEncoder().encode(chore))
        XCTAssertEqual(encoded.weekdays, [1, 3, 5])
        XCTAssertEqual(encoded.steps, ["Fill cup", "Water"])
        XCTAssertTrue(encoded.requiresPhoto)
        XCTAssertThrowsError(try JSONDecoder().decode(ChoreListResponse.self, from: Data(#"{"chores":[{}]}"#.utf8)))
        XCTAssertTrue(try JSONDecoder().decode(ChoreListResponse.self, from: Data(#"{"chores":[]}"#.utf8)).chores.isEmpty)
    }

    func testChoreMovesStayWithinPersonAndEncodeOrderedIDs() throws {
        let chores = ["a", "other", "b", "c"].map { id in
            ChoreDefinition(id: id, title: id, assignedPersonId: id == "other" ? "other" : "kid",
                stars: 1, requiresPhoto: false, repeatType: "daily", steps: [], active: true)
        }
        let moved = ChoreReorder.moving(chores, personId: "kid", from: IndexSet(integer: 2), to: 0)
        XCTAssertEqual(moved.map(\.id), ["c", "other", "a", "b"])
        let payload = ChoreReorder(personId: "kid", choreIds: moved.filter { $0.assignedPersonId == "kid" }.map(\.id))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any])
        XCTAssertEqual(json["personId"] as? String, "kid")
        XCTAssertEqual(json["choreIds"] as? [String], ["c", "a", "b"])
        XCTAssertEqual(ChoreReorder.moving(chores, personId: "kid", from: IndexSet(integer: 0), to: 3).map(\.id),
            ["b", "other", "c", "a"])
        XCTAssertTrue(ChoreReorder.moving([], personId: "kid", from: [], to: 0).isEmpty)
        XCTAssertEqual(ChoreReorder.moving(chores, personId: "kid", from: [], to: 0).map(\.id), chores.map(\.id))
    }

    @MainActor
    func testChoreNotificationRequestsRefreshInForegroundAndOnTap() {
        let navigation = PushNavigation()
        navigation.tab = "dinner"
        navigation.receive([:])
        XCTAssertEqual(navigation.tab, "dinner")
        XCTAssertNil(navigation.refreshID)
        navigation.receive(["type": "reward"])
        XCTAssertEqual(navigation.tab, "dinner")
        XCTAssertNil(navigation.refreshID)
        navigation.receive(["type": "chores"], openChores: false)
        let foregroundRefresh = navigation.refreshID
        XCTAssertNotNil(foregroundRefresh)
        XCTAssertEqual(navigation.tab, "dinner")
        navigation.receive(["type": "chores"])
        XCTAssertNotEqual(navigation.refreshID, foregroundRefresh)
        XCTAssertEqual(navigation.tab, "today")
        let tapRefresh = navigation.refreshID
        navigation.receive(["type": "reward"])
        XCTAssertEqual(navigation.refreshID, tapRefresh)
    }
}
