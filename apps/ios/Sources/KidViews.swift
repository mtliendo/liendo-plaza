import SwiftUI

struct ChoreDestination: Hashable {
    let id: String
}

struct ChoreRow: View {
    @EnvironmentObject private var house: House
    let chore: ChoreInstance
    let canToggle: Bool
    var showDate = false
    @State private var busy = false
    @State private var error = ""
    var body: some View {
        VStack(alignment: .leading) {
            HStack(spacing: 14) {
                if canToggle && !chore.requiresPhoto {
                    Button {
                        Task {
                            busy = true
                            error = ""
                            defer { busy = false }
                            do { try await house.toggle(chore) }
                            catch { self.error = error.localizedDescription }
                        }
                    } label: {
                        Image(systemName: chore.status == "done" ? "checkmark.circle.fill" : "circle")
                            .font(.title2).frame(width: 44, height: 44)
                    }
                    .disabled(busy || !["open", "rejected", "done"].contains(chore.status))
                    .accessibilityLabel(chore.status == "done" ? "Undo \(chore.title)" : "Complete \(chore.title)")
                    .accessibilityIdentifier("chore.toggle.\(chore.title)")
                }
                NavigationLink(value: ChoreDestination(id: chore.id)) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(chore.title).font(Plaza.title(23))
                        if showDate { Text(chore.date).font(.caption).foregroundStyle(Plaza.muted) }
                        HStack {
                            Chip(text: chore.statusLabel).accessibilityIdentifier("status.\(chore.title)")
                            Chip(text: "★ \(chore.stars)")
                        }
                        if chore.requiresPhoto { Text("Needs a photo").font(.caption) }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain).accessibilityIdentifier("chore.\(chore.title)")
            }
            InlineError(message: error)
        }
        .padding(18).background(Plaza.card).clipShape(RoundedRectangle(cornerRadius: 16))
    }
}
