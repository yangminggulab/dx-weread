import Foundation

struct WorkerAPIClient {
    var baseURL: URL
    var token: String?

    func fetchDashboardData() async throws -> DashboardData {
        var request = URLRequest(url: dataURL)
        request.httpMethod = "GET"
        request.timeoutInterval = 12
        if let token, !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (payload, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw APIError.badStatus(http.statusCode)
        }
        return try JSONDecoder().decode(DashboardData.self, from: payload)
    }

    private var dataURL: URL {
        baseURL
            .appendingPathComponent("api")
            .appendingPathComponent("data")
    }
}

enum APIError: Error, LocalizedError {
    case badStatus(Int)
    case invalidBaseURL

    var errorDescription: String? {
        switch self {
        case .badStatus(let status):
            return "Worker API 返回状态码 \(status)"
        case .invalidBaseURL:
            return "API 地址无效"
        }
    }
}
