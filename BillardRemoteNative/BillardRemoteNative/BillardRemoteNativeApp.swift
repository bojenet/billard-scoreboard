import SwiftUI

@main
struct BillardRemoteNativeApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appState)
                .task {
                    await appState.restoreSessionIfPossible()
                }
        }
    }
}
