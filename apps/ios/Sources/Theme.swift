import SwiftUI

enum Plaza {
    static let paper = Color(hex: 0xFAF6EF)
    static let card = Color(hex: 0xF7F0E4)
    static let ink = Color(hex: 0x3A2418)
    static let muted = Color(hex: 0x7A5840)
    static let accent = Color(hex: 0x8C4A22)
    static let error = Color(hex: 0x8C2F1F)
    static func title(_ size: CGFloat = 32) -> Font { .custom("Fraunces", size: size, relativeTo: .title) }
    static func personColor(_ slug: String) -> Color {
        Color(hex: ["focus": 0x893D31, "jess": 0x426F51, "sofia": 0xAC5D71,
                    "noah": 0x527491, "xavier": 0xB78B29][slug] ?? 0x7A7168)
    }
}

extension Color {
    init(hex: Int) {
        self.init(.sRGB, red: Double((hex >> 16) & 255) / 255,
                  green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255, opacity: 1)
    }
}

struct PrimaryButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.custom("Figtree", size: 17, relativeTo: .body))
            .frame(maxWidth: .infinity).padding(18)
            .background(Plaza.accent.opacity(configuration.isPressed ? 0.7 : 1))
            .foregroundStyle(Plaza.paper).clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

struct Avatar: View {
    let person: Person
    var body: some View {
        Group {
            if ["sofia", "noah", "xavier"].contains(person.slug),
               let image = UIImage(named: person.slug) {
                Image(uiImage: image).resizable().scaledToFit()
            } else {
                Text(String(person.name.prefix(1))).font(Plaza.title(23))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(width: 48, height: 48)
        .background(Plaza.personColor(person.slug).opacity(0.16)).clipShape(Circle())
        .accessibilityHidden(true)
    }
}

struct InlineError: View {
    let message: String
    var body: some View {
        if !message.isEmpty {
            Text(message).foregroundStyle(Plaza.error).accessibilityIdentifier("error")
        }
    }
}

struct Chip: View {
    let text: String
    var body: some View {
        Text(text).font(.custom("Figtree", size: 13, relativeTo: .caption))
            .padding(.horizontal, 9).padding(.vertical, 5)
            .background(Plaza.paper).clipShape(Capsule())
    }
}
