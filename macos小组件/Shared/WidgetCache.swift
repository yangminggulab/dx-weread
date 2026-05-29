import Foundation

enum WidgetCache {
    private static let snapshotKey = "lastWidgetSnapshot"

    static func loadSnapshot() -> WidgetSnapshot? {
        guard let data = WidgetSettings.store.data(forKey: snapshotKey) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    static func save(snapshot: WidgetSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        WidgetSettings.store.set(data, forKey: snapshotKey)
    }
}
