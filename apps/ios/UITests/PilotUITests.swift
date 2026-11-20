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

    private func open(_ app: XCUIApplication, person: String, pin: String) {
        XCTAssertTrue(app.buttons["person.\(person)"].waitForExistence(timeout: 40))
        app.buttons["person.\(person)"].tap()
        app.secureTextFields["pin"].tap()
        app.secureTextFields["pin"].typeText(pin)
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
        XCTAssertTrue(app.buttons["person.focus"].waitForExistence(timeout: 40))
        capture(app, "bootstrap-picker")
        open(app, person: "focus", pin: "123456")
        XCTAssertTrue(app.buttons["chore.Unload the dishwasher"].waitForExistence(timeout: 60))
        XCTAssertTrue(app.staticTexts["Focus"].exists)
        XCTAssertTrue(app.buttons["chore.Make your bed"].exists)
        capture(app, "bootstrap-today")
        app.tabBars.buttons["Family"].tap()
        app.buttons["signOut"].tap()
        XCTAssertTrue(app.buttons["Someone else"].waitForExistence(timeout: 40))
        app.buttons["Someone else"].tap()
        XCTAssertTrue(app.buttons["person.focus"].waitForExistence(timeout: 40))
        XCTAssertTrue(app.staticTexts["Who are you?"].exists)
        capture(app, "bootstrap-signed-out")
        open(app, person: "focus", pin: "123456")
        XCTAssertTrue(app.buttons["chore.Unload the dishwasher"].waitForExistence(timeout: 60))
        XCTAssertTrue(app.staticTexts["Focus"].exists)
        capture(app, "bootstrap-signed-back-in")
    }

    @MainActor
    func testPairingByCodeThenKidCompletesChore() async throws {
        let app = launch()
        let code = app.staticTexts["pairing.code"]
        XCTAssertTrue(code.waitForExistence(timeout: 40))
        capture(app, "pairing-code")
        _ = try await api("pair/approve", body: ["code": code.label], token: parentToken)
        open(app, person: "noah", pin: "0000")
        XCTAssertTrue(app.staticTexts["That PIN is wrong."].waitForExistence(timeout: 20))
        capture(app, "wrong-pin")
        let pin = app.secureTextFields["pin"]
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
    func testParentApprovesDeviceInApp() async throws {
        let claim = try await api("pair/claim", body: ["deviceKind": "phone"])
        _ = try await api("pair/approve", body: ["code": try XCTUnwrap(claim["displayCode"] as? String)], token: parentToken)
        let poll = try await api("pair/poll", body: [
            "id": try XCTUnwrap(claim["id"] as? String),
            "pollSecret": try XCTUnwrap(claim["pollSecret"] as? String)
        ])
        let family = try XCTUnwrap(poll["familyToken"] as? String)
        var peopleRequest = URLRequest(url: URL(string: environment["LP_API_URL"] ?? "http://localhost:3000")!.appendingPathComponent("api/people"))
        peopleRequest.setValue(family, forHTTPHeaderField: "x-family-token")
        let (data, response) = try await URLSession.shared.data(for: peopleRequest)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let people = try XCTUnwrap((JSONSerialization.jsonObject(with: data) as? [String: Any])?["people"] as? [[String: Any]])
        let focus = try XCTUnwrap(people.first { $0["slug"] as? String == "focus" })
        let login = try await api("auth/login", body: [
            "familyToken": family, "personId": try XCTUnwrap(focus["id"] as? String),
            "pin": "123456", "deviceKind": "phone"
        ])
        let app = launch(session: try XCTUnwrap(login["token"] as? String), family: family)
        XCTAssertTrue(app.tabBars.buttons["Family"].waitForExistence(timeout: 60))
        app.tabBars.buttons["Family"].tap()
        XCTAssertTrue(app.buttons["addDevice"].waitForExistence(timeout: 60))
        let second = try await api("pair/claim", body: ["deviceKind": "display"])
        let secondCode = try XCTUnwrap(second["displayCode"] as? String)
        app.open(try XCTUnwrap(URL(string: "liendoplaza://pair?code=\(secondCode)")))
        let field = app.textFields["addDevice.code"]
        XCTAssertTrue(field.waitForExistence(timeout: 15))
        XCTAssertEqual(field.value as? String, secondCode)
        XCTAssertTrue(app.staticTexts["addDevice.claim"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["addDevice.claim"].label.contains("Display"))
        let pending = try await api("pair/poll", body: [
            "id": try XCTUnwrap(second["id"] as? String),
            "pollSecret": try XCTUnwrap(second["pollSecret"] as? String)
        ])
        XCTAssertEqual(pending["status"] as? String, "pending")
        XCTAssertFalse(app.staticTexts["addDevice.success"].exists)
        capture(app, "approve-device")
        app.buttons["addDevice.approve"].tap()
        XCTAssertTrue(app.staticTexts["addDevice.success"].waitForExistence(timeout: 30))
        capture(app, "device-approved")
        let approved = try await api("pair/poll", body: [
            "id": try XCTUnwrap(second["id"] as? String),
            "pollSecret": try XCTUnwrap(second["pollSecret"] as? String)
        ])
        XCTAssertEqual(approved["status"] as? String, "paired")
        XCTAssertNotNil(approved["token"])
    }
}
