import SwiftUI
import UIKit

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
    var guidePhotoPath: String? = nil

    enum CodingKeys: String, CodingKey {
        case id, title, assignedPersonId, stars, requiresPhoto, repeatType
        case weekdays, weeklyWeekday, onceDate, description, steps, active, guidePhotoPath
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

struct ChoreReorder: Encodable {
    let personId: String
    let choreIds: [String]

    static func moving(_ chores: [ChoreDefinition], personId: String, from: IndexSet, to: Int) -> [ChoreDefinition] {
        var assigned = chores.filter { $0.assignedPersonId == personId }
        assigned.move(fromOffsets: from, toOffset: to)
        var remaining = assigned.makeIterator()
        return chores.map { $0.assignedPersonId == personId ? remaining.next()! : $0 }
    }
}

extension ChoreDefinition {
    mutating func didReplaceGuidePhoto(_ path: String?, pendingGuide: inout Data?) {
        guidePhotoPath = path
        pendingGuide = nil
    }
}

extension APIClient {
    func setGuidePhoto(_ photo: Data?, for choreID: String, token: String?) async throws -> String? {
        let response: ChoreResponse = try await request("chores/\(choreID)/guide-photo",
            method: photo == nil ? "DELETE" : "POST", token: token, photo: photo)
        return response.chore.guidePhotoPath
    }
}

struct ChoreManagementView: View {
    @EnvironmentObject private var house: House
    @State private var chores: [ChoreDefinition] = []
    @State private var editing: ChoreDefinition?
    @State private var error = ""
    @State private var loading = false
    @State private var reordering = false
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
                                .accessibilityLabel(chore.title)
                                .accessibilityIdentifier("manage.chore.\(chore.title)")
                                .disabled(reordering)
                                .swipeActions {
                                    Button("Delete", role: .destructive) { Task { await delete(chore) } }
                                }
                            }
                            .onMove { from, to in
                                move(personId: person.id, from: from, to: to)
                            }
                            .moveDisabled(reordering || loading)
                        }
                    }
                }
            }
            .scrollContentBackground(.hidden).background(Plaza.paper).navigationTitle("Chores")
            .toolbar {
                EditButton().accessibilityIdentifier("manage.reorder")
                    .disabled(reordering)
                Button("Add chore", systemImage: "plus") {
                    editing = ChoreDefinition(id: "", title: "", assignedPersonId: house.snapshot?.people.first?.id ?? "",
                        stars: 1, requiresPhoto: false, repeatType: "daily", weekdays: [1, 2, 3, 4, 5],
                        weeklyWeekday: 1, onceDate: MealWeek.formatter().string(from: Date()),
                        description: nil, steps: [], active: true)
                }.disabled(reordering || house.snapshot?.people.isEmpty != false).accessibilityIdentifier("manage.add")
            }
            .accessibilityIdentifier("manage.list")
            .task { await load() }.refreshable { await load() }
            .sheet(item: $editing, onDismiss: { Task { await load() } }) { chore in
                ChoreEditor(chore: chore)
            }
        }
    }
    private func load() async {
        guard !reordering else { return }
        loading = true
        defer { loading = false }
        do {
            let response: ChoreListResponse = try await house.api.request("chores", token: house.session)
            chores = response.chores.filter(\.active)
            error = ""
        } catch { self.error = error.localizedDescription }
    }
    private func move(personId: String, from: IndexSet, to: Int) {
        guard !reordering else { return }
        let previous = chores
        chores = ChoreReorder.moving(chores, personId: personId, from: from, to: to)
        let payload = ChoreReorder(personId: personId,
            choreIds: chores.filter { $0.assignedPersonId == personId }.map(\.id))
        guard payload.choreIds != previous.filter({ $0.assignedPersonId == personId }).map(\.id) else { return }
        reordering = true
        error = ""
        Task {
            defer { reordering = false }
            do {
                let _: ChoreListResponse = try await house.api.request("chores/reorder", method: "POST",
                    token: house.session, payload: JSONEncoder().encode(payload))
                await house.load()
            } catch {
                chores = previous
                self.error = error.localizedDescription
            }
        }
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
    @State private var camera = false
    @State private var photoOptions = false
    @State private var cameraSource: UIImagePickerController.SourceType = .photoLibrary
    @State private var pendingGuide: Data?
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
                Section("Guide photo") {
                    if let data = pendingGuide, let image = UIImage(data: data) {
                        Image(uiImage: image).resizable().scaledToFit()
                            .frame(maxWidth: .infinity).frame(height: 200)
                            .accessibilityLabel("Guide photo")
                    } else if let path = chore.guidePhotoPath {
                        MealPhoto(path: path, accessibilityLabel: "Guide photo")
                            .frame(maxWidth: .infinity).frame(height: 200)
                    }
                    Button(chore.guidePhotoPath == nil && pendingGuide == nil ? "Add photo" : "Replace photo") {
                        chooseGuidePhoto()
                    }.accessibilityIdentifier("manage.guide.choose")
                    if chore.guidePhotoPath != nil || pendingGuide != nil {
                        Button("Remove photo", role: .destructive) { Task { await removeGuide() } }
                            .accessibilityIdentifier("manage.guide.remove")
                    }
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
            .sheet(isPresented: $camera) {
                Camera(sourceType: cameraSource) { data in Task { await changeGuide(data) } }
            }
            .confirmationDialog("Guide photo", isPresented: $photoOptions, titleVisibility: .visible) {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    Button("Take photo") { cameraSource = .camera; camera = true }
                }
                Button("Choose from library") { cameraSource = .photoLibrary; camera = true }
            }
        }
    }
    private func chooseGuidePhoto() {
        #if DEBUG
        if CommandLine.arguments.contains("-uiTestReset"),
           let encoded = ProcessInfo.processInfo.environment["LP_TEST_GUIDE_PHOTO"],
           let data = Data(base64Encoded: encoded), let image = UIImage(data: data),
           let prepared = Camera.prepare(image) {
            Task { await changeGuide(prepared) }
            return
        }
        #endif
        photoOptions = true
    }
    private func changeGuide(_ data: Data) async {
        if chore.id.isEmpty {
            pendingGuide = data
            return
        }
        busy = true
        error = ""
        defer { busy = false }
        do {
            let path = try await house.api.setGuidePhoto(data, for: chore.id, token: house.session)
            chore.didReplaceGuidePhoto(path, pendingGuide: &pendingGuide)
            await house.load()
        } catch { self.error = error.localizedDescription }
    }
    private func removeGuide() async {
        if chore.id.isEmpty {
            pendingGuide = nil
            return
        }
        busy = true
        error = ""
        defer { busy = false }
        do {
            chore.guidePhotoPath = try await house.api.setGuidePhoto(nil, for: chore.id, token: house.session)
            pendingGuide = nil
            await house.load()
        } catch { self.error = error.localizedDescription }
    }
    private func save() async {
        busy = true
        error = ""
        defer { busy = false }
        do {
            chore.onceDate = MealWeek.formatter().string(from: onceDate)
            chore.steps = steps.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            if chore.repeatType == "weekly", chore.weeklyWeekday == nil { chore.weeklyWeekday = 1 }
            let response: ChoreResponse = try await house.api.request(chore.id.isEmpty ? "chores" : "chores/\(chore.id)",
                method: chore.id.isEmpty ? "POST" : "PATCH", token: house.session, payload: JSONEncoder().encode(chore))
            chore.id = response.chore.id
            if let photo = pendingGuide {
                chore.guidePhotoPath = try await house.api.setGuidePhoto(photo, for: chore.id, token: house.session)
                pendingGuide = nil
            }
            await house.load()
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
