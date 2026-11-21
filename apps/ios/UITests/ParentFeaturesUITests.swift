import XCTest
import UIKit

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
    private func launch(token: String, guidePhoto: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestReset", "-uiTestGroceries"]
        app.launchEnvironment["LP_API_URL"] = environment["LP_API_URL"] ?? "http://localhost:3000"
        app.launchEnvironment["LP_TEST_SESSION_TOKEN"] = token
        app.launchEnvironment["LP_TEST_GUIDE_PHOTO"] = guidePhoto
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
    func testParentReordersKidChoresAndRefreshPersistsOrder() async throws {
        let response = try await api("chores", token: parentToken)
        let definitions = try XCTUnwrap(response["chores"] as? [[String: Any]])
        let bed = try XCTUnwrap(definitions.first { $0["title"] as? String == "Make your bed" })
        let personID = try XCTUnwrap(bed["assignedPersonId"] as? String)
        let own = definitions.filter { $0["assignedPersonId"] as? String == personID && $0["active"] as? Bool == true }
        XCTAssertEqual(own.count, 2)
        let firstTitle = try XCTUnwrap(own[0]["title"] as? String)
        let lastTitle = try XCTUnwrap(own[1]["title"] as? String)
        let login = try await api("auth/login", body: ["code": "123456", "deviceKind": "phone"])
        let app = launch(token: try XCTUnwrap(login["token"] as? String))
        app.tabBars.buttons["Chores"].tap()
        let first = app.buttons["manage.chore.\(firstTitle)"]
        let last = app.buttons["manage.chore.\(lastTitle)"]
        XCTAssertTrue(last.waitForExistence(timeout: 30))
        app.buttons["manage.reorder"].tap()
        let handle = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Reorder \(lastTitle)")).firstMatch
        XCTAssertTrue(handle.waitForExistence(timeout: 10))
        handle.press(forDuration: 1, thenDragTo: first)
        let moved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            last.frame.minY < first.frame.minY
        }, object: nil)
        await fulfillment(of: [moved], timeout: 15)
        let saved = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.buttons["manage.reorder"].isEnabled
        }, object: nil)
        await fulfillment(of: [saved], timeout: 15)
        app.buttons["manage.reorder"].tap()
        let list = app.collectionViews.firstMatch
        list.swipeDown()
        let refreshed = try await api("chores", token: parentToken)
        let updated = try XCTUnwrap(refreshed["chores"] as? [[String: Any]])
            .filter { $0["assignedPersonId"] as? String == personID && $0["active"] as? Bool == true }
        XCTAssertEqual(updated.compactMap { $0["title"] as? String }, [lastTitle, firstTitle])
        app.tabBars.buttons["Today"].tap()
        app.tabBars.buttons["Chores"].tap()
        XCTAssertTrue(last.waitForExistence(timeout: 30))
        XCTAssertLessThan(last.frame.minY, first.frame.minY)
        capture(app, "Chore-reorder-persisted")
        let snapshot = try await api("snapshot", token: parentToken)
        let today = String(try XCTUnwrap(snapshot["now"] as? String).prefix(10))
        let due = try XCTUnwrap(snapshot["chores"] as? [[String: Any]])
            .filter { $0["personId"] as? String == personID && $0["date"] as? String == today }
        let expectedTitles: [String] = [lastTitle, firstTitle].filter { title in
            due.contains { $0["title"] as? String == title }
        }
        XCTAssertFalse(expectedTitles.isEmpty)
        app.tabBars.buttons["Family"].tap()
        app.buttons["signOut"].tap()
        let code = app.secureTextFields["code"]
        XCTAssertTrue(code.waitForExistence(timeout: 20))
        code.tap()
        code.typeText("0101")
        app.buttons["open"].tap()
        let kidRows = expectedTitles.map { app.buttons["chore.\($0)"] }
        for row in kidRows { XCTAssertTrue(row.waitForExistence(timeout: 30)) }
        for (first, last) in zip(kidRows, kidRows.dropFirst()) {
            XCTAssertLessThan(first.frame.minY, last.frame.minY)
        }
        XCTAssertTrue(app.staticTexts["Sofia"].exists)
        capture(app, "Sofia-reordered-chores")
    }

    @MainActor
    func testParentGuideEditorShowsReplacesRemovesAndAddsPhoto() async throws {
        try XCTSkipUnless(environment["LP_GUIDE_EDITOR_PROBE"] == "1", "Requires scripts/guide-fixture.ts")
        let response = try await api("chores", token: parentToken)
        let chores = try XCTUnwrap(response["chores"] as? [[String: Any]])
        let chore = try XCTUnwrap(chores.first { $0["title"] as? String == "Guide fixture chore" })
        let id = try XCTUnwrap(chore["id"] as? String)
        let oldPath = try XCTUnwrap(chore["guidePhotoPath"] as? String)
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 640, height: 400))
        let replacement = renderer.image { context in
            UIColor.systemOrange.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 640, height: 400))
            ("Replacement guide" as NSString).draw(at: CGPoint(x: 60, y: 180),
                withAttributes: [.font: UIFont.systemFont(ofSize: 44), .foregroundColor: UIColor.black])
        }
        let app = launch(token: try parentToken, guidePhoto: replacement.pngData()!.base64EncodedString())
        app.tabBars.buttons["Chores"].tap()
        let row = app.buttons["manage.chore.Guide fixture chore"]
        XCTAssertTrue(row.waitForExistence(timeout: 30))
        row.tap()
        let image = app.images["Guide photo"]
        XCTAssertTrue(image.waitForExistence(timeout: 30))
        capture(app, "Guide-editor-existing")
        print("Existing guide image frame: \(image.frame)")
        XCTAssertGreaterThan(image.frame.height, 100, "The Form row must reserve space for the loaded image")
        let original = image.screenshot().pngRepresentation
        let choose = app.buttons["manage.guide.choose"]
        choose.tap()
        XCTAssertTrue(choose.waitForExistence(timeout: 30))
        let ready = NSPredicate(format: "enabled == true")
        await fulfillment(of: [XCTNSPredicateExpectation(predicate: ready, object: choose)], timeout: 60)
        XCTAssertTrue(image.waitForExistence(timeout: 30))
        XCTAssertNotEqual(image.screenshot().pngRepresentation, original)
        let updated = try await api("chores/\(id)", token: parentToken)
        let newPath = try XCTUnwrap((updated["chore"] as? [String: Any])?["guidePhotoPath"] as? String)
        XCTAssertNotEqual(newPath, oldPath)
        app.buttons["manage.save"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: 60))
        row.tap()
        XCTAssertTrue(image.waitForExistence(timeout: 30))
        XCTAssertGreaterThan(image.frame.height, 100)
        XCTAssertNotEqual(image.screenshot().pngRepresentation, original)
        capture(app, "Guide-editor-replacement-reopened")
        app.buttons["manage.guide.remove"].tap()
        await fulfillment(of: [XCTNSPredicateExpectation(predicate: ready, object: choose)], timeout: 60)
        XCTAssertFalse(image.exists)
        app.buttons["manage.save"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: 60))
        row.tap()
        XCTAssertTrue(app.buttons["Add photo"].waitForExistence(timeout: 30))
        XCTAssertFalse(image.exists)
        capture(app, "Guide-editor-removed-reopened")
        choose.tap()
        await fulfillment(of: [XCTNSPredicateExpectation(predicate: ready, object: choose)], timeout: 60)
        app.buttons["manage.save"].tap()
        XCTAssertTrue(row.waitForExistence(timeout: 60))
        row.tap()
        XCTAssertTrue(image.waitForExistence(timeout: 30))
        XCTAssertGreaterThan(image.frame.height, 100)
        capture(app, "Guide-editor-added-reopened")
    }

    @MainActor
    func testKidChoreGuidePhotoAppears() throws {
        try XCTSkipUnless(environment["LP_GUIDE_KID_TOKEN"] != nil, "Requires scripts/guide-fixture.ts")
        let token = try XCTUnwrap(environment["LP_GUIDE_KID_TOKEN"], "Requires a seeded chore with a guide photo")
        let app = launch(token: token)
        let chore = app.buttons["chore.Guide fixture chore"]
        XCTAssertTrue(chore.waitForExistence(timeout: 30))
        chore.tap()
        XCTAssertTrue(app.images["Guide photo"].waitForExistence(timeout: 30))
        capture(app, "Kid-chore-guide-photo")
    }

    @MainActor
    func testParentTodayOpensOnlyTappedMiddleChore() async throws {
        try XCTSkipUnless(environment["LP_NAVIGATION_KID_TOKEN"] != nil, "Requires scripts/refresh-fixture.ts with kid session")
        try await verifyMiddleChoreNavigation(token: parentToken, role: "Parent")
    }

    @MainActor
    func testKidChoresOpensOnlyTappedMiddleChore() async throws {
        try XCTSkipUnless(environment["LP_NAVIGATION_KID_TOKEN"] != nil, "Requires scripts/refresh-fixture.ts with kid session")
        let token = try XCTUnwrap(environment["LP_NAVIGATION_KID_TOKEN"], "Requires scripts/refresh-fixture.ts with kid session")
        try await verifyMiddleChoreNavigation(token: token, role: "Kid")
    }

    @MainActor
    private func verifyMiddleChoreNavigation(token: String, role: String) async throws {
        let snapshot = try await api("snapshot", token: token)
        let today = String(try XCTUnwrap(snapshot["now"] as? String).prefix(10))
        let chores = try XCTUnwrap(snapshot["chores"] as? [[String: Any]]).filter { $0["date"] as? String == today }
        let ids = chores.compactMap { $0["id"] as? String }
        XCTAssertEqual(chores.count, 3)
        XCTAssertEqual(Set(ids).count, 3, "The fixture must have distinct instance IDs")
        XCTAssertEqual(Set(chores.compactMap { $0["personId"] as? String }).count, 1)
        let expectedTitle = try XCTUnwrap(chores.dropFirst().first?["title"] as? String)
        let app = launch(token: token)
        let list = app.descendants(matching: .any).matching(identifier: "today.list").firstMatch
        XCTAssertTrue(list.waitForExistence(timeout: 30))
        for title in ["Refresh fixture chore", "Navigation middle chore", "Navigation last chore"] {
            XCTAssertTrue(app.buttons["chore.\(title)"].waitForExistence(timeout: 30))
        }
        app.buttons["chore.\(expectedTitle)"].tap()
        let title = app.staticTexts["chore.detail.title"]
        XCTAssertTrue(title.waitForExistence(timeout: 30))
        capture(app, "\(role)-middle-chore-detail")
        XCTAssertEqual(title.label, expectedTitle)
        app.navigationBars["Chore"].buttons.firstMatch.tap()
        XCTAssertTrue(list.waitForExistence(timeout: 30), "One Back must return directly to the list")
        XCTAssertFalse(app.navigationBars["Chore"].exists)
        XCTAssertFalse(title.exists)
        capture(app, "\(role)-middle-chore-back-once")
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
        let login = try await api("auth/login", body: [
            "code": "1234", "deviceKind": "phone"
        ])
        let app = launch(token: try XCTUnwrap(login["token"] as? String))
        XCTAssertTrue(app.staticTexts["stars.balance"].waitForExistence(timeout: 60))
        XCTAssertEqual(app.tabBars.buttons.count, 2)
        XCTAssertTrue(app.tabBars.buttons["Chores"].exists)
        XCTAssertTrue(app.tabBars.buttons["Dinner"].exists)
        XCTAssertFalse(app.tabBars.buttons["Groceries"].exists)
        XCTAssertFalse(app.buttons["manage.add"].exists)
        XCTAssertFalse(app.buttons["manage.reorder"].exists)
        capture(app, "Today-kid")
    }

    @MainActor
    private func setPhotoProof(_ required: Bool, on title: String) throws {
        let app = launch(token: try parentToken)
        app.tabBars.buttons["Chores"].tap()
        let row = app.buttons["manage.chore.\(title)"]
        XCTAssertTrue(row.waitForExistence(timeout: 60))
        row.tap()
        let toggle = app.switches["manage.requiresPhoto"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 30))
        if (toggle.value as? String == "1") != required { toggle.switches.firstMatch.tap() }
        XCTAssertEqual(toggle.value as? String, required ? "1" : "0")
        capture(app, required ? "Photo-proof-on" : "Photo-proof-off")
        app.buttons["manage.save"].tap()
        let caption = NSPredicate(format: "identifier == %@ AND \(required ? "" : "NOT ")(label CONTAINS 'photo proof')",
            "manage.chore.\(title)")
        XCTAssertTrue(app.buttons.matching(caption).firstMatch.waitForExistence(timeout: 60))
        app.terminate()
    }

    private func restorePhotoProof(id: String, token: String) async throws {
        let base = URL(string: environment["LP_API_URL"] ?? "http://localhost:3000")!
        var request = URLRequest(url: base.appendingPathComponent("api/chores/\(id)"))
        request.httpMethod = "PATCH"
        request.httpBody = try JSONSerialization.data(withJSONObject: ["requiresPhoto": false])
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        let (_, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
    }

    @MainActor
    private func launchNoah() async throws -> XCUIApplication {
        let login = try await api("auth/login", body: ["code": "1234", "deviceKind": "phone"])
        let app = launch(token: try XCTUnwrap(login["token"] as? String))
        XCTAssertTrue(app.staticTexts["stars.balance"].waitForExistence(timeout: 60))
        return app
    }

    @MainActor
    func testParentRequiresPhotoProofPerChore() async throws {
        let title = "Unload the dishwasher"
        let response = try await api("chores", token: parentToken)
        let chores = try XCTUnwrap(response["chores"] as? [[String: Any]])
        let id = try XCTUnwrap(chores.first { $0["title"] as? String == title }?["id"] as? String)
        let token = try parentToken
        addTeardownBlock { try await self.restorePhotoProof(id: id, token: token) }
        try setPhotoProof(true, on: title)
        var app = try await launchNoah()
        let open = app.buttons["chore.\(title)"]
        XCTAssertTrue(open.waitForExistence(timeout: 60))
        XCTAssertFalse(app.buttons["chore.toggle.\(title)"].exists)
        open.tap()
        XCTAssertTrue(app.buttons["chore.photo"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.buttons["chore.complete"].exists)
        capture(app, "Kid-photo-required")
        app.terminate()

        try setPhotoProof(false, on: title)
        app = try await launchNoah()
        XCTAssertTrue(app.buttons["chore.toggle.\(title)"].waitForExistence(timeout: 60))
        app.buttons["chore.\(title)"].tap()
        XCTAssertTrue(app.buttons["chore.complete"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.buttons["chore.photo"].exists)
        capture(app, "Kid-no-photo")
    }

    @MainActor
    func testKidSeesOwnPendingProofButNotAnotherKids() async throws {
        let title = "Feed the fish"
        let xavierLogin = try await api("auth/login", body: ["code": "0303", "deviceKind": "phone"])
        let xavierToken = try XCTUnwrap(xavierLogin["token"] as? String)
        let snapshot = try await api("snapshot", token: xavierToken)
        let today = String(try XCTUnwrap(snapshot["now"] as? String).prefix(10))
        let instance = try XCTUnwrap((snapshot["chores"] as? [[String: Any]])?.first {
            $0["title"] as? String == title && $0["date"] as? String == today && $0["status"] as? String == "open"
        })
        let id = try XCTUnwrap(instance["id"] as? String)
        let base = URL(string: environment["LP_API_URL"] ?? "http://localhost:3000")!
        var upload = URLRequest(url: base.appendingPathComponent("api/chores/instances/\(id)/photo"))
        upload.httpMethod = "POST"
        upload.setValue("Bearer \(xavierToken)", forHTTPHeaderField: "authorization")
        upload.setValue("image/png", forHTTPHeaderField: "Content-Type")
        upload.httpBody = try XCTUnwrap(UIGraphicsImageRenderer(size: CGSize(width: 32, height: 32)).image { context in
            UIColor.systemGreen.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 32, height: 32))
        }.pngData())
        let (_, uploaded) = try await URLSession.shared.data(for: upload)
        XCTAssertEqual((uploaded as? HTTPURLResponse)?.statusCode, 200)
        let token = try parentToken
        addTeardownBlock { _ = try await self.api("chores/instances/\(id)/review", body: ["action": "reject"], token: token) }

        var app = launch(token: xavierToken)
        let own = app.buttons["chore.\(title)"]
        XCTAssertTrue(own.waitForExistence(timeout: 60))
        own.tap()
        XCTAssertTrue(app.images["Proof photo"].waitForExistence(timeout: 30))
        XCTAssertFalse(app.buttons["Approve"].exists)
        XCTAssertFalse(app.buttons["Send back"].exists)
        capture(app, "Kid-own-pending-proof")
        app.terminate()

        app = try await launchNoah()
        XCTAssertFalse(app.buttons["chore.\(title)"].exists)
        XCTAssertFalse(app.images["Proof photo"].exists)
        let noahLogin = try await api("auth/login", body: ["code": "1234", "deviceKind": "phone"])
        let noahSnapshot = try await api("snapshot", token: try XCTUnwrap(noahLogin["token"] as? String))
        XCTAssertFalse((noahSnapshot["chores"] as? [[String: Any]] ?? []).contains { $0["id"] as? String == id })
        capture(app, "Other-kid-proof-hidden")
    }
}
