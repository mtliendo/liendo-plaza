import XCTest

final class PilotUITests: XCTestCase {
    private let environment = ProcessInfo.processInfo.environment
    private var parentToken: String {
        get throws { try XCTUnwrap(environment["LP_PARENT_TOKEN"], "Run scripts/ui-tests.sh for parent authorization") }
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func launch(session: String? = nil, family: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestReset"]
        app.launchEnvironment["LP_API_URL"] = environment["LP_API_URL"] ?? "http://localhost:3000"
        app.launchEnvironment["LP_TEST_SESSION_TOKEN"] = session
        app.launchEnvironment["LP_TEST_FAMILY_TOKEN"] = family
        app.launch()
        return app
    }

    private func capture(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func open(_ app: XCUIApplication, pin: String) {
        XCTAssertTrue(app.secureTextFields["code"].waitForExistence(timeout: 40))
        app.secureTextFields["code"].tap()
        app.secureTextFields["code"].typeText(pin)
        app.buttons["open"].tap()
    }

    private func api(_ path: String, body: [String: String]? = nil, token: String? = nil) async throws -> [String: Any] {
        let base = URL(string: environment["LP_API_URL"] ?? "http://localhost:3000")!
        var request = URLRequest(url: base.appendingPathComponent("api/\(path)"))
        request.timeoutInterval = 40
        if let body {
            request.httpMethod = "POST"
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200, "API request failed: \(path)")
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @MainActor
    func testFirstParentBootstrapShowsToday() {
        let app = launch()
        XCTAssertTrue(app.staticTexts["Set up Liendo Plaza"].waitForExistence(timeout: 40))
        capture(app, "setup")
        app.secureTextFields["code"].tap()
        app.secureTextFields["code"].typeText("123456")
        app.secureTextFields["code.confirmation"].tap()
        app.secureTextFields["code.confirmation"].typeText("123456")
        app.swipeUp()
        app.buttons["open"].tap()
        XCTAssertTrue(app.buttons["chore.Unload the dishwasher"].waitForExistence(timeout: 60))
        XCTAssertTrue(app.staticTexts["Focus"].exists)
        XCTAssertTrue(app.buttons["chore.Make your bed"].exists)
        capture(app, "bootstrap-today")
        app.terminate()
        app.launchArguments = []
        app.launch()
        XCTAssertTrue(app.buttons["chore.Unload the dishwasher"].waitForExistence(timeout: 60))
        capture(app, "session-survives-relaunch")
        app.tabBars.buttons["Family"].tap()
        app.buttons["signOut"].tap()
        XCTAssertTrue(app.secureTextFields["code"].waitForExistence(timeout: 40))
        capture(app, "bootstrap-signed-out")
        open(app, pin: "123456")
        XCTAssertTrue(app.buttons["chore.Unload the dishwasher"].waitForExistence(timeout: 60))
        XCTAssertTrue(app.staticTexts["Focus"].exists)
        capture(app, "bootstrap-signed-back-in")
    }

    @MainActor
    func testCodeSignInThenKidCompletesChore() async throws {
        let app = launch()
        open(app, pin: "0000")
        XCTAssertTrue(app.staticTexts["That code is not recognized."].waitForExistence(timeout: 20))
        capture(app, "wrong-pin")
        let pin = app.secureTextFields["code"]
        pin.tap()
        pin.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 4) + "1234")
        app.buttons["open"].tap()
        let card = app.buttons["chore.Unload the dishwasher"]
        XCTAssertTrue(card.waitForExistence(timeout: 60))
        XCTAssertTrue(card.label.contains("To do"))
        XCTAssertFalse(app.buttons["chore.Make your bed"].exists)
        capture(app, "noah-today")
        card.tap()
        XCTAssertTrue(app.buttons["chore.complete"].waitForExistence(timeout: 10))
        capture(app, "chore-detail")
        app.buttons["chore.complete"].tap()
        XCTAssertTrue(app.buttons["chore.undo"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.staticTexts["chore.status"].label.contains("Done"))
        capture(app, "chore-done")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        XCTAssertTrue(card.label.contains("Done"))
        capture(app, "today-done")
        card.tap()
        app.buttons["chore.undo"].tap()
        XCTAssertTrue(app.buttons["chore.complete"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.staticTexts["chore.status"].label.contains("To do"))
        capture(app, "chore-undone")
    }

    @MainActor
    func testIndividualParentCodeSignsInDirectly() async throws {
        let response = try await api("people", token: parentToken)
        let people = try XCTUnwrap(response["people"] as? [[String: Any]])
        let jess = try XCTUnwrap(people.first { $0["slug"] as? String == "jess" })
        _ = try await api("auth/codes", body: ["personId": try XCTUnwrap(jess["id"] as? String), "code": "234567", "confirmation": "234567"], token: parentToken)
        let app = launch()
        open(app, pin: "234567")
        XCTAssertTrue(app.tabBars.buttons["Family"].waitForExistence(timeout: 60))
        XCTAssertTrue(app.staticTexts["Jess"].exists)
        app.tabBars.buttons["Family"].tap()
        XCTAssertTrue(app.buttons["code.jess"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["code.jess"].label.contains("Jess (you)"))
        app.buttons["code.jess"].tap()
        XCTAssertTrue(app.secureTextFields["codes.new"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["codes.clear"].exists)
        capture(app, "individual-parent-code")
        _ = try await api("auth/codes", body: ["personId": try XCTUnwrap(jess["id"] as? String), "code": ""], token: parentToken)
    }

    @MainActor
    func testParentChangesFamilyCode() async throws {
        let response = try await api("people", token: parentToken)
        let people = try XCTUnwrap(response["people"] as? [[String: Any]])
        let focus = try XCTUnwrap(people.first { $0["slug"] as? String == "focus" })
        let login = try await api("auth/login", body: ["code": "123456", "deviceKind": "phone"])
        let app = launch(session: try XCTUnwrap(login["token"] as? String))
        XCTAssertTrue(app.tabBars.buttons["Family"].waitForExistence(timeout: 60))
        app.tabBars.buttons["Family"].tap()
        XCTAssertTrue(app.buttons["code.focus"].waitForExistence(timeout: 20))
        app.buttons["code.focus"].tap()
        let code = app.secureTextFields["codes.new"]
        XCTAssertTrue(code.waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["codes.clear"].exists)
        XCTAssertFalse(app.buttons["codes.save"].isEnabled)
        code.tap(); code.typeText("654321")
        app.secureTextFields["codes.confirmation"].tap()
        app.secureTextFields["codes.confirmation"].typeText("654321")
        app.buttons["codes.save"].tap()
        XCTAssertTrue(app.staticTexts["codes.success"].waitForExistence(timeout: 30))
        capture(app, "family-code-saved")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["signOut"].tap()
        open(app, pin: "654321")
        XCTAssertTrue(app.tabBars.buttons["Family"].waitForExistence(timeout: 60))
        _ = try await api("auth/codes", body: ["personId": try XCTUnwrap(focus["id"] as? String), "code": "123456", "confirmation": "123456"], token: parentToken)
    }

    @MainActor
    func testFamilyTabResetsOtherParentAndKidCodes() async throws {
        let response = try await api("people", token: parentToken)
        let people = try XCTUnwrap(response["people"] as? [[String: Any]])
        let jess = try XCTUnwrap(people.first { $0["slug"] as? String == "jess" }?["id"] as? String)
        let noah = try XCTUnwrap(people.first { $0["slug"] as? String == "noah" }?["id"] as? String)
        let login = try await api("auth/login", body: ["code": "123456", "deviceKind": "phone"])
        let app = launch(session: try XCTUnwrap(login["token"] as? String))
        XCTAssertTrue(app.tabBars.buttons["Family"].waitForExistence(timeout: 60))
        app.tabBars.buttons["Family"].tap()
        XCTAssertTrue(app.buttons["code.focus"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["code.jess"].exists)
        XCTAssertTrue(app.buttons["code.noah"].exists)
        XCTAssertTrue(app.buttons["signOut"].exists)
        XCTAssertFalse(app.buttons["addDevice"].exists)
        XCTAssertFalse(app.buttons["familyCodes"].exists)
        XCTAssertTrue(app.buttons["code.jess"].label.contains("Not set"))
        capture(app, "family-tab")

        app.buttons["code.jess"].tap()
        let code = app.secureTextFields["codes.new"]
        XCTAssertTrue(code.waitForExistence(timeout: 20))
        code.tap(); code.typeText("345678")
        app.secureTextFields["codes.confirmation"].tap()
        app.secureTextFields["codes.confirmation"].typeText("345678")
        app.buttons["codes.save"].tap()
        XCTAssertTrue(app.staticTexts["codes.success"].waitForExistence(timeout: 30))
        capture(app, "other-parent-code-saved")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.buttons["code.jess"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["code.jess"].label.contains("Set"))

        app.buttons["code.noah"].tap()
        XCTAssertTrue(code.waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["codes.clear"].exists)
        code.tap(); code.typeText("0412")
        XCTAssertFalse(app.secureTextFields["codes.confirmation"].exists)
        app.buttons["codes.save"].tap()
        XCTAssertTrue(app.staticTexts["codes.success"].waitForExistence(timeout: 30))
        capture(app, "kid-code-saved")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["signOut"].tap()

        open(app, pin: "345678")
        XCTAssertTrue(app.tabBars.buttons["Family"].waitForExistence(timeout: 60))
        XCTAssertTrue(app.staticTexts["Jess"].exists)
        app.tabBars.buttons["Family"].tap()
        app.buttons["signOut"].tap()
        open(app, pin: "0412")
        XCTAssertTrue(app.buttons["chore.Unload the dishwasher"].waitForExistence(timeout: 60))
        XCTAssertFalse(app.tabBars.buttons["Family"].exists)
        capture(app, "kid-signed-in-with-new-code")

        _ = try await api("auth/codes", body: ["personId": noah, "code": "1234"], token: parentToken)
        _ = try await api("auth/codes", body: ["personId": jess, "code": ""], token: parentToken)
    }
}
