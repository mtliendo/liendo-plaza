import Foundation
import UserNotifications

enum ChoreReminders {
    static let identifier = "kid.chores.today"
    static func remove() {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier])
    }
    static func triggerDate(snapshot: Snapshot, now: Date = Date()) -> Date? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Chicago")!
        let day = calendar.dateComponents([.year, .month, .day], from: now)
        var components = day
        components.timeZone = calendar.timeZone
        components.hour = snapshot.settings?.choreReminderHour ?? 18
        components.minute = snapshot.settings?.choreReminderMinute ?? 0
        guard let date = calendar.date(from: components), date > now else { return nil }
        return date
    }
    static func update(snapshot: Snapshot, person: Person) async {
        let center = UNUserNotificationCenter.current()
        remove()
        let settings = await center.notificationSettings()
        guard [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus) else { return }
        let count = snapshot.chores(for: person).filter { ["open", "rejected"].contains($0.status) }.count
        guard count > 0, let date = triggerDate(snapshot: snapshot) else { return }
        let content = UNMutableNotificationContent()
        content.title = "Liendo Plaza"
        content.body = "You still have \(count) chores"
        content.sound = .default
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Chicago")!
        var components = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        components.timeZone = calendar.timeZone
        try? await center.add(UNNotificationRequest(identifier: identifier, content: content,
            trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false)))
    }
}
