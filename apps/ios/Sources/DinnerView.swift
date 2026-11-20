import SwiftUI

struct DinnerView: View {
    @EnvironmentObject private var house: House
    @State private var meals: [Meal] = []
    @State private var loading = false
    @State private var error = ""
    @State private var weekOffset = 0
    @State private var editing: Meal?
    private var days: [String] { MealWeek.days(offset: weekOffset) }
    var body: some View {
        NavigationStack {
            List {
                VStack(alignment: .leading, spacing: 18) {
                    HStack {
                        Button { weekOffset -= 1 } label: { Image(systemName: "chevron.left") }
                            .accessibilityLabel("Previous week")
                        Spacer()
                        Text(weekOffset == 0 ? "This week" : "\(days.first ?? "")").font(Plaza.title(25))
                        Spacer()
                        Button { weekOffset += 1 } label: { Image(systemName: "chevron.right") }
                            .accessibilityLabel("Next week")
                    }
                    if loading { ProgressView("Getting dinner ready…") }
                    if meals.isEmpty && !loading && error.isEmpty {
                        Text("Nothing on the menu yet.").foregroundStyle(Plaza.muted)
                    }
                    ForEach(days, id: \.self) { day in
                        let meal = meals.first { $0.date == day } ?? Meal(date: day, name: "", photoPath: nil)
                        Group {
                            if house.person?.isParent == true {
                                Button { editing = meal } label: { mealCard(meal) }.buttonStyle(.plain)
                                    .disabled(loading || !error.isEmpty)
                            } else { mealCard(meal) }
                        }.accessibilityIdentifier("dinner.\(meal.date)")
                    }
                    InlineError(message: error)
                    if !error.isEmpty { Button("Try again") { Task { await load() } } }
                }
                .padding(24)
                .buttonStyle(.plain)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
                .listRowSeparator(.hidden)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .accessibilityIdentifier("dinner.list")
            .background(Plaza.paper).navigationTitle("Dinner")
            .task(id: weekOffset) { await load() }.refreshable { await load() }
            .sheet(item: $editing, onDismiss: { Task { await load() } }) { meal in
                MealEditor(meal: meal)
            }
        }
    }

    private func mealCard(_ meal: Meal) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(meal.date == house.snapshot?.today ? "Today · \(meal.date)" : meal.date)
                .foregroundStyle(Plaza.muted)
            Text(meal.name.isEmpty ? "Nothing written yet" : meal.name).font(Plaza.title(25))
            if let path = meal.photoPath { MealPhoto(path: path) }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(18)
        .background(meal.date == house.snapshot?.today ? Plaza.accent.opacity(0.12) : Plaza.card)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay {
            if meal.date == house.snapshot?.today {
                RoundedRectangle(cornerRadius: 16).stroke(Plaza.accent, lineWidth: 2)
            }
        }
    }
    private func load() async {
        loading = true
        error = ""
        defer { loading = false }
        do {
            let result: MealsResponse = try await house.api.request("meals", token: house.session,
                query: ["from": days.first!, "to": days.last!])
            guard !Task.isCancelled else { return }
            meals = result.meals
        } catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
}

enum MealWeek {
    static func formatter() -> DateFormatter {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "America/Chicago")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }
    static func days(offset: Int, now: Date = Date()) -> [String] {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Chicago")!
        let start = calendar.startOfDay(for: now)
        let sundayOffset = calendar.component(.weekday, from: start) - 1
        return (0..<7).map { formatter().string(from: calendar.date(byAdding: .day, value: offset * 7 - sundayOffset + $0, to: start)!) }
    }
}

struct MealEditor: View {
    @EnvironmentObject private var house: House
    @Environment(\.dismiss) private var dismiss
    let meal: Meal
    @State private var name: String
    @State private var suggestions: [String] = []
    @State private var photo: Data?
    @State private var camera = false
    @State private var busy = false
    @State private var error = ""
    init(meal: Meal) {
        self.meal = meal
        _name = State(initialValue: meal.name)
    }
    var body: some View {
        NavigationStack {
            Form {
                Section(meal.date) {
                    TextField("Dinner", text: $name).accessibilityIdentifier("dinner.name")
                    ScrollView(.horizontal) {
                        HStack {
                            ForEach(suggestions, id: \.self) { suggestion in
                                Button(suggestion) { name = suggestion }.buttonStyle(.bordered)
                            }
                        }
                    }
                    Button(photo == nil ? "Add photo" : "Change photo") { camera = true }
                    if let photo, let image = UIImage(data: photo) {
                        Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 180)
                    } else if let path = meal.photoPath { MealPhoto(path: path) }
                    Text("Leave the name empty to clear this dinner.").font(.caption).foregroundStyle(Plaza.muted)
                }
                InlineError(message: error)
            }
            .disabled(busy).scrollContentBackground(.hidden).background(Plaza.paper)
            .navigationTitle("Dinner")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.disabled(busy).accessibilityIdentifier("dinner.save")
                }
            }
            .task(id: name) {
                do {
                    try await Task.sleep(for: .milliseconds(250))
                    let result: Suggestions = try await house.api.request("meals/suggest", token: house.session, query: ["q": name])
                    guard !Task.isCancelled else { return }
                    suggestions = result.names
                } catch { suggestions = [] }
            }
            .sheet(isPresented: $camera) { Camera { photo = $0 } }
        }
    }
    private struct Suggestions: Decodable { let names: [String] }
    private struct Saved: Decodable { let meal: Meal? }
    private func save() async {
        busy = true
        error = ""
        defer { busy = false }
        do {
            let _: Saved = try await house.api.request("meals", method: "PUT",
                body: ["date": meal.date, "name": name], token: house.session)
            if !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, let photo {
                let _: Saved = try await house.api.request("meals/\(meal.date)/photo", method: "POST",
                    token: house.session, photo: photo)
            }
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

struct MealPhoto: View {
    @EnvironmentObject private var house: House
    let path: String
    var accessibilityLabel = "Dinner photo"
    @State private var image: UIImage?
    @State private var failed = false
    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 12))
                    .accessibilityLabel(accessibilityLabel)
            } else if failed {
                Text("Photo unavailable").font(.caption).foregroundStyle(Plaza.muted)
            } else { ProgressView() }
        }
        .task(id: path) {
            image = nil
            failed = false
            do {
                var request = URLRequest(url: house.api.photoURL(path))
                if let token = house.session { request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
                let (data, response) = try await house.api.session.data(for: request)
                guard (response as? HTTPURLResponse)?.statusCode == 200, let decoded = UIImage(data: data) else {
                    failed = true
                    return
                }
                image = decoded
            } catch { failed = true }
        }
    }
}
