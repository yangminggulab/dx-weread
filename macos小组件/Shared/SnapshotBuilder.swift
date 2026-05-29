import Foundation

enum SnapshotBuilder {
    static let defaultReadGoalMinutes = 30

    static func build(
        from data: DashboardData,
        now: Date = Date(),
        readGoalMinutes: Int = defaultReadGoalMinutes,
        source: SnapshotSource = .live
    ) -> WidgetSnapshot {
        let calendar = Calendar.shanghai
        let todayKey = DateKeys.dayKey(for: now, calendar: calendar)
        let todayTasks = data.tasks.filter { task in
            task.taskType == "daily" || task.deadline == todayKey
        }
        let taskScope = todayTasks.isEmpty ? data.tasks : todayTasks
        let taskTotal = taskScope.count
        let taskCompleted = taskScope.filter(\.isCompleted).count
        let activeTasks = data.tasks
            .filter { !$0.isCompleted }
            .sorted { left, right in
                if left.priorityRank != right.priorityRank {
                    return left.priorityRank < right.priorityRank
                }
                return left.id < right.id
            }
            .prefix(6)

        let todayReadMinutes = todayMinutes(
            weekReadDaily: data.weekReadDaily,
            dailyReadTimes: data.wereadStats?.dailyReadTimes,
            now: now,
            todayKey: todayKey,
            calendar: calendar
        )

        return WidgetSnapshot(
            dateKey: todayKey,
            updatedAt: now,
            taskTotal: taskTotal,
            taskCompleted: taskCompleted,
            activeTasks: Array(activeTasks),
            todayReadMinutes: todayReadMinutes,
            readGoalMinutes: readGoalMinutes,
            readingStreakDays: streakDays(
                dailyReadTimes: data.wereadStats?.dailyReadTimes,
                todayReadMinutes: todayReadMinutes,
                goalMinutes: readGoalMinutes,
                now: now,
                calendar: calendar
            ),
            totalReadDays: data.totalReadDays ?? data.wereadStats?.overall?.readDays ?? 0,
            source: source
        )
    }

    static func sample(source: SnapshotSource = .sample) -> WidgetSnapshot {
        let tasks = [
            TaskItem(id: 1, title: "复盘今日任务", category: "study", status: "in_progress", priority: "high", taskType: "daily", deadline: nil, tags: nil, notes: nil, createdAt: nil),
            TaskItem(id: 2, title: "读 30 分钟", category: "life", status: "in_progress", priority: "medium", taskType: "daily", deadline: nil, tags: nil, notes: nil, createdAt: nil),
            TaskItem(id: 3, title: "整理小组件方案", category: "research", status: "in_progress", priority: "medium", taskType: "weekly", deadline: nil, tags: nil, notes: nil, createdAt: nil)
        ]
        let data = DashboardData(
            tasks: tasks,
            weekReadDaily: nil,
            weekReadMinutes: nil,
            totalReadDays: 128,
            wereadStats: WereadStats(
                monthly: nil,
                annual: nil,
                overall: nil,
                dailyReadTimes: [
                    DailyReadTime(date: DateKeys.dayKey(for: Date()), seconds: nil, minutes: 24)
                ]
            ),
            wereadSyncedAt: nil
        )
        return build(from: data, source: source)
    }

    private static func todayMinutes(
        weekReadDaily: [String: Int]?,
        dailyReadTimes: [DailyReadTime]?,
        now: Date,
        todayKey: String,
        calendar: Calendar
    ) -> Int {
        let weekMinutes = (weekReadDaily ?? [:]).reduce(0) { total, item in
            DateKeys.isTimestamp(item.key, inSameDayAs: now, calendar: calendar) ? total + item.value : total
        }
        if weekMinutes > 0 { return weekMinutes }

        return dailyReadTimes?
            .first(where: { $0.date == todayKey })?
            .minutesValue ?? 0
    }

    private static func streakDays(
        dailyReadTimes: [DailyReadTime]?,
        todayReadMinutes: Int,
        goalMinutes: Int,
        now: Date,
        calendar: Calendar
    ) -> Int {
        var completed = Set(
            (dailyReadTimes ?? [])
                .filter { $0.minutesValue >= goalMinutes }
                .map(\.date)
        )

        let todayKey = DateKeys.dayKey(for: now, calendar: calendar)
        if todayReadMinutes >= goalMinutes {
            completed.insert(todayKey)
        }
        guard !completed.isEmpty else { return 0 }

        var cursor = now
        if !completed.contains(todayKey),
           let yesterday = calendar.date(byAdding: .day, value: -1, to: now) {
            cursor = yesterday
        }

        var streak = 0
        while completed.contains(DateKeys.dayKey(for: cursor, calendar: calendar)) {
            streak += 1
            guard let previous = calendar.date(byAdding: .day, value: -1, to: cursor) else {
                break
            }
            cursor = previous
        }
        return streak
    }
}
