import Combine
import EventKit
import Foundation

struct GroceryItem: Identifiable, Equatable {
    let id: String
    let title: String
}

@MainActor
protocol GroceriesStore {
    func requestAccess() async throws -> Bool
    func items() async throws -> [GroceryItem]
    func add(_ title: String) async throws
    func complete(_ id: String) async throws
    func clearChecked() async throws
}

@MainActor
final class RemindersGroceriesStore: GroceriesStore {
    private let store = EKEventStore()
    private func calendar() throws -> EKCalendar {
        if let existing = store.calendars(for: .reminder).first(where: { $0.title == "Groceries" }) { return existing }
        guard let source = store.defaultCalendarForNewReminders()?.source else {
            throw APIError(status: 0, message: "Set up a Reminders account first, then try again.")
        }
        let calendar = EKCalendar(for: .reminder, eventStore: store)
        calendar.title = "Groceries"
        calendar.source = source
        try store.saveCalendar(calendar, commit: true)
        return calendar
    }
    func requestAccess() async throws -> Bool {
        switch EKEventStore.authorizationStatus(for: .reminder) {
        case .fullAccess: return true
        case .notDetermined: return try await store.requestFullAccessToReminders()
        default: return false
        }
    }
    private func reminders(completed: Bool) async throws -> [EKReminder] {
        let calendar = try calendar()
        let predicate = completed
            ? store.predicateForCompletedReminders(withCompletionDateStarting: nil, ending: nil, calendars: [calendar])
            : store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: [calendar])
        return await withCheckedContinuation { continuation in
            store.fetchReminders(matching: predicate) { continuation.resume(returning: $0 ?? []) }
        }
    }
    func items() async throws -> [GroceryItem] {
        try await reminders(completed: false).map { GroceryItem(id: $0.calendarItemIdentifier, title: $0.title ?? "") }
            .sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
    }
    func add(_ title: String) async throws {
        let reminder = EKReminder(eventStore: store)
        reminder.calendar = try calendar()
        reminder.title = title
        try store.save(reminder, commit: true)
    }
    func complete(_ id: String) async throws {
        guard let reminder = store.calendarItem(withIdentifier: id) as? EKReminder else {
            throw APIError(status: 0, message: "That item changed. Refresh the list and try again.")
        }
        reminder.isCompleted = true
        try store.save(reminder, commit: true)
    }
    func clearChecked() async throws {
        let checked = try await reminders(completed: true)
        for reminder in checked { try store.remove(reminder, commit: false) }
        if !checked.isEmpty { try store.commit() }
    }
}

#if DEBUG
@MainActor
final class MemoryGroceriesStore: GroceriesStore {
    private var incomplete: [GroceryItem] = []
    private var checked: [GroceryItem] = []
    func requestAccess() async throws -> Bool { true }
    func items() async throws -> [GroceryItem] { incomplete }
    func add(_ title: String) async throws { incomplete.append(GroceryItem(id: UUID().uuidString, title: title)) }
    func complete(_ id: String) async throws {
        checked += incomplete.filter { $0.id == id }
        incomplete.removeAll { $0.id == id }
    }
    func clearChecked() async throws { checked.removeAll() }
}
#endif

@MainActor
final class GroceriesModel: ObservableObject {
    @Published var items: [GroceryItem] = []
    @Published var denied = false
    @Published var error = ""
    @Published var busy = false
    private let store: any GroceriesStore
    init(store: (any GroceriesStore)? = nil) {
        if let store { self.store = store; return }
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-uiTestGroceries") {
            self.store = MemoryGroceriesStore()
            return
        }
#endif
        self.store = RemindersGroceriesStore()
    }
    func load() async {
        busy = true
        defer { busy = false }
        do {
            denied = !(try await store.requestAccess())
            guard !denied else { items = []; return }
            items = try await store.items()
            error = ""
        } catch { self.error = error.localizedDescription }
    }
    func add(_ title: String) async -> Bool {
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return false }
        return await change { try await self.store.add(title) }
    }
    func complete(_ id: String) async { _ = await change { try await self.store.complete(id) } }
    func clearChecked() async { _ = await change { try await self.store.clearChecked() } }
    private func change(_ operation: () async throws -> Void) async -> Bool {
        busy = true
        defer { busy = false }
        do {
            try await operation()
            items = try await store.items()
            error = ""
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}
