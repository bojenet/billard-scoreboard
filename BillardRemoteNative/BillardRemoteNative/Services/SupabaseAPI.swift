import Foundation

enum SupabaseAPIError: LocalizedError {
    case invalidResponse
    case api(message: String)
    case encodingFailed

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "Ungültige Server-Antwort."
        case .api(let message):
            return message
        case .encodingFailed:
            return "Daten konnten nicht verarbeitet werden."
        }
    }
}

final class SupabaseAPI {
    static let shared = SupabaseAPI()

    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    private init() {}

    func signIn(email: String, password: String) async throws -> AuthSession {
        let body = try encoder.encode([
            "email": email,
            "password": password
        ])
        let (data, response) = try await request(
            path: "/auth/v1/token",
            method: "POST",
            queryItems: [URLQueryItem(name: "grant_type", value: "password")],
            bearerToken: nil,
            body: body,
            additionalHeaders: ["Content-Type": "application/json"]
        )
        try validate(response: response, data: data)
        return try decoder.decode(AuthSession.self, from: data)
    }

    func fetchCurrentUser(accessToken: String) async throws -> AuthUser {
        let (data, response) = try await request(
            path: "/auth/v1/user",
            method: "GET",
            queryItems: [],
            bearerToken: accessToken
        )
        try validate(response: response, data: data)
        return try decoder.decode(AuthUser.self, from: data)
    }

    func signOut(accessToken: String) async {
        _ = try? await request(
            path: "/auth/v1/logout",
            method: "POST",
            queryItems: [],
            bearerToken: accessToken,
            body: nil,
            additionalHeaders: ["Content-Type": "application/json"]
        )
    }

    func fetchUserRole(accessToken: String, userID: String) async throws -> String? {
        let (data, response) = try await request(
            path: "/rest/v1/user_roles",
            method: "GET",
            queryItems: [
                URLQueryItem(name: "select", value: "role"),
                URLQueryItem(name: "user_id", value: "eq.\(userID)"),
                URLQueryItem(name: "limit", value: "1")
            ],
            bearerToken: accessToken
        )
        try validate(response: response, data: data)
        let rows = try decoder.decode([[String: String]].self, from: data)
        return rows.first?["role"]
    }

    func fetchOwnedPlayerNames(accessToken: String, userID: String) async throws -> [String] {
        let (data, response) = try await request(
            path: "/rest/v1/players",
            method: "GET",
            queryItems: [
                URLQueryItem(name: "select", value: "name,user_id"),
                URLQueryItem(name: "user_id", value: "eq.\(userID)")
            ],
            bearerToken: accessToken
        )
        try validate(response: response, data: data)
        let rows = try decoder.decode([PlayerRow].self, from: data)
        return rows.compactMap { row in
            guard let raw = row.name else { return nil }
            let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
    }

    func fetchRunningMatches(accessToken: String) async throws -> [Match] {
        let (data, response) = try await request(
            path: "/rest/v1/matches",
            method: "GET",
            queryItems: [
                URLQueryItem(name: "select", value: "*"),
                URLQueryItem(name: "status", value: "eq.1"),
                URLQueryItem(name: "finished", value: "eq.false"),
                URLQueryItem(name: "order", value: "started_at.desc")
            ],
            bearerToken: accessToken
        )
        try validate(response: response, data: data)
        return try decoder.decode([Match].self, from: data)
    }

    func fetchMatch(accessToken: String, matchID: Int) async throws -> Match {
        let (data, response) = try await request(
            path: "/rest/v1/matches",
            method: "GET",
            queryItems: [
                URLQueryItem(name: "select", value: "*"),
                URLQueryItem(name: "id", value: "eq.\(matchID)"),
                URLQueryItem(name: "limit", value: "1")
            ],
            bearerToken: accessToken
        )
        try validate(response: response, data: data)
        let matches = try decoder.decode([Match].self, from: data)
        guard let match = matches.first else {
            throw SupabaseAPIError.api(message: "Match konnte nicht geladen werden.")
        }
        return match
    }

    func updateMatch(accessToken: String, matchID: Int, payload: [String: Any]) async throws {
        guard JSONSerialization.isValidJSONObject(payload) else {
            throw SupabaseAPIError.encodingFailed
        }
        let body = try JSONSerialization.data(withJSONObject: payload)
        let (data, response) = try await request(
            path: "/rest/v1/matches",
            method: "PATCH",
            queryItems: [URLQueryItem(name: "id", value: "eq.\(matchID)")],
            bearerToken: accessToken,
            body: body,
            additionalHeaders: [
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
            ]
        )
        try validate(response: response, data: data, acceptEmptyBody: true)
    }

    private func request(
        path: String,
        method: String,
        queryItems: [URLQueryItem],
        bearerToken: String?,
        body: Data? = nil,
        additionalHeaders: [String: String] = [:]
    ) async throws -> (Data, HTTPURLResponse) {
        var components = URLComponents(url: AppConfig.supabaseURL, resolvingAgainstBaseURL: false)
        components?.path = path
        components?.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let url = components?.url else {
            throw SupabaseAPIError.invalidResponse
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.setValue(AppConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        if let bearerToken {
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }
        for (key, value) in additionalHeaders {
            request.setValue(value, forHTTPHeaderField: key)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw SupabaseAPIError.invalidResponse
        }
        return (data, httpResponse)
    }

    private func validate(response: HTTPURLResponse, data: Data, acceptEmptyBody: Bool = false) throws {
        guard (200 ... 299).contains(response.statusCode) else {
            if let apiError = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                let message = (apiError["msg"] as? String)
                    ?? (apiError["message"] as? String)
                    ?? (apiError["error_description"] as? String)
                    ?? (apiError["error"] as? String)
                    ?? "Serverfehler (\(response.statusCode))."
                throw SupabaseAPIError.api(message: message)
            }
            let fallback = String(data: data, encoding: .utf8) ?? "Serverfehler (\(response.statusCode))."
            throw SupabaseAPIError.api(message: fallback)
        }

        if acceptEmptyBody { return }
    }
}

private struct PlayerRow: Decodable {
    let name: String?
}
