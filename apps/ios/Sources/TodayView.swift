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
                    Text("Today").font(Plaza.title(36)).accessibilityIdentifier("today")
                    if let snapshot = house.snapshot, let person = house.person {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Tonight’s dinner").font(.custom("Fraunces-Italic", size: 22))
                            Text(snapshot.meals.first(where: { $0.date == snapshot.today })?.name ?? "Nothing written yet")
                                .font(Plaza.title(25))
                        }
                        let chores = snapshot.chores(for: person)
                        if chores.isEmpty {
                            Text("No chores for today.").foregroundStyle(Plaza.muted)
                        }
                        ForEach(chores) { chore in
                            NavigationLink {
                                ChoreDetailView(id: chore.id)
                            } label: {
                                VStack(alignment: .leading, spacing: 10) {
                                    if person.isParent, let owner = snapshot.people.first(where: { $0.id == chore.personId }) {
                                        Text(owner.name).font(.subheadline).foregroundStyle(Plaza.muted)
                                    }
                                    Text(chore.title).font(Plaza.title(23))
                                    HStack {
                                        Chip(text: chore.statusLabel).accessibilityIdentifier("status.\(chore.title)")
                                        Chip(text: "\(chore.stars) \(chore.stars == 1 ? "star" : "stars")")
                                        if chore.requiresPhoto { Chip(text: "Needs a photo") }
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading).padding(18)
                                .background(Plaza.card).clipShape(RoundedRectangle(cornerRadius: 16))
                                .overlay(alignment: .leading) {
                                    RoundedRectangle(cornerRadius: 2)
                                        .fill(Plaza.personColor(snapshot.people.first(where: { $0.id == chore.personId })?.slug ?? ""))
                                        .frame(width: 3).padding(.vertical, 18)
                                }
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("chore.\(chore.title)")
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
                ToolbarItem(placement: .topBarLeading) {
                    Button("Sign out") { Task { await house.signOut() } }
                        .accessibilityIdentifier("signOut")
                }
                if house.person?.isParent == true {
                    ToolbarItem(placement: .topBarTrailing) {
                        NavigationLink("Add a device") { AddDeviceView() }
                            .accessibilityIdentifier("addDevice")
                    }
                }
            }
            .task { await house.load() }
        }
    }
}

struct ChoreDetailView: View {
    @EnvironmentObject private var house: House
    let id: String
    @State private var busy = false
    @State private var error = ""

    var body: some View {
        ScrollView {
            if let chore = house.snapshot?.chores.first(where: { $0.id == id }) {
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
                    if chore.requiresPhoto {
                        Text("Photo proof is coming in the next pilot phase.")
                            .padding(18).background(Plaza.card).clipShape(RoundedRectangle(cornerRadius: 16))
                    }
                    if let actor = house.person, actor.isParent || actor.id == chore.personId {
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
    }
}
