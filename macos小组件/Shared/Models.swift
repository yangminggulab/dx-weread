import Foundation

struct DashboardData: Codable {
    var tasks: [TaskItem]
    var weekReadDaily: [String: Int]?
    var weekReadMinutes: Int?
    var totalReadDays: Int?
    var wereadStats: WereadStats?
    var wereadSyncedAt: String?
}

struct TaskItem: Codable, Identifiable {
    var id: Int
    var title: String
    var category: String?
    var status: String?
    var priority: String?
    var taskType: String?
    var deadline: String?
    var tags: [String]?
    var notes: String?
    var createdAt: String?

    var isCompleted: Bool {
        status == "completed"
    }

    var priorityRank: Int {
        switch priority {
        case "high": return 0
        case "medium": return 1
        case "low": return 2
        default: return 3
        }
    }
}

struct WereadStats: Codable {
    var monthly: WereadBriefStats?
    var annual: WereadBriefStats?
    var overall: WereadBriefStats?
    var dailyReadTimes: [DailyReadTime]?
}

struct WereadBriefStats: Codable {
    var baseTime: Int?
    var readDays: Int?
    var totalReadTime: Int?
    var dayAverageReadTime: Int?
}

struct DailyReadTime: Codable {
    var date: String
    var seconds: Int?
    var minutes: Int?

    var minutesValue: Int {
        if let minutes { return max(0, minutes) }
        return max(0, Int((Double(seconds ?? 0) / 60.0).rounded()))
    }
}

struct WidgetSnapshot: Codable {
    var dateKey: String
    var updatedAt: Date
    var taskTotal: Int
    var taskCompleted: Int
    var activeTasks: [TaskItem]
    var todayReadMinutes: Int
    var readGoalMinutes: Int
    var readingStreakDays: Int
    var totalReadDays: Int
    var source: SnapshotSource

    var taskActive: Int {
        max(0, taskTotal - taskCompleted)
    }

    var taskCompletionRate: Double {
        guard taskTotal > 0 else { return 0 }
        return min(1, max(0, Double(taskCompleted) / Double(taskTotal)))
    }

    var readingProgress: Double {
        guard readGoalMinutes > 0 else { return 0 }
        return max(0, Double(todayReadMinutes) / Double(readGoalMinutes))
    }
}

enum SnapshotSource: String, Codable {
    case live
    case cache
    case sample
}
