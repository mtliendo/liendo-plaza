import XCTest
@testable import LiendoPlaza

private final class PushProtocol: URLProtocol {
    struct Call {
        let path: String
        let authorization: String?
        let body: [String: String]
    }
    static var calls: [Call] = []
    static var failRegister = false
    static var failUnregister = false
    static var paused: PushProtocol?
    static var onRegister: (() -> Void)?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        var data = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var bytes = [UInt8](repeating: 0, count: 1024)
            while stream.hasBytesAvailable {
                let count = stream.read(&bytes, maxLength: bytes.count)
                if count <= 0 { break }
                data.append(contentsOf: bytes.prefix(count))
            }
        }
        Self.calls.append(Call(path: request.url!.path,
            authorization: request.value(forHTTPHeaderField: "Authorization"),
            body: (try? JSONSerialization.jsonObject(with: data) as? [String: String]) ?? [:]))
        if request.url!.path.hasSuffix("/register"), let onRegister = Self.onRegister {
            Self.paused = self
            onRegister()
        } else {
            respond()
        }
    }
    func respond() {
        let path = request.url!.path
        let failed = (path.hasSuffix("/register") && Self.failRegister) ||
            (path.hasSuffix("/unregister") && Self.failUnregister)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: failed ? 503 : 200,
            httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data((failed ? #"{"error":"Offline"}"# : #"{"ok":true}"#).utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class PushTests: XCTestCase {
    override func setUpWithError() throws {
        PushProtocol.calls = []
        PushProtocol.failRegister = false
        PushProtocol.failUnregister = false
        PushProtocol.paused = nil
        PushProtocol.onRegister = nil
        try Keychain.write(nil, key: "apns.\(PushNotifications.environment)")
    }
    override func tearDownWithError() throws {
        PushProtocol.paused = nil
        PushProtocol.onRegister = nil
        try Keychain.write(nil, key: "apns.\(PushNotifications.environment)")
    }
    @MainActor
    private func house(role: String = "parent") -> House {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PushProtocol.self]
        let house = House(api: APIClient(session: URLSession(configuration: configuration)))
        house.session = "test-session"
        house.family = "test-family"
        house.person = Person(id: role, slug: role, name: role, role: role, color: "", avatarKey: nil)
        return house
    }

    func testPushHexPreservesZeroesAndRegistrationEnvironment() throws {
        for environment in ["sandbox", "production"] {
            let registration = try XCTUnwrap(PushRegistration(deviceToken: Data([0, 1, 15, 16, 128, 255]),
                environment: environment))
            XCTAssertEqual(registration.body, ["kind": "apns", "token": "00010f1080ff", "environment": environment])
        }
        XCTAssertNil(PushRegistration(deviceToken: Data(), environment: "sandbox"))
        XCTAssertNil(PushRegistration(deviceToken: Data([1]), environment: "development"))
        XCTAssertEqual(PushNotifications.environment,
            Bundle.main.object(forInfoDictionaryKey: "LPAPNSEnvironment") as? String == "development" ? "sandbox" : "production")
    }

    @MainActor
    func testParentsAndKidsRegisterAgainAndReplaceTokens() async throws {
        for role in ["parent", "kid"] {
            try Keychain.write(nil, key: "apns.\(PushNotifications.environment)")
            let house = house(role: role)
            await house.registerPushToken(Data([0, 255]))
            await house.registerPushToken(Data([0, 255]))
            await house.registerPushToken(Data([1, 255]))
            let calls = PushProtocol.calls
            XCTAssertEqual(calls.suffix(4).map(\.path), [
                "/api/push/register", "/api/push/register", "/api/push/register", "/api/push/unregister",
            ])
            XCTAssertEqual(calls.last?.body["token"], "00ff")
            XCTAssertTrue(calls.allSatisfy { $0.authorization == "Bearer test-session" })
            XCTAssertEqual(calls[calls.count - 2].body,
                ["token": "01ff", "kind": "apns", "environment": PushNotifications.environment])
        }
    }

    @MainActor
    func testEmptyAndSignedOutTokensNeverRegisterAndFailuresCanRetry() async {
        let house = house()
        await house.registerPushToken(Data())
        XCTAssertTrue(PushProtocol.calls.isEmpty)
        PushProtocol.failRegister = true
        await house.registerPushToken(Data([3]))
        XCTAssertEqual(house.error, "")
        PushProtocol.failRegister = false
        await house.registerPushToken(Data([3]))
        XCTAssertEqual(PushProtocol.calls.count, 2)
        house.session = nil
        await house.registerPushToken(Data([4]))
        XCTAssertEqual(PushProtocol.calls.count, 2)
    }

    @MainActor
    func testSignOutUnregistersBeforeLogoutEvenIfUnregisterFails() async {
        let house = house()
        await house.registerPushToken(Data([5]))
        PushProtocol.failUnregister = true
        await house.signOut()
        XCTAssertEqual(PushProtocol.calls.map(\.path), ["/api/push/register", "/api/push/unregister", "/api/auth/logout"])
        XCTAssertNil(house.session)
        XCTAssertEqual(house.error, "")
    }

    @MainActor
    func testClearedSessionCleansUpInFlightRegistrationUsingOriginalSession() async throws {
        let house = house()
        let started = expectation(description: "Registration started")
        PushProtocol.onRegister = { started.fulfill() }
        let registration = Task { await house.registerPushToken(Data([6])) }
        await fulfillment(of: [started], timeout: 5)
        try house.clearSession()
        PushProtocol.paused?.respond()
        await registration.value
        XCTAssertEqual(PushProtocol.calls.map(\.path), ["/api/push/register", "/api/push/unregister"])
        XCTAssertEqual(PushProtocol.calls.last?.authorization, "Bearer test-session")
    }

    @MainActor
    func testSignOutWaitsForInFlightRegistration() async {
        let house = house()
        let started = expectation(description: "Registration started")
        PushProtocol.onRegister = { started.fulfill() }
        let registration = Task { await house.registerPushToken(Data([7])) }
        await fulfillment(of: [started], timeout: 5)
        let signOut = Task { await house.signOut() }
        await Task.yield()
        PushProtocol.paused?.respond()
        await registration.value
        await signOut.value
        XCTAssertEqual(PushProtocol.calls.first?.path, "/api/push/register")
        XCTAssertEqual(PushProtocol.calls.last?.path, "/api/auth/logout")
        XCTAssertTrue(PushProtocol.calls.dropFirst().dropLast().allSatisfy { $0.path == "/api/push/unregister" })
        XCTAssertGreaterThan(PushProtocol.calls.count, 2)
        XCTAssertNil(house.session)
    }
}
