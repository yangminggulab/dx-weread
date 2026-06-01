import Foundation

enum WidgetConstants {
    static let defaultBaseURL = "https://yangminggu.com/tasks"
    static let defaultToken = "ef7a6f5bedf74c2f20c3966c38f40809679644abf07ee776048f50623362ed99"
    static let widgetKind = "TaskReadingWidget"
}

enum WidgetSettings {
    private enum Keys {
        static let baseURL = "apiBaseURL"
        static let token = "apiToken"
    }

    static var store: UserDefaults {
        UserDefaults(suiteName: "group.com.yangminggu.taskwidget") ?? .standard
    }

    static var baseURLString: String {
        let value = store.string(forKey: Keys.baseURL) ?? WidgetConstants.defaultBaseURL
        return value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? WidgetConstants.defaultBaseURL
            : value
    }

    static var token: String {
        let value = store.string(forKey: Keys.token) ?? WidgetConstants.defaultToken
        return value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? WidgetConstants.defaultToken
            : value
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
