import EventKit
import SwiftUI

struct GroceriesView: View {
    @StateObject private var model = GroceriesModel()
    @State private var title = ""
    @Environment(\.scenePhase) private var phase
    var body: some View {
        NavigationStack {
            List {
                if model.denied {
                    Text("Allow Reminders access in Settings to use Groceries.")
                    Link("Open Settings", destination: URL(string: UIApplication.openSettingsURLString)!)
                } else {
                    HStack {
                        TextField("Add an item", text: $title).accessibilityIdentifier("groceries.title")
                            .onSubmit { add() }
                        Button("Add") { add() }.disabled(model.busy || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            .accessibilityIdentifier("groceries.add")
                    }
                    ForEach(model.items) { item in
                        Button { Task { await model.complete(item.id) } } label: {
                            Label(item.title, systemImage: "circle").foregroundStyle(Plaza.ink)
                        }
                        .disabled(model.busy).accessibilityIdentifier("groceries.item.\(item.title)")
                    }
                    if model.items.isEmpty && !model.busy { Text("Your grocery list is clear.").foregroundStyle(Plaza.muted) }
                    Button("Clear checked") { Task { await model.clearChecked() } }.disabled(model.busy)
                    Text("Share the Groceries list with Jess in Reminders to keep it in sync.")
                        .font(.footnote).foregroundStyle(Plaza.muted)
                }
                if model.busy { ProgressView() }
                InlineError(message: model.error)
            }
            .scrollContentBackground(.hidden).background(Plaza.paper).navigationTitle("Groceries")
            .task { await model.load() }.refreshable { await model.load() }
            .onChange(of: phase) { _, next in if next == .active { Task { await model.load() } } }
            .onReceive(NotificationCenter.default.publisher(for: .EKEventStoreChanged)) { _ in
                Task { await model.load() }
            }
        }
    }
    private func add() {
        guard !model.busy else { return }
        Task { if await model.add(title) { title = "" } }
    }
}
