import XCTest

final class ChoreAgentUITests: XCTestCase {
    @MainActor
    func testKidCannotReachAgentAfterParentSignsOut() async throws {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        let base = URL(string: environment["LP_API_URL"] ?? "http://localhost:3000")!
        func api(_ path: String, body: [String: String]? = nil, token: String? = nil) async throws -> [String: Any] {
            var request = URLRequest(url: base.appendingPathComponent("api/" + path))
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
        let login = try await api("auth/login", body: [
            "code": "123456", "deviceKind": "phone"
        ])
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestReset", "-uiTestGroceries"]
        app.launchEnvironment["LP_API_URL"] = base.absoluteString
        app.launchEnvironment["LP_TEST_SESSION_TOKEN"] = try XCTUnwrap(login["token"] as? String)
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["Family"].waitForExistence(timeout: 60))
        app.tabBars.buttons["Chores"].tap()
        XCTAssertTrue(app.buttons["askAgent"].waitForExistence(timeout: 20))
        app.buttons["askAgent"].tap()
        let input = app.textFields["agentInput"].exists ? app.textFields["agentInput"] : app.textViews["agentInput"]
        input.tap()
        input.typeText("add Parent private history")
        app.buttons["agentSend"].tap()
        XCTAssertTrue(app.staticTexts["agentSummary"].waitForExistence(timeout: 30))
        app.buttons["Close"].tap()
        app.tabBars.buttons["Family"].tap()
        app.buttons["signOut"].tap()
        XCTAssertTrue(app.secureTextFields["code"].waitForExistence(timeout: 30))
        app.secureTextFields["code"].tap()
        app.secureTextFields["code"].typeText("1234")
        app.buttons["open"].tap()
        XCTAssertTrue(app.staticTexts["stars.balance"].waitForExistence(timeout: 60))
        XCTAssertEqual(app.tabBars.buttons.count, 2)
        func assertNoAgent(_ name: String) {
            XCTAssertFalse(app.buttons["askAgent"].exists)
            XCTAssertFalse(app.buttons["agentHistory"].exists)
            XCTAssertFalse(app.buttons["agentNew"].exists)
            XCTAssertFalse(app.textFields["agentInput"].exists)
            XCTAssertFalse(app.textViews["agentInput"].exists)
            XCTAssertFalse(app.staticTexts["Parent private history"].exists)
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = name
            shot.lifetime = .keepAlways
            add(shot)
        }
        assertNoAgent("Agent-unreachable-kid-chores-today")
        let row = app.buttons.matching(NSPredicate(
            format: "identifier BEGINSWITH %@ AND NOT identifier BEGINSWITH %@", "chore.", "chore.toggle."
        )).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        XCTAssertTrue(app.staticTexts["chore.detail.title"].waitForExistence(timeout: 10))
        assertNoAgent("Agent-unreachable-kid-chore-detail")
        app.navigationBars.buttons.firstMatch.tap()
        app.tabBars.buttons["Dinner"].tap()
        XCTAssertTrue(app.buttons["Previous week"].waitForExistence(timeout: 10))
        assertNoAgent("Agent-unreachable-kid-dinner")
        app.buttons["Previous week"].tap()
        assertNoAgent("Agent-unreachable-kid-dinner-other-week")
        app.tabBars.buttons["Chores"].tap()
        app.buttons["More"].tap()
        app.buttons["signOut"].tap()
        XCTAssertTrue(app.secureTextFields["code"].waitForExistence(timeout: 30))
        app.secureTextFields["code"].tap()
        app.secureTextFields["code"].typeText("123456")
        app.buttons["open"].tap()
        XCTAssertTrue(app.tabBars.buttons["Family"].waitForExistence(timeout: 60))
        app.tabBars.buttons["Chores"].tap()
        app.buttons["askAgent"].tap()
        XCTAssertTrue(app.buttons["agentNew"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["agentHistory"].exists, "Parent conversation must be destroyed on sign-out")
    }

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
        ask.tap()
        XCTAssertTrue(app.buttons["agentHistory"].waitForExistence(timeout: 10))
        app.buttons["agentHistory"].tap()
        XCTAssertTrue(app.staticTexts["add feed the fish"].exists)
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "Applied:"))
            .firstMatch.exists)
        let retained = XCTAttachment(screenshot: app.screenshot())
        retained.name = "Chore-agent-retained-conversation"
        retained.lifetime = .keepAlways
        add(retained)
        input.tap()
        input.typeText("Actually make it 3 stars")
        app.buttons["agentSend"].tap()
        XCTAssertTrue(app.staticTexts["agentSummary"].waitForExistence(timeout: 30))
        app.buttons["agentNew"].tap()
        XCTAssertFalse(app.buttons["agentHistory"].exists)
        XCTAssertFalse(app.staticTexts["agentSummary"].exists)
        XCTAssertEqual(input.value as? String, "What would you like to change?")
        app.buttons["Close"].tap()
        ask.tap()
        XCTAssertTrue(app.buttons["agentNew"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["agentHistory"].exists)
        app.buttons["Close"].tap()
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
