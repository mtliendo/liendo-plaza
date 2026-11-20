import SwiftUI

struct AddDeviceView: View {
    @EnvironmentObject private var house: House
    @State private var code = ""
    @State private var pending: [PendingResponse.Item] = []
    @State private var message = ""
    @State private var error = ""
    @State private var busy = false

    init(code: String? = nil) {
        _code = State(initialValue: code ?? "")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Add a device").font(Plaza.title())
                Text("Approve a kitchen frame or another phone that is showing a short code.")
                    .foregroundStyle(Plaza.muted)
                TextField("Code from the other screen", text: $code)
                    .textInputAutocapitalization(.characters).autocorrectionDisabled()
                    .onChange(of: code) { _, value in code = value.uppercased() }
                    .padding(18).background(Plaza.card).clipShape(RoundedRectangle(cornerRadius: 16))
                    .accessibilityIdentifier("addDevice.code")
                if let claim = pending.first(where: {
                    $0.displayCode.replacingOccurrences(of: "-", with: "").uppercased()
                        == code.replacingOccurrences(of: "-", with: "").uppercased()
                }) {
                    Text("\(claim.label) · \(claim.deviceKind.capitalized)")
                        .accessibilityIdentifier("addDevice.claim")
                }
                Button("Approve this device") { Task { await approve(code) } }
                    .buttonStyle(PrimaryButton()).disabled(busy || code.isEmpty)
                    .accessibilityIdentifier("addDevice.approve")
                if !message.isEmpty {
                    Text(message).accessibilityIdentifier("addDevice.success")
                }
                InlineError(message: error)
                Text("Waiting").font(Plaza.title(24))
                if pending.isEmpty { Text("No devices waiting.").foregroundStyle(Plaza.muted) }
                ForEach(pending) { item in
                    Button { Task { await approve(item.displayCode) } } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(item.displayCode).font(Plaza.title(24))
                            Text("\(item.label) · \(item.deviceKind.capitalized)").foregroundStyle(Plaza.muted)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(18).background(Plaza.card).clipShape(RoundedRectangle(cornerRadius: 16))
                    }
                    .disabled(busy).accessibilityIdentifier("pending.\(item.displayCode)")
                }
            }.padding(24)
        }
        .background(Plaza.paper).navigationBarTitleDisplayMode(.inline)
        .task {
            while !Task.isCancelled {
                await refresh()
                do { try await Task.sleep(for: .seconds(4)) } catch { return }
            }
        }
    }

    private func refresh() async {
        do {
            let response: PendingResponse = try await house.api.request("pair/pending", token: house.session)
            pending = response.requests
        } catch {
            if !Task.isCancelled { self.error = error.localizedDescription }
        }
    }

    private func approve(_ value: String) async {
        busy = true
        message = ""
        error = ""
        defer { busy = false }
        do {
            let _: OKResponse = try await house.api.request("pair/approve", method: "POST",
                                                          body: ["code": value], token: house.session)
            message = "That device is approved. It should open on its own."
            code = ""
            await refresh()
        } catch { self.error = error.localizedDescription }
    }
}
