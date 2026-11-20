import SwiftUI

struct TodayView: View {
    @EnvironmentObject private var house: House
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if let person = house.person {
                        HStack(spacing: 12) {
                            Avatar(person: person)
                            Text(person.name).foregroundStyle(Plaza.muted)
                        }
                    }
                    Text(house.person?.isParent == true ? "Today" : "Chores").font(Plaza.title(36)).accessibilityIdentifier("today")
                    if let snapshot = house.snapshot, let person = house.person {
                        let chores = snapshot.chores(for: person)
                        if !person.isParent {
                            Text("★ \(snapshot.stars?.first(where: { $0.personId == person.id })?.balance ?? 0) stars")
                                .font(Plaza.title(25)).accessibilityIdentifier("stars.balance")
                        }
                        if chores.isEmpty {
                            Text("No chores for today.").foregroundStyle(Plaza.muted)
                        }
                        if person.isParent {
                            let pending = house.pendingProofs
                            if !pending.isEmpty {
                                Text("Needs a look").font(Plaza.title(25))
                                ForEach(pending) { ChoreRow(chore: $0, canToggle: false, showDate: $0.date != snapshot.today) }
                            }
                            ForEach(snapshot.people) { kid in
                                let own = chores.filter { $0.personId == kid.id }
                                if !own.isEmpty {
                                    HStack { Avatar(person: kid); Text(kid.name).font(Plaza.title(25)) }
                                    ForEach(own) { ChoreRow(chore: $0, canToggle: false) }
                                }
                            }
                        } else {
                            ForEach(chores) { ChoreRow(chore: $0, canToggle: true) }
                        }
                    } else if house.loading {
                        ProgressView("Getting today ready…")
                            .frame(maxWidth: .infinity).padding(.vertical, 60)
                            .accessibilityIdentifier("today.loading")
                    }
                    InlineError(message: house.error)
                    if !house.error.isEmpty {
                        Button("Try again") { Task { await house.load() } }
                    }
                }.padding(24)
            }
            .background(Plaza.paper).refreshable { await house.load() }
            .toolbar {
                if house.person?.isParent == false {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button("Not you?") { Task { await house.signOut() } }
                                .accessibilityIdentifier("signOut")
                        } label: { Image(systemName: "ellipsis").accessibilityLabel("More") }
                    }
                }
            }
            .task { await house.load() }
        }
    }
}

struct ChoreDetailView: View {
    @EnvironmentObject private var house: House
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var busy = false
    @State private var error = ""
    @State private var camera = false

    var body: some View {
        ScrollView {
            if let chore = house.chore(id: id) {
                VStack(alignment: .leading, spacing: 24) {
                    if let owner = house.snapshot?.people.first(where: { $0.id == chore.personId }) {
                        HStack { Avatar(person: owner); Text(owner.name) }
                    }
                    Text(chore.title).font(Plaza.title(32))
                    Text("\(chore.statusLabel) · \(chore.stars) \(chore.stars == 1 ? "star" : "stars")")
                        .foregroundStyle(Plaza.muted).accessibilityIdentifier("chore.status")
                    if let description = chore.description, !description.isEmpty { Text(description) }
                    ForEach(Array(chore.steps.enumerated()), id: \.offset) { index, step in
                        HStack(alignment: .top, spacing: 14) {
                            Text("\(index + 1).").foregroundStyle(Plaza.muted)
                            Text(step)
                        }
                    }
                    if let actor = house.person, actor.isParent || actor.id == chore.personId {
                        if actor.isParent && chore.status == "pending" {
                            if let path = chore.photoPath { MealPhoto(path: path, accessibilityLabel: "Proof photo") }
                            HStack {
                                reviewButton("Approve", action: "approve")
                                reviewButton("Send back", action: "reject")
                            }
                        }
                        if chore.requiresPhoto && ["open", "rejected"].contains(chore.status) {
                            Button("Take a photo") { camera = true }
                                .buttonStyle(PrimaryButton()).disabled(busy)
                                .accessibilityIdentifier("chore.photo")
                        }
                        if chore.status == "done" || (!chore.requiresPhoto && ["open", "rejected"].contains(chore.status)) {
                            Button(busy ? "Saving…" : chore.status == "done" ? "Not done" : "Mark done") {
                                Task {
                                    busy = true
                                    error = ""
                                    defer { busy = false }
                                    do { try await house.toggle(chore) }
                                    catch { self.error = error.localizedDescription }
                                }
                            }
                            .buttonStyle(PrimaryButton()).disabled(busy)
                            .accessibilityIdentifier(chore.status == "done" ? "chore.undo" : "chore.complete")
                        }
                    }
                    InlineError(message: error)
                }.frame(maxWidth: .infinity, alignment: .leading).padding(24)
            }
        }
        .background(Plaza.paper).navigationTitle("Chore").navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $camera) {
            Camera { data in
                Task {
                    busy = true
                    error = ""
                    defer { busy = false }
                    do { try await house.uploadPhoto(data, for: id) }
                    catch { self.error = error.localizedDescription }
                }
            }
        }
    }

    private func reviewButton(_ title: String, action: String) -> some View {
        Button(title) {
            Task {
                busy = true
                error = ""
                defer { busy = false }
                do {
                    try await house.review(id, action: action)
                    dismiss()
                }
                catch { self.error = error.localizedDescription }
            }
        }.buttonStyle(PrimaryButton()).disabled(busy).accessibilityIdentifier("chore.review.\(action)")
    }
}
