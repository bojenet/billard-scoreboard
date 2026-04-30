import SwiftUI

struct PrimaryActionButton: View {
    let title: String
    let background: Color
    let foreground: Color
    let minHeight: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 22, weight: .bold))
                .frame(maxWidth: .infinity, minHeight: minHeight)
        }
        .buttonStyle(.plain)
        .foregroundStyle(foreground)
        .background(background)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .shadow(color: .black.opacity(0.22), radius: 10, y: 6)
    }
}

struct PlayerMiniCard: View {
    let name: String
    let discipline: String
    let score: Int
    let innings: Int
    let average: String
    let highRun: Int
    let isActive: Bool
    let activeColor: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(name)
                .font(.system(size: 20, weight: .bold))
                .lineLimit(2)
            Text(discipline)
                .font(.system(size: 12, weight: .semibold))
                .opacity(0.78)
            Text("\(score)")
                .font(.system(size: 56, weight: .heavy))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            HStack {
                Text("A: \(innings)")
                Spacer()
                Text("DS: \(average)")
                Spacer()
                Text("HR: \(highRun)")
            }
            .font(.system(size: 12, weight: .semibold))
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(isActive ? activeColor : Color(red: 0.07, green: 0.15, blue: 0.34))
        .foregroundStyle(isActive ? Color.black : Color.white)
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(isActive ? activeColor.opacity(0.95) : Color(red: 0.17, green: 0.27, blue: 0.53), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .shadow(color: isActive ? activeColor.opacity(0.22) : .black.opacity(0.2), radius: 12, y: 8)
    }
}
