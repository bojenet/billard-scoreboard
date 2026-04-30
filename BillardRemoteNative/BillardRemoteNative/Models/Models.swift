import Foundation

struct AuthSession: Codable, Equatable {
    let accessToken: String
    let refreshToken: String?
    let expiresAt: TimeInterval?

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
        case refreshToken = "refresh_token"
        case expiresAt = "expires_at"
    }
}

struct AuthUser: Codable, Equatable {
    let id: String
    let email: String?
}

struct Match: Identifiable, Decodable, Equatable {
    let id: Int
    let player1: String
    let player2: String
    let discipline1: String?
    let discipline2: String?
    let score1: Int
    let score2: Int
    let inn1: Int
    let inn2: Int
    let high1: Int
    let high2: Int
    let series1: Int
    let series2: Int
    let activePlayer: Int
    let target1: Int
    let target2: Int
    let totalInnings: Int
    let maxInnings: Int
    let status: Int
    let finished: Bool
    let player1ID: String?
    let player2ID: String?
    let startedAt: String?
    let seriesLog1: [Int]?
    let seriesLog2: [Int]?

    var currentSeries: Int {
        activePlayer == 1 ? series1 : series2
    }

    var isRunning: Bool {
        status == 1 && !finished
    }

    var subtitle: String {
        let discipline = (discipline1?.isEmpty == false ? discipline1! : "-")
        return "\(discipline) · \(score1) : \(score2) · Aufn. \(totalInnings)"
    }

    var targetDescription1: String {
        let discipline = discipline1?.isEmpty == false ? discipline1! : "-"
        return "\(discipline) · \(target1 > 0 ? String(target1) : "-")"
    }

    var targetDescription2: String {
        let discipline = discipline2?.isEmpty == false ? discipline2! : "-"
        return "\(discipline) · \(target2 > 0 ? String(target2) : "-")"
    }

    var average1: String {
        guard inn1 > 0 else { return "0.000" }
        return String(format: "%.3f", Double(score1) / Double(inn1))
    }

    var average2: String {
        guard inn2 > 0 else { return "0.000" }
        return String(format: "%.3f", Double(score2) / Double(inn2))
    }

    var supportsSeriesLogs: Bool {
        seriesLog1 != nil && seriesLog2 != nil
    }

    enum CodingKeys: String, CodingKey {
        case id
        case player1
        case player2
        case discipline1
        case discipline2
        case score1
        case score2
        case inn1
        case inn2
        case high1
        case high2
        case series1
        case series2
        case activePlayer
        case target1
        case target2
        case totalInnings
        case maxInnings
        case status
        case finished
        case player1ID = "player1_id"
        case player2ID = "player2_id"
        case startedAt = "started_at"
        case seriesLog1 = "series_log1"
        case seriesLog2 = "series_log2"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = container.decodeFlexibleInt(forKey: .id)
        player1 = container.decodeFlexibleString(forKey: .player1) ?? "Spieler 1"
        player2 = container.decodeFlexibleString(forKey: .player2) ?? "Spieler 2"
        discipline1 = container.decodeFlexibleString(forKey: .discipline1)
        discipline2 = container.decodeFlexibleString(forKey: .discipline2)
        score1 = container.decodeFlexibleInt(forKey: .score1)
        score2 = container.decodeFlexibleInt(forKey: .score2)
        inn1 = container.decodeFlexibleInt(forKey: .inn1)
        inn2 = container.decodeFlexibleInt(forKey: .inn2)
        high1 = container.decodeFlexibleInt(forKey: .high1)
        high2 = container.decodeFlexibleInt(forKey: .high2)
        series1 = container.decodeFlexibleInt(forKey: .series1)
        series2 = container.decodeFlexibleInt(forKey: .series2)
        activePlayer = max(1, container.decodeFlexibleInt(forKey: .activePlayer))
        target1 = container.decodeFlexibleInt(forKey: .target1)
        target2 = container.decodeFlexibleInt(forKey: .target2)
        totalInnings = max(1, container.decodeFlexibleInt(forKey: .totalInnings, defaultValue: 1))
        maxInnings = container.decodeFlexibleInt(forKey: .maxInnings)
        status = container.decodeFlexibleInt(forKey: .status, defaultValue: 1)
        finished = container.decodeFlexibleBool(forKey: .finished)
        player1ID = container.decodeFlexibleString(forKey: .player1ID)
        player2ID = container.decodeFlexibleString(forKey: .player2ID)
        startedAt = container.decodeFlexibleString(forKey: .startedAt)
        seriesLog1 = container.decodeFlexibleIntArray(forKey: .seriesLog1)
        seriesLog2 = container.decodeFlexibleIntArray(forKey: .seriesLog2)
    }
}

