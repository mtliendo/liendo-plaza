import SwiftUI

private enum AgentValue: Codable {
    case string(String), number(Double), bool(Bool), array([AgentValue]), object([String: AgentValue]), null

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let bool = try? value.decode(Bool.self) { self = .bool(bool) }
        else if let number = try? value.decode(Double.self) { self = .number(number) }
        else if let string = try? value.decode(String.self) { self = .string(string) }
        else if let array = try? value.decode([AgentValue].self) { self = .array(array) }
        else { self = .object(try value.decode([String: AgentValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .null: try value.encodeNil()
        case .bool(let item): try value.encode(item)
        case .number(let item): try value.encode(item)
        case .string(let item): try value.encode(item)
        case .array(let item): try value.encode(item)
        case .object(let item): try value.encode(item)
        }
    }
}

private struct AgentChange: Codable {
    let op: String
    let choreId: String?
    let chore: AgentValue?
    let patch: AgentValue?
    let label: String
    let before: ChoreDefinition?

}

struct ChoreAgentTurn: Encodable {
    let role: String
    let text: String
}

private struct AgentRequest: Encodable {
    let message: String
    let history: [ChoreAgentTurn]
}

private struct AgentProposal: Decodable {
    let summary: String
    let changes: [AgentChange]
}

struct ChoreAgentView: View {
    @EnvironmentObject private var house: House
    @Environment(\.dismiss) private var dismiss
    @State private var message = ""
    @State private var proposal: AgentProposal?
    @State private var busy = false
    @State private var error = ""
    @Binding var history: [ChoreAgentTurn]
    @FocusState private var inputFocused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section("Ask about chores") {
                    TextField("What would you like to change?", text: $message, axis: .vertical)
                        .focused($inputFocused)
                        .accessibilityIdentifier("agentInput")
                        .onChange(of: message) { _, _ in proposal = nil }
                    Button("Send") { Task { await send() } }
                        .accessibilityIdentifier("agentSend")
                        .disabled(message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || message.count > 500)
                }
                if busy { ProgressView("Working…") }
                InlineError(message: error)
                if let proposal {
                    Section {
                        Text(proposal.summary).accessibilityIdentifier("agentSummary")
                        ForEach(Array(proposal.changes.enumerated()), id: \.offset) { _, change in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(change.op == "create" ? "Add" : change.op == "update" ? "Change" : "Remove")
                                    .font(.caption.bold()).padding(4).background(.quaternary, in: Capsule())
                                Text(change.label)
                                    .fixedSize(horizontal: false, vertical: true)
                            }.accessibilityElement(children: .combine).accessibilityIdentifier("agentChange")
                        }
                        Button("Apply") { Task { await apply(proposal) } }
                            .disabled(proposal.changes.isEmpty).accessibilityIdentifier("agentApply")
                        Button("Discard", role: .cancel) { self.proposal = nil; error = "" }
                            .accessibilityIdentifier("agentDiscard")
                    }
                }
                if !history.isEmpty {
                    Section {
                        DisclosureGroup("Conversation") {
                            ForEach(Array(history.enumerated()), id: \.offset) { _, turn in
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(turn.role == "user" ? "You" : "Agent").font(.caption.bold())
                                    Text(turn.text).fixedSize(horizontal: false, vertical: true)
                                }
                            }
                        }.accessibilityIdentifier("agentHistory")
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .disabled(busy)
            .navigationTitle("Chore agent")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("New") {
                        history = []
                        message = ""
                        proposal = nil
                        error = ""
                        inputFocused = false
                    }.disabled(busy).accessibilityIdentifier("agentNew")
                }
            }
            .interactiveDismissDisabled(busy)
        }
    }

    private func send() async {
        inputFocused = false
        let sent = message
        busy = true
        error = ""
        proposal = nil
        defer { busy = false }
        do {
            let payload = try JSONEncoder().encode(AgentRequest(message: sent, history: Array(history.suffix(6))))
            let response: AgentProposal = try await house.api.request("agent/chores/propose", method: "POST",
                token: house.session, payload: payload)
            proposal = response
            history = Array((history + [ChoreAgentTurn(role: "user", text: sent),
                ChoreAgentTurn(role: "assistant", text: response.summary)]).suffix(6))
        } catch { self.error = error.localizedDescription }
    }

    private func apply(_ proposal: AgentProposal) async {
        busy = true
        error = ""
        defer { busy = false }
        do {
            let payload = try JSONEncoder().encode(["changes": proposal.changes])
            let _: ChoreListResponse = try await house.api.request("agent/chores/apply", method: "POST",
                token: house.session, payload: payload)
            let applied = "Applied: \(proposal.summary)\n" + proposal.changes.map(\.label).joined(separator: "\n")
            history = Array((history + [ChoreAgentTurn(role: "assistant", text: String(applied.prefix(2000)))]).suffix(6))
            await house.load()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
