import XCTest
@testable import LiendoPlaza

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
    func testPhotoAccessibilityLabelsMatchContext() {
        XCTAssertEqual(MealPhoto(path: "meal.jpg").accessibilityLabel, "Dinner photo")
        XCTAssertEqual(MealPhoto(path: "proof.jpg", accessibilityLabel: "Proof photo").accessibilityLabel, "Proof photo")
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
         "onceDate":null,"description":"Use a cup","steps":["Fill cup","Water"],"active":true}]}
        """.utf8)
        let response = try JSONDecoder().decode(ChoreListResponse.self, from: data)
        let chore = try XCTUnwrap(response.chores.first)
        let encoded = try JSONDecoder().decode(ChoreDefinition.self, from: JSONEncoder().encode(chore))
        XCTAssertEqual(encoded.weekdays, [1, 3, 5])
        XCTAssertEqual(encoded.steps, ["Fill cup", "Water"])
        XCTAssertTrue(encoded.requiresPhoto)
        XCTAssertThrowsError(try JSONDecoder().decode(ChoreListResponse.self, from: Data(#"{"chores":[{}]}"#.utf8)))
        XCTAssertTrue(try JSONDecoder().decode(ChoreListResponse.self, from: Data(#"{"chores":[]}"#.utf8)).chores.isEmpty)
    }
}
