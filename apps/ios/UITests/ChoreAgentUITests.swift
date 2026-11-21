import XCTest

final class ChoreAgentUITests: XCTestCase {
    @MainActor
    func testParentAddsChoreWithAgent() async throws {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        let token = try XCTUnwrap(environment["LP_PARENT_TOKEN"], "Run scripts/ui-tests.sh")
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestReset", "-uiTestGroceries"]
        app.launchEnvironment["LP_API_URL"] = environment["LP_API_URL"] ?? "http://localhost:3000"
        app.launchEnvironment["LP_TEST_SESSION_TOKEN"] = token
        app.launch()
        XCTAssertTrue(app.staticTexts["today"].waitForExistence(timeout: 60))
        XCTAssertTrue(app.tabBars.buttons["Family"].waitForExistence(timeout: 60))
        app.tabBars.buttons["Chores"].tap()
        let ask = app.buttons["askAgent"]
        XCTAssertTrue(ask.waitForExistence(timeout: 20))
        ask.tap()
        let input = app.textFields["agentInput"].exists ? app.textFields["agentInput"] : app.textViews["agentInput"]
        XCTAssertTrue(input.waitForExistence(timeout: 10))
        input.tap()
        input.typeText("add feed the fish")
        app.buttons["agentSend"].tap()
        XCTAssertTrue(app.staticTexts["agentSummary"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        XCTAssertTrue(app.buttons["agentApply"].isHittable)
        XCTAssertTrue(app.buttons["agentDiscard"].isHittable)
        XCTAssertTrue(app.otherElements["agentChange"].exists || app.staticTexts.matching(identifier: "agentChange").firstMatch.exists)
        let preview = XCTAttachment(screenshot: app.screenshot())
        preview.name = "Chore-agent-proposal"
        preview.lifetime = .keepAlways
        add(preview)
        app.buttons["agentApply"].tap()
        XCTAssertTrue(app.buttons["manage.chore.feed the fish"].waitForExistence(timeout: 30))
        let applied = XCTAttachment(screenshot: app.screenshot())
        applied.name = "Chore-agent-applied"
        applied.lifetime = .keepAlways
        add(applied)
        let base = URL(string: environment["LP_API_URL"] ?? "http://localhost:3000")!
        var list = URLRequest(url: base.appendingPathComponent("api/chores"))
        list.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        let (data, _) = try await URLSession.shared.data(for: list)
        let response = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let chores = try XCTUnwrap(response["chores"] as? [[String: Any]])
        let chore = try XCTUnwrap(chores.first { $0["title"] as? String == "feed the fish" && $0["active"] as? Bool == true })
        let id = try XCTUnwrap(chore["id"] as? String)
        var remove = URLRequest(url: base.appendingPathComponent("api/chores/\(id)"))
        remove.httpMethod = "DELETE"
        remove.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        let (_, removed) = try await URLSession.shared.data(for: remove)
        XCTAssertEqual((removed as? HTTPURLResponse)?.statusCode, 200)
    }
}
