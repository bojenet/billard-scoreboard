import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var appState: AppState
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        VStack(spacing: 20) {
            Spacer()

            VStack(spacing: 12) {
                Text("Match Remote")
                    .font(.system(size: 34, weight: .heavy))
                    .foregroundStyle(.white)
                Text("Native iPhone-App für die Punkteingabe")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.8))
            }

            VStack(spacing: 14) {
                TextField("E-Mail", text: $email)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                    .autocorrectionDisabled()
                    .padding()
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

                SecureField("Passwort", text: $password)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding()
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

                Button {
                    Task {
                        await appState.signIn(
                            email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                            password: password
                        )
                    }
                } label: {
                    HStack {
                        if appState.isAuthenticating {
                            ProgressView()
                                .tint(.black)
                        }
                        Text(appState.isAuthenticating ? "Anmeldung läuft …" : "Anmelden")
                            .font(.system(size: 20, weight: .bold))
                    }
                    .frame(maxWidth: .infinity, minHeight: 58)
                    .background(Color(red: 1.0, green: 0.85, blue: 0.29))
                    .foregroundStyle(.black)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .disabled(appState.isAuthenticating)
            }
            .padding(20)
            .background(Color(red: 0.09, green: 0.17, blue: 0.4))
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            .padding(.horizontal, 20)

            Spacer()
        }
    }
}
