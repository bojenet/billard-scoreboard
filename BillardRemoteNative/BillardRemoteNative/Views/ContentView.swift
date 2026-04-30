import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        Group {
            if appState.isRestoring {
                ProgressView("Remote wird vorbereitet …")
                    .progressViewStyle(.circular)
                    .tint(.white)
            } else if appState.session == nil {
                LoginView()
            } else if let selectedMatch = appState.selectedMatch,
                      let token = appState.session?.accessToken {
                RemoteMatchContainer(
                    initialMatch: selectedMatch,
                    accessToken: token,
                    onClose: {
                        appState.closeSelectedMatch()
                        Task { await appState.refreshMatches() }
                    },
                    onMatchUpdated: { match in
                        appState.updateCachedMatch(match)
                    }
                )
            } else {
                MatchListView()
            }
        }
        .background(Color(red: 0.06, green: 0.11, blue: 0.25).ignoresSafeArea())
        .alert("Hinweis", isPresented: Binding(
            get: { appState.errorMessage != nil },
            set: { if !$0 { appState.errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {
                appState.errorMessage = nil
            }
        } message: {
            Text(appState.errorMessage ?? "")
        }
    }
}

private struct RemoteMatchContainer: View {
    @StateObject private var viewModel: RemoteMatchViewModel

    init(
        initialMatch: Match,
        accessToken: String,
        onClose: @escaping () -> Void,
        onMatchUpdated: @escaping (Match) -> Void
    ) {
        _viewModel = StateObject(
            wrappedValue: RemoteMatchViewModel(
                initialMatch: initialMatch,
                accessToken: accessToken,
                onClose: onClose,
                onMatchUpdated: onMatchUpdated
            )
        )
    }

    var body: some View {
        RemoteMatchView(viewModel: viewModel)
    }
}
