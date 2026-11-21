import XCTest
import UIKit

final class PilotUITests: XCTestCase {
    private let environment = ProcessInfo.processInfo.environment
    private var parentToken: String {
        get throws { try XCTUnwrap(environment["LP_PARENT_TOKEN"], "Run scripts/ui-tests.sh for parent authorization") }
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func launch(session: String? = nil, family: String? = nil, groceries: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestReset"] + (groceries ? ["-uiTestGroceries"] : [])
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

    private func api(_ path: String, method: String? = nil, body: [String: Any]? = nil, token: String? = nil) async throws -> [String: Any] {
        let base = URL(string: environment["LP_API_URL"] ?? "http://localhost:3000")!
        var request = URLRequest(url: base.appendingPathComponent("api/\(path)"))
        request.timeoutInterval = 40
        if let body {
            request.httpMethod = "POST"
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let method { request.httpMethod = method }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertTrue((200..<300).contains((response as? HTTPURLResponse)?.statusCode ?? 0), "API request failed: \(path)")
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @MainActor
    func testFirstParentBootstrapShowsToday() throws {
        let app = launch()
        XCTAssertTrue(app.staticTexts["setup.parentRequired"].waitForExistence(timeout: 40))
        XCTAssertEqual(app.secureTextFields.count, 0)
        XCTAssertFalse(app.staticTexts["Jess"].exists)
        XCTAssertFalse(app.staticTexts["Sofia"].exists)
        capture(app, "setup-anonymous-parent-required")
        app.terminate()
        app.launchEnvironment["LP_TEST_SESSION_TOKEN"] = try parentToken
        app.launch()
        XCTAssertTrue(app.staticTexts["setup.parent"].waitForExistence(timeout: 40))
        app.terminate()
        app.launchArguments = []
        app.launchEnvironment["LP_TEST_SESSION_TOKEN"] = nil
        app.launch()
        XCTAssertTrue(app.staticTexts["Set up Liendo Plaza"].waitForExistence(timeout: 40))
        XCTAssertTrue(app.staticTexts["setup.parent"].waitForExistence(timeout: 40))
        XCTAssertEqual(app.staticTexts["setup.parent"].label, "Setting up as Focus")
        XCTAssertEqual(app.pickers.count, 0)
        XCTAssertTrue(app.secureTextFields["setup.jess"].exists)
        capture(app, "setup-existing-parent-after-relaunch")
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
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Leave a code empty to clear it.")).firstMatch.exists)
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
    func testRoleBoundariesAcrossCodeSessions() async throws {
        let token = try parentToken
        let people = try await api("people", token: parentToken)
        let roster = try XCTUnwrap(people["people"] as? [[String: Any]])
        let jess = try XCTUnwrap(roster.first { $0["slug"] as? String == "jess" })
        _ = try await api("auth/codes", body: ["personId": try XCTUnwrap(jess["id"] as? String), "code": "234567", "confirmation": "234567"], token: parentToken)
        var sofiaChoreId = ""
        for (slug, title) in [("noah", "Role audit Noah photo"), ("sofia", "Role audit Sofia proof")] {
            let kid = try XCTUnwrap(roster.first { $0["slug"] as? String == slug })
            let result = try await api("chores", body: ["title": title, "assignedPersonId": try XCTUnwrap(kid["id"] as? String), "stars": 2, "requiresPhoto": true, "repeatType": "daily"], token: token)
            let choreId = try XCTUnwrap((result["chore"] as? [String: Any])?["id"] as? String)
            if slug == "sofia" { sofiaChoreId = choreId }
            addTeardownBlock { _ = try await self.api("chores/\(choreId)", method: "DELETE", token: token) }
        }
        let sofiaLogin = try await api("auth/login", body: ["code": "0101", "deviceKind": "phone"])
        let sofiaToken = try XCTUnwrap(sofiaLogin["token"] as? String)
        let snapshot = try await api("snapshot", token: sofiaToken)
        let today = String(try XCTUnwrap(snapshot["now"] as? String).prefix(10))
        let proof = try XCTUnwrap((snapshot["chores"] as? [[String: Any]])?.first { $0["choreId"] as? String == sofiaChoreId && $0["date"] as? String == today })
        let proofId = try XCTUnwrap(proof["id"] as? String)
        let base = URL(string: environment["LP_API_URL"] ?? "http://localhost:3000")!
        var upload = URLRequest(url: base.appendingPathComponent("api/chores/instances/\(proofId)/photo"))
        upload.httpMethod = "POST"
        upload.setValue("Bearer \(sofiaToken)", forHTTPHeaderField: "authorization")
        upload.setValue("image/png", forHTTPHeaderField: "Content-Type")
        let photo = UIGraphicsImageRenderer(size: CGSize(width: 32, height: 32)).image { context in
            UIColor.systemBlue.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 32, height: 32))
        }
        upload.httpBody = try XCTUnwrap(photo.pngData())
        let (_, uploaded) = try await URLSession.shared.data(for: upload)
        XCTAssertEqual((uploaded as? HTTPURLResponse)?.statusCode, 200)
        let app = launch(groceries: true)
        for (name, code) in [("Focus", "123456"), ("Jess", "234567")] {
            open(app, pin: code)
            XCTAssertTrue(app.tabBars.buttons["Family"].waitForExistence(timeout: 60))
            XCTAssertTrue(app.staticTexts[name].exists)
            let pending = app.buttons.matching(identifier: "chore.Role audit Sofia proof").firstMatch
            XCTAssertTrue(pending.waitForExistence(timeout: 20))
            pending.tap()
            XCTAssertTrue(app.images["Proof photo"].waitForExistence(timeout: 20))
            XCTAssertTrue(app.buttons["Approve"].exists)
            XCTAssertTrue(app.buttons["Send back"].exists)
            capture(app, "audit-\(name)-pending-proof")
            app.navigationBars.buttons.element(boundBy: 0).tap()
            capture(app, "audit-\(name)-today")
            app.tabBars.buttons["Dinner"].tap()
            let dinner = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "dinner.")).firstMatch
            XCTAssertTrue(dinner.waitForExistence(timeout: 20))
            dinner.tap()
            XCTAssertTrue(app.textFields["dinner.name"].waitForExistence(timeout: 10))
            capture(app, "audit-\(name)-dinner-editor")
            app.buttons["Cancel"].tap()
            app.tabBars.buttons["Groceries"].tap()
            XCTAssertTrue(app.textFields["groceries.title"].waitForExistence(timeout: 15))
            capture(app, "audit-\(name)-groceries")
            app.tabBars.buttons["Chores"].tap()
            XCTAssertTrue(app.buttons["manage.add"].waitForExistence(timeout: 20))
            app.buttons["manage.add"].tap()
            XCTAssertTrue(app.textFields["manage.title"].waitForExistence(timeout: 10))
            capture(app, "audit-\(name)-chore-editor")
            app.buttons["Cancel"].tap()
            app.tabBars.buttons["Family"].tap()
            XCTAssertFalse(app.buttons["addDevice"].exists)
            app.buttons["code.noah"].tap()
            XCTAssertTrue(app.secureTextFields["codes.new"].waitForExistence(timeout: 20))
            capture(app, "audit-\(name)-codes")
            app.navigationBars.buttons.element(boundBy: 0).tap()
            app.buttons["signOut"].tap()
            XCTAssertTrue(app.secureTextFields["code"].waitForExistence(timeout: 30))
        }
        open(app, pin: "1234")
        XCTAssertTrue(app.staticTexts["stars.balance"].waitForExistence(timeout: 60))
        XCTAssertEqual(app.tabBars.buttons.count, 2)
        XCTAssertFalse(app.tabBars.buttons["Family"].exists)
        XCTAssertFalse(app.tabBars.buttons["Groceries"].exists)
        XCTAssertFalse(app.buttons["manage.add"].exists)
        XCTAssertFalse(app.buttons["chore.Make your bed"].exists)
        XCTAssertFalse(app.buttons["chore.Role audit Sofia proof"].exists)
        app.buttons["chore.Role audit Noah photo"].tap()
        XCTAssertTrue(app.buttons["chore.photo"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons["chore.complete"].exists)
        XCTAssertFalse(app.buttons["Approve"].exists)
        capture(app, "audit-Noah-photo-required")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["chore.Unload the dishwasher"].tap()
        XCTAssertTrue(app.buttons["chore.complete"].waitForExistence(timeout: 15))
        capture(app, "audit-Noah-detail")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.tabBars.buttons["Dinner"].tap()
        XCTAssertTrue(app.navigationBars["Dinner"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "dinner.")).firstMatch.exists)
        XCTAssertFalse(app.textFields["dinner.name"].exists)
        capture(app, "audit-Noah-read-only-dinner")
        app.tabBars.buttons["Chores"].tap()
        XCTAssertTrue(app.staticTexts["stars.balance"].waitForExistence(timeout: 15))
        let kidLogin = try await api("auth/login", body: ["code": "1234", "deviceKind": "phone"])
        app.launchEnvironment["LP_TEST_SESSION_TOKEN"] = try XCTUnwrap(kidLogin["token"] as? String)
        app.open(try XCTUnwrap(URL(string: "liendoplaza://pair?code=ABC123")))
        XCTAssertFalse(app.textFields["addDevice.code"].exists)
        XCTAssertTrue(app.staticTexts["stars.balance"].waitForExistence(timeout: 15))
        XCTAssertEqual(app.tabBars.buttons.count, 2)
        XCTAssertFalse(app.tabBars.buttons["Family"].exists)
        capture(app, "audit-Noah-parent-deep-link-denied")
        app.buttons["More"].tap()
        app.buttons["signOut"].tap()
        open(app, pin: "123456")
        XCTAssertTrue(app.buttons.matching(identifier: "chore.Role audit Sofia proof").firstMatch.waitForExistence(timeout: 60))
        capture(app, "audit-kid-to-parent-fresh-state")
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
