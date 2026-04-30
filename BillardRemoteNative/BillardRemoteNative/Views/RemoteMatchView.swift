import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct RemoteMatchView: View {
    @ObservedObject var viewModel: RemoteMatchViewModel

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Text("Match Remote")
                    .font(.system(size: 30, weight: .heavy))
                    .foregroundStyle(.white)
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)

            HStack(spacing: 10) {
                PlayerMiniCard(
                    name: viewModel.match.player1,
                    discipline: viewModel.match.targetDescription1,
                    score: viewModel.match.score1,
                    innings: viewModel.match.inn1,
                    average: viewModel.match.average1,
                    highRun: viewModel.match.high1,
                    isActive: viewModel.match.activePlayer == 1,
                    activeColor: .white
                )
                PlayerMiniCard(
                    name: viewModel.match.player2,
                    discipline: viewModel.match.targetDescription2,
                    score: viewModel.match.score2,
                    innings: viewModel.match.inn2,
                    average: viewModel.match.average2,
                    highRun: viewModel.match.high2,
                    isActive: viewModel.match.activePlayer == 2,
                    activeColor: Color(red: 1.0, green: 0.85, blue: 0.29)
                )
            }
            .padding(.horizontal, 16)

            Text(viewModel.currentSeriesText)
                .font(.system(size: 36, weight: .black))
                .foregroundStyle(viewModel.match.activePlayer == 1 ? .white : Color(red: 1.0, green: 0.85, blue: 0.29))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)

            VStack(spacing: 12) {
                PrimaryActionButton(
                    title: "+1",
                    background: Color(red: 0.11, green: 0.2, blue: 0.5),
                    foreground: .white,
                    minHeight: 150
                ) {
                    Task { await viewModel.add(1) }
                }
                .disabled(!viewModel.canControl)

                HStack(spacing: 12) {
                    PrimaryActionButton(
                        title: "+5",
                        background: Color(red: 0.11, green: 0.2, blue: 0.5),
                        foreground: .white,
                        minHeight: 88
                    ) {
                        Task { await viewModel.add(5) }
                    }
                    .disabled(!viewModel.canControl)

                    PrimaryActionButton(
                        title: "+10",
                        background: Color(red: 0.11, green: 0.2, blue: 0.5),
                        foreground: .white,
                        minHeight: 88
                    ) {
                        Task { await viewModel.add(10) }
                    }
                    .disabled(!viewModel.canControl)

                    PrimaryActionButton(
                        title: "-1",
                        background: Color(red: 0.11, green: 0.2, blue: 0.5),
                        foreground: .white,
                        minHeight: 88
                    ) {
                        Task { await viewModel.add(-1) }
                    }
                    .disabled(!viewModel.canControl)
                }

                HStack(spacing: 12) {
                    PrimaryActionButton(
                        title: "Wechsel",
                        background: Color(red: 1.0, green: 0.85, blue: 0.29),
                        foreground: .black,
                        minHeight: 88
                    ) {
                        Task { await viewModel.switchPlayer() }
                    }
                    .disabled(!viewModel.canControl)

                    PrimaryActionButton(
                        title: "Undo",
                        background: Color(red: 0.11, green: 0.2, blue: 0.5),
                        foreground: .white,
                        minHeight: 88
                    ) {
                        Task { await viewModel.undo() }
                    }
                    .disabled(!viewModel.canControl)

                    PrimaryActionButton(
                        title: "Beenden",
                        background: Color(red: 0.66, green: 0.13, blue: 0.13),
                        foreground: .white,
                        minHeight: 88
                    ) {
                        Task { await viewModel.finish() }
                    }
                    .disabled(!viewModel.canControl)
                }

                HStack(spacing: 12) {
                    PrimaryActionButton(
                        title: viewModel.voiceButtonTitle,
                        background: viewModel.isVoiceActive ? Color(red: 0.55, green: 0.14, blue: 0.14) : Color(red: 0.11, green: 0.2, blue: 0.5),
                        foreground: .white,
                        minHeight: 76
                    ) {
                        viewModel.toggleVoice()
                    }
                    .disabled(!viewModel.isVoiceAvailable)

                    VStack {
                        Text("Display bleibt aktiv")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.white)
                        Text("native Idle-Timer-Sperre")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.78))
                    }
                    .frame(maxWidth: .infinity, minHeight: 76)
                    .background(Color(red: 0.09, green: 0.16, blue: 0.37))
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(Color(red: 0.18, green: 0.28, blue: 0.56), lineWidth: 1)
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
            }
            .padding(.horizontal, 16)

            if let errorMessage = viewModel.errorMessage, !errorMessage.isEmpty {
                Text(errorMessage)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color(red: 1.0, green: 0.85, blue: 0.29))
                    .padding(.horizontal, 16)
                    .multilineTextAlignment(.center)
            }

            Spacer(minLength: 0)
        }
        .onAppear {
            #if canImport(UIKit)
            UIApplication.shared.isIdleTimerDisabled = true
            #endif
            viewModel.start()
        }
        .onDisappear {
            #if canImport(UIKit)
            UIApplication.shared.isIdleTimerDisabled = false
            #endif
            viewModel.stop()
        }
    }
}