struct MatchSnapshot {
    let score1: Int
    let score2: Int
    let series1: Int
    let series2: Int
    let high1: Int
    let high2: Int
    let activePlayer: Int
    let inn1: Int
    let inn2: Int
    let totalInnings: Int
    let finished: Bool
    let seriesLog1: [Int]?
    let seriesLog2: [Int]?

    init(match: Match) {
        score1 = match.score1
        score2 = match.score2
        series1 = match.series1
        series2 = match.series2
        high1 = match.high1
        high2 = match.high2
        activePlayer = match.activePlayer
        inn1 = match.inn1
        inn2 = match.inn2
        totalInnings = match.totalInnings
        finished = match.finished
        seriesLog1 = match.seriesLog1
        seriesLog2 = match.seriesLog2
    }

    var payload: [String: Any] {
        var value: [String: Any] = [
            "score1": score1,
            "score2": score2,
            "series1": series1,
            "series2": series2,
            "high1": high1,
            "high2": high2,
            "activePlayer": activePlayer,
            "inn1": inn1,
            "inn2": inn2,
            "totalInnings": totalInnings,
            "finished": finished
        ]
        if let seriesLog1 {
            value["series_log1"] = seriesLog1
        }
        if let seriesLog2 {
            value["series_log2"] = seriesLog2
        }
        return value
    }
}

enum VoiceCommand: Equatable {
    case set(Int)
    case add(Int)
    case `switch`
    case undo
    case finish
}

extension KeyedDecodingContainer {
    func decodeFlexibleString(forKey key: Key) -> String? {
        if let value = try? decodeIfPresent(String.self, forKey: key), let value {
            return value
        }
        if let value = try? decodeIfPresent(Int.self, forKey: key), let value {
            return String(value)
        }
        if let value = try? decodeIfPresent(Double.self, forKey: key), let value {
            return String(value)
        }
        if let value = try? decodeIfPresent(Bool.self, forKey: key), let value {
            return value ? "true" : "false"
        }
        return nil
    }

    func decodeFlexibleInt(forKey key: Key, defaultValue: Int = 0) -> Int {
        if let value = try? decodeIfPresent(Int.self, forKey: key), let value {
            return value
        }
        if let value = try? decodeIfPresent(Double.self, forKey: key), let value {
            return Int(value)
        }
        if let value = try? decodeIfPresent(String.self, forKey: key),
           let value,
           let parsed = Int(value) {
            return parsed
        }
        if let value = try? decodeIfPresent(Bool.self, forKey: key), let value {
            return value ? 1 : 0
        }
        return defaultValue
    }

    func decodeFlexibleBool(forKey key: Key) -> Bool {
        if let value = try? decodeIfPresent(Bool.self, forKey: key), let value {
            return value
        }
        if let value = try? decodeIfPresent(Int.self, forKey: key), let value {
            return value != 0
        }
        if let value = try? decodeIfPresent(String.self, forKey: key), let value {
            let normalized = value.lowercased()
            return normalized == "true" || normalized == "1" || normalized == "t"
        }
        return false
    }

    func decodeFlexibleIntArray(forKey key: Key) -> [Int]? {
        if let value = try? decodeIfPresent([Int].self, forKey: key), let value {
            return value
        }
        if let value = try? decodeIfPresent([String].self, forKey: key), let value {
            return value.compactMap(Int.init)
        }
        if let value = try? decodeIfPresent(String.self, forKey: key), let value {
            guard let data = value.data(using: .utf8) else { return nil }
            if let parsed = try? JSONSerialization.jsonObject(with: data) as? [Any] {
                return parsed.compactMap { item in
                    if let intValue = item as? Int { return intValue }
                    if let stringValue = item as? String { return Int(stringValue) }
                    if let doubleValue = item as? Double { return Int(doubleValue) }
                    return nil
                }
            }
        }
        return nil
    }
}
