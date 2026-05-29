import SwiftUI
import WidgetKit

struct ContentView: View {
    var openedRoute: String

    @Environment(\.openURL) private var openURL
    @State private var baseURLString = WidgetSettings.baseURLString
    @State private var token = WidgetSettings.token
    @State private var status = "尚未刷新"
    @State private var snapshot = WidgetCache.loadSnapshot() ?? SnapshotBuilder.sample()
    @State private var isLoading = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            header
            preview
            settings
            actions
            Text(status)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(24)
        .frame(minWidth: 560, minHeight: 520)
        .onAppear {
            snapshot = WidgetCache.loadSnapshot() ?? snapshot
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 6) {
                Text("任务阅读小组件")
                    .font(.title.bold())
                Text("当前入口：\(openedRoute)")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                openDashboard()
            } label: {
                Label("打开云端", systemImage: "safari")
            }
        }
    }

    private var preview: some View {
        HStack(spacing: 18) {
            ReadingRingView(progress: snapshot.readingProgress, lineWidth: 14)
                .frame(width: 112, height: 112)

            VStack(alignment: .leading, spacing: 10) {
                Text("\(snapshot.todayReadMinutes) / \(snapshot.readGoalMinutes) 分钟")
                    .font(.system(size: 28, weight: .bold, design: .rounded))
                HStack(spacing: 16) {
                    metric(title: "今日任务", value: "\(snapshot.taskCompleted)/\(snapshot.taskTotal)")
                    metric(title: "连续完成", value: "\(snapshot.readingStreakDays) 天")
                    metric(title: "累积完成", value: "\(snapshot.totalReadDays) 天")
                }
                if let first = snapshot.activeTasks.first {
                    Text(first.title)
                        .lineLimit(1)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .padding(18)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func metric(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.headline)
        }
    }

    private var settings: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Worker API")
                .font(.headline)
            TextField("API 地址", text: $baseURLString)
                .textFieldStyle(.roundedBorder)
            SecureField("API Token", text: $token)
                .textFieldStyle(.roundedBorder)
        }
    }

    private var actions: some View {
        HStack(spacing: 12) {
            Button {
                saveSettings()
            } label: {
                Label("保存设置", systemImage: "checkmark.circle")
            }
            .buttonStyle(.borderedProminent)

            Button {
                Task { await refresh() }
            } label: {
                Label(isLoading ? "刷新中" : "测试并刷新", systemImage: "arrow.clockwise")
            }
            .disabled(isLoading)

            Button {
                WidgetCenter.shared.reloadAllTimelines()
                status = "已请求刷新 Widget timeline"
            } label: {
                Label("刷新 Widget", systemImage: "rectangle.3.group")
            }
        }
    }

    @MainActor
    private func saveSettings() {
        WidgetSettings.save(baseURLString: baseURLString, token: token)
        WidgetCenter.shared.reloadAllTimelines()
        status = "设置已保存"
    }

    @MainActor
    private func refresh() async {
        isLoading = true
        defer { isLoading = false }
        saveSettings()

        do {
            let client = try WidgetSettings.makeAPIClient()
            let data = try await client.fetchDashboardData()
            let nextSnapshot = SnapshotBuilder.build(from: data)
            WidgetCache.save(snapshot: nextSnapshot)
            snapshot = nextSnapshot
            WidgetCenter.shared.reloadAllTimelines()
            status = "刷新成功：\(nextSnapshot.dateKey)，\(nextSnapshot.activeTasks.count) 条待办"
        } catch {
            status = error.localizedDescription
        }
    }

    private func openDashboard() {
        guard let url = URL(string: baseURLString) else {
            status = "地址无效"
            return
        }
        openURL(url)
    }
}
