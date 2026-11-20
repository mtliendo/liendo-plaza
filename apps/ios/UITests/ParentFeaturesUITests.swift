import XCTest

final class ParentFeaturesUITests: XCTestCase {
    private let environment = ProcessInfo.processInfo.environment
    override func setUpWithError() throws { continueAfterFailure = false }
    private var parentToken: String {
        get throws { try XCTUnwrap(environment["LP_PARENT_TOKEN"], "Run scripts/ui-tests.sh") }
    }
    private func api(_ path: String, body: [String: String]? = nil, token: String? = nil) async throws -> [String: Any] {
        let base = URL(string: environment["LP_API_URL"] ?? "http://localhost:3000")!
        var request = URLRequest(url: base.appendingPathComponent("api/" + path))
        request.timeoutInterval = 60
        if let body {
            request.httpMethod = "POST"
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
    @MainActor
    private func launch(token: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestReset", "-uiTestGroceries"]
        app.launchEnvironment["LP_API_URL"] = environment["LP_API_URL"] ?? "http://localhost:3000"
        app.launchEnvironment["LP_TEST_SESSION_TOKEN"] = token
        app.launch()
        XCTAssertTrue(app.staticTexts["today"].waitForExistence(timeout: 60))
        return app
    }
    @MainActor
    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor
    func testTodayPullRefreshReachesServer() async throws {
        try XCTSkipUnless(environment["LP_REFRESH_PROBE"] == "1", "Requires scripts/refresh-fixture.ts")
        let app = launch(token: try parentToken)
        XCTAssertTrue(app.buttons["chore.Refresh fixture chore"].waitForExistence(timeout: 30))
        let before = try await api("qa/requests/today-before", token: parentToken)
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.28))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85))
        start.press(forDuration: 0.1, thenDragTo: end)
        var refreshed = false
        for _ in 0..<30 {
            let after = try await api("qa/requests/today-after", token: parentToken)
            if (after["snapshot"] as? Int ?? 0) > (before["snapshot"] as? Int ?? 0),
               (after["pending"] as? Int ?? 0) > (before["pending"] as? Int ?? 0) {
                refreshed = true
                break
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertTrue(refreshed, "The pull must fetch both snapshot and pending proofs, without changing tabs.")
        capture(app, "Today-pull-refreshed")
    }

    @MainActor
    func testDinnerPullRefreshReachesServer() async throws {
        try XCTSkipUnless(environment["LP_REFRESH_PROBE"] == "1", "Requires scripts/refresh-fixture.ts")
        let app = launch(token: try parentToken)
        XCTAssertTrue(app.buttons["chore.Refresh fixture chore"].waitForExistence(timeout: 30))
        app.tabBars.buttons["Dinner"].tap()
        XCTAssertTrue(app.staticTexts["This week"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.staticTexts["Nothing written yet"].firstMatch.waitForExistence(timeout: 30))
        let before = try await api("qa/requests/dinner-before", token: parentToken)
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.28))
        let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85))
        start.press(forDuration: 0.1, thenDragTo: end)
        var refreshed = false
        for _ in 0..<30 {
            let after = try await api("qa/requests/dinner-after", token: parentToken)
            if (after["meals"] as? Int ?? 0) > (before["meals"] as? Int ?? 0) {
                refreshed = true
                break
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertTrue(refreshed, "The pull must fetch meals without changing tabs or weeks.")
        capture(app, "Dinner-pull-refreshed")
    }

    @MainActor
    func testParentEditsTonightDinner() async throws {
        let snapshot = try await api("snapshot", token: parentToken)
        let today = String(try XCTUnwrap(snapshot["now"] as? String).prefix(10))
        let app = launch(token: try parentToken)
        XCTAssertTrue(app.buttons["chore.Unload the dishwasher"].waitForExistence(timeout: 60))
        capture(app, "Today-parent")
        app.tabBars.buttons["Dinner"].tap()
        let day = app.buttons["dinner.\(today)"]
        XCTAssertTrue(day.waitForExistence(timeout: 30))
        for _ in 0..<6 where !day.isHittable { app.swipeUp() }
        day.tap()
        let field = app.textFields["dinner.name"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        let existing = field.value as? String ?? ""
        if existing != "Dinner" { field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: existing.count)) }
        field.typeText("UI test tacos")
        app.buttons["dinner.save"].tap()
        XCTAssertTrue(app.staticTexts["UI test tacos"].waitForExistence(timeout: 30))
        capture(app, "Dinner-edited")
    }

    @MainActor
    func testParentAddsChoreForNoah() throws {
        let app = launch(token: try parentToken)
        XCTAssertTrue(app.tabBars.buttons["Family"].waitForExistence(timeout: 60))
        app.tabBars.buttons["Chores"].tap()
        app.buttons["manage.add"].tap()
        let field = app.textFields["manage.title"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("UI test water the basil")
        app.buttons["manage.person"].tap()
        app.buttons["Noah"].tap()
        capture(app, "Chore-editor")
        app.buttons["manage.save"].tap()
        XCTAssertTrue(app.buttons["manage.chore.UI test water the basil"].waitForExistence(timeout: 60))
        capture(app, "Chores-added")
    }

    @MainActor
    func testParentAddsAndChecksGrocery() throws {
        let app = launch(token: try parentToken)
        XCTAssertTrue(app.tabBars.buttons["Groceries"].waitForExistence(timeout: 60))
        app.tabBars.buttons["Groceries"].tap()
        let field = app.textFields["groceries.title"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("Milk")
        app.buttons["groceries.add"].tap()
        let item = app.buttons["groceries.item.Milk"]
        XCTAssertTrue(item.waitForExistence(timeout: 10))
        capture(app, "Groceries-added")
        item.tap()
        XCTAssertTrue(app.staticTexts["Your grocery list is clear."].waitForExistence(timeout: 10))
        XCTAssertFalse(item.exists)
        capture(app, "Groceries-checked")
    }

    @MainActor
    func testKidOnlyHasChoresAndDinner() async throws {
        let claim = try await api("pair/claim", body: ["deviceKind": "phone"])
        _ = try await api("pair/approve", body: ["code": try XCTUnwrap(claim["displayCode"] as? String)], token: parentToken)
        let poll = try await api("pair/poll", body: [
            "id": try XCTUnwrap(claim["id"] as? String), "pollSecret": try XCTUnwrap(claim["pollSecret"] as? String)
        ])
        let snapshot = try await api("snapshot", token: parentToken)
        let people = try XCTUnwrap(snapshot["people"] as? [[String: Any]])
        let noah = try XCTUnwrap(people.first { $0["slug"] as? String == "noah" })
        let login = try await api("auth/login", body: [
            "familyToken": try XCTUnwrap(poll["familyToken"] as? String),
            "personId": try XCTUnwrap(noah["id"] as? String), "pin": "1234", "deviceKind": "phone"
        ])
        let app = launch(token: try XCTUnwrap(login["token"] as? String))
        XCTAssertTrue(app.staticTexts["stars.balance"].waitForExistence(timeout: 60))
        XCTAssertEqual(app.tabBars.buttons.count, 2)
        XCTAssertTrue(app.tabBars.buttons["Chores"].exists)
        XCTAssertTrue(app.tabBars.buttons["Dinner"].exists)
        XCTAssertFalse(app.tabBars.buttons["Groceries"].exists)
        XCTAssertFalse(app.buttons["manage.add"].exists)
        capture(app, "Today-kid")
    }
}
