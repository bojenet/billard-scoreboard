import SwiftUI

struct MatchListView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        NavigationStack {
            VStack(spacing: 18) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Laufende Matches")
                            .font(.system(size: 32, weight: .heavy))
                            .foregroundStyle(.white)
                        Text(appState.isAdmin ? "Admin-Zugriff" : "Eigene und zugeordnete Partien")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.78))
                    }
                    Spacer()
                    Button {
                        Task { await appState.signOut() }
                    } label: {
                        Text("Logout")
                            .font(.system(size: 15, weight: .bold))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                            .background(Color(red: 0.55, green: 0.16, blue: 0.16))
                            .foregroundStyle(.white)
                            .clipShape(Capsule())
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)

                HStack {
                    Spacer()
                    Button {
                        Task { await appState.refreshMatches() }
                    } label: {
                        Text("↻")
                            .font(.system(size: 28, weight: .bold))
                            .frame(width: 58, height: 58)
                            .background(Color(red: 0.11, green: 0.2, blue: 0.5))
                            .foregroundStyle(.white)
                            .clipShape(Circle())
                    }
                }
                .padding(.horizontal, 20)

                if appState.isRefreshingMatches {
                    ProgressView()
                        .tint(.white)
                }

                if appState.runningMatches.isEmpty {
                    Spacer()
                    Text("Kein laufendes Match gefunden.")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.85))
                    Spacer()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(appState.runningMatches) { match in
                                Button {
                                    appState.openMatch(match)
                                } label: {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text("\(match.player1) vs \(match.player2)")
                                            .font(.system(size: 24, weight: .bold))
                                            .foregroundStyle(.white)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                        Text(match.subtitle)
                                            .font(.system(size: 15, weight: .semibold))
                                            .foregroundStyle(.white.opacity(0.8))
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                    }
                                    .padding(18)
                                    .background(Color(red: 0.09, green: 0.17, blue: 0.4))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                                            .stroke(Color(red: 0.18, green: 0.28, blue: 0.56), lineWidth: 1)
                                    )
                                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 20)
                        .padding(.bottom, 20)
                    }
                    .refreshable {
                        await appState.refreshMatches()
                    }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}
