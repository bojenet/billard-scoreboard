import AVFoundation
import Foundation
import Speech

@MainActor
final class SpeechCommandService: NSObject, ObservableObject {
    @Published private(set) var isActive = false
    @Published private(set) var isAvailable = false
    @Published private(set) var buttonTitle = "Sprache aus"

    var onCommand: ((VoiceCommand) async -> Void)?

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "de-DE"))
    private let audioEngine = AVAudioEngine()
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var lastHandledTranscript = ""
    private var shouldContinueListening = false

    override init() {
        super.init()
        isAvailable = recognizer?.isAvailable ?? false
        recognizer?.delegate = self
        updateButton()
    }

    func toggle() {
        if isActive {
            shouldContinueListening = false
            stopListening()
            return
        }

        Task {
            let granted = await requestPermissionsIfNeeded()
            guard granted else { return }
            do {
                shouldContinueListening = true
                try startListening()
            } catch {
                shouldContinueListening = false
                stopListening()
            }
        }
    }

    func stopAll() {
        shouldContinueListening = false
        stopListening()
    }

    private func requestPermissionsIfNeeded() async -> Bool {
        let speechAllowed = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }

        let microphoneAllowed = await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { allowed in
                continuation.resume(returning: allowed)
            }
        }

        return speechAllowed && microphoneAllowed
    }

    private func startListening() throws {
        stopListening()

        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.record, mode: .measurement, options: [.duckOthers])
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)

        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        recognitionRequest?.shouldReportPartialResults = true
        lastHandledTranscript = ""

        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        inputNode.removeTap(onBus: 0)
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }

        audioEngine.prepare()
        try audioEngine.start()
        isActive = true
        updateButton()

        recognitionTask = recognizer?.recognitionTask(with: recognitionRequest!) { [weak self] result, error in
            guard let self else { return }
            if let result {
                let transcript = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
                Task { @MainActor in
                    await self.consume(transcript: transcript, isFinal: result.isFinal)
                }
            }

            if error != nil {
                Task { @MainActor in
                    self.restartIfNeeded()
                }
            }
        }
    }

    private func stopListening() {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionRequest = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        isActive = false
        updateButton()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func restartIfNeeded() {
        let keepGoing = shouldContinueListening
        stopListening()
        guard keepGoing else { return }
        Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            guard self.shouldContinueListening else { return }
            do {
                try self.startListening()
            } catch {
                self.shouldContinueListening = false
                self.stopListening()
            }
        }
    }

    private func consume(transcript: String, isFinal: Bool) async {
        let normalized = transcript.lowercased()
        guard !normalized.isEmpty else { return }
        guard normalized != lastHandledTranscript || isFinal else { return }

        if let command = Self.parseVoiceCommand(normalized) {
            lastHandledTranscript = normalized
            shouldContinueListening = true
            stopListening()
            await onCommand?(command)
            restartIfNeeded()
            return
        }

        if isFinal {
            restartIfNeeded()
        }
    }

    private func updateButton() {
        if !isAvailable {
            buttonTitle = "Sprache nicht verfügbar"
        } else {
            buttonTitle = isActive ? "Sprache an" : "Sprache aus"
        }
    }

    static func parseVoiceCommand(_ text: String) -> VoiceCommand? {
        let normalized = text
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "ß", with: "ss")
            .replacingOccurrences(of: "-", with: "")

        guard !normalized.isEmpty else { return nil }

        if normalized == "plus" || normalized == "+" {
            return .add(1)
        }
        if normalized.contains("plus funf") || normalized.contains("plus fuenf") || normalized.contains("plus fünf") || normalized == "+5" {
            return .add(5)
        }
        if normalized.contains("plus zehn") || normalized == "+10" {
            return .add(10)
        }
        if normalized == "minus" || normalized == "minus eins" || normalized == "-1" {
            return .add(-1)
        }
        if normalized.contains("wechsel") || normalized.contains("spielerwechsel") || normalized.contains("naechste aufnahme") || normalized.contains("nächste aufnahme") {
            return .switch
        }
        if normalized.contains("undo") || normalized.contains("ruckgangig") || normalized.contains("rueckgaengig") || normalized.contains("rückgängig") {
            return .undo
        }
        if normalized.contains("beenden") || normalized == "ende" {
            return .finish
        }

        if let direct = Int(normalized), (0 ... 300).contains(direct) {
            return .set(direct)
        }

        if let spoken = parseGermanNumber(normalized), (0 ... 300).contains(spoken) {
            return .set(spoken)
        }

        return nil
    }

    private static func parseGermanNumber(_ value: String) -> Int? {
        let directMap: [String: Int] = [
            "null": 0,
            "ein": 1,
            "eins": 1,
            "eine": 1,
            "zwei": 2,
            "drei": 3,
            "vier": 4,
            "funf": 5,
            "fuenf": 5,
            "fünf": 5,
            "sechs": 6,
            "sieben": 7,
            "acht": 8,
            "neun": 9,
            "zehn": 10,
            "elf": 11,
            "zwolf": 12,
            "zwoelf": 12,
            "zwölf": 12,
            "dreizehn": 13,
            "vierzehn": 14,
            "funfzehn": 15,
            "fuenfzehn": 15,
            "fünfzehn": 15,
            "sechzehn": 16,
            "siebzehn": 17,
            "achtzehn": 18,
            "neunzehn": 19,
            "zwanzig": 20,
            "dreissig": 30,
            "dreißig": 30,
            "vierzig": 40,
            "funfzig": 50,
            "fuenfzig": 50,
            "fünfzig": 50,
            "sechzig": 60,
            "siebzig": 70,
            "achtzig": 80,
            "neunzig": 90,
            "hundert": 100,
            "zweihundert": 200,
            "dreihundert": 300
        ]
        if let direct = directMap[value] {
            return direct
        }

        let onesMap: [String: Int] = [
            "ein": 1,
            "eins": 1,
            "eine": 1,
            "zwei": 2,
            "drei": 3,
            "vier": 4,
            "funf": 5,
            "fuenf": 5,
            "fünf": 5,
            "sechs": 6,
            "sieben": 7,
            "acht": 8,
            "neun": 9
        ]
        let tensMap: [String: Int] = [
            "zwanzig": 20,
            "dreissig": 30,
            "dreißig": 30,
            "vierzig": 40,
            "funfzig": 50,
            "fuenfzig": 50,
            "fünfzig": 50,
            "sechzig": 60,
            "siebzig": 70,
            "achtzig": 80,
            "neunzig": 90
        ]

        if let undRange = value.range(of: "und") {
            let onesPart = String(value[..<undRange.lowerBound])
            let tensPart = String(value[undRange.upperBound...])
            if let ones = onesMap[onesPart], let tens = tensMap[tensPart] {
                return ones + tens
            }
        }

        return nil
    }
}

extension SpeechCommandService: SFSpeechRecognizerDelegate {
    nonisolated func speechRecognizer(_ speechRecognizer: SFSpeechRecognizer, availabilityDidChange available: Bool) {
        Task { @MainActor in
            self.isAvailable = available
            self.updateButton()
        }
    }
}
