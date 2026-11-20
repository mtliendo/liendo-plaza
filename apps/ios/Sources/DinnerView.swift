import SwiftUI

struct DinnerView: View {
    @EnvironmentObject private var house: House
    @State private var meals: [Meal] = []
    @State private var loading = false
    @State private var error = ""
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("This week").font(Plaza.title(32))
                    if loading { ProgressView("Getting dinner ready…") }
                    if meals.isEmpty && !loading && error.isEmpty {
                        Text("Nothing on the menu yet.").foregroundStyle(Plaza.muted)
                    }
                    ForEach(meals.sorted { $0.date < $1.date }, id: \.date) { meal in
                        VStack(alignment: .leading, spacing: 12) {
                            Text(meal.date == house.snapshot?.today ? "Today · \(meal.date)" : meal.date)
                                .foregroundStyle(Plaza.muted)
                            Text(meal.name).font(Plaza.title(25))
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
                        .accessibilityIdentifier("dinner.\(meal.date)")
                    }
                    InlineError(message: error)
                    if !error.isEmpty { Button("Try again") { Task { await load() } } }
                }.padding(24)
            }
            .background(Plaza.paper).navigationTitle("Dinner")
            .task { await load() }.refreshable { await load() }
        }
    }
    private func load() async {
        loading = true
        error = ""
        defer { loading = false }
        do {
            let result: MealsResponse = try await house.api.request("meals", token: house.session)
            meals = result.meals
        } catch { self.error = error.localizedDescription }
    }
}

struct MealPhoto: View {
    @EnvironmentObject private var house: House
    let path: String
    @State private var image: UIImage?
    @State private var failed = false
    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 12))
                    .accessibilityLabel("Dinner photo")
            } else if failed {
                Text("Photo unavailable").font(.caption).foregroundStyle(Plaza.muted)
            } else { ProgressView() }
        }
        .task(id: path) {
            image = nil
            failed = false
            do {
                var request = URLRequest(url: house.api.baseURL.appendingPathComponent("api/photos").appendingPathComponent(path))
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
