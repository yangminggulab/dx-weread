import SwiftUI
import WidgetKit

struct IOSContentView: View {
    var openedRoute: String

    @Environment(\.openURL) private var openURL
    @State private var baseURLString = WidgetSettings.baseURLString
    @State private var token = WidgetSettings.token
    @State private var status = "尚未刷新"
    @State private var snapshot = WidgetCache.loadSnapshot() ?? SnapshotBuilder.sample()
    @State private var isLoading = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    preview
                }

                Section("Worker API") {
                    TextField("API 地址", text: $baseURLString)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                    SecureField("API Token", text: $token)
                        .textInputAutocapitalization(.never)
                }

                Section {
                    Button {
                        saveSettings()
                    } label: {
                        Label("保存设置", systemImage: "checkmark.circle")
                    }

                    Button {
                        Task { await refresh() }
                    } label: {
                        Label(isLoading ? "刷新中" : "测试并刷新", systemImage: "arrow.clockwise")
                    }
                    .disabled(isLoading)

                    Button {
                        openDashboard()
                    } label: {
                        Label("打开云端", systemImage: "safari")
                    }
                }

                Section {
                    Text(status)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("任务阅读小组件")
            .onAppear {
                snapshot = WidgetCache.loadSnapshot() ?? snapshot
            }
        }
    }

    private var preview: some View {
        HStack(spacing: 18) {
            ReadingRingView(progress: snapshot.readingProgress, lineWidth: 12)
                .frame(width: 92, height: 92)

            VStack(alignment: .leading, spacing: 8) {
                Text("\(snapshot.todayReadMinutes) / \(snapshot.readGoalMinutes) 分钟")
                    .font(.system(size: 24, weight: .bold, design: .rounded))
                Text("今日任务 \(snapshot.taskCompleted)/\(snapshot.taskTotal)")
                    .font(.subheadline)
                Text("连续 \(snapshot.readingStreakDays) 天 · 累计 \(snapshot.totalReadDays) 天")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 8)
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
