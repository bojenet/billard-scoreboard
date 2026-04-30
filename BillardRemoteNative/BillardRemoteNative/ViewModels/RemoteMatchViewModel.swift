import Combine
import Foundation

@MainActor
final class RemoteMatchViewModel: ObservableObject {
    @Published var match: Match
    @Published var errorMessage: String?
    @Published var isUpdating = false
    @Published var voiceButtonTitle = "Sprache aus"
    @Published var isVoiceActive = false
    @Published var isVoiceAvailable = false

    let speechService = SpeechCommandService()

    private let api: SupabaseAPI
    private let accessToken: String
    private let onClose: () -> Void
    private let onMatchUpdated: (Match) -> Void
    private var history: [MatchSnapshot] = []
    private var pollTask: Task<Void, Never>?
    private var finishedHandled = false
    private var cancellables = Set<AnyCancellable>()

    init(
        initialMatch: Match,
        accessToken: String,
        api: SupabaseAPI = .shared,
        onClose: @escaping () -> Void,
        onMatchUpdated: @escaping (Match) -> Void
    ) {
        self.match = initialMatch
        self.accessToken = accessToken
        self.api = api
        self.onClose = onClose
        self.onMatchUpdated = onMatchUpdated
        speechService.onCommand = { [weak self] command in
            await self?.handleVoiceCommand(command)
        }
        voiceButtonTitle = speechService.buttonTitle
        isVoiceActive = speechService.isActive
        isVoiceAvailable = speechService.isAvailable

        speechService.$buttonTitle
            .receive(on: DispatchQueue.main)
            .sink { [weak self] title in
                self?.voiceButtonTitle = title
            }
            .store(in: &cancellables)

        speechService.$isActive
            .receive(on: DispatchQueue.main)
            .sink { [weak self] active in
                self?.isVoiceActive = active
            }
            .store(in: &cancellables)

        speechService.$isAvailable
            .receive(on: DispatchQueue.main)
            .sink { [weak self] available in
                self?.isVoiceAvailable = available
            }
            .store(in: &cancellables)
    }

    var canControl: Bool {
        !match.finished && !isUpdating
    }

    var currentSeriesText: String {
        if match.finished {
            return "Partie beendet"
        }
        return "Serie: \(match.currentSeries > 0 ? "+\(match.currentSeries)" : "0")"
    }

    func start() {
        speechService.objectWillChange.send()
        voiceButtonTitle = speechService.buttonTitle
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            guard let self else { return }
            await self.refreshMatch()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: AppConfig.matchPollIntervalNanoseconds)
                await self.refreshMatch()
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
        speechService.stopAll()
    }

    func toggleVoice() {
        speechService.toggle()
        voiceButtonTitle = speechService.buttonTitle
    }

    func add(_ value: Int) async {
        guard canControl else { return }
        saveHistory()

        var series1 = match.series1
        var series2 = match.series2
        if match.activePlayer == 1 {
            series1 = clampSeries(match.score1, target: match.target1, value: series1 + value)
        } else {
            series2 = clampSeries(match.score2, target: match.target2, value: series2 + value)
        }

        await updateMatch([
            "series1": series1,
            "series2": series2
        ])
    }

    func setSeriesValue(_ value: Int) async {
        guard canControl else { return }
        saveHistory()

        var series1 = match.series1
        var series2 = match.series2
        let nextValue: Int
        if match.activePlayer == 1 {
            nextValue = clampSeries(match.score1, target: match.target1, value: value)
            series1 = nextValue
        } else {
            nextValue = clampSeries(match.score2, target: match.target2, value: value)
            series2 = nextValue
        }

        await updateMatch([
            "series1": series1,
            "series2": series2
        ])
    }

    func switchPlayer() async {
        guard canControl else { return }
        saveHistory()

        var score1 = match.score1
        var score2 = match.score2
        var series1 = match.series1
        var series2 = match.series2
        var high1 = match.high1
        var high2 = match.high2
        var inn1 = match.inn1
        var inn2 = match.inn2
        var totalInnings = match.totalInnings
        var activePlayer = match.activePlayer
        var seriesLog1 = match.seriesLog1 ?? []
        var seriesLog2 = match.seriesLog2 ?? []

        if activePlayer == 1 {
            score1 += series1
            high1 = max(high1, series1)
            if match.supportsSeriesLogs {
                seriesLog1.append(series1)
            }
            series1 = 0
            inn1 += 1
            activePlayer = 2
        } else {
            score2 += series2
            high2 = max(high2, series2)
            if match.supportsSeriesLogs {
                seriesLog2.append(series2)
            }
            series2 = 0
            inn2 += 1
            totalInnings += 1
            activePlayer = 1
        }

        var payload: [String: Any] = [
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
            "finished": detectWinner(
                score1: score1,
                score2: score2,
                inn1: inn1,
                inn2: inn2,
                target1: match.target1,
                target2: match.target2,
                maxInnings: match.maxInnings
            )
        ]

        if match.supportsSeriesLogs {
            payload["series_log1"] = seriesLog1
            payload["series_log2"] = seriesLog2
        }

        await updateMatch(payload)
    }

    func undo() async {
        guard canControl else { return }
        guard let previous = history.popLast() else { return }
        await updateMatch(previous.payload, saveHistory: false)
    }

    func finish() async {
        guard canControl else { return }
        await updateMatch(["finished": true], saveHistory: false)
    }

    private func handleVoiceCommand(_ command: VoiceCommand) async {
        switch command {
        case .set(let value):
            await setSeriesValue(value)
        case .add(let value):
            await add(value)
        case .switch:
            await switchPlayer()
        case .undo:
            await undo()
        case .finish:
            await finish()
        }
        voiceButtonTitle = speechService.buttonTitle
    }

    private func clampSeries(_ score: Int, target: Int, value: Int) -> Int {
        var next = max(0, value)
        if target > 0, score + next > target {
            next = max(0, target - score)
        }
        return next
    }

    private func detectWinner(
        score1: Int,
        score2: Int,
        inn1: Int,
        inn2: Int,
        target1: Int,
        target2: Int,
        maxInnings: Int
    ) -> Bool {
        if inn1 == inn2 {
            if target1 > 0, score1 >= target1, score2 < target2 { return true }
            if target2 > 0, score2 >= target2, score1 < target1 { return true }
            if target1 > 0, target2 > 0, score1 >= target1, score2 >= target2 { return true }
        }

        if maxInnings > 0, inn1 == inn2, inn1 >= maxInnings, inn2 >= maxInnings {
            return true
        }

        return false
    }

    private func saveHistory() {
        history.append(MatchSnapshot(match: match))
    }

    private func updateMatch(_ payload: [String: Any], saveHistory: Bool = true) async {
        if saveHistory == false {
            errorMessage = nil
        }
        isUpdating = true
        defer { isUpdating = false }
        do {
            try await api.updateMatch(accessToken: accessToken, matchID: match.id, payload: payload)
            await refreshMatch()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func refreshMatch() async {
        do {
            let refreshed = try await api.fetchMatch(accessToken: accessToken, matchID: match.id)
            match = refreshed
            onMatchUpdated(refreshed)
            if refreshed.finished, !finishedHandled {
                finishedHandled = true
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                onClose()
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        voiceButtonTitle = speechService.buttonTitle
    }
}
