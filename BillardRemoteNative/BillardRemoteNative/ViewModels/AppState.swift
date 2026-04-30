import Foundation

@MainActor
final class AppState: ObservableObject {
    @Published var isRestoring = true
    @Published var isAuthenticating = false
    @Published var session: AuthSession?
    @Published var user: AuthUser?
    @Published var ownedPlayerNames: [String] = []
    @Published var userRole: String?
    @Published var runningMatches: [Match] = []
    @Published var selectedMatch: Match?
    @Published var errorMessage: String?
    @Published var isRefreshingMatches = false

    private let api = SupabaseAPI.shared
    private let sessionStoreKey = "BillardRemoteNative.session"

    var isAdmin: Bool {
        userRole == "admin"
    }

    func restoreSessionIfPossible() async {
        defer { isRestoring = false }
        guard let stored = loadStoredSession() else { return }
        session = stored
        do {
            let authUser = try await api.fetchCurrentUser(accessToken: stored.accessToken)
            user = authUser
            userRole = try await api.fetchUserRole(accessToken: stored.accessToken, userID: authUser.id)
            ownedPlayerNames = try await api.fetchOwnedPlayerNames(accessToken: stored.accessToken, userID: authUser.id)
            await refreshMatches()
        } catch {
            clearSession()
            errorMessage = "Gespeicherte Sitzung konnte nicht wiederhergestellt werden."
        }
    }

    func signIn(email: String, password: String) async {
        errorMessage = nil
        isAuthenticating = true
        defer { isAuthenticating = false }

        do {
            let nextSession = try await api.signIn(email: email, password: password)
            let authUser = try await api.fetchCurrentUser(accessToken: nextSession.accessToken)
            let role = try await api.fetchUserRole(accessToken: nextSession.accessToken, userID: authUser.id)
            let owned = try await api.fetchOwnedPlayerNames(accessToken: nextSession.accessToken, userID: authUser.id)

            session = nextSession
            user = authUser
            userRole = role
            ownedPlayerNames = owned
            storeSession(nextSession)
            await refreshMatches()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func signOut() async {
        if let token = session?.accessToken {
            await api.signOut(accessToken: token)
        }
        clearSession()
    }

    func refreshMatches() async {
        guard let token = session?.accessToken else { return }
        isRefreshingMatches = true
        defer { isRefreshingMatches = false }
        do {
            let fetched = try await api.fetchRunningMatches(accessToken: token)
            runningMatches = filterAccessibleMatches(fetched)
            if let selectedMatch {
                if let refreshed = runningMatches.first(where: { $0.id == selectedMatch.id }) {
                    self.selectedMatch = refreshed
                } else if let latest = try? await api.fetchMatch(accessToken: token, matchID: selectedMatch.id) {
                    self.selectedMatch = latest.finished ? nil : latest
                } else {
                    self.selectedMatch = nil
                }
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func openMatch(_ match: Match) {
        selectedMatch = match
    }

    func closeSelectedMatch() {
        selectedMatch = nil
    }

    func updateCachedMatch(_ match: Match) {
        if let index = runningMatches.firstIndex(where: { $0.id == match.id }) {
            if match.finished {
                runningMatches.remove(at: index)
            } else {
                runningMatches[index] = match
            }
        } else if !match.finished, canAccess(match) {
            runningMatches.insert(match, at: 0)
        }
        if selectedMatch?.id == match.id {
            selectedMatch = match.finished ? nil : match
        }
    }

    private func canAccess(_ match: Match) -> Bool {
        guard let user else { return false }
        if isAdmin { return true }
        if let player1ID = match.player1ID, player1ID == user.id { return true }
        if let player2ID = match.player2ID, player2ID == user.id { return true }
        return ownedPlayerNames.contains(match.player1) || ownedPlayerNames.contains(match.player2)
    }

    private func filterAccessibleMatches(_ matches: [Match]) -> [Match] {
        matches.filter(canAccess)
    }

    private func storeSession(_ session: AuthSession) {
        if let data = try? JSONEncoder().encode(session) {
            UserDefaults.standard.set(data, forKey: sessionStoreKey)
        }
    }

    private func loadStoredSession() -> AuthSession? {
        guard let data = UserDefaults.standard.data(forKey: sessionStoreKey) else { return nil }
        return try? JSONDecoder().decode(AuthSession.self, from: data)
    }

    private func clearSession() {
        session = nil
        user = nil
        userRole = nil
        ownedPlayerNames = []
        runningMatches = []
        selectedMatch = nil
        UserDefaults.standard.removeObject(forKey: sessionStoreKey)
    }
}
