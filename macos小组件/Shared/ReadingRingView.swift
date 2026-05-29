import SwiftUI

struct ReadingRingView: View {
    var progress: Double
    var lineWidth: CGFloat = 12

    private var clampedBase: Double {
        min(max(progress, 0), 1)
    }

    private var overflow: Double {
        progress > 1 ? progress.truncatingRemainder(dividingBy: 1) : 0
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Circle()
                    .stroke(Color.green.opacity(0.16), lineWidth: lineWidth)

                if progress >= 1 {
                    Circle()
                        .stroke(Color.green, style: StrokeStyle(lineWidth: lineWidth, lineCap: .butt))
                } else {
                    Circle()
                        .trim(from: 0, to: clampedBase)
                        .stroke(Color.green, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                        .rotationEffect(.degrees(90))
                }

                if overflow > 0.01 {
                    Circle()
                        .trim(from: 0, to: overflow)
                        .stroke(Color.green, style: StrokeStyle(lineWidth: lineWidth, lineCap: .butt))
                        .rotationEffect(.degrees(90))

                    LeadingCap(progress: overflow, lineWidth: lineWidth)
                        .fill(Color.green)
                        .shadow(color: .black.opacity(0.22), radius: 3, x: 0, y: 1)
                        .frame(width: lineWidth, height: lineWidth)
                        .position(capPosition(in: proxy.size, progress: overflow))
                }
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }

    private func capPosition(in size: CGSize, progress: Double) -> CGPoint {
        let radius = (min(size.width, size.height) - lineWidth) / 2
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let angle = CGFloat.pi / 2 + CGFloat.pi * 2 * CGFloat(progress)
        return CGPoint(
            x: center.x + cos(angle) * radius,
            y: center.y + sin(angle) * radius
        )
    }
}

private struct LeadingCap: Shape {
    var progress: Double
    var lineWidth: CGFloat

    func path(in rect: CGRect) -> Path {
        Path(ellipseIn: rect)
    }
}
