import Foundation

extension Calendar {
    static let shanghai: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai") ?? .current
        return calendar
    }()
}

enum DateKeys {
    static func dayKey(for date: Date, calendar: Calendar = .shanghai) -> String {
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        let year = components.year ?? 1970
        let month = components.month ?? 1
        let day = components.day ?? 1
        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    static func startOfDay(for date: Date, calendar: Calendar = .shanghai) -> Date {
        calendar.startOfDay(for: date)
    }

    static func isTimestamp(_ timestamp: String, inSameDayAs date: Date, calendar: Calendar = .shanghai) -> Bool {
        guard let seconds = TimeInterval(timestamp) else { return false }
        let itemDate = Date(timeIntervalSince1970: seconds)
        return calendar.isDate(itemDate, inSameDayAs: date)
    }
}
