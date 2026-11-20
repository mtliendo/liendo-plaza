import XCTest

final class PilotUITests: XCTestCase {
    func testLaunchShowsPairing() {
        let app = XCUIApplication()
        app.launchArguments = ["-uiTestReset"]
        app.launchEnvironment["LP_API_URL"] = ProcessInfo.processInfo.environment["LP_API_URL"] ?? "http://localhost:3000"
        app.launch()
        let parent = app.buttons["person.focus"]
        let code = app.staticTexts["pairing.code"]
        XCTAssertTrue(parent.waitForExistence(timeout: 35) || code.waitForExistence(timeout: 35))
    }
}
