import Foundation

enum WidgetConstants {
    static let appGroupID = "group.com.yangminggu.taskwidget"
    static let defaultBaseURL = "https://yangminggu.com/tasks"
    static let widgetKind = "TaskReadingWidget"
}

enum WidgetSettings {
    private enum Keys {
        static let baseURL = "apiBaseURL"
        static let token = "apiToken"
    }

    static var store: UserDefaults {
        UserDefaults(suiteName: WidgetConstants.appGroupID) ?? .standard
    }

    static var baseURLString: String {
        let value = store.string(forKey: Keys.baseURL) ?? WidgetConstants.defaultBaseURL
        return value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? WidgetConstants.defaultBaseURL
            : value
    }

    static var token: String {
        store.string(forKey: Keys.token) ?? ""
    }

    static func save(baseURLString: String, token: String) {
        store.set(baseURLString.trimmingCharacters(in: .whitespacesAndNewlines), forKey: Keys.baseURL)
        store.set(token.trimmingCharacters(in: .whitespacesAndNewlines), forKey: Keys.token)
    }

    static func makeAPIClient() throws -> WorkerAPIClient {
        guard let url = URL(string: baseURLString) else {
            throw APIError.invalidBaseURL
        }
        return WorkerAPIClient(baseURL: url, token: token)
    }
}
