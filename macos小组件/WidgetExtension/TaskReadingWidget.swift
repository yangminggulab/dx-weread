import SwiftUI
import WidgetKit

struct TaskWidgetEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
}

struct TaskWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> TaskWidgetEntry {
        TaskWidgetEntry(date: Date(), snapshot: SnapshotBuilder.sample())
    }

    func getSnapshot(in context: Context, completion: @escaping (TaskWidgetEntry) -> Void) {
        let snapshot = WidgetCache.loadSnapshot() ?? SnapshotBuilder.sample()
        completion(TaskWidgetEntry(date: Date(), snapshot: snapshot))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TaskWidgetEntry>) -> Void) {
        Task {
            let snapshot = await loadSnapshot()
            let entry = TaskWidgetEntry(date: Date(), snapshot: snapshot)
            let nextRefresh = Calendar.shanghai.date(byAdding: .minute, value: 45, to: Date()) ?? Date().addingTimeInterval(2700)
            completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
        }
    }

    private func loadSnapshot() async -> WidgetSnapshot {
        do {
            let client = try WidgetSettings.makeAPIClient()
            let data = try await client.fetchDashboardData()
            let snapshot = SnapshotBuilder.build(from: data, source: .live)
            WidgetCache.save(snapshot: snapshot)
            return snapshot
        } catch {
            if var cached = WidgetCache.loadSnapshot() {
                cached.source = .cache
                return cached
            }
            return SnapshotBuilder.sample()
        }
    }
}

struct TaskReadingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetConstants.widgetKind, provider: TaskWidgetProvider()) { entry in
            TaskReadingWidgetView(entry: entry)
        }
        .configurationDisplayName("任务阅读")
        .description("查看今日任务进度、阅读圆环和高优先级待办。")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct TaskReadingWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TaskWidgetEntry

    var body: some View {
        Group {
            switch family {
            case .systemSmall:
                small
            case .systemLarge:
                large
            default:
                medium
            }
        }
        .widgetURL(URL(string: "taskwidget://dashboard"))
        .containerBackground(for: .widget) {
            Color(red: 0.07, green: 0.08, blue: 0.09)
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("今日阅读")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
                sourceDot
            }
            ZStack {
                ReadingRingView(progress: entry.snapshot.readingProgress, lineWidth: 12)
                VStack(spacing: 2) {
                    Text("\(entry.snapshot.todayReadMinutes)")
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                    Text("分钟")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            Text("连续 \(entry.snapshot.readingStreakDays) 天")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(14)
    }

    private var medium: some View {
        HStack(spacing: 16) {
            ZStack {
                ReadingRingView(progress: entry.snapshot.readingProgress, lineWidth: 14)
                VStack(spacing: 2) {
                    Text("\(entry.snapshot.todayReadMinutes)")
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                    Text("/ \(entry.snapshot.readGoalMinutes) 分")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(width: 112, height: 112)

            VStack(alignment: .leading, spacing: 10) {
                header
                HStack(spacing: 14) {
                    stat("任务", "\(entry.snapshot.taskCompleted)/\(entry.snapshot.taskTotal)")
                    stat("连续", "\(entry.snapshot.readingStreakDays)天")
                    stat("累计", "\(entry.snapshot.totalReadDays)天")
                }
                if let task = entry.snapshot.activeTasks.first {
                    Text(task.title)
                        .font(.callout.weight(.medium))
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(16)
    }

    private var large: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            HStack(spacing: 16) {
                ZStack {
                    ReadingRingView(progress: entry.snapshot.readingProgress, lineWidth: 14)
                    VStack(spacing: 3) {
                        Text("\(entry.snapshot.todayReadMinutes)")
                            .font(.system(size: 32, weight: .bold, design: .rounded))
                        Text("分钟")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(width: 112, height: 112)

                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 16) {
                        stat("今日任务", "\(entry.snapshot.taskCompleted)/\(entry.snapshot.taskTotal)")
                        stat("连续完成", "\(entry.snapshot.readingStreakDays)天")
                    }
                    stat("累积完成", "\(entry.snapshot.totalReadDays)天")
                }
                Spacer()
            }

            Divider().opacity(0.35)

            VStack(alignment: .leading, spacing: 8) {
                ForEach(entry.snapshot.activeTasks.prefix(5)) { task in
                    TaskRow(task: task)
                }
                if entry.snapshot.activeTasks.isEmpty {
                    Text("今天没有待办")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(18)
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("任务阅读")
                    .font(.headline.weight(.semibold))
                Text("更新 \(entry.snapshot.updatedAt.formatted(date: .omitted, time: .shortened))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            sourceDot
        }
    }

    private func stat(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
    }

    private var sourceDot: some View {
        Circle()
            .fill(entry.snapshot.source == .live ? Color.green : Color.yellow)
            .frame(width: 8, height: 8)
            .accessibilityLabel(entry.snapshot.source == .live ? "实时数据" : "缓存数据")
    }
}

private struct TaskRow: View {
    let task: TaskItem

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(priorityColor)
                .frame(width: 7, height: 7)
            Text(task.title)
                .font(.callout)
                .lineLimit(1)
            Spacer(minLength: 0)
            if let taskType = task.taskType {
                Text(taskTypeLabel(taskType))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var priorityColor: Color {
        switch task.priority {
        case "high": return .red
        case "medium": return .orange
        case "low": return .blue
        default: return .secondary
        }
    }

    private func taskTypeLabel(_ value: String) -> String {
        switch value {
        case "daily": return "日常"
        case "weekly": return "本周"
        case "longterm": return "长期"
        default: return value
        }
    }
}
