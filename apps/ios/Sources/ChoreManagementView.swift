import SwiftUI

struct ChoreDefinition: Codable, Identifiable {
    var id: String
    var title: String
    var assignedPersonId: String
    var stars: Int
    var requiresPhoto: Bool
    var repeatType: String
    var weekdays: [Int]?
    var weeklyWeekday: Int?
    var onceDate: String?
    var description: String?
    var steps: [String]
    var active: Bool

    enum CodingKeys: String, CodingKey {
        case id, title, assignedPersonId, stars, requiresPhoto, repeatType
        case weekdays, weeklyWeekday, onceDate, description, steps, active
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(id, forKey: .id)
        try values.encode(title, forKey: .title)
        try values.encode(assignedPersonId, forKey: .assignedPersonId)
        try values.encode(stars, forKey: .stars)
        try values.encode(requiresPhoto, forKey: .requiresPhoto)
        try values.encode(repeatType, forKey: .repeatType)
        try values.encode(repeatType == "weekdays" ? weekdays : nil, forKey: .weekdays)
        try values.encode(repeatType == "weekly" ? weeklyWeekday : nil, forKey: .weeklyWeekday)
        try values.encode(repeatType == "once" ? onceDate : nil, forKey: .onceDate)
        try values.encodeIfPresent(description, forKey: .description)
        try values.encode(steps, forKey: .steps)
        try values.encode(active, forKey: .active)
    }
}

struct ChoreListResponse: Decodable { let chores: [ChoreDefinition] }
struct ChoreResponse: Decodable { let chore: ChoreDefinition }

struct ChoreManagementView: View {
    @EnvironmentObject private var house: House
    @State private var chores: [ChoreDefinition] = []
    @State private var editing: ChoreDefinition?
    @State private var error = ""
    @State private var loading = false
    var body: some View {
        NavigationStack {
            List {
                if loading { ProgressView("Loading chores…") }
                if !loading && chores.isEmpty { Text("No chores yet. Add one for the family.") }
                InlineError(message: error)
                ForEach(house.snapshot?.people ?? []) { person in
                    let assigned = chores.filter { $0.assignedPersonId == person.id }
                    if !assigned.isEmpty {
                        Section(person.name) {
                            ForEach(assigned) { chore in
                                Button { editing = chore } label: {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text(chore.title).foregroundStyle(Plaza.ink)
                                        Text("★ \(chore.stars) · \(chore.repeatType)").font(.caption).foregroundStyle(Plaza.muted)
                                    }
                                }
                                .accessibilityIdentifier("manage.chore.\(chore.title)")
                                .swipeActions {
                                    Button("Delete", role: .destructive) { Task { await delete(chore) } }
                                }
                            }
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden).background(Plaza.paper).navigationTitle("Chores")
            .toolbar {
                Button("Add chore", systemImage: "plus") {
                    editing = ChoreDefinition(id: "", title: "", assignedPersonId: house.snapshot?.people.first?.id ?? "",
                        stars: 1, requiresPhoto: false, repeatType: "daily", weekdays: [1, 2, 3, 4, 5],
                        weeklyWeekday: 1, onceDate: MealWeek.formatter().string(from: Date()),
                        description: nil, steps: [], active: true)
                }.disabled(house.snapshot?.people.isEmpty != false).accessibilityIdentifier("manage.add")
            }
            .task { await load() }.refreshable { await load() }
            .sheet(item: $editing, onDismiss: { Task { await load() } }) { chore in
                ChoreEditor(chore: chore)
            }
        }
    }
    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let response: ChoreListResponse = try await house.api.request("chores", token: house.session)
            chores = response.chores.filter(\.active)
            error = ""
        } catch { self.error = error.localizedDescription }
    }
    private func delete(_ chore: ChoreDefinition) async {
        do {
            let _: OKResponse = try await house.api.request("chores/\(chore.id)", method: "DELETE", token: house.session)
            await load()
            await house.load()
        } catch { self.error = error.localizedDescription }
    }
}

struct ChoreEditor: View {
    @EnvironmentObject private var house: House
    @Environment(\.dismiss) private var dismiss
    @State var chore: ChoreDefinition
    @State private var steps: String
    @State private var onceDate: Date
    @State private var busy = false
    @State private var error = ""
    private let dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    init(chore: ChoreDefinition) {
        _chore = State(initialValue: chore)
        _steps = State(initialValue: chore.steps.joined(separator: "\n"))
        _onceDate = State(initialValue: chore.onceDate.flatMap { MealWeek.formatter().date(from: $0) } ?? Date())
    }
    var body: some View {
        NavigationStack {
            Form {
                Section("Chore") {
                    TextField("Title", text: $chore.title).accessibilityIdentifier("manage.title")
                    Picker("Person", selection: $chore.assignedPersonId) {
                        ForEach(house.snapshot?.people ?? []) { Text($0.name).tag($0.id) }
                    }.accessibilityIdentifier("manage.person")
                    Stepper("Stars: \(chore.stars)", value: $chore.stars, in: 1...50)
                    Toggle("Needs a photo", isOn: $chore.requiresPhoto)
                }
                Section("Repeat") {
                    Picker("Repeat", selection: $chore.repeatType) {
                        Text("Daily").tag("daily")
                        Text("Weekdays").tag("weekdays")
                        Text("Weekly").tag("weekly")
                        Text("Once").tag("once")
                    }
                    if chore.repeatType == "weekdays" {
                        ForEach(0..<7, id: \.self) { day in
                            Toggle(dayNames[day], isOn: Binding(
                                get: { chore.weekdays?.contains(day) == true },
                                set: { selected in
                                    var days = Set(chore.weekdays ?? [])
                                    if selected { days.insert(day) } else { days.remove(day) }
                                    chore.weekdays = days.sorted()
                                }))
                        }
                    }
                    if chore.repeatType == "weekly" {
                        Picker("Day", selection: Binding(get: { chore.weeklyWeekday ?? 1 }, set: { chore.weeklyWeekday = $0 })) {
                            ForEach(0..<7, id: \.self) { Text(dayNames[$0]).tag($0) }
                        }
                    }
                    if chore.repeatType == "once" {
                        DatePicker("Date", selection: $onceDate, displayedComponents: .date)
                            .environment(\.timeZone, TimeZone(identifier: "America/Chicago")!)
                    }
                }
                Section("Details (optional)") {
                    TextField("Description", text: Binding(get: { chore.description ?? "" }, set: { chore.description = $0 }), axis: .vertical)
                    TextField("Steps, one per line", text: $steps, axis: .vertical)
                }
                InlineError(message: error)
            }
            .disabled(busy).scrollContentBackground(.hidden).background(Plaza.paper)
            .navigationTitle(chore.id.isEmpty ? "Add chore" : "Edit chore")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(busy || chore.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                                  (chore.repeatType == "weekdays" && (chore.weekdays ?? []).isEmpty))
                        .accessibilityIdentifier("manage.save")
                }
            }
        }
    }
    private func save() async {
        busy = true
        error = ""
        defer { busy = false }
        do {
            chore.onceDate = MealWeek.formatter().string(from: onceDate)
            chore.steps = steps.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            if chore.repeatType == "weekly", chore.weeklyWeekday == nil { chore.weeklyWeekday = 1 }
            let _: ChoreResponse = try await house.api.request(chore.id.isEmpty ? "chores" : "chores/\(chore.id)",
                method: chore.id.isEmpty ? "POST" : "PATCH", token: house.session, payload: JSONEncoder().encode(chore))
            await house.load()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
