# BillardRemoteNative

Native SwiftUI-iPhone-App für die Match-Remote-Bedienung.

## Enthalten

- Login gegen bestehendes Supabase-Projekt
- Liste laufender Matches mit Zugriff wie in `remote.html`
- Remote-Matchscreen mit:
  - `+1`, `+5`, `+10`, `-1`
  - `Wechsel`
  - `Undo`
  - `Beenden`
  - Spracheingabe
- natives Wachhalten des Displays per `isIdleTimerDisabled`
- Polling statt Browser-Realtime, angelehnt an die bestehende Web-Remote

## Start in Xcode

1. [BillardRemoteNative.xcodeproj](./BillardRemoteNative.xcodeproj) in Xcode öffnen
2. Unter `Signing & Capabilities` dein Team wählen
3. Ein echtes iPhone auswählen
4. App starten

## Hinweise

- Für Sprache müssen Mikrofon- und Speech-Rechte erlaubt werden.
- Die App nutzt bewusst das bestehende Supabase-Backend und führt keine neue Serverlogik ein.
- Das AppIcon-Set ist noch leer und sollte vor produktivem Einsatz ergänzt werden.
